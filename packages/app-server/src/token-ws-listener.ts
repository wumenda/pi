/**
 * Task 26：带 token 校验的 WS ServerListener。
 * 结构复制自 packages/server/src/transports/ws/listener.ts，差异仅在 upgrade 分支：
 * 配置 token 时，升级请求 `?token=` 必须匹配才 handleUpgrade，否则裸 socket 回 401
 * 并销毁（握手失败）。token 缺省（APP_SERVER_TOKEN 未配置）保持开发回环匿名。
 * 已知边界（ADR-0003）：token 经 query 传输有日志泄漏风险——fastify logger 关闭、
 * 本监听不打印 url。
 */

import { createServer, type Server as HttpServer } from "node:http";
import { DEFAULT_MAX_FRAME_LENGTH } from "@earendil-works/pi-protocol";
import type { ServerListener } from "@earendil-works/pi-server";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { resolveIdentity } from "./config.ts";

const DEFAULT_WS_HOST = "127.0.0.1";
const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;
const MAX_UINT32 = 0xffff_ffff;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface TokenWsListenerOptions {
	port: number;
	host?: string;
	/** 访问令牌；undefined/空 = 匿名放行（开发回环缺省）。 */
	token?: string;
	/** 多用户映射（Task 27）：配置后按 token→userId 校验并把 userId 附在连接上。 */
	users?: Record<string, string>;
	maxPendingBytes?: number;
	gracefulCloseTimeoutMs?: number;
	/** Used to derive and validate maxPendingBytes. Must match the server when customized. */
	maxFrameLength?: number;
	onError?: (error: Error) => void;
}

export interface TokenWsListenerAddress {
	host: string;
	port: number;
}

/** acceptor/handler 类型自 ServerListener 派生（连接对象与 pi-server ByteConnection 结构兼容） */
type ByteConnectionAcceptor = Parameters<ServerListener["start"]>[0];

interface ResolvedTokenWsListenerOptions {
	port: number;
	host: string;
	token?: string;
	users?: Record<string, string>;
	gracefulCloseTimeoutMs: number;
	maxPendingBytes: number;
	maxPayload: number;
	onError?: (error: Error) => void;
}

export class TokenWsListener implements ServerListener {
	private readonly options: ResolvedTokenWsListenerOptions;
	private readonly connections = new Set<WsByteConnection>();
	private httpServer?: HttpServer;
	private wsServer?: WebSocketServer;
	private closing = false;
	private closePromise?: Promise<void>;
	private accept?: ByteConnectionAcceptor;

	constructor(options: TokenWsListenerOptions) {
		this.options = resolveTokenWsListenerOptions(options);
	}

	/** Bound endpoint after a successful start, or undefined while stopped. */
	get address(): TokenWsListenerAddress | undefined {
		const httpServer = this.httpServer;
		if (!httpServer) return undefined;
		const address = httpServer.address();
		if (address === null || typeof address === "string") return undefined;
		return { host: address.address, port: address.port };
	}

	async start(accept: ByteConnectionAcceptor): Promise<void> {
		if (this.httpServer) throw new Error("Token WebSocket listener is already started");
		if (this.closing) throw new Error("Token WebSocket listener is closing or closed");
		this.accept = accept;

		const httpServer = createServer((_request, response) => {
			response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			response.end();
		});
		httpServer.on("error", (error) => this.reportError(error));
		const wsServer = new WebSocketServer({
			// 升级请求先过 token 校验，再手动 handleUpgrade（noServer 模式）
			noServer: true,
			perMessageDeflate: false,
			maxPayload: this.options.maxPayload,
		});
		wsServer.on("error", (error) => this.reportError(error));
		httpServer.on("upgrade", (request, socket, head) => {
			const urlToken = tokenFromUpgradeUrl(request.url);
			if (this.options.users !== undefined) {
				// 多用户模式（Task 27）：token 必须命中 users 映射，userId 附在连接上供 accept 路由
				const identity = resolveIdentity(this.options.users, urlToken);
				if (identity.kind !== "user") {
					socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\ncontent-length: 0\r\n\r\n");
					socket.destroy();
					return;
				}
				wsServer.handleUpgrade(request, socket, head, (wsSocket) => this.acceptSocket(wsSocket, identity.userId));
				return;
			}
			const expected = this.options.token;
			if (expected !== undefined && urlToken !== expected) {
				socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\ncontent-length: 0\r\n\r\n");
				socket.destroy();
				return;
			}
			wsServer.handleUpgrade(request, socket, head, (wsSocket) => this.acceptSocket(wsSocket, undefined));
		});

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

	private acceptSocket(socket: WebSocket, userId: string | undefined): void {
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
			userId,
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

/** 从升级请求 url 的 query 提取 token（url-decode 失败时按原值比对） */
function tokenFromUpgradeUrl(url: string | undefined): string | undefined {
	if (url === undefined) return undefined;
	const queryIndex = url.indexOf("?");
	if (queryIndex === -1) return undefined;
	for (const pair of url.slice(queryIndex + 1).split("&")) {
		const eq = pair.indexOf("=");
		const key = eq === -1 ? pair : pair.slice(0, eq);
		if (key !== "token") continue;
		const value = eq === -1 ? "" : pair.slice(eq + 1);
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
	return undefined;
}

class WsByteConnection {
	private readonly socket: WebSocket;
	private readonly gracefulCloseTimeoutMs: number;
	private readonly maxPendingBytes: number;
	private readonly reportError: (error: Error) => void;
	/** users 模式下由 upgrade 解析出的用户身份；单用户模式 undefined。 */
	readonly userId?: string;
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
		userId?: string,
	) {
		this.socket = socket;
		this.gracefulCloseTimeoutMs = gracefulCloseTimeoutMs;
		this.maxPendingBytes = maxPendingBytes;
		this.reportError = reportError;
		this.userId = userId;
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

export function createTokenWsListener(options: TokenWsListenerOptions): TokenWsListener {
	return new TokenWsListener(options);
}

/** 读取连接携带的用户身份（users 模式下由 upgrade 解析；单用户/匿名连接 undefined）。 */
export function connectionUserId(connection: unknown): string | undefined {
	const userId = (connection as { userId?: unknown }).userId;
	return typeof userId === "string" ? userId : undefined;
}

function resolveTokenWsListenerOptions(options: TokenWsListenerOptions): ResolvedTokenWsListenerOptions {
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
		token: options.token,
		users: options.users,
		maxPendingBytes,
		maxPayload: maxPendingBytes,
		gracefulCloseTimeoutMs,
		onError: options.onError,
	};
}
