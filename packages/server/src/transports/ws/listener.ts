import { createServer, type Server as HttpServer } from "node:http";
import { DEFAULT_MAX_FRAME_LENGTH } from "@earendil-works/pi-protocol";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { ByteConnection, ByteConnectionAcceptor } from "../../connection.ts";
import type { ServerListener } from "../../listener.ts";
import type { WsListenerOptions } from "./types.ts";

const DEFAULT_WS_HOST = "127.0.0.1";
const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;
const MAX_UINT32 = 0xffff_ffff;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface ResolvedWsListenerOptions {
	port: number;
	host: string;
	gracefulCloseTimeoutMs: number;
	maxPendingBytes: number;
	maxPayload: number;
	onError?: (error: Error) => void;
}

export interface WsListenerAddress {
	host: string;
	port: number;
}

export class WsListener implements ServerListener {
	private readonly options: ResolvedWsListenerOptions;
	private readonly connections = new Set<WsByteConnection>();
	private httpServer?: HttpServer;
	private wsServer?: WebSocketServer;
	private closing = false;
	private closePromise?: Promise<void>;
	private accept?: ByteConnectionAcceptor;

	constructor(options: WsListenerOptions) {
		this.options = resolveWsListenerOptions(options);
	}

	/** Bound endpoint after a successful start, or undefined while stopped. */
	get address(): WsListenerAddress | undefined {
		const httpServer = this.httpServer;
		if (!httpServer) return undefined;
		const address = httpServer.address();
		if (address === null || typeof address === "string") return undefined;
		return { host: address.address, port: address.port };
	}

	async start(accept: ByteConnectionAcceptor): Promise<void> {
		if (this.httpServer) throw new Error("WebSocket listener is already started");
		if (this.closing) throw new Error("WebSocket listener is closing or closed");
		this.accept = accept;

		const httpServer = createServer((_request, response) => {
			response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			response.end();
		});
		httpServer.on("error", (error) => this.reportError(error));
		const wsServer = new WebSocketServer({
			server: httpServer,
			perMessageDeflate: false,
			maxPayload: this.options.maxPayload,
		});
		wsServer.on("connection", (socket) => this.acceptSocket(socket));
		wsServer.on("error", (error) => this.reportError(error));

		try {
			await new Promise<void>((resolve, reject) => {
				const onError = (error: Error): void => {
					httpServer.off("listening", onListening);
					reject(error);
				};
				const onListening = (): void => {
					httpServer.off("error", onError);
					resolve();
				};
				httpServer.once("error", onError);
				httpServer.once("listening", onListening);
				httpServer.listen(this.options.port, this.options.host);
			});
		} catch (error) {
			const wsClosed = closeWebSocketServer(wsServer);
			await closeHttpServer(httpServer);
			await wsClosed;
			throw error;
		}
		this.httpServer = httpServer;
		this.wsServer = wsServer;
	}

	async close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closing = true;
		this.closePromise = this.closeInternal();
		return this.closePromise;
	}

	private async closeInternal(): Promise<void> {
		const wsServer = this.wsServer;
		const httpServer = this.httpServer;
		this.wsServer = undefined;
		this.httpServer = undefined;
		await Promise.all([...this.connections].map((connection) => connection.close()));
		this.connections.clear();
		const wsClosed = wsServer ? closeWebSocketServer(wsServer) : Promise.resolve();
		if (httpServer) await closeHttpServer(httpServer);
		await wsClosed;
	}

	private acceptSocket(socket: WebSocket): void {
		const accept = this.accept;
		if (this.closing || !accept) {
			socket.close();
			return;
		}
		const connection = new WsByteConnection(
			socket,
			this.options.gracefulCloseTimeoutMs,
			this.options.maxPendingBytes,
			(error) => this.reportError(error),
		);
		this.connections.add(connection);
		const handler = accept(connection);
		socket.on("message", (data: RawData) => {
			handler.onData(toBytes(data));
		});
		socket.on("error", (error) => {
			handler.onError(error);
		});
		socket.once("close", () => {
			connection.markClosed();
			this.connections.delete(connection);
			handler.onClose();
		});
	}

	private reportError(error: unknown): void {
		try {
			this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
		} catch {
			// Error observers cannot affect listener state.
		}
	}
}

class WsByteConnection implements ByteConnection {
	private readonly socket: WebSocket;
	private readonly gracefulCloseTimeoutMs: number;
	private readonly maxPendingBytes: number;
	private readonly reportError: (error: Error) => void;
	private closedValue = false;
	private closing = false;
	private writeTail: Promise<void> = Promise.resolve();
	private closePromise?: Promise<void>;
	private resolveClose?: () => void;

