import { describe, expect, it } from "vitest";
import type { McpRoutedTool, McpServerManager } from "../../src/harness/mcp/manager.ts";
import { createMcpTools } from "../../src/harness/mcp/tools.ts";

function routedTool(meta: unknown): McpRoutedTool {
	return {
		serverId: "demo",
		tool: { name: "read_sensor", inputSchema: { type: "object" }, _meta: meta } as McpRoutedTool["tool"],
	};
}

function managerWithTools(tools: McpRoutedTool[]): McpServerManager {
	// Building the bridge only reads manager.tools(); callTool is not exercised here.
	return { tools: () => tools } as unknown as McpServerManager;
}

describe("createMcpTools terminalDetails", () => {
	it("carries the UI descriptor for synthesized error results", () => {
		const { tools } = createMcpTools(managerWithTools([routedTool({ ui: { resourceUri: "ui://demo/panel" } })]));
		expect(tools[0]?.terminalDetails).toEqual({
			mcpUi: { resourceUri: "ui://demo/panel", serverId: "demo" },
		});
	});

	it("stays absent for tools without UI metadata", () => {
		const { tools } = createMcpTools(managerWithTools([routedTool(undefined)]));
		expect(tools[0]?.terminalDetails).toBeUndefined();
	});
});
