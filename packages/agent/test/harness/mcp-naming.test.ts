import { describe, expect, it } from "vitest";
import type { McpRoutedTool, McpServerManager } from "../../src/harness/mcp/manager.ts";
import { createMcpTools } from "../../src/harness/mcp/tools.ts";

function routedTool(serverId: string, name: string, meta: unknown): McpRoutedTool {
	return {
		serverId,
		tool: { name, inputSchema: { type: "object" }, _meta: meta } as McpRoutedTool["tool"],
	};
}

function managerWithTools(tools: McpRoutedTool[]): McpServerManager {
	// Building the bridge only reads manager.tools(); callTool is not exercised here.
	return { tools: () => tools } as unknown as McpServerManager;
}

describe("createMcpTools provenance", () => {
	it("carries the default namespaced harness name", () => {
		const { provenance } = createMcpTools(
			managerWithTools([routedTool("demo", "read_sensor", { ui: { resourceUri: "ui://demo/panel" } })]),
		);
		expect(provenance).toEqual([
			{ serverId: "demo", toolName: "read_sensor", harnessName: "mcp__demo__read_sensor" },
		]);
	});

	it("keeps collision-suffixed harness names resolvable per server", () => {
		// "a.b" and "a_b" sanitize to the same name part; the second bridge gets a `_` suffix.
		const { provenance } = createMcpTools(
			managerWithTools([routedTool("a.b", "read", undefined), routedTool("a_b", "read", undefined)]),
		);
		expect(provenance).toEqual([
			{ serverId: "a.b", toolName: "read", harnessName: "mcp__a_b__read" },
			{ serverId: "a_b", toolName: "read", harnessName: "mcp__a_b__read_" },
		]);
	});
});
