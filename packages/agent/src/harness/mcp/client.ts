/**
 * Minimal MCP client over stdio and Streamable HTTP transports.
 *
 * Implements just enough of the protocol for the pi harness: initialize
 * handshake, tools/list (with pagination), tools/call, resources/read, and
 * clean shutdown. JSON-RPC 2.0 framing is handled inline; server-initiated
 * requests and notifications other than `notifications/initialized` are
 * ignored.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
	MCP_PROTOCOL_VERSION,
	type McpCallToolResult,
	type McpContent,
	type McpReadResourceResult,
	type McpResourceContents,
	type McpServerConfig,
	type McpTool,
} from "./types.ts";

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: unknown;
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const STDERR_LIMIT = 8_192;

export class McpClientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpClientError";
	}
}

/** Lazy JSON value check used to keep untyped wire data out of the core. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parseContents(value: unknown): McpContent[] {
	const record = asRecord(value);
	const raw = record?.content;
	if (!Array.isArray(raw)) return [];
	const contents: McpContent[] = [];
	for (const item of raw) {
		const entry = asRecord(item);
		if (entry === undefined) continue;
		if (entry.type === "text" && typeof entry.text === "string") {
			contents.push({ type: "text", text: entry.text });
		} else if (entry.type === "image" && typeof entry.data === "string" && typeof entry.mimeType === "string") {
			contents.push({ type: "image", data: entry.data, mimeType: entry.mimeType });
		} else if (entry.type === "audio" && typeof entry.data === "string" && typeof entry.mimeType === "string") {
			contents.push({ type: "audio", data: entry.data, mimeType: entry.mimeType });
		} else if (entry.type === "resource") {
			const resource = asRecord(entry.resource);
			if (resource !== undefined && typeof resource.uri === "string") {
				contents.push({
					type: "resource",
					resource: {
						uri: resource.uri,
						...(typeof resource.mimeType === "string" ? { mimeType: resource.mimeType } : {}),
						...(typeof resource.text === "string" ? { text: resource.text } : {}),
						...(typeof resource.blob === "string" ? { blob: resource.blob } : {}),
					},
				});
			}
		}
	}
	return contents;
}

function parseResourceContents(value: unknown): McpResourceContents[] {
	const record = asRecord(value);
	const raw = record?.contents;
	if (!Array.isArray(raw)) return [];
	const contents: McpResourceContents[] = [];
	for (const item of raw) {
		const entry = asRecord(item);
		if (entry === undefined || typeof entry.uri !== "string") continue;
		contents.push({
			uri: entry.uri,
			...(typeof entry.mimeType === "string" ? { mimeType: entry.mimeType } : {}),
			...(typeof entry.text === "string" ? { text: entry.text } : {}),
			...(typeof entry.blob === "string" ? { blob: entry.blob } : {}),
		});
	}
	return contents;
}

export interface McpClientOptions {
	serverId: string;
	config: McpServerConfig;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
}

export type McpClientState = "disconnected" | "connecting" | "ready" | "error";

/** One MCP server connection; owns its transport and pending request map. */
export class McpClient {
	readonly serverId: string;
	state: McpClientState = "disconnected";
	error: string | undefined;
	/** Tools cached from the most recent tools/list. */
	tools: McpTool[] = [];

	readonly #config: McpServerConfig;
	readonly #connectTimeoutMs: number;
	readonly #requestTimeoutMs: number;
	#nextId = 1;
	#pending = new Map<number, PendingRequest>();
	#process: ChildProcess | undefined;
	#sessionKey: string | undefined;
	#stderrTail = "";
	#closed = false;
	#closePromise: Promise<void> = Promise.resolve();

	constructor(options: McpClientOptions) {
		this.serverId = options.serverId;
		this.#config = options.config;
		this.#connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
		this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
	}

