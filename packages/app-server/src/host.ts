import { join, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { HarnessEvent } from "@earendil-works/pi-agent-core";
import {
	createMcpTools,
	extractMcpToolUi,
	isVisibleToLlm,
	type McpRoutedTool,
	McpServerManager,
	mcpToolName,
} from "@earendil-works/pi-agent-core/harness/mcp";
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import type { RoutedSessionHandle, ServerHost } from "@earendil-works/pi-server";
import type { AppServerConfig } from "./config.ts";
import type { McpToolManifestEntry } from "./http.ts";
import type { AppServerLlm } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { loadMcpServerConfigs } from "./mcp-config.ts";
import { createSessionRuntime, type SessionRuntime } from "./runtime.ts";
import { createServerServices, type ServerServices } from "./services/server-services.ts";
import { createSessionServices, type SessionServiceRuntime } from "./services/session-services.ts";
import { createSessionStore, type SessionStore } from "./sessions.ts";
import { createToolEventRecorder, recordToolEvent, type ToolEventRecorder } from "./tool-events.ts";

const log = createLogger("host");

export interface AppServerHostDeps {
	config: AppServerConfig;
	llm: AppServerLlm;
}

export interface AppServerHostHandle {
	readonly host: ServerHost<JsonlSessionMetadata>;
	readonly services: ServerServices;
	/**
	 * 读取 MCP Apps ui:// 资源（HTTP ui-resources 端点用）。
	 * 资源为静态应用文档：host 级共享 manager 读取，会话存活与否不影响可用性（B1）；
	 * declaredCsp 取声明该 resourceUri 的工具 `_meta.ui.csp`（未声明 null）。
	 */
	readUiResource(request: { serverId: string; resourceUri: string }): Promise<{
		mimeType: string;
		html: string;
		declaredCsp: string | null;
	}>;
	/** MCP Apps 工具清单（HTTP mcp-tools 端点用）：带 ui:// 声明的工具 + 受众可见性 */
	listMcpTools(): Promise<McpToolManifestEntry[]>;
	/** 会话文件根目录（文件上传/下载端点用，安全边界）；未知会话返回 null */
	sessionFilesRoot(sessionId: string): Promise<string | null>;
	close(): Promise<void>;
}

interface RuntimeEntry {
	runtime: SessionRuntime;
	services: SessionServiceRuntime;
	unsubscribe: Array<() => void>;
}

/** 订阅 harness 工具事件并落盘；映射失败只记日志，不影响运行。 */
function subscribeToolEvents(runtime: SessionRuntime, recorder: ToolEventRecorder): Array<() => void> {
	const unsubscribe: Array<() => void> = [];
	const onToolEvent = (event: HarnessEvent): void => {
		recordToolEvent(recorder, event).catch((error) => {
			log.error(`tool event record failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	};
	for (const type of ["tool_start", "tool_update", "tool_end"] as const) {
		unsubscribe.push(runtime.harness.events.on(type, onToolEvent));
	}
	return unsubscribe;
}

/** 工具的受众可见性声明（_meta.ui.visibility）；未声明或为空返回 undefined */
function declaredVisibility(routed: McpRoutedTool): string[] | undefined {
	const meta = routed.tool._meta;
	if (typeof meta !== "object" || meta === null) return undefined;
	const ui = (meta as { ui?: unknown }).ui;
	if (typeof ui !== "object" || ui === null) return undefined;
	const visibility = (ui as { visibility?: unknown }).visibility;
	if (!Array.isArray(visibility)) return undefined;
	const list = visibility.filter((entry): entry is string => typeof entry === "string");
	return list.length > 0 ? list : undefined;
}

/** 会话运行时缓存：attach/detach 不销毁，removeSession 与 shutdown 才关闭。 */
export async function createAppServerHost(deps: AppServerHostDeps, serverId: string): Promise<AppServerHostHandle> {
	const runtimes = new Map<string, RuntimeEntry>();
	// host 级共享 MCP manager（B1）：app-server 启动即连接，供全部会话、ui-resources
	// 端点与 mcp-tools 清单共用——会话关闭不回收，host.close() 统一释放。
	// 配置缺失/坏 JSON 由 loadMcpServerConfigs 降级为空 map（error 日志），不阻塞启动；
	// per-server 连接失败记录进 statuses，不抛。
	const mcpConfigPath = deps.config.mcpConfigPath ?? join(deps.config.dataDir, "mcp.json");
	const mcp = new McpServerManager(await loadMcpServerConfigs(mcpConfigPath));
	for (const status of await mcp.connectAll()) {
		log.info(
			`mcp server ${status.id}: state=${status.state} toolCount=${status.toolCount}${status.error === undefined ? "" : ` error=${status.error}`}`,
		);
	}
	// 桥接工具与 (serverId, toolName) → 最终桥接名映射在构造期计算一次（B1 后 manager
	// 进程内单例、无自动重连，tools 快照恒定）；清单据映射携带 harnessName，撞名 `_`
	// 后缀的桥接名也能被前端精确匹配（A1）。
	const mcpBridge = createMcpTools(mcp);
	const harnessNames = new Map(
		mcpBridge.provenance.map((entry) => [`${entry.serverId}\0${entry.toolName}`, entry.harnessName] as const),
	);
	// MCP Apps app-only 工具（visibility=["app"]）仅 iframe 经反向调用可用
	const hiddenFromLlm: readonly string[] = mcp
		.tools()
		.filter((routed) => !isVisibleToLlm(routed))
		.map((routed) => mcpToolName(routed.serverId, routed.tool.name));
	const workspaceDir = resolve(deps.config.dataDir, "workspace");
	// 会话存储按 host 的 dataDir 构造：多用户隔离（Task 27）通过 per-user dataDir 派生实现
	const store: SessionStore = createSessionStore({ dataDir: deps.config.dataDir, workspaceDir });
	const toSummary = (metadata: JsonlSessionMetadata) => ({
		serverId,
		sessionId: metadata.id,
		createdAt: metadata.createdAt,
	});
	async function closeRuntime(sessionId: string): Promise<void> {
		const entry = runtimes.get(sessionId);
		if (entry === undefined) return;
		runtimes.delete(sessionId);
		log.info(`closing runtime for session ${sessionId}`);
		for (const unsubscribe of entry.unsubscribe) unsubscribe();
		await entry.services.dispose().catch(() => undefined);
		await entry.runtime.close().catch(() => undefined);
	}
	const readUiResource = async (request: { serverId: string; resourceUri: string }) => {
		const contents = await mcp.readResource(request.serverId, request.resourceUri);
		const first = contents.contents[0];
		const csp = mcp
			.tools()
			.filter(
				(routed) =>
					routed.serverId === request.serverId && extractMcpToolUi(routed)?.resourceUri === request.resourceUri,
			)
			.map((routed) => extractMcpToolUi(routed)?.csp)
			.find((csp) => csp !== undefined);
		return {
			mimeType: first?.mimeType ?? "text/html",
			html: first?.text ?? "",
			declaredCsp: csp ?? null,
		};
	};
	// MCP Apps 工具清单：host 级共享 manager 中带 ui:// 声明的工具
	//（单 manager 内 serverId 为配置键、tool 名 server 内唯一，无需去重）
	const listMcpTools = async (): Promise<McpToolManifestEntry[]> => {
		const entries: McpToolManifestEntry[] = [];
		for (const routed of mcp.tools()) {
			const ui = extractMcpToolUi(routed);
			if (ui === undefined) continue;
			const visibility = declaredVisibility(routed);
			const harnessName = harnessNames.get(`${routed.serverId}\0${routed.tool.name}`);
			entries.push({
				serverId: routed.serverId,
				name: routed.tool.name,
				resourceUri: ui.resourceUri,
				...(harnessName === undefined ? {} : { harnessName }),
				...(visibility === undefined ? {} : { visibility }),
			});
		}
		return entries;
	};
	// 会话文件根：<dataDir>/sessions-workspace/<sessionId>；store.resolve 校验存在性（含路径注入拒绝）
	const sessionFilesRoot = async (sessionId: string): Promise<string | null> => {
		try {
			await store.resolve(sessionId);
			return resolve(deps.config.dataDir, "sessions-workspace", sessionId);
		} catch {
			return null;
		}
	};
	const services = await createServerServices({
		list: async () => (await store.list()).map(toSummary),
		create: async (createOptions) => toSummary(await store.create(createOptions.id)),
		remove: async (sessionId) => {
			await closeRuntime(sessionId);
			await store.delete(sessionId);
		},
	});
	const host: ServerHost<JsonlSessionMetadata> = {
		serverServices: services.host,
		async resolveSession(sessionId) {
			try {
				const metadata = await store.resolve(sessionId);
				log.info(`resolveSession ${sessionId}: found (createdAt=${metadata.createdAt})`);
				return metadata;
			} catch (error) {
				log.error(`resolveSession ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
				throw error;
			}
		},
		async openSession(metadata) {
			let entry = runtimes.get(metadata.id);
			if (entry === undefined) {
				const startedAt = Date.now();
				log.info(`openSession ${metadata.id}: creating runtime`);
				const session = await store.open(metadata);
				try {
					const runtime = await createSessionRuntime({
						session,
						models: deps.llm.models,
						model: deps.llm.model,
						workspaceDir,
						mcp,
						extraTools: mcpBridge.tools,
						hiddenFromLlm,
					});
					const recorder = createToolEventRecorder(deps.config.dataDir, metadata.id);
					const sessionServices = await createSessionServices(runtime, recorder);
					const unsubscribe = subscribeToolEvents(runtime, recorder);
					entry = { runtime, services: sessionServices, unsubscribe };
					runtimes.set(metadata.id, entry);
					log.info(`openSession ${metadata.id}: runtime ready in ${Date.now() - startedAt}ms`);
				} catch (error) {
					log.error(
						`openSession ${metadata.id}: runtime failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					await session.close(BACKGROUND_CONTEXT).catch(() => undefined);
					throw error;
				}
			} else {
				log.info(`openSession ${metadata.id}: reusing cached runtime`);
			}
			const active = entry;
			const handle: RoutedSessionHandle = {
				attachClient: (context: Context) => active.services.attachmentFactory(context),
				close: async () => {
					await closeRuntime(metadata.id);
				},
			};
			return handle;
		},
	};
	return {
		host,
		services,
		readUiResource,
		listMcpTools,
		sessionFilesRoot,
		async close() {
			for (const sessionId of [...runtimes.keys()]) await closeRuntime(sessionId);
			await mcp.close();
			await services.dispose();
		},
	};
}
