import { describe, expect, it } from "vitest";
import { createHttpServer, type HttpDeps } from "../src/http.ts";

const manifest = [
	{ serverId: "example", name: "simple_tool", resourceUri: "ui://mcp-app-ui/simple/index.html" },
	{
		serverId: "example",
		name: "review_tool",
		resourceUri: "ui://mcp-app-ui/review/index.html",
		visibility: ["app"],
	},
];

function fakeDeps(overrides: Partial<HttpDeps> = {}): HttpDeps {
	return {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => manifest,
		...overrides,
	};
}

describe("GET /api/v1/mcp-tools", () => {
	it("returns the manifest with cache-control no-store", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/mcp-tools" });
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toEqual(manifest);
	});
	it("returns an empty array when no ui tools exist", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps({ listMcpTools: async () => [] }));
		const response = await http.inject({ method: "GET", url: "/api/v1/mcp-tools" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
	});
});