	constructor(
		socket: WebSocket,
		gracefulCloseTimeoutMs: number,
		maxPendingBytes: number,
		reportError: (error: Error) => void,
	) {
		this.socket = socket;
		this.gracefulCloseTimeoutMs = gracefulCloseTimeoutMs;
		this.maxPendingBytes = maxPendingBytes;
		this.reportError = reportError;
	}

	get closed(): boolean {
		return this.closedValue;
	}

	send(chunk: Uint8Array): Promise<void> {
		if (!(chunk instanceof Uint8Array)) {
			return Promise.reject(new TypeError("WebSocket connection chunks must be Uint8Array"));
		}
		if (this.closedValue || this.closing) return Promise.reject(new Error("WebSocket connection is closed"));
		if (this.socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error("WebSocket connection is not open"));
		}
		if (this.socket.bufferedAmount + chunk.byteLength > this.maxPendingBytes) {
			return Promise.reject(new Error("WebSocket connection exceeded its pending byte limit"));
		}
		const bytes = Buffer.from(chunk);
		const write = this.writeTail.then(() => this.write(bytes));
		this.writeTail = write.catch(() => {});
		return write;
	}

	close(finalChunk?: Uint8Array): Promise<void> {
		if (this.closedValue) return Promise.resolve();
		if (this.closePromise) return this.closePromise;
		this.closing = true;
		const finalBytes = finalChunk === undefined ? undefined : Buffer.from(finalChunk);
		this.closePromise = new Promise<void>((resolve) => {
			this.resolveClose = resolve;
			const timer = setTimeout(() => {
				if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
			}, this.gracefulCloseTimeoutMs);
			timer.unref();
			void this.writeTail.then(() => {
				if (this.socket.readyState !== WebSocket.OPEN) return;
				try {
					if (finalBytes) this.socket.send(finalBytes, () => this.socket.close());
					else this.socket.close();
				} catch (error) {
					this.socket.terminate();
					this.reportError(error instanceof Error ? error : new Error(String(error)));
				}
			});
		});
		return this.closePromise;
	}

	markClosed(): void {
		if (this.closedValue) return;
		this.closedValue = true;
		this.closing = true;
		this.resolveClose?.();
		this.resolveClose = undefined;
	}

	private write(bytes: Buffer): Promise<void> {
		if (this.closedValue || this.closing) return Promise.reject(new Error("WebSocket connection is closed"));
		return new Promise<void>((resolve, reject) => {
			this.socket.send(bytes, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
	return new Promise<void>((resolve) => {
		server.close(() => resolve());
	});
}

function closeHttpServer(server: HttpServer): Promise<void> {
	if (!server.listening) return Promise.resolve();
	return new Promise<void>((resolve) => {
		server.close(() => resolve());
		server.closeAllConnections();
	});
}

function toBytes(data: RawData): Uint8Array {
	if (Array.isArray(data)) {
		const buffer = Buffer.concat(data);
		return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	}
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function createWsListener(options: WsListenerOptions): WsListener {
	return new WsListener(options);
}

function resolveWsListenerOptions(options: WsListenerOptions): ResolvedWsListenerOptions {
	if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
		throw new TypeError("Server WebSocket port must be an integer between 0 and 65535");
	}
	const host = options.host ?? DEFAULT_WS_HOST;
	if (host.length === 0) throw new TypeError("Server WebSocket host must not be empty");
	const maxFrameLength = options.maxFrameLength ?? DEFAULT_MAX_FRAME_LENGTH;
	if (!Number.isSafeInteger(maxFrameLength) || maxFrameLength <= 0 || maxFrameLength > MAX_UINT32) {
		throw new TypeError(`Server maxFrameLength must be an integer between 1 and ${MAX_UINT32}`);
	}
	const maxPendingBytes = options.maxPendingBytes ?? maxFrameLength * 4;
	if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes < maxFrameLength + 4) {
		throw new TypeError("Server maxPendingBytes must be a safe integer at least maxFrameLength + 4");
	}
	const gracefulCloseTimeoutMs = options.gracefulCloseTimeoutMs ?? DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(gracefulCloseTimeoutMs) ||
		gracefulCloseTimeoutMs <= 0 ||
		gracefulCloseTimeoutMs > MAX_TIMER_DELAY_MS
	) {
		throw new TypeError(`Server gracefulCloseTimeoutMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`);
	}
	return {
		port: options.port,
		host,
		maxPendingBytes,
		maxPayload: maxPendingBytes,
		gracefulCloseTimeoutMs,
		onError: options.onError,
	};
}
