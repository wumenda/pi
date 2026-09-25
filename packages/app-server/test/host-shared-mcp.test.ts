import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it } from "vitest";
import { createAppServerHost } from "../src/host.ts";
import { createSessionStore } from "../src/sessions.ts";
import { createFauxLlm } from "./faux-llm.ts";

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

/**
 * Minimal streamable-HTTP MCP server: one UI-declaring tool plus a ui:// resource.
 * Counts initialize handshakes so tests can assert the shared manager connects once.
 */
async function startMcpServer(): Promise<{ port: number; initializeCount: () => number }> {
	let initialized = 0;
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
			if (message.method === "initialize") headers["mcp-session-id"] = "shared-session";
			res.writeHead(200, headers);
			if (message.method === "initialize") {
				initialized += 1;
				sse(res, {
					jsonrpc: "2.0",
					id: message.id,
					result: { protocolVersion: "2025-06-18", serverInfo: { name: "t", version: "0" } },
				});
			} else if (message.method === "tools/list") {
				sse(res, {
					jsonrpc: "2.0",
					id: message.id,
					result: {
						tools: [
							{
								name: "query_panel",
								description: "panel query",
								inputSchema: { type: "object" },
								_meta: { ui: { resourceUri: "ui://demo/panel" } },
							},
						],
					},
				});
			} else if (message.method === "resources/read") {
				sse(res, {
					jsonrpc: "2.0",
					id: message.id,
					result: {
						contents: [
							{ uri: "ui://demo/panel", mimeType: "text/html", text: "<html><body>panel</body></html>" },
						],
					},
				});
			} else {
				sse(res, { jsonrpc: "2.0", id: message.id, result: {} });
			}
			res.end();
		});
	});
	servers.push(server);
	const port = await listen(server);
	return { port, initializeCount: () => initialized };
}

describe("host-level shared MCP manager (B1)", () => {
	it("serves ui resources with zero sessions, connects once across sessions, releases on host close", async () => {
		const { port, initializeCount } = await startMcpServer();
		const root = mkdtempSync(join(tmpdir(), "app-server-host-"));
		dirs.push(root);
		const dataDir = join(root, "data");
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(
			join(dataDir, "mcp.json"),
			JSON.stringify({ t: { type: "http", url: `http://127.0.0.1:${port}/mcp` } }),
		);

		const handle = await createAppServerHost(
			{
				config: {
					agentPlanBaseUrl: "https://example.invalid",
					modelId: "faux",
					wsPort: 0,
					httpPort: 0,
					dataDir,
				},
				llm: createFauxLlm(),
			},
			"test-host",
		);

		// 零会话即可用：ui-resources 与清单不再依赖存活会话的 manager
		const ui = await handle.readUiResource({ serverId: "t", resourceUri: "ui://demo/panel" });
		expect(ui.mimeType).toBe("text/html");
		expect(ui.html).toContain("panel");
		await expect(handle.listMcpTools()).resolves.toEqual([
			{ serverId: "t", name: "query_panel", resourceUri: "ui://demo/panel", harnessName: "mcp__t__query_panel" },
		]);

		// 两个会话共享同一条连接（initialize 恰好一次）；会话逐一关闭后依旧可用
		const store = createSessionStore({ dataDir, workspaceDir: join(root, "ws") });
		const runtimeA = await handle.host.openSession(await store.create(), BACKGROUND_CONTEXT);
		const runtimeB = await handle.host.openSession(await store.create(), BACKGROUND_CONTEXT);
		expect(initializeCount()).toBe(1);

		await runtimeA.close(BACKGROUND_CONTEXT);
		await expect(handle.readUiResource({ serverId: "t", resourceUri: "ui://demo/panel" })).resolves.toMatchObject({
			html: expect.stringContaining("panel"),
		});
		await runtimeB.close(BACKGROUND_CONTEXT);
		await expect(handle.readUiResource({ serverId: "t", resourceUri: "ui://demo/panel" })).resolves.toMatchObject({
			html: expect.stringContaining("panel"),
		});

		// host.close() 统一释放共享连接
		await handle.close();
		await expect(handle.readUiResource({ serverId: "t", resourceUri: "ui://demo/panel" })).rejects.toThrow();
	});
});
