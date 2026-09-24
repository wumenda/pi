/**
 * Multi-server MCP runtime for the pi harness: owns one {@link McpClient} per
 * configured server, aggregates their tools, and routes calls either by server
 * id or by unique tool name.
 */

import { McpClient } from "./client.ts";
import type { McpProgressPayload } from "./progress.ts";
import type { McpCallToolResult, McpReadResourceResult, McpServerConfigMap, McpTool } from "./types.ts";

export type McpServerState = "disconnected" | "connecting" | "ready" | "error";

export interface McpServerStatus {
	id: string;
	state: McpServerState;
	error?: string;
	toolCount: number;
}

export interface McpServerTools {
	serverId: string;
	tools: McpTool[];
}

export interface McpServerManagerOptions {
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
}

/** Aggregated MCP tool with its owning server id. */
export interface McpRoutedTool {
	serverId: string;
	tool: McpTool;
}

export class McpServerManagerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpServerManagerError";
	}
}

export class McpServerManager {
	readonly #clients: McpClient[];

	constructor(servers: McpServerConfigMap, options: McpServerManagerOptions = {}) {
		this.#clients = Object.entries(servers).map(
			([serverId, config]) =>
				new McpClient({
					serverId,
					config,
					connectTimeoutMs: options.connectTimeoutMs,
					requestTimeoutMs: options.requestTimeoutMs,
				}),
		);
	}

	get serverIds(): string[] {
		return this.#clients.map((client) => client.serverId);
	}

	/** Connect every configured server in parallel; per-server failures are recorded, never thrown. */
	async connectAll(): Promise<McpServerStatus[]> {
		await Promise.allSettled(this.#clients.map((client) => client.connect()));
		return this.statuses();
	}

	statuses(): McpServerStatus[] {
		return this.#clients.map((client) => ({
			id: client.serverId,
			state: client.state,
			...(client.error === undefined ? {} : { error: client.error }),
			toolCount: client.tools.length,
		}));
	}

	/** Aggregated tool list across ready servers, in server-config order. */
	tools(): McpRoutedTool[] {
		const routed: McpRoutedTool[] = [];
		for (const client of this.#clients) {
			if (client.state !== "ready") continue;
			for (const tool of client.tools) routed.push({ serverId: client.serverId, tool });
		}
		return routed;
	}

	#resolve(serverId: string | undefined, name: string | undefined): McpClient {
		if (serverId !== undefined) {
			const client = this.#clients.find((candidate) => candidate.serverId === serverId);
			if (client === undefined) {
				throw new McpServerManagerError(`Unknown MCP server ${JSON.stringify(serverId)}`);
			}
			if (client.state !== "ready") {
				throw new McpServerManagerError(
					`MCP server ${serverId} is not ready${client.error === undefined ? "" : `: ${client.error}`}`,
				);
			}
			return client;
		}
		if (name === undefined) throw new McpServerManagerError("MCP tool call requires a server id or tool name");
		const candidates = this.tools().filter((routed) => routed.tool.name === name);
		if (candidates.length === 0) {
			const available = this.tools()
				.map((routed) => `${routed.serverId}:${routed.tool.name}`)
				.join(", ");
			throw new McpServerManagerError(
				available.length > 0
					? `No MCP server exposes tool ${JSON.stringify(name)} (available: ${available})`
					: "No MCP servers are connected",
			);
		}
		if (candidates.length > 1) {
			const owners = [...new Set(candidates.map((candidate) => candidate.serverId))].join(", ");
			throw new McpServerManagerError(`MCP tool ${JSON.stringify(name)} is ambiguous across servers: ${owners}`);
		}
		const client = this.#clients.find((candidate) => candidate.serverId === candidates[0]!.serverId);
		return client!;
	}

	async callTool(
		serverId: string | undefined,
		name: string,
		args: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (payload: McpProgressPayload) => void,
	): Promise<McpCallToolResult> {
		return await this.#resolve(serverId, name).callTool(name, args, signal, onProgress);
	}

	async readResource(serverId: string | undefined, uri: string, signal?: AbortSignal): Promise<McpReadResourceResult> {
		if (serverId !== undefined) {
			return await this.#resolve(serverId, undefined).readResource(uri, signal);
		}
		// Resources are not discovered eagerly; try ready servers in order until one answers.
		let lastError: unknown;
		for (const client of this.#clients) {
			if (client.state !== "ready") continue;
			try {
				return await client.readResource(uri, signal);
			} catch (error) {
				lastError = error;
			}
		}
		throw lastError instanceof Error ? lastError : new McpServerManagerError(`MCP resources/read failed for ${uri}`);
	}

	async close(): Promise<void> {
		await Promise.allSettled(this.#clients.map((client) => client.close()));
	}
}
