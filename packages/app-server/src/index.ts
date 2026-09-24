import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SessionMetadata } from "@earendil-works/pi-agent-core";
import { Server, type ServerHost } from "@earendil-works/pi-server";
import type { AppServerConfig } from "./config.ts";
import { type AppServerHostHandle, createAppServerHost } from "./host.ts";
import { createHttpServer } from "./http.ts";
import type { AppServerLlm } from "./llm.ts";
import { connectionUserId, createTokenWsListener } from "./token-ws-listener.ts";

export interface AppServerDeps {
	config: AppServerConfig;
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

/** per-user 连接路由的兜底 handler：users 模式下身份连接必有归属，此分支仅防御。 */
function orphanConnectionHandler(): { onData(): void; onClose(): void; onError(error: Error): void } {
	return { onData() {}, onClose() {}, onError() {} };
}

export function createAppServer(options: AppServerOptions = {}): AppServerHandle {
	const serverId = options.serverId ?? randomUUID();
	const config = options.deps?.config;
	const users = config?.users;
	const listener = createTokenWsListener({
		port: options.wsPort ?? 0,
		host: options.wsHost ?? "127.0.0.1",
		...(config?.token === undefined ? {} : { token: config.token }),
		...(users === undefined ? {} : { users }),
	});
	let server: Server<SessionMetadata> | undefined;
	let hostHandle: AppServerHostHandle | undefined;
	/** users 模式：userId → per-user host + Server（连接按 upgrade 解析的 userId 路由）。 */
	const userHosts = new Map<string, AppServerHostHandle>();
	const userServers = new Map<string, Server<SessionMetadata>>();
	let http: ReturnType<typeof createHttpServer> | undefined;
	let httpPort: number | undefined;

	/** 按请求用户取 host；单用户模式恒为主 host，users 模式按 userId 查（未装配返回 undefined）。 */
	const hostFor = (userId: string | undefined): AppServerHostHandle | undefined => {
		if (userId === undefined) return hostHandle;
		return userHosts.get(userId);
	};

	const buildHostDeps = (dataDir: string) => ({ config: { ...config!, dataDir }, llm: options.deps!.llm });

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
			if (server !== undefined || userServers.size > 0) throw new Error("App server is already started");
			if (options.deps !== undefined && config !== undefined) {
				if (users === undefined) {
					// 单用户模式（缺省）：单 host + 单 Server，dataDir 原样
					const handle = await createAppServerHost({ config, llm: options.deps.llm }, serverId);
					hostHandle = handle;
					server = new Server(handle.host, { listeners: [listener], serverId });
				} else {
					// 多用户模式（Task 27）：每个唯一 userId 预建 per-user host + Server，
					// 数据目录派生为 <dataDir>/users/<userId>；连接按 upgrade 解析的 userId 路由
					for (const userId of new Set(Object.values(users))) {
						const host = await createAppServerHost(
							buildHostDeps(join(config.dataDir, "users", userId)),
							serverId,
						);
						const userServer = new Server(host.host, { listeners: [], serverId });
						await userServer.start();
						userHosts.set(userId, host);
						userServers.set(userId, userServer);
					}
					await listener.start((connection) => {
						const entry = userServers.get(connectionUserId(connection) ?? "");
						if (entry === undefined) {
							Promise.resolve(connection.close()).catch(() => undefined);
							return orphanConnectionHandler();
						}
						return entry.accept(connection);
					});
				}
				const hostForDeps = {
					readUiResource: async (
						userId: string | undefined,
						request: { serverId: string; resourceUri: string },
					) => {
						const target = hostFor(userId);
						if (target === undefined) throw new Error(`no host for user: ${userId ?? "(anonymous)"}`);
						return target.readUiResource(request);
					},
					listMcpTools: async (userId: string | undefined) => hostFor(userId)?.listMcpTools() ?? [],
					sessionFilesRoot: async (userId: string | undefined, sessionId: string) =>
						hostFor(userId)?.sessionFilesRoot(sessionId) ?? null,
				};
				http = createHttpServer(
					{
						httpPort: options.httpPort ?? config.httpPort,
						...(config.token === undefined ? {} : { token: config.token }),
						...(users === undefined ? {} : { users }),
						...(config.webDist === undefined ? {} : { webDist: config.webDist }),
					},
					hostForDeps,
				);
				await http.listen({
					port: options.httpPort ?? config.httpPort,
					host: options.httpHost ?? "127.0.0.1",
				});
				const address = http.addresses().find((entry) => entry.family === "IPv4") ?? http.addresses()[0];
				httpPort = typeof address === "object" ? address.port : (options.httpPort ?? 0);
				if (server !== undefined) await server.start();
				return;
			}
			// 无 deps：最小桩 + 单 Server
			const host: ServerHost<SessionMetadata> = createStubHost();
			server = new Server(host, { listeners: [listener], serverId });
			await server.start();
		},
		async close() {
			try {
				const active = server;
				server = undefined;
				if (active !== undefined) await active.close();
				else if (userServers.size > 0) {
					for (const userServer of userServers.values()) await userServer.close().catch(() => undefined);
					await listener.close();
				} else {
					await listener.close();
				}
			} finally {
				const closingHttp = http;
				http = undefined;
				httpPort = undefined;
				if (closingHttp !== undefined) await closingHttp.close().catch(() => undefined);
				const closingHost = hostHandle;
				hostHandle = undefined;
				if (closingHost !== undefined) await closingHost.close();
				const closingUserHosts = [...userHosts.values()];
				userHosts.clear();
				userServers.clear();
				for (const userHost of closingUserHosts) await userHost.close().catch(() => undefined);
			}
		},
	};
}
