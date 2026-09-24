import { randomUUID } from "node:crypto";
import type { SessionMetadata } from "@earendil-works/pi-agent-core";
import { Server, type ServerHost } from "@earendil-works/pi-server";
import { createWsListener } from "@earendil-works/pi-server/ws";

export interface AppServerOptions {
	/** 固定 serverId（测试用）；缺省随机 UUIDv4。 */
	serverId?: string;
	/** WS 监听端口；0 = OS 分配（默认）。 */
	wsPort?: number;
	wsHost?: string;
}

export interface AppServerHandle {
	readonly serverId: string;
	/** 实际绑定端口；start() 前访问抛错。 */
	readonly wsPort: number;
	start(): Promise<void>;
	close(): Promise<void>;
}

export function createAppServer(options: AppServerOptions = {}): AppServerHandle {
	const serverId = options.serverId ?? randomUUID();
	// Task 5 替换为真实服务装配；此处最小 attachment 让 hello 握手通过。
	const host: ServerHost<SessionMetadata> = {
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
	const listener = createWsListener({
		port: options.wsPort ?? 0,
		host: options.wsHost ?? "127.0.0.1",
	});
	const server = new Server(host, { listeners: [listener], serverId });
	return {
		serverId,
		get wsPort() {
			const address = listener.address;
			if (address === undefined) throw new Error("App server is not started");
			return address.port;
		},
		start() {
			return server.start().then(() => undefined);
		},
		close() {
			return server.close();
		},
	};
}
