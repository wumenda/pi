import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getCachedMcpTools,
	type McpToolManifestEntry,
	requestMcpToolManifest,
	resolveServerId,
	setCachedMcpTools,
	subscribeMcpTools,
} from "../src/api/mcp-tools.ts";
import { namespacedMcpToolName } from "../src/features/mcp/naming.ts";
import { scanTranscript, type TranscriptEntryView } from "../src/features/mcp/scan.ts";

const manifest: McpToolManifestEntry[] = [
	{ serverId: "example", name: "simple_tool", resourceUri: "ui://mcp-app-ui/simple/index.html" },
	{
		serverId: "my server",
		name: "review_tool",
		resourceUri: "ui://mcp-app-ui/review/index.html",
		visibility: ["app"],
	},
];

describe("namespacedMcpToolName", () => {
	it("sanitizes the serverId segment like the agent core", () => {
		expect(namespacedMcpToolName("example", "simple_tool")).toBe("mcp__example__simple_tool");
		expect(namespacedMcpToolName("my server", "review_tool")).toBe("mcp__my_server__review_tool");
	});
});

describe("resolveServerId", () => {
	it("matches the raw tool name exactly", () => {
		expect(resolveServerId(manifest, "simple_tool")).toBe("example");
	});
	it("matches the sanitized namespaced harness name", () => {
		expect(resolveServerId(manifest, "mcp__example__simple_tool")).toBe("example");
		expect(resolveServerId(manifest, "mcp__my_server__review_tool")).toBe("my server");
	});
	it("returns null for unknown tools and server mismatches", () => {
		expect(resolveServerId(manifest, "mcp__example__other")).toBeNull();
		expect(resolveServerId(manifest, "mcp__my_server__simple_tool")).toBeNull();
	});
});

/** 构造 transcript 条目视图（wire JSON 形状子集） */
function entry(id: string, partial: object): TranscriptEntryView {
	return { id, type: "message", message: partial } as TranscriptEntryView;
}

function toolCallEntry(id: string, toolCallId: string, harnessName: string): TranscriptEntryView {
	return entry(id, {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: harnessName, arguments: {} }],
	});
}

function toolResultEntry(id: string, toolCallId: string, mcpUi: object): TranscriptEntryView {
	return entry(id, {
		role: "toolResult",
		toolCallId,
		isError: false,
		content: [{ type: "text", text: "{}" }],
		details: { mcpUi },
	});
}

describe("scanTranscript manifest self-healing", () => {
	afterEach(() => setCachedMcpTools(null));

	it("holds unresolved calls and reports pending tool names", () => {
		const entries = [
			toolCallEntry("a1", "call-1", "mcp__example__simple_tool"),
			toolResultEntry("r1", "call-1", { resourceUri: "ui://mcp-app-ui/simple/index.html" }),
		];
		const { calls, pendingToolNames } = scanTranscript(entries);
		expect(calls).toEqual([]);
		expect(pendingToolNames).toEqual(["mcp__example__simple_tool"]);
	});

	it("resolves serverId from the cached manifest", () => {
		setCachedMcpTools(manifest);
		const entries = [
			toolCallEntry("a1", "call-1", "mcp__my_server__review_tool"),
			toolResultEntry("r1", "call-1", { resourceUri: "ui://mcp-app-ui/review/index.html" }),
		];
		const { calls, pendingToolNames } = scanTranscript(entries);
		expect(pendingToolNames).toEqual([]);
		expect(calls[0]?.serverId).toBe("my server");
		expect(calls[0]?.toolName).toBe("review_tool");
	});

	it("does not report pending when the descriptor carries serverId", () => {
		const entries = [
			toolCallEntry("a1", "call-1", "mcp__example__simple_tool"),
			toolResultEntry("r1", "call-1", {
				resourceUri: "ui://mcp-app-ui/simple/index.html",
				serverId: "example",
			}),
		];
		const { calls, pendingToolNames } = scanTranscript(entries);
		expect(pendingToolNames).toEqual([]);
		expect(calls[0]?.serverId).toBe("example");
	});
});

describe("requestMcpToolManifest", () => {
	afterEach(() => {
		setCachedMcpTools(null);
		vi.unstubAllGlobals();
	});

	it("fetches once for concurrent requests of the same tool and notifies on change", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		let notified = 0;
		const unsubscribe = subscribeMcpTools(() => {
			notified += 1;
		});
		const [first, second] = await Promise.all([
			requestMcpToolManifest("http://x", "mcp__example__simple_tool"),
			requestMcpToolManifest("http://x", "mcp__example__simple_tool"),
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("http://x/api/v1/mcp-tools");
		expect(first).toBe(true);
		expect(second).toBe(true);
		expect(notified).toBe(1);
		expect(getCachedMcpTools()).toEqual(manifest);
		unsubscribe();
	});

	it("does not notify when the manifest is unchanged", async () => {
		setCachedMcpTools(manifest);
		let notified = 0;
		const unsubscribe = subscribeMcpTools(() => {
			notified += 1;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })),
		);
		const changed = await requestMcpToolManifest("http://x", "mcp__example__simple_tool");
		expect(changed).toBe(false);
		expect(notified).toBe(0);
		unsubscribe();
	});

	it("swallows fetch failures and keeps the cache empty", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("boom", { status: 500 })),
		);
		const changed = await requestMcpToolManifest("http://x", "t1");
		expect(changed).toBe(false);
		expect(getCachedMcpTools()).toBeNull();
	});
});
