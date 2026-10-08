import { describe, expect, it } from "vitest";
import { createHttpServer, type HttpDeps, type McpToolEntry } from "../src/http.ts";

const tools: McpToolEntry[] = [
	{
		serverId: "example",
		name: "simple_tool",
		title: "Simple",
		description: "A ui tool",
		harnessName: "mcp__example__simple_tool",
		visibility: ["model", "app"],
		resourceUri: "ui://mcp-app-ui/simple/index.html",
		inputSchema: { type: "object", properties: {} },
	},
	{
		serverId: "example",
		name: "plain_tool",
		description: "A non-ui tool",
		inputSchema: { type: "object", properties: {} },
	},
];

function fakeDeps(overrides: Partial<HttpDeps> = {}): HttpDeps {
	return {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => [],
		listTools: async () => tools,
		listSkills: async () => [],
		getSkillDetail: async () => null,
		sessionFilesRoot: async () => null,
		dataCenterStore: async () => null,
		...overrides,
	};
}

describe("GET /api/v1/tools", () => {
	it("returns all tools (ui and non-ui) with cache-control no-store", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/tools" });
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toEqual(tools);
	});
	it("returns an empty array when no mcp servers are connected", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps({ listTools: async () => [] }));
		const response = await http.inject({ method: "GET", url: "/api/v1/tools" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
	});
});
