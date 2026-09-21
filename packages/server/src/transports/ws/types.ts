import type { ServerOptions } from "../../types.ts";

export interface WsListenerOptions {
	/** TCP port to bind. Use 0 to let the OS assign a free port. */
	port: number;
	/** Bind address. Defaults to loopback only (127.0.0.1). */
	host?: string;
	/** Maximum framed bytes queued per connection before a slow peer is disconnected. */
	maxPendingBytes?: number;
	gracefulCloseTimeoutMs?: number;
	/** Used to derive and validate maxPendingBytes. Must match the server when customized. */
	maxFrameLength?: number;
	onError?: (error: Error) => void;
}

export interface WsServerOptions extends Omit<ServerOptions, "listeners">, WsListenerOptions {}
