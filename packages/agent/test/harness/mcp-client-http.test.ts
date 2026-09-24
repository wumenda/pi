import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { McpClient } from "../../src/harness/mcp/client.ts";

const servers: Server[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

function listen(server: Server): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve(typeof address === "object" && address !== null ? address.port : 0);
		});
	});
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("waitFor timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("McpClient streamable HTTP", () => {
	it("receives progress notifications from the server-initiated GET stream", async () => {
		const listeners = new Set<ServerResponse>();
		const sse = (res: ServerResponse, message: object) => {
			res.write(`data: ${JSON.stringify(message)}\n\n`);
		};
		const server = createServer((req, res) => {
			if (req.method === "GET") {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				res.flushHeaders(); // deliver headers immediately, like real SSE servers
				listeners.add(res);
				req.on("close", () => listeners.delete(res));
				return;
			}
			let body = "";
			req.on("data", (chunk: string) => {
				body += chunk;
			});
			req.on("end", () => {
				const message = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
				if (message.method === "notifications/initialized") {
					res.writeHead(202, { "content-type": "application/json" });
					res.end();
					return;
				}
				const headers: Record<string, string> = { "content-type": "text/event-stream" };
				if (message.method === "initialize") headers["mcp-session-id"] = "test-session";
				res.writeHead(200, headers);
				if (message.method === "initialize") {
					sse(res, {
						jsonrpc: "2.0",
						id: message.id,
						result: { protocolVersion: "2025-06-18", serverInfo: { name: "t", version: "0" } },
					});
				} else if (message.method === "tools/list") {
					sse(res, { jsonrpc: "2.0", id: message.id, result: { tools: [] } });
				} else if (message.method === "tools/call") {
					const token = (message.params?._meta as { progressToken?: string } | undefined)?.progressToken;
					void (async () => {
						await waitFor(() => listeners.size > 0);
						const payload = { progressToken: token, progress: 1, total: 2, message: "步骤 1" };
						for (const listener of listeners) {
							sse(listener, { jsonrpc: "2.0", method: "notifications/progress", params: payload });
						}
						// Real servers emit progress during execution, well before the
						// reply; model that gap so the notification wins the race.
						await new Promise((resolve) => setTimeout(resolve, 50));
						sse(res, {
							jsonrpc: "2.0",
							id: message.id,
							result: { content: [{ type: "text", text: "done" }] },
						});
						res.end();
					})();
					return;
				}
				res.end();
			});
		});
		servers.push(server);
		const port = await listen(server);
		const client = new McpClient({ serverId: "t", config: { type: "http", url: `http://127.0.0.1:${port}/mcp` } });
		await client.connect();
		const received: unknown[] = [];
		await client.callTool("tool", {}, undefined, (payload) => received.push(payload));
		// The GET stream is processed concurrently with the POST reply; wait for delivery.
		await waitFor(() => received.length > 0);
		expect(received).toEqual([{ progress: 1, total: 2, message: "步骤 1", uiEvent: null }]);
		await client.close();
		await waitFor(() => listeners.size === 0); // TCP teardown is asynchronous
	});
});
