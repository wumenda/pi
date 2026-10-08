import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { bashTool } from "../../../src/harness/pico3/bash.ts";
import type { ToolApi, ToolResult } from "../../../src/harness/pico3/types.ts";

// bash 可用性探测：正常路径用例依赖 bash 存在（Windows CI 可能没有）；
// spawn 失败用例不依赖 bash（bash 缺失本身就是 error 事件，同样走修复路径）
const bashAvailable = spawnSync("bash", ["-c", "true"]).status === 0;

/** bash.execute 只消费 api.stream：收集流式输出供断言。 */
function testApi(): ToolApi & { chunks: string[] } {
	const chunks: string[] = [];
	const api = {
		chunks,
		stream(chunk: string | Uint8Array): void {
			chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
		},
	} as ToolApi & { chunks: string[] };
	return api;
}

const decodeDetails = (result: ToolResult) => result.details as { exitCode: number | null; error?: string };

describe("pico3 bash tool", () => {
	// 跨平台确定性的 spawn 失败触发器：无效 cwd 使 libuv 在 spawn 阶段报错（error 事件）；
	// bash 缺失（ENOENT）同样触发 error——两条路径都验证修复后的行为：
	// Promise settle 并返回 isError ToolResult（修复前：永久挂死 + 未捕获异常）。
	it("settles with an error ToolResult when spawn fails (invalid cwd)", async () => {
		const api = testApi();
		const tool = bashTool();
		const result = await tool.execute(
			{ command: "echo hi", cwd: join(tmpdir(), `no-such-dir-${Date.now()}`) },
			api,
			BACKGROUND_CONTEXT,
		);
		expect(result.isError).toBe(true);
		const details = decodeDetails(result);
		expect(details.exitCode).toBeNull();
		expect(details.error).toBeTruthy();
	});

	it.runIf(bashAvailable)("returns exit code and streams output on success", async () => {
		const api = testApi();
		const tool = bashTool();
		const result = await tool.execute({ command: "echo hello" }, api, BACKGROUND_CONTEXT);
		expect(result.isError).toBe(false);
		expect(decodeDetails(result).exitCode).toBe(0);
		expect(api.chunks.join("")).toContain("hello");
	});

	it.runIf(bashAvailable)("reports non-zero exit codes as error results", async () => {
		const api = testApi();
		const tool = bashTool();
		const result = await tool.execute({ command: "exit 3" }, api, BACKGROUND_CONTEXT);
		expect(result.isError).toBe(true);
		expect(decodeDetails(result).exitCode).toBe(3);
	});
});
