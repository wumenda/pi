import { resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonlSessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import type { RoutedSessionHandle, ServerHost } from "@earendil-works/pi-server";
import type { AppServerConfig } from "./config.ts";
import type { AppServerLlm } from "./llm.ts";
import { createSessionRuntime, type SessionRuntime } from "./runtime.ts";
import { createServerServices, type ServerServices } from "./services/server-services.ts";
import { createSessionServices, type SessionServiceRuntime } from "./services/session-services.ts";
import type { SessionStore } from "./sessions.ts";

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
		resolveSession: (sessionId) => deps.store.resolve(sessionId),
		async openSession(metadata) {
			let entry = runtimes.get(metadata.id);
			if (entry === undefined) {
				const session = await deps.store.open(metadata);
				try {
					const runtime = await createSessionRuntime({
						session,
						models: deps.llm.models,
						model: deps.llm.model,
						workspaceDir,
					});
					const sessionServices = await createSessionServices(runtime);
					entry = { runtime, services: sessionServices };
					runtimes.set(metadata.id, entry);
				} catch (error) {
					await session.close(BACKGROUND_CONTEXT).catch(() => undefined);
					throw error;
				}
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
