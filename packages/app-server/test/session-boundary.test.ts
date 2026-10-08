import { mkdtempSync, rmSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client } from "@earendil-works/pi-client";
import { createWsTransportFactory } from "@earendil-works/pi-client/ws";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createAppServer } from "../src/index.ts";
import { SessionDirectory, SessionManagement } from "../src/services/contracts.ts";
import { createSessionStore } from "../src/sessions.ts";
import { createFauxLlm } from "./faux-llm.ts";
import { bindServerServices } from "./service-bindings.ts";

// 会话 id 边界回归（目录穿越封堵）：
// - WS 面：SessionManagement.create 拒绝路径分隔符/点段 id，不落盘；
// - HTTP 面：上传/下载端点对非法 id 一律 404（sessionFilesRoot 边界）；
// - 合法自定义 id 不受影响（白名单不误伤）。

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "app-server-boundary-"));
	dirs.push(dir);
	return dir;
};
afterAll(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("session id boundary（目录穿越封堵）", { timeout: 30_000 }, () => {
	let root = "";
	let handle: ReturnType<typeof createAppServer> | undefined;
	let client: Client | undefined;
	let serverBinding: ReturnType<typeof bindServerServices> | undefined;

	afterEach(async () => {
		if (client !== undefined) await client.dispose().catch(() => undefined);
		client = undefined;
		serverBinding = undefined;
		if (handle !== undefined) await handle.close().catch(() => undefined);
		handle = undefined;
		if (root.length > 0) await rm(root, { recursive: true, force: true }).catch(() => undefined);
		root = "";
	});

	async function start(): Promise<void> {
		root = tempDir();
		const config = loadConfig({});
		config.dataDir = join(root, "data");
		const faux = createFauxLlm();
		handle = createAppServer({
			wsPort: 0,
			httpPort: 0,
			deps: { config, llm: { models: faux.models, model: faux.model } },
		});
		await handle.start();
		client = new Client({
			serverId: handle.serverId,
			transportFactory: createWsTransportFactory({ url: `ws://127.0.0.1:${handle.wsPort}` }),
		});
		await client.connect();
		serverBinding = bindServerServices(client);
	}

	it("create rejects path traversal ids over WS and does not persist them", { timeout: 30_000 }, async () => {
		await start();
		const management = serverBinding!.use(SessionManagement);
		for (const malicious of ["../../evil", "..\\..\\evil", "../x", "..%2F..%2Fevil"]) {
			await expect(management.create({ id: malicious }, BACKGROUND_CONTEXT), `id=${malicious}`).rejects.toThrow();
		}
		// 目录状态（session-directory replicated state）中不出现任何恶意 id
		await waitUntil(() => serverBinding!.use(SessionDirectory).state.value !== undefined);
		const sessions = serverBinding!.use(SessionDirectory).state.value?.sessions ?? [];
		expect(sessions.map((summary) => summary.sessionId)).not.toContain("../../evil");
		expect(sessions).toHaveLength(0);
	});

	it("create accepts safe custom ids and the HTTP boundary blocks traversal session ids", async () => {
		await start();
		const created = await serverBinding!.use(SessionManagement).create({ id: "my-session-1" }, BACKGROUND_CONTEXT);
		expect(created.sessionId).toBe("my-session-1");

		// 下载端点：恶意 id（URL 编码后仍为路径段逃逸形态）→ 404，不触达 sessions-workspace 之外
		const traversal = await fetch(
			`http://127.0.0.1:${handle!.httpPort}/api/v1/sessions/${encodeURIComponent("../../evil")}/files?path=x`,
		);
		expect(traversal.status).toBe(404);

		// 上传端点：恶意 id → 404
		const maliciousForm = new FormData();
		maliciousForm.append("files", new Blob(["x"], { type: "application/octet-stream" }), "a.txt");
		const uploadTraversal = await fetch(
			`http://127.0.0.1:${handle!.httpPort}/api/v1/sessions/${encodeURIComponent("../../evil")}/files`,
			{ method: "POST", body: maliciousForm },
		);
		expect(uploadTraversal.status).toBe(404);

		// 正向对照：合法会话上传仍工作，文件落在 <dataDir>/sessions-workspace/<id>/uploads/
		const form = new FormData();
		form.append("files", new Blob(["upload-content"], { type: "application/octet-stream" }), "a.txt");
		const response = await fetch(`http://127.0.0.1:${handle!.httpPort}/api/v1/sessions/my-session-1/files`, {
			method: "POST",
			body: form,
		});
		expect(response.status).toBe(200);
		const refs = (await response.json()) as Array<{ filename: string; path: string }>;
		expect(refs).toHaveLength(1);
		expect(refs[0]?.path).toMatch(/^uploads\/[0-9a-f-]{36}-a\.txt$/);
		const stored = await readFile(
			join(root, "data", "sessions-workspace", "my-session-1", ...refs[0]!.path.split("/")),
			"utf8",
		);
		expect(stored).toBe("upload-content");
	});

	it("openSession boundary rejects attach of legacy malicious-id sessions", async () => {
		await start();
		// 模拟修复前遗留的恶意 id 会话：绕过 create 边界，直接经 SessionStore 落盘
		const legacyStore = createSessionStore({
			dataDir: join(root, "data"),
			workspaceDir: join(root, "data", "workspace"),
		});
		await legacyStore.create("../../evil");

		const management = serverBinding!.use(SessionManagement);
		await expect(management.attach("../../evil", BACKGROUND_CONTEXT)).rejects.toThrow();
		expect(client!.attachment).toBeUndefined();

		// 正向对照：同栈下合法会话 attach 仍正常打开运行时
		await management.create({ id: "valid-session-1" }, BACKGROUND_CONTEXT);
		await management.attach("valid-session-1", BACKGROUND_CONTEXT);
		await waitUntil(() => client!.attachment !== undefined && client!.attachment.sessionId === "valid-session-1");
	});
});

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitUntil timed out");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
