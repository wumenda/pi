import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { createMcpHostService } from "../src/services/mcp-host.ts";

function fakeManager(overrides: Record<string, unknown> = {}) {
	return {
		callTool: async () => ({
			content: [{ type: "text", text: "ok" }],
			isError: false,
		}),
		readResource: async () => ({
			contents: [{ uri: "ui://x", mimeType: "text/html", text: "<html>app</html>" }],
		}),
		statuses: () => [{ id: "example", state: "ready", error: null, toolCount: 2 }],
		...overrides,
	};
}

describe("createMcpHostService", () => {
	it("callTool maps content and error flag", async () => {
		const service = createMcpHostService(fakeManager() as never);
		const result = await service.callTool({ serverId: "example", name: "t", args: {} }, BACKGROUND_CONTEXT);
		expect(result.isError).toBe(false);
		expect(result.content[0]).toEqual({ type: "text", text: "ok" });
	});
	it("getUiResource returns html and mimeType", async () => {
		const service = createMcpHostService(fakeManager() as never);
		const resource = await service.getUiResource(
			{ serverId: "example", resourceUri: "ui://x" },
			BACKGROUND_CONTEXT,
		);
		expect(resource.mimeType).toBe("text/html");
		expect(resource.html).toContain("app");
	});
	it("statuses maps tool counts", async () => {
		const service = createMcpHostService(fakeManager() as never);
		const statuses = await service.statuses(BACKGROUND_CONTEXT);
		expect(statuses).toEqual([{ id: "example", state: "ready", error: null, toolCount: 2 }]);
	});
});