	/** Connect the transport and run the initialize handshake. Idempotent. */
	async connect(): Promise<void> {
		if (this.state === "ready") return;
		if (this.state === "connecting") throw new McpClientError(`MCP server ${this.serverId} is still connecting`);
		this.state = "connecting";
		this.error = undefined;
		try {
			if (this.#config.type === "stdio") {
				this.#startStdio();
			} else {
				// Streamable HTTP opens lazily per request; validate reachability via initialize below.
			}
			const result = await this.#request(
				"initialize",
				{
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "pi-agent", version: "0.86.1" },
				},
				this.#connectTimeoutMs,
			);
			const serverInfo = asRecord(asRecord(result)?.serverInfo);
			if (serverInfo === undefined) throw new McpClientError("MCP server returned an invalid initialize result");
			await this.#notify("notifications/initialized", {});
			this.state = "ready";
			await this.listTools();
		} catch (error) {
			this.state = "error";
			this.error = error instanceof Error ? error.message : String(error);
			await this.close().catch(() => {});
			throw new McpClientError(`MCP server ${this.serverId} failed to connect: ${this.error}`);
		}
	}

	/** Refresh and cache the server's tool list, following pagination. */
	async listTools(): Promise<McpTool[]> {
		const tools: McpTool[] = [];
		let cursor: string | undefined;
		do {
			const result = await this.#request("tools/list", cursor === undefined ? {} : { cursor });
			const record = asRecord(result);
			const raw = record?.tools;
			if (!Array.isArray(raw)) throw new McpClientError("MCP server returned an invalid tools/list result");
			for (const item of raw) {
				const tool = asRecord(item);
				if (tool === undefined || typeof tool.name !== "string") continue;
				const inputSchema = asRecord(tool.inputSchema);
				tools.push({
					name: tool.name,
					...(typeof tool.title === "string" ? { title: tool.title } : {}),
					...(typeof tool.description === "string" ? { description: tool.description } : {}),
					inputSchema: inputSchema ?? { type: "object" },
					...(asRecord(tool._meta) !== undefined ? { _meta: asRecord(tool._meta)! } : {}),
				});
			}
			cursor = typeof record?.nextCursor === "string" ? record.nextCursor : undefined;
		} while (cursor !== undefined);
		this.tools = tools;
		return tools;
	}

	async callTool(
		name: string,
		args: Record<string, unknown> | undefined,
		signal?: AbortSignal,
	): Promise<McpCallToolResult> {
		const result = await this.#request("tools/call", { name, arguments: args ?? {} }, undefined, signal);
		const record = asRecord(result);
		return {
			content: parseContents(result),
			isError: record?.isError === true ? true : undefined,
		};
	}

	async readResource(uri: string, signal?: AbortSignal): Promise<McpReadResourceResult> {
		const result = await this.#request("resources/read", { uri }, undefined, signal);
		return { contents: parseResourceContents(result) };
	}

	/** Terminate the transport; pending requests reject with a closed error. */
	async close(): Promise<void> {
		this.#closed = true;
		const error = new McpClientError(`MCP server ${this.serverId} is closed`);
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.#pending.clear();
		if (this.#process !== undefined && this.#process.exitCode === null && !this.#process.killed) {
			this.#process.kill();
		}
		this.#process = undefined;
		this.state = "disconnected";
		await this.#closePromise;
	}

	#startStdio(): void {
		const config = this.#config;
		if (config.type !== "stdio") return;
		const child = spawn(config.command, config.args ?? [], {
			cwd: config.cwd,
			env: { ...process.env, ...(config.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.#process = child;
		const closed = new Promise<void>((resolve) => {
			child.once("close", () => resolve());
			child.once("error", () => resolve());
		});
		this.#closePromise = closed;

		const reader = createInterface({ input: child.stdout! });
		reader.on("line", (line) => {
			const trimmed = line.trim();
			if (trimmed.length === 0) return;
			let message: JsonRpcMessage;
			try {
				message = JSON.parse(trimmed) as JsonRpcMessage;
			} catch {
				return;
			}
			this.#handleMessage(message);
		});

		child.stderr!.setEncoding("utf8");
		child.stderr!.on("data", (chunk: string) => {
			this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_LIMIT);
		});

		const failPending = (message: string): void => {
			const error = new McpClientError(
				this.#stderrTail.trim().length > 0 ? `${message}: ${this.#stderrTail.trim()}` : message,
			);
			for (const pending of this.#pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(error);
			}
			this.#pending.clear();
		};
		child.once("error", (error) => failPending(`MCP server ${this.serverId} process error: ${error.message}`));
		child.once("close", () => {
			reader.close();
			if (!this.#closed) failPending(`MCP server ${this.serverId} exited before responding`);
		});
	}

	#handleMessage(message: JsonRpcMessage): void {
		if (!("id" in message) || message.id === null || message.id === undefined) return; // notification
		if (typeof message.id !== "number") return;
		const pending = this.#pending.get(message.id);
		if (pending === undefined) return;
		this.#pending.delete(message.id);
		clearTimeout(pending.timer);
		const response = message as JsonRpcResponse;
		if (response.error !== undefined) {
			pending.reject(
				new McpClientError(response.error.message || `MCP request failed with code ${response.error.code}`),
			);
		} else {
			pending.resolve(response.result);
		}
	}

	#request(method: string, params: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown> {
		if (this.#closed) return Promise.reject(new McpClientError(`MCP server ${this.serverId} is closed`));
		const id = this.#nextId++;
		const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new McpClientError(`MCP request ${method} to ${this.serverId} timed out`));
			}, timeoutMs ?? this.#requestTimeoutMs);
			const pending: PendingRequest = { resolve, reject, timer };
			this.#pending.set(id, pending);
			if (signal !== undefined) {
				if (signal.aborted) {
					this.#pending.delete(id);
					clearTimeout(timer);
					reject(signal.reason instanceof Error ? signal.reason : new McpClientError("MCP request aborted"));
					return;
				}
				signal.addEventListener(
					"abort",
					() => {
						if (!this.#pending.has(id)) return;
						this.#pending.delete(id);
						clearTimeout(timer);
						reject(signal.reason instanceof Error ? signal.reason : new McpClientError("MCP request aborted"));
					},
					{ once: true },
				);
			}
			void this.#send(request).catch((error: unknown) => {
				if (!this.#pending.has(id)) return;
				this.#pending.delete(id);
				clearTimeout(timer);
				reject(error instanceof Error ? error : new McpClientError(String(error)));
			});
		});
	}

	#notify(method: string, params: unknown): Promise<void> {
		const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
		return this.#send(notification).then(() => undefined);
	}

	async #send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
		if (this.#config.type === "stdio") {
			const stdin = this.#process?.stdin;
			if (stdin === null || stdin === undefined || stdin.destroyed) {
				throw new McpClientError(`MCP server ${this.serverId} transport is not open`);
			}
			await new Promise<void>((resolve, reject) => {
				stdin.write(`${JSON.stringify(message)}\n`, (error) => (error === undefined ? resolve() : reject(error)));
			});
			return;
		}
		await this.#sendHttp(message);
	}

	async #sendHttp(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
		const config = this.#config;
		if (config.type !== "http") return;
		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(config.headers ?? {}),
		};
		if (this.#sessionKey !== undefined) headers["mcp-session-id"] = this.#sessionKey;
		let response: Response;
		try {
			response = await fetch(config.url, {
				method: "POST",
				headers,
				body: JSON.stringify(message),
			});
		} catch (error) {
			throw new McpClientError(
				`MCP HTTP request to ${this.serverId} failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const sessionKey = response.headers.get("mcp-session-id");
		if (sessionKey !== null && this.#sessionKey === undefined) this.#sessionKey = sessionKey;
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new McpClientError(
				`MCP HTTP request to ${this.serverId} failed with status ${response.status}${body.length > 0 ? `: ${body.slice(0, 512)}` : ""}`,
			);
		}
		if ("id" in message && typeof message.id === "number") {
			await this.#readHttpResponse(response, message.id);
		} else if (response.headers.get("content-type")?.includes("application/json")) {
			await response.text().catch(() => "");
		}
	}

	async #readHttpResponse(response: Response, id: number): Promise<void> {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("text/event-stream")) {
			const body = await response.text();
			for (const dataLine of body.split("\n")) {
				const line = dataLine.trim();
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (payload.length === 0) continue;
				try {
					this.#handleMessage(JSON.parse(payload) as JsonRpcMessage);
					if (!this.#pending.has(id)) return; // resolved
				} catch {
					// skip malformed SSE payload
				}
			}
			if (this.#pending.has(id))
				throw new McpClientError(`MCP HTTP response from ${this.serverId} carried no reply`);
			return;
		}
		const text = await response.text();
		if (text.trim().length === 0) {
			throw new McpClientError(`MCP HTTP response from ${this.serverId} was empty`);
		}
		try {
			this.#handleMessage(JSON.parse(text) as JsonRpcMessage);
		} catch {
			throw new McpClientError(`MCP HTTP response from ${this.serverId} was not valid JSON-RPC`);
		}
		if (this.#pending.has(id)) throw new McpClientError(`MCP HTTP response from ${this.serverId} carried no reply`);
	}
}
