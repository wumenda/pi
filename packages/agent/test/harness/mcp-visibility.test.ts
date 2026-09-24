import { describe, expect, it } from "vitest";
import type { McpRoutedTool } from "../../src/harness/mcp/manager.ts";
import { isVisibleToLlm } from "../../src/harness/mcp/tools.ts";

function routed(meta: unknown): McpRoutedTool {
	return { serverId: "example", tool: { name: "submit_review", _meta: meta } as McpRoutedTool["tool"] };
}

describe("isVisibleToLlm", () => {
	it("hides tools declaring app-only visibility", () => {
		expect(isVisibleToLlm(routed({ ui: { visibility: ["app"] } }))).toBe(false);
		expect(isVisibleToLlm(routed({ ui: { visibility: ["model", "app"] } }))).toBe(true);
	});
	it("shows tools without UI metadata or visibility declarations", () => {
		expect(isVisibleToLlm(routed(undefined))).toBe(true);
		expect(isVisibleToLlm(routed({ ui: { resourceUri: "ui://x/index.html" } }))).toBe(true);
		expect(isVisibleToLlm(routed({ ui: { visibility: ["model"] } }))).toBe(true);
		expect(isVisibleToLlm(routed({ other: true }))).toBe(true);
	});
});
