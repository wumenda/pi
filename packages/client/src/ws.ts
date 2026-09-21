import { DEFAULT_MAX_FRAME_LENGTH } from "@earendil-works/pi-protocol";
import type { ByteTransport, ByteTransportFactory, ByteTransportHandlers } from "./transport.ts";

export interface WsTransportOptions {
	/** WebSocket endpoint, e.g. ws://127.0.0.1:8787. */
	url: string;
	/** Optional WebSocket subprotocols. */
	protocols?: string | string[];
	maxPendingBytes?: number;
}

/** Creates fresh WebSocket transports for Client connection attempts in browser and Node runtimes. */
export function createWsTransportFactory(options: WsTransportOptions): ByteTransportFactory {
	const maxPendingBytes = validateWsTransportOptions(options);
	return (handlers) => connectWsSocket(options.url, options.protocols, maxPendingBytes, handlers);
}

function validateWsTransportOptions(options: WsTransportOptions): number {
	if (options.url.length === 0) throw new TypeError("WebSocket transport URL must not be empty");
	const maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_FRAME_LENGTH * 4;
	if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) {
		throw new TypeError("WebSocket transport maxPendingBytes must be a positive safe integer");
	}
	return maxPendingBytes;
}

function connectWsSocket(
	url: string,
	protocols: string | string[] | undefined,
	maxPendingBytes: number,
	handlers: ByteTransportHandlers,
): Promise<ByteTransport> {
	return new Promise<ByteTransport>((resolve, reject) => {
		const socket = new WebSocket(url, protocols);
		socket.binaryType = "arraybuffer";
		let connected = false;
		let terminal = false;

		socket.addEventListener("open", () => {
			if (terminal) return;
			connected = true;
			resolve(
				new WsByteTransport(socket, maxPendingBytes, () => {
					terminal = true;
				}),
			);
		});
		socket.addEventListener("message", (event) => {
			if (terminal) return;
			handlers.onData(toBytes(event.data));
		});
		socket.addEventListener("close", () => {
			if (terminal) return;
			terminal = true;
			if (connected) handlers.onClose();
			else reject(new Error("WebSocket transport closed before connecting"));
		});
		socket.addEventListener("error", () => {
			if (terminal) return;
			terminal = true;
			// Browsers and Node do not expose error details on the WebSocket error event.
			const error = new Error(
				connected ? "WebSocket transport failed" : `WebSocket transport failed to connect to ${url}`,
			);
			if (connected) handlers.onError(error);
			else reject(error);
		});
	});
}

class WsByteTransport implements ByteTransport {
	readonly #socket: WebSocket;
	readonly #maxPendingBytes: number;
	readonly #markLocalClose: () => void;
	#closed = false;
	#writeTail: Promise<void> = Promise.resolve();

	constructor(socket: WebSocket, maxPendingBytes: number, markLocalClose: () => void) {
		this.#socket = socket;
		this.#maxPendingBytes = maxPendingBytes;
		this.#markLocalClose = markLocalClose;
	}

	send(chunk: Uint8Array): Promise<void> {
		if (!(chunk instanceof Uint8Array)) {
			return Promise.reject(new TypeError("WebSocket transport chunks must be Uint8Array"));
		}
		if (this.#closed) return Promise.reject(new Error("WebSocket transport is closed"));
		if (this.#socket.readyState !== WebSocket.OPEN)
			return Promise.reject(new Error("WebSocket transport is not open"));
		if (this.#socket.bufferedAmount + chunk.byteLength > this.#maxPendingBytes) {
			return Promise.reject(new Error("WebSocket transport exceeded its pending byte limit"));
		}
		const bytes = chunk.slice();
		const write = this.#writeTail.then(() => this.#write(bytes));
		this.#writeTail = write.catch(() => {});
		return write;
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#markLocalClose();
		this.#socket.close();
	}

	#write(chunk: Uint8Array): Promise<void> {
		if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error("WebSocket transport is closed"));
		}
		// send() enqueues synchronously and preserves frame order; there is no completion callback.
		this.#socket.send(chunk);
		return Promise.resolve();
	}
}

function toBytes(data: unknown): Uint8Array {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	return new TextEncoder().encode(String(data));
}
