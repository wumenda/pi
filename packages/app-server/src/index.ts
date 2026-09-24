import { randomUUID } from "node:crypto";
import type { SessionMetadata } from "@earendil-works/pi-agent-core";
import { Server, type ServerHost } from "@earendil-works/pi-server";
import type { AppServerConfig } from "./config.ts";
import { type AppServerHostHandle, createAppServerHost } from "./host.ts";
import { createHttpServer } from "./http.ts";
import type { AppServerLlm } from "./llm.ts";
import type { SessionStore } from "./sessions.ts";
import { createTokenWsListener } from "./token-ws-listener.ts";

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
	/** HTTP 监听端口（ui-resources 端点）；0 = OS 分配（默认）。 */
	httpPort?: number;
	httpHost?: string;
	/** 有 deps 时装配真实服务（会话目录 / 管理 / 会话级 chord 服务）；缺省保持最小桩。 */
	deps?: AppServerDeps;
}

export interface AppServerHandle {
	readonly serverId: string;
	/** 实际绑定端口；start() 前访问抛错。 */
	readonly wsPort: number;
	/** HTTP 实际绑定端口；start() 前或无 deps 时访问抛错。 */
	readonly httpPort: number;
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
	const token = options.deps?.config.token;
	const listener = createTokenWsListener({
		port: options.wsPort ?? 0,
		host: options.wsHost ?? "127.0.0.1",
		...(token === undefined ? {} : { token }),
	});
	let server: Server<SessionMetadata> | undefined;
	let hostHandle: AppServerHostHandle | undefined;
	let http: ReturnType<typeof createHttpServer> | undefined;
	let httpPort: number | undefined;
	return {
		serverId,
		get wsPort() {
			const address = listener.address;
			if (address === undefined) throw new Error("App server is not started");
			return address.port;
		},
		get httpPort() {
			if (httpPort === undefined) throw new Error("App server HTTP is not started");
			return httpPort;
		},
		async start() {
			if (server !== undefined) throw new Error("App server is already started");
			if (options.deps !== undefined) {
				const handle = await createAppServerHost(options.deps, serverId);
				hostHandle = handle;
				http = createHttpServer(
					{
						httpPort: options.httpPort ?? options.deps.config.httpPort,
						token: options.deps.config.token,
					},
					{
						readUiResource: (request) => handle.readUiResource(request),
						listMcpTools: () => handle.listMcpTools(),
						sessionFilesRoot: (sessionId) => handle.sessionFilesRoot(sessionId),
					},
				);
				await http.listen({
					port: options.httpPort ?? options.deps.config.httpPort,
					host: options.httpHost ?? "127.0.0.1",
				});
				const address = http.addresses().find((entry) => entry.family === "IPv4") ?? http.addresses()[0];
				httpPort = typeof address === "object" ? address.port : (options.httpPort ?? 0);
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
				const closingHttp = http;
				http = undefined;
				httpPort = undefined;
				if (closingHttp !== undefined) await closingHttp.close().catch(() => undefined);
				if (closing !== undefined) await closing.close();
			}
		},
	};
}
