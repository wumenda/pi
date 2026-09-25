import { describe, expect, it } from "vitest";
import { createHttpServer, type HttpDeps } from "../src/http.ts";

const SERVER_ID = "00000000-0000-4000-8000-000000000000";

function fakeDeps(): HttpDeps {
	return {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => [],
		sessionFilesRoot: async () => null,
	};
}

describe("GET /api/v1/server-id", () => {
	it("returns the configured server id", async () => {
		const http = createHttpServer({ httpPort: 0, serverId: SERVER_ID }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/server-id" });
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toEqual({ serverId: SERVER_ID });
	});

	it("returns null when no server id is configured", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/server-id" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ serverId: null });
	});

	it("requires the token in token mode", async () => {
		const http = createHttpServer({ httpPort: 0, token: "secret", serverId: SERVER_ID }, fakeDeps());
		const denied = await http.inject({ method: "GET", url: "/api/v1/server-id" });
		expect(denied.statusCode).toBe(401);
		const allowed = await http.inject({ method: "GET", url: "/api/v1/server-id?token=secret" });
		expect(allowed.statusCode).toBe(200);
		expect(allowed.json()).toEqual({ serverId: SERVER_ID });
	});
});
