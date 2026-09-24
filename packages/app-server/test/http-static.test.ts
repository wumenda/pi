/**
 * Task 28：静态托管 + SPA fallback。
 * - 配置 webDist：/ 返回 index.html、/assets/* 按内容类型 200、
 *   未知非 API 路径 fallback 到 index.html（SPA 深链）；
 * - 未知 /api/v1/* 保持 404 JSON，不走 fallback；
 * - 未配置 webDist：不注册静态托管（既有行为回归）。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer, type HttpDeps } from "../src/http.ts";

let dist = "";
const deps: HttpDeps = {
	readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
	listMcpTools: async () => [],
	sessionFilesRoot: async () => null,
};

beforeAll(async () => {
	dist = await mkdtemp(join(tmpdir(), "web-dist-"));
	await mkdir(join(dist, "assets"), { recursive: true });
	await writeFile(join(dist, "index.html"), "<!doctype html><title>pi-web</title>", "utf8");
	await writeFile(join(dist, "assets", "app.js"), "console.log(1);", "utf8");
});

afterAll(async () => {
	if (dist.length > 0) await rm(dist, { recursive: true, force: true });
});

describe("static hosting with SPA fallback", () => {
	it("serves index.html at /", async () => {
		const app = createHttpServer({ httpPort: 0, webDist: dist }, deps);
		try {
			const response = await app.inject({ method: "GET", url: "/" });
			expect(response.statusCode).toBe(200);
			expect(response.body).toContain("pi-web");
		} finally {
			await app.close();
		}
	});

	it("serves /assets/* files", async () => {
		const app = createHttpServer({ httpPort: 0, webDist: dist }, deps);
		try {
			const response = await app.inject({ method: "GET", url: "/assets/app.js" });
			expect(response.statusCode).toBe(200);
			expect(response.headers["content-type"]).toContain("javascript");
			expect(response.body).toBe("console.log(1);");
		} finally {
			await app.close();
		}
	});

	it("falls back unknown non-API paths to index.html", async () => {
		const app = createHttpServer({ httpPort: 0, webDist: dist }, deps);
		try {
			const response = await app.inject({ method: "GET", url: "/some/spa/route" });
			expect(response.statusCode).toBe(200);
			expect(response.body).toContain("pi-web");
		} finally {
			await app.close();
		}
	});

	it("keeps unknown API routes as JSON 404 without fallback", async () => {
		const app = createHttpServer({ httpPort: 0, webDist: dist }, deps);
		try {
			const response = await app.inject({ method: "GET", url: "/api/v1/nope" });
			expect(response.statusCode).toBe(404);
			expect(response.json()).toEqual({ error: "not found" });
		} finally {
			await app.close();
		}
	});

	it("keeps registered API routes working alongside static hosting", async () => {
		const app = createHttpServer({ httpPort: 0, webDist: dist }, deps);
		try {
			const response = await app.inject({ method: "GET", url: "/api/v1/mcp-tools" });
			expect(response.statusCode).toBe(200);
		} finally {
			await app.close();
		}
	});

	it("does not serve static files without webDist", async () => {
		const app = createHttpServer({ httpPort: 0 }, deps);
		try {
			const root = await app.inject({ method: "GET", url: "/" });
			expect(root.statusCode).toBe(404);
			const spa = await app.inject({ method: "GET", url: "/some/spa/route" });
			expect(spa.statusCode).toBe(404);
		} finally {
			await app.close();
		}
	});
});
