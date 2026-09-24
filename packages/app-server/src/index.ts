import { randomUUID } from "node:crypto";
import type { SessionMetadata } from "@earendil-works/pi-agent-core";
import { Server, type ServerHost } from "@earendil-works/pi-server";
import { createWsListener } from "@earendil-works/pi-server/ws";
import type { AppServerConfig } from "./config.ts";
import { type AppServerHostHandle, createAppServerHost } from "./host.ts";
import type { AppServerLlm } from "./llm.ts";
import type { SessionStore } from "./sessions.ts";

export interface AppServerDeps {
	config: AppServerConfig;
	store: SessionStore;
	llm: AppServerLlm;
}

export interface AppServerOptions {
	/** 固定 serverId（测试用）；缺省随机 UUIDv4。 */
	serverId?: string;
	/** WS 监听端口；0 = OS 分配（默认）。 */
	wsPort?: number;
	wsHost?: string;
	/** 有 deps 时装配真实服务（会话目录 / 管理 / 会话级 chord 服务）；缺省保持最小桩。 */
	deps?: AppServerDeps;
}

export interface AppServerHandle {
	readonly serverId: string;
	/** 实际绑定端口；start() 前访问抛错。 */
	readonly wsPort: number;
	start(): Promise<void>;
	close(): Promise<void>;
}

function createStubHost(): ServerHost<SessionMetadata> {
	// 无 deps 时的最小 attachment：让 hello 握手通过。
	return {
		serverServices: {
			attachClient() {
				return {
					invokeService() {
						return Promise.reject(new Error("Server services are not implemented yet"));
					},
					release() {},
				};
			},
		},
		async resolveSession() {
			throw new Error("Sessions are not implemented yet");
		},
		async openSession() {
			throw new Error("Sessions are not implemented yet");
		},
	};
}

export function createAppServer(options: AppServerOptions = {}): AppServerHandle {
	const serverId = options.serverId ?? randomUUID();
	const listener = createWsListener({
		port: options.wsPort ?? 0,
		host: options.wsHost ?? "127.0.0.1",
	});
	let server: Server<SessionMetadata> | undefined;
	let hostHandle: AppServerHostHandle | undefined;
	return {
		serverId,
		get wsPort() {
			const address = listener.address;
			if (address === undefined) throw new Error("App server is not started");
			return address.port;
		},
		async start() {
			if (server !== undefined) throw new Error("App server is already started");
			if (options.deps !== undefined) {
				hostHandle = await createAppServerHost(options.deps, serverId);
			}
			const host: ServerHost<SessionMetadata> = hostHandle !== undefined ? hostHandle.host : createStubHost();
			server = new Server(host, { listeners: [listener], serverId });
			await server.start();
		},
		async close() {
			try {
				const active = server;
				server = undefined;
				if (active !== undefined) await active.close();
				else await listener.close();
			} finally {
				const closing = hostHandle;
				hostHandle = undefined;
				if (closing !== undefined) await closing.close();
			}
		},
	};
}
