import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePersistedServerId } from "../src/server-id.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function tempDataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "app-server-id-"));
	dirs.push(dir);
	return dir;
}

describe("resolvePersistedServerId", () => {
	it("generates and persists a UUIDv4 on first run, then reuses it across restarts", async () => {
		const dataDir = tempDataDir();
		const first = await resolvePersistedServerId(dataDir);
		expect(first).toMatch(UUID_V4);
		expect(readFileSync(join(dataDir, "server-id"), "utf8").trim()).toBe(first);
		await expect(resolvePersistedServerId(dataDir)).resolves.toBe(first);
	});

	it("regenerates when the persisted file is corrupt", async () => {
		const dataDir = tempDataDir();
		writeFileSync(join(dataDir, "server-id"), "not-a-uuid");
		const resolved = await resolvePersistedServerId(dataDir);
		expect(resolved).toMatch(UUID_V4);
		expect(readFileSync(join(dataDir, "server-id"), "utf8").trim()).toBe(resolved);
	});

	it("honors the override and persists it as the single source", async () => {
		const dataDir = tempDataDir();
		const override = "00000000-0000-4000-8000-000000000000";
		await expect(resolvePersistedServerId(dataDir, override)).resolves.toBe(override);
		expect(readFileSync(join(dataDir, "server-id"), "utf8").trim()).toBe(override);
		await expect(resolvePersistedServerId(dataDir)).resolves.toBe(override);
	});

	it("rejects invalid overrides", async () => {
		const dataDir = tempDataDir();
		await expect(resolvePersistedServerId(dataDir, "nope")).rejects.toThrow("APP_SERVER_SERVER_ID");
	});
});
