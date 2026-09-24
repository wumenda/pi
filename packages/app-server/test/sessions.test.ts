import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore } from "../src/sessions.ts";

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "app-server-"));
	dirs.push(dir);
	return dir;
};
afterEach(async () => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SessionStore", () => {
	it("create → list → resolve → delete lifecycle", async () => {
		const root = tempDir();
		const store = createSessionStore({ dataDir: join(root, "data"), workspaceDir: join(root, "ws") });
		const created = await store.create();
		expect(created.id).toBeTruthy();
		expect((await store.list()).map((m) => m.id)).toContain(created.id);
		expect((await store.resolve(created.id)).id).toBe(created.id);
		const session = await store.open(await store.resolve(created.id));
		await session.close(BACKGROUND_CONTEXT);
		await store.delete(created.id);
		expect((await store.list()).map((m) => m.id)).not.toContain(created.id);
	});
	it("resolve throws for unknown session", async () => {
		const root = tempDir();
		const store = createSessionStore({ dataDir: join(root, "data"), workspaceDir: join(root, "ws") });
		await expect(store.resolve("nope")).rejects.toThrow(/not found/i);
	});
});
