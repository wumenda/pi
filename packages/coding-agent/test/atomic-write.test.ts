import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { writeFileAtomic } from "../src/core/tools/atomic-write.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";

// rename 失败注入（模拟崩溃窗口 / 目标被占用 / ENOSPC 后的替换失败）：
// 验证失败路径的目标文件完好性与临时文件清理。其余用例全部走真实 FS。
const renameState = vi.hoisted(() => ({ failNext: false }));
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>();
	return {
		...actual,
		rename: async (...args: Parameters<typeof actual.rename>) => {
			if (renameState.failNext) {
				renameState.failNext = false;
				throw Object.assign(new Error("simulated rename failure"), { code: "EPERM" });
			}
			return actual.rename(...args);
		},
	};
});

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	renameState.failNext = false;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempFileCount = (dir: string): number => readdirSync(dir).filter((name) => name.includes(".pi-tmp-")).length;

describe("writeFileAtomic（真实 FS）", () => {
	it("creates a new file with the exact content", async () => {
		const dir = tempDir();
		const target = join(dir, "file.txt");
		await writeFileAtomic(target, "hello");
		expect(await import("fs/promises").then((fs) => fs.readFile(target, "utf-8"))).toBe("hello");
		expect(tempFileCount(dir)).toBe(0);
	});

	it("replaces existing content and leaves no temp residue", async () => {
		const dir = tempDir();
		const target = join(dir, "file.txt");
		writeFileSync(target, "old content");
		await writeFileAtomic(target, "new content");
		expect(await import("fs/promises").then((fs) => fs.readFile(target, "utf-8"))).toBe("new content");
		expect(tempFileCount(dir)).toBe(0);
	});

	it("keeps original content and cleans the temp file when rename fails", async () => {
		const dir = tempDir();
		const target = join(dir, "file.txt");
		writeFileSync(target, "original");
		renameState.failNext = true;
		await expect(writeFileAtomic(target, "replaced")).rejects.toThrow("simulated rename failure");
		expect(await import("fs/promises").then((fs) => fs.readFile(target, "utf-8"))).toBe("original");
		expect(tempFileCount(dir)).toBe(0);
	});
});

describe("edit/write tools 使用原子写（默认 ops，真实 FS）", () => {
	// 与 tools.test.ts 相同的最小 ctx 惯例：工具只消费 cwd
	const toolCtx = (dir: string): ExtensionContext => ({ cwd: dir }) as ExtensionContext;

	it("write tool persists content atomically", async () => {
		const dir = tempDir();
		const tool = createWriteToolDefinition(dir);
		const result = await tool.execute(
			"call-1",
			{ path: "out/nested.txt", content: "written" },
			undefined,
			undefined,
			toolCtx(dir),
		);
		expect(result.content[0]?.type).toBe("text");
		expect(await import("fs/promises").then((fs) => fs.readFile(join(dir, "out", "nested.txt"), "utf-8"))).toBe(
			"written",
		);
	});

	it("edit tool applies replacements atomically", async () => {
		const dir = tempDir();
		const target = join(dir, "code.ts");
		writeFileSync(target, "hello world\n");
		const tool = createEditToolDefinition(dir);
		await tool.execute(
			"call-2",
			{ path: target, edits: [{ oldText: "world", newText: "there" }] },
			undefined,
			undefined,
			toolCtx(dir),
		);
		expect(await import("fs/promises").then((fs) => fs.readFile(target, "utf-8"))).toBe("hello there\n");
		expect(tempFileCount(dir)).toBe(0);
	});
});
