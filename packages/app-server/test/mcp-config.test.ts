import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMcpServerConfigs } from "../src/mcp-config.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadMcpServerConfigs", () => {
	it("parses stdio and http entries and skips invalid ones", async () => {
		const dir = mkdtempSync(join(tmpdir(), "mcp-"));
		dirs.push(dir);
		writeFileSync(
			join(dir, "mcp.json"),
			JSON.stringify({
				example: { type: "http", url: "http://127.0.0.1:8018/mcp" },
				bad: { type: "http" },
				legacy: { type: "stdio", command: "python", args: ["-m", "x"] },
			}),
		);
		const configs = await loadMcpServerConfigs(join(dir, "mcp.json"));
		expect(Object.keys(configs)).toEqual(["example", "legacy"]);
		expect(configs.example).toEqual({ type: "http", url: "http://127.0.0.1:8018/mcp" });
	});
	it("returns empty map when the file is missing", async () => {
		const configs = await loadMcpServerConfigs(join(tmpdir(), "definitely-missing.json"));
		expect(configs).toEqual({});
	});
});
