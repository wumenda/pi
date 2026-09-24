/**
 * Task 27：多用户会话空间隔离（APP_SERVER_USERS token→userId 映射）。
 * - users 模式：无/未映射 token 的 WS 升级与 HTTP 请求 401；
 * - 两个用户各自 create 的会话只在各自 list 中（SessionDirectory 隔离）；
 * - user-a 无法 attach user-b 的会话（resolve 按用户存储路由）；
 * - 上传/下载目录隔离：tok-a 上传到 user-b 的会话 404，tok-b 成功且文件落
 *   <dataDir>/users/user-b/sessions-workspace/<sessionId>/；
 * - 缺省（未配置 users）：单用户模式，dataDir 原样（既有测试回归覆盖）。
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteServiceBinding } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client } from "@earendil-works/pi-client";
import { createWsTransportFactory } from "@earendil-works/pi-client/ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { loadConfig } from "../src/config.ts";
import { createAppServer } from "../src/index.ts";
import { SessionDirectory, SessionManagement } from "../src/services/contracts.ts";
import { createFauxLlm } from "./faux-llm.ts";
import { bindServerServices } from "./service-bindings.ts";

const USERS: Record<string, string> = { "tok-a": "user-a", "tok-b": "user-b" };

let root = "";
let handle: ReturnType<typeof createAppServer>;
let bindingA: RemoteServiceBinding;
let bindingB: RemoteServiceBinding;
let createdA: { sessionId: string };
let createdB: { sessionId: string };
const clients: Client[] = [];

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "app-server-users-"));
	const config = loadConfig({});
	config.dataDir = root;
	config.users = USERS;
	const faux = createFauxLlm();
	handle = createAppServer({
		wsPort: 0,
		httpPort: 0,
		deps: { config, llm: { models: faux.models, model: faux.model } },
	});
	await handle.start();

	const connect = async (token: string): Promise<RemoteServiceBinding> => {
		const client = new Client({
			serverId: handle.serverId,
			transportFactory: createWsTransportFactory({
				url: `ws://127.0.0.1:${handle.wsPort}?token=${token}`,
			}),
		});
		await client.connect();
		clients.push(client);
		return bindServerServices(client);
	};
	bindingA = await connect("tok-a");
	bindingB = await connect("tok-b");
	createdA = await bindingA.use(SessionManagement).create({}, BACKGROUND_CONTEXT);
	createdB = await bindingB.use(SessionManagement).create({}, BACKGROUND_CONTEXT);
}, 30_000);

afterAll(async () => {
	for (const client of clients.splice(0)) await client.dispose().catch(() => undefined);
	await handle?.close().catch(() => undefined);
	if (root.length > 0) await rm(root, { recursive: true, force: true });
});

/** 等待 replicated directory 快照包含指定会话后返回完整列表（create 后 refresh 推送有延迟）。 */
async function listedSessionIds(binding: RemoteServiceBinding, expectedSessionId: string): Promise<string[]> {
	await waitUntil(() =>
		(binding.use(SessionDirectory).state.value?.sessions ?? []).some(
			(entry) => entry.sessionId === expectedSessionId,
		),
	);
	return (binding.use(SessionDirectory).state.value?.sessions ?? []).map((entry) => entry.sessionId);
}

function httpBase(): string {
	return `http://127.0.0.1:${handle.httpPort}`;
}

async function upload(token: string | undefined, sessionId: string): Promise<Response> {
	const form = new FormData();
	form.append("files", new Blob(["payload"]), "note.txt");
	const suffix = token === undefined ? "" : `?token=${token}`;
	return fetch(`${httpBase()}/api/v1/sessions/${sessionId}/files${suffix}`, { method: "POST", body: form });
}

describe("WS per-user routing", () => {
	it("routes connections by token and isolates session lists", { timeout: 20_000 }, async () => {
		const idsA = await listedSessionIds(bindingA, createdA.sessionId);
		const idsB = await listedSessionIds(bindingB, createdB.sessionId);
		expect(idsA).toContain(createdA.sessionId);
		expect(idsA).not.toContain(createdB.sessionId);
		expect(idsB).toContain(createdB.sessionId);
		expect(idsB).not.toContain(createdA.sessionId);
		// 数据目录按用户隔离：<dataDir>/users/<userId>/sessions
		await expect(stat(join(root, "users", "user-a", "sessions"))).resolves.toBeTruthy();
		await expect(stat(join(root, "users", "user-b", "sessions"))).resolves.toBeTruthy();
		await expect(stat(join(root, "sessions"))).rejects.toThrow();
	});

	it("rejects cross-user session attach", { timeout: 20_000 }, async () => {
		await expect(bindingA.use(SessionManagement).attach(createdB.sessionId, BACKGROUND_CONTEXT)).rejects.toThrow();
		await expect(bindingB.use(SessionManagement).attach(createdA.sessionId, BACKGROUND_CONTEXT)).rejects.toThrow();
	});
});

describe("HTTP per-user routing", () => {
	it("rejects unauthenticated requests with 401", async () => {
		const anonymous = await fetch(`${httpBase()}/api/v1/mcp-tools`);
		expect(anonymous.status).toBe(401);
		const wrong = await fetch(`${httpBase()}/api/v1/mcp-tools?token=nope`);
		expect(wrong.status).toBe(401);
	});

	it("isolates file upload roots per user", { timeout: 20_000 }, async () => {
		const cross = await upload("tok-a", createdB.sessionId);
		expect(cross.status).toBe(404);
		const own = await upload("tok-b", createdB.sessionId);
		expect(own.status).toBe(200);
		const refs = (await own.json()) as Array<{ filename: string; path: string }>;
		expect(refs).toHaveLength(1);
		const stored = await readFile(
			join(root, "users", "user-b", "sessions-workspace", createdB.sessionId, ...refs[0]!.path.split("/")),
			"utf8",
		);
		expect(stored).toBe("payload");
	});
});

describe("WS upgrade auth in users mode", () => {
	function upgradeStatus(target: string): Promise<number> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(target);
			socket.once("unexpected-response", (_request: unknown, response: { statusCode: number }) => {
				resolve(response.statusCode);
			});
			socket.once("open", () => {
				socket.close();
				reject(new Error("WebSocket upgrade should have been rejected"));
			});
			socket.once("error", (error) => reject(error));
		});
	}

	it("rejects missing/unmapped tokens with 401", async () => {
		await expect(upgradeStatus(`ws://127.0.0.1:${handle.wsPort}`)).resolves.toBe(401);
		await expect(upgradeStatus(`ws://127.0.0.1:${handle.wsPort}/?token=nope`)).resolves.toBe(401);
	});
});

describe("loadConfig users parsing", () => {
	it("parses APP_SERVER_USERS JSON into a token→userId map", () => {
		const env = { APP_SERVER_USERS: '{"tok":"alice"}' } as NodeJS.ProcessEnv;
		const config = loadConfig(env);
		expect(config.users).toEqual({ tok: "alice" });
	});

	it("omits users when unset and throws on invalid JSON or shape", () => {
		expect(loadConfig({} as NodeJS.ProcessEnv).users).toBeUndefined();
		expect(() => loadConfig({ APP_SERVER_USERS: "not-json" } as NodeJS.ProcessEnv)).toThrow();
		expect(() => loadConfig({ APP_SERVER_USERS: '["tok"]' } as NodeJS.ProcessEnv)).toThrow();
		expect(() => loadConfig({ APP_SERVER_USERS: '{"t":1}' } as NodeJS.ProcessEnv)).toThrow();
	});
});

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitUntil timed out");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
