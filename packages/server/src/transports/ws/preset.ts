import type { SessionMetadata } from "@earendil-works/pi-agent-core";
import { Server } from "../../server.ts";
import type { ServerHost } from "../../types.ts";
import { createWsListener } from "./listener.ts";
import type { WsServerOptions } from "./types.ts";

/** Compose Server with one WebSocket listener. */
export function createWsServer<TMetadata extends SessionMetadata>(
	host: ServerHost<TMetadata>,
	options: WsServerOptions,
): Server<TMetadata> {
	const listener = createWsListener({
		port: options.port,
		host: options.host,
		maxFrameLength: options.maxFrameLength,
		maxPendingBytes: options.maxPendingBytes,
		gracefulCloseTimeoutMs: options.gracefulCloseTimeoutMs,
		onError: options.onError,
	});
	return new Server(host, {
		listeners: [listener],
		maxFrameLength: options.maxFrameLength,
		handshakeTimeoutMs: options.handshakeTimeoutMs,
		onConnectionCountChanged: options.onConnectionCountChanged,
		serverId: options.serverId,
		onError: options.onError,
	});
}
