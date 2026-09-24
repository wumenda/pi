import { createServer, type Server } from "node:http";
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

function sse(res: import("node:http").ServerResponse, message: object): void {
	res.write(`data: ${JSON.stringify(message)}\n\n`);
}

/** Minimal streamable-HTTP fake server whose tools/call reply is caller-defined. */
async function startClient(callResult: object): Promise<McpClient> {
	const server = createServer((req, res) => {
		if (req.method === "GET") {
			res.writeHead(204);
			res.end();
			return;
		}
		let body = "";
		req.on("data", (chunk: string) => {
			body += chunk;
		});
		req.on("end", () => {
			const message = JSON.parse(body) as { id?: number; method: string };
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
				sse(res, { jsonrpc: "2.0", id: message.id, result: callResult });
			}
			res.end();
		});
	});
	servers.push(server);
	const port = await listen(server);
	const client = new McpClient({ serverId: "t", config: { type: "http", url: `http://127.0.0.1:${port}/mcp` } });
	await client.connect();
	return client;
}

describe("McpClient structuredContent passthrough", () => {
	it("keeps structuredContent from the tools/call result", async () => {
		const structured = { status: "success", items: [{ id: "I-001", value: 100 }] };
		const client = await startClient({
			content: [{ type: "text", text: JSON.stringify(structured) }],
			structuredContent: structured,
		});
		const result = await client.callTool("tool", {});
		expect(result.structuredContent).toEqual(structured);
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify(structured) }]);
		await client.close();
	});

	it("omits structuredContent when the reply has none", async () => {
		const client = await startClient({ content: [{ type: "text", text: "plain" }] });
		const result = await client.callTool("tool", {});
		expect(result.structuredContent).toBeUndefined();
		await client.close();
	});
});
