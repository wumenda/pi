import { join, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { HarnessEvent } from "@earendil-works/pi-agent-core";
import {
	createMcpTools,
	isVisibleToLlm,
	McpServerManager,
	mcpToolName,
} from "@earendil-works/pi-agent-core/harness/mcp";
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import type { RoutedSessionHandle, ServerHost } from "@earendil-works/pi-server";
import type { AppServerConfig } from "./config.ts";
import type { AppServerLlm } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { loadMcpServerConfigs } from "./mcp-config.ts";
import { createSessionRuntime, type SessionRuntime } from "./runtime.ts";
import { createServerServices, type ServerServices } from "./services/server-services.ts";
import { createSessionServices, type SessionServiceRuntime } from "./services/session-services.ts";
import type { SessionStore } from "./sessions.ts";
import { createToolEventRecorder, recordToolEvent, type ToolEventRecorder } from "./tool-events.ts";

const log = createLogger("host");

export interface AppServerHostDeps {
	config: AppServerConfig;
	store: SessionStore;
	llm: AppServerLlm;
}

export interface AppServerHostHandle {
	readonly host: ServerHost<JsonlSessionMetadata>;
	readonly services: ServerServices;
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

/** 会话运行时缓存：attach/detach 不销毁，removeSession 与 shutdown 才关闭。 */
export async function createAppServerHost(deps: AppServerHostDeps, serverId: string): Promise<AppServerHostHandle> {
	const runtimes = new Map<string, RuntimeEntry>();
	const workspaceDir = resolve(deps.config.dataDir, "workspace");
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
	const services = await createServerServices({
		list: async () => (await deps.store.list()).map(toSummary),
		create: async (createOptions) => toSummary(await deps.store.create(createOptions.id)),
		remove: async (sessionId) => {
			await closeRuntime(sessionId);
			await deps.store.delete(sessionId);
		},
	});
	const host: ServerHost<JsonlSessionMetadata> = {
		serverServices: services.host,
		async resolveSession(sessionId) {
			try {
				const metadata = await deps.store.resolve(sessionId);
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
				const session = await deps.store.open(metadata);
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
		async close() {
			for (const sessionId of [...runtimes.keys()]) await closeRuntime(sessionId);
			await services.dispose();
		},
	};
}
