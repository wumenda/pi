import { describe, expect, it } from "vitest";
import { createHttpServer, intersectCsp } from "../src/http.ts";

function fakeDeps() {
	return {
		readUiResource: async (_request: { serverId: string; resourceUri: string }) => ({
			mimeType: "text/html",
			html: "<html>app</html>",
			declaredCsp: null as string | null,
		}),
	};
}

describe("GET /api/v1/ui-resources", () => {
	it("serves html with the platform CSP header", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({
			method: "GET",
			url: "/api/v1/ui-resources?serverId=example&resourceUri=ui%3A%2F%2Fx",
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
		expect(response.body).toContain("app");
	});
	it("rejects missing params with 400", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/ui-resources" });
		expect(response.statusCode).toBe(400);
	});
	it("propagates read failures as 502", async () => {
		const http = createHttpServer(
			{
				httpPort: 0,
			},
			{
				readUiResource: async () => {
					throw new Error("server down");
				},
			},
		);
		const response = await http.inject({
			method: "GET",
			url: "/api/v1/ui-resources?serverId=example&resourceUri=ui%3A%2F%2Fx",
		});
		expect(response.statusCode).toBe(502);
	});
});

describe("intersectCsp", () => {
	it("returns the platform default when nothing is declared", () => {
		expect(intersectCsp(null)).toContain("default-src 'none'");
	});
	it("drops declared values that would loosen the platform default", () => {
		const merged = intersectCsp("default-src *; script-src 'unsafe-inline' https://evil.example; img-src data:");
		expect(merged).toContain("default-src 'none'");
		expect(merged).not.toContain("evil.example");
		expect(merged).toContain("img-src data:");
	});
	it("drops unknown directive families entirely", () => {
		const merged = intersectCsp("frame-ancestors *; script-src 'unsafe-inline'");
		expect(merged).not.toContain("frame-ancestors");
		expect(merged).toContain("script-src 'unsafe-inline'");
	});
});
