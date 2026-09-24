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
	 * 资源为静态应用文档：任一已连接该 server 的会话 manager 读取等价；
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
	// 存活会话的 MCP manager 登记：ui-resources 端点按需复用已连接实例读静态资源
	const managers = new Set<McpServerManager>();
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
		managers.delete(entry.runtime.mcp);
		log.info(`closing runtime for session ${sessionId}`);
		for (const unsubscribe of entry.unsubscribe) unsubscribe();
		await entry.services.dispose().catch(() => undefined);
		await entry.runtime.close().catch(() => undefined);
	}
	const readUiResource = async (request: { serverId: string; resourceUri: string }) => {
		let lastError: unknown;
		for (const manager of managers) {
			try {
				const contents = await manager.readResource(request.serverId, request.resourceUri);
				const first = contents.contents[0];
				const csp = manager
					.tools()
					.filter(
						(routed) =>
							routed.serverId === request.serverId &&
							extractMcpToolUi(routed)?.resourceUri === request.resourceUri,
					)
					.map((routed) => extractMcpToolUi(routed)?.csp)
					.find((csp) => csp !== undefined);
				return {
					mimeType: first?.mimeType ?? "text/html",
					html: first?.text ?? "",
					declaredCsp: csp ?? null,
				};
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError instanceof Error ? lastError : new Error(`no connected manager for ${request.serverId}`);
	};
	// MCP Apps 工具清单：跨存活会话 manager 聚合带 ui:// 声明的工具（按 serverId+name 去重）
	const listMcpTools = async (): Promise<McpToolManifestEntry[]> => {
		const seen = new Set<string>();
		const entries: McpToolManifestEntry[] = [];
		for (const manager of managers) {
			for (const routed of manager.tools()) {
				const ui = extractMcpToolUi(routed);
				if (ui === undefined) continue;
				const key = `${routed.serverId}\0${routed.tool.name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const visibility = declaredVisibility(routed);
				entries.push({
					serverId: routed.serverId,
					name: routed.tool.name,
					resourceUri: ui.resourceUri,
					...(visibility === undefined ? {} : { visibility }),
				});
			}
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
				let mcpManager: McpServerManager | undefined;
				try {
					const mcpConfigPath = deps.config.mcpConfigPath ?? join(deps.config.dataDir, "mcp.json");
					const mcpConfig = await loadMcpServerConfigs(mcpConfigPath);
					const manager = new McpServerManager(mcpConfig);
					mcpManager = manager;
					for (const status of await manager.connectAll()) {
						log.info(
							`mcp server ${status.id}: state=${status.state} toolCount=${status.toolCount}${status.error === undefined ? "" : ` error=${status.error}`}`,
						);
					}
					managers.add(manager);
					const mcpTools = createMcpTools(manager);
					const runtime = await createSessionRuntime({
						session,
						models: deps.llm.models,
						model: deps.llm.model,
						workspaceDir,
						mcp: manager,
						extraTools: mcpTools,
						// MCP Apps app-only 工具（visibility=["app"]）仅 iframe 经反向调用可用
						hiddenFromLlm: manager
							.tools()
							.filter((routed) => !isVisibleToLlm(routed))
							.map((routed) => mcpToolName(routed.serverId, routed.tool.name)),
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
					await mcpManager?.close().catch(() => undefined);
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
			await services.dispose();
		},
	};
}
