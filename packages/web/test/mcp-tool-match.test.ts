import type { McpUiToolDTO } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { matchMcpTool } from "../src/api/tools";

function tool(overrides: Partial<McpUiToolDTO> & { name: string; serverId: string }): McpUiToolDTO {
	return { resourceUri: `ui://${overrides.serverId}/panel`, permissions: [], ...overrides };
}

describe("matchMcpTool", () => {
	it("matches bridged harness names exactly, collision suffix included (A1)", () => {
		// "a.b" 与 "a_b" sanitize 同形，桥接名靠 `_` 后缀区分——只有 harnessName 能唯一定位
		const tools = [
			tool({ name: "read", serverId: "a.b", harnessName: "mcp__a_b__read" }),
			tool({ name: "read", serverId: "a_b", harnessName: "mcp__a_b__read_" }),
		];
		expect(matchMcpTool("mcp__a_b__read", tools)?.serverId).toBe("a.b");
		expect(matchMcpTool("mcp__a_b__read_", tools)?.serverId).toBe("a_b");
	});

	it("prefers the harness match over the raw-name heuristics", () => {
		const tools = [
			tool({ name: "mcp__a_b__read", serverId: "s1" }),
			tool({ name: "read", serverId: "s2", harnessName: "mcp__a_b__read" }),
		];
		expect(matchMcpTool("mcp__a_b__read", tools)?.serverId).toBe("s2");
	});

	it("falls back to legacy heuristics when the manifest has no harnessName", () => {
		const tools = [tool({ name: "read", serverId: "a_b" })];
		expect(matchMcpTool("read", tools)?.serverId).toBe("a_b");
		expect(matchMcpTool("mcp__a_b__read", tools)?.serverId).toBe("a_b");
		// 遗留启发式的已知模糊：后缀命中不校验 server 前缀，异 server 同名也会命中
		//（A1 的 harnessName 精确匹配正是为消除它）
		expect(matchMcpTool("mcp__other__read", tools)?.serverId).toBe("a_b");
	});
});
