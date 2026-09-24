import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpServer, type HttpDeps } from "../src/http.ts";

const sessionRoot = (): string => join(dataDir, "sessions-workspace", "sid-1");

let dataDir = "";
let deps: HttpDeps;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "ask-files-"));
	deps = {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => [],
		sessionFilesRoot: async (_userId, sessionId) =>
			sessionId === "sid-1" ? join(dataDir, "sessions-workspace", sessionId) : null,
	};
});

afterAll(async () => {
	if (dataDir.length > 0) await rm(dataDir, { recursive: true, force: true });
});

const BOUNDARY = "----askfilesboundary";

function multipartBody(files: Array<{ name: string; filename: string; content: string }>): Buffer {
	const parts = files
		.map(
			(file) =>
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${file.content}\r\n`,
		)
		.join("");
	return Buffer.from(`${parts}--${BOUNDARY}--\r\n`, "utf8");
}

async function postFiles(sessionId: string, files: Array<{ name: string; filename: string; content: string }>) {
	const http = createHttpServer({ httpPort: 0 }, deps);
	return http.inject({
		method: "POST",
		url: `/api/v1/sessions/${sessionId}/files`,
		headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
		payload: multipartBody(files),
	});
}

async function getFile(sessionId: string, path: string) {
	const http = createHttpServer({ httpPort: 0 }, deps);
	return http.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/files?path=${encodeURIComponent(path)}` });
}

describe("POST /api/v1/sessions/:sessionId/files", () => {
	it("stores uploaded files under the session workspace and returns refs", async () => {
		const response = await postFiles("sid-1", [
			{ name: "files", filename: "a.pdf", content: "pdf-content-a" },
			{ name: "files", filename: "b.txt", content: "txt-content-b" },
		]);
		expect(response.statusCode).toBe(200);
		const refs = response.json() as Array<{ filename: string; path: string }>;
		expect(refs).toHaveLength(2);
		expect(refs[0]?.filename).toBe("a.pdf");
		expect(refs[1]?.filename).toBe("b.txt");
		for (const ref of refs) {
			expect(ref.path).toMatch(/^uploads\/[0-9a-f-]{36}-(a\.pdf|b\.txt)$/);
			const stored = await readFile(join(sessionRoot(), ...ref.path.split("/")), "utf8");
			expect(stored).toBe(ref.path.endsWith("a.pdf") ? "pdf-content-a" : "txt-content-b");
		}
	});

	it("returns 404 for unknown sessions", async () => {
		const response = await postFiles("nope", [{ name: "files", filename: "a.pdf", content: "x" }]);
		expect(response.statusCode).toBe(404);
	});
});

describe("CORS（web 前端跨源访问 HTTP 面）", () => {
	it("marks every API response accessible to any origin", async () => {
		const uploaded = await postFiles("sid-1", [{ name: "files", filename: "a.pdf", content: "x" }]);
		expect(uploaded.headers["access-control-allow-origin"]).toBe("*");
		const downloaded = await getFile("sid-1", "missing.txt");
		expect(downloaded.headers["access-control-allow-origin"]).toBe("*");
	});

	it("answers preflight OPTIONS with 204 and permissive headers", async () => {
		const http = createHttpServer({ httpPort: 0 }, deps);
		const response = await http.inject({
			method: "OPTIONS",
			url: "/api/v1/sessions/sid-1/files",
			headers: { origin: "http://localhost:8788", "access-control-request-method": "POST" },
		});
		expect(response.statusCode).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe("*");
		expect(response.headers["access-control-allow-methods"]).toContain("POST");
	});
});

describe("GET /api/v1/sessions/:sessionId/files", () => {
	it("streams a stored file with content-disposition attachment", async () => {
		const uploaded = await postFiles("sid-1", [{ name: "files", filename: "doc.pdf", content: "download-me" }]);
		const ref = (uploaded.json() as Array<{ filename: string; path: string }>)[0];
		const response = await getFile("sid-1", ref.path);
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-disposition"]).toContain("attachment");
		expect(response.body).toBe("download-me");
	});

	it("rejects path escapes with 400 and missing files with 404", async () => {
		for (const path of ["../other.json", "..\\..\\x", "C:\\x", "/etc/passwd"]) {
			const response = await getFile("sid-1", path);
			expect(response.statusCode, `path=${path}`).toBe(400);
		}
		expect((await getFile("sid-1", "missing.txt")).statusCode).toBe(404);
		expect((await getFile("sid-1", "")).statusCode).toBe(400);
	});

	it("returns 404 for unknown sessions", async () => {
		expect((await getFile("nope", "uploads/x.pdf")).statusCode).toBe(404);
	});
});
