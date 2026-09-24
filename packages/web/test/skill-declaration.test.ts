import { describe, expect, it } from "vitest";
import { scanTranscript, type TranscriptEntryView } from "../src/features/mcp/scan.ts";
import { parseSkillDeclaration, toolMatchesDeclaration } from "../src/features/mcp/skill-declaration.ts";

const blockWithMeta = [
	'<skill name="equipment" location="/skills/equipment/SKILL.md">',
	"References are relative to /skills/equipment.",
	'<!-- skill-meta {"title":"设备管理","tools":[{"name":"query_equipment"},{"name":"query_alarm","title":"查询告警"}]} -->',
	"",
	"Use the tools.",
	"</skill>",
].join("\n");

const plainBlock = [
	'<skill name="plain" location="/skills/plain/SKILL.md">',
	"References are relative to /skills/plain.",
	"",
	"Do things.",
	"</skill>",
].join("\n");

describe("parseSkillDeclaration", () => {
	it("parses title and tools from the skill-meta comment", () => {
		expect(parseSkillDeclaration(blockWithMeta)).toEqual({
			title: "设备管理",
			tools: [{ name: "query_equipment" }, { name: "query_alarm", title: "查询告警" }],
		});
	});
	it("returns undefined for blocks without a declaration", () => {
		expect(parseSkillDeclaration(plainBlock)).toBeUndefined();
	});
	it("returns undefined for malformed meta without throwing", () => {
		const broken = blockWithMeta.replace('{"title":"设备管理"', '{"title":"设备管理",,"broken"');
		expect(parseSkillDeclaration(broken)).toBeUndefined();
		const badShape = blockWithMeta.replace(
			'{"title":"设备管理","tools":[{"name":"query_equipment"},{"name":"query_alarm","title":"查询告警"}]}',
			'{"tools":"all"}',
		);
		expect(parseSkillDeclaration(badShape)).toBeUndefined();
	});
});

describe("toolMatchesDeclaration", () => {
	const declarations = [{ name: "query_equipment" }, { name: "query_alarm", title: "查询告警" }];
	it("matches raw MCP tool names against declarations", () => {
		expect(toolMatchesDeclaration("mcp__example__query_alarm", "example", declarations)).toBe(true);
		expect(toolMatchesDeclaration("mcp__example__query_equipment", "example", declarations)).toBe(true);
	});
	it("accepts declarations written as full harness names", () => {
		expect(
			toolMatchesDeclaration("mcp__example__query_alarm", "example", [{ name: "mcp__example__query_alarm" }]),
		).toBe(true);
	});
	it("rejects undeclared tools", () => {
		expect(toolMatchesDeclaration("mcp__example__other_tool", "example", declarations)).toBe(false);
	});
});

/** 构造 transcript 条目视图（wire JSON 形状子集） */
function entry(id: string, partial: object): TranscriptEntryView {
	return { id, type: "message", message: partial } as TranscriptEntryView;
}

function skillEntry(id: string, block: string): TranscriptEntryView {
	return entry(id, { role: "user", content: [{ type: "text", text: block }] });
}

function toolCallEntry(id: string, toolCallId: string, harnessName: string): TranscriptEntryView {
	return entry(id, {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: harnessName, arguments: {} }],
	});
}

function toolResultEntry(id: string, toolCallId: string, output: string): TranscriptEntryView {
	return entry(id, {
		role: "toolResult",
		toolCallId,
		isError: false,
		content: [{ type: "text", text: output }],
		details: {
			mcpUi: { resourceUri: "ui://mcp-app-ui/simple/index.html", serverId: "example" },
		},
	});
}

describe("scanTranscript declaration ownership", () => {
	it("keeps skill ownership for declared tools and attaches the declared title", () => {
		const entries = [
			skillEntry("s1", blockWithMeta),
			toolCallEntry("a1", "call-1", "mcp__example__query_alarm"),
			toolResultEntry("r1", "call-1", "{}"),
		];
		const { skillInstances, calls } = scanTranscript(entries);
		expect(skillInstances[0]?.declaration?.title).toBe("设备管理");
		expect(calls[0]?.groupContext).toEqual({ name: "equipment", instanceId: "s1" });
		expect(calls[0]?.toolTitle).toBe("查询告警");
	});

	it("detaches ownership when the tool is not in the declaration", () => {
		const entries = [
			skillEntry("s1", blockWithMeta),
			toolCallEntry("a1", "call-1", "mcp__example__other_tool"),
			toolResultEntry("r1", "call-1", "{}"),
		];
		const { calls } = scanTranscript(entries);
		expect(calls[0]?.groupContext).toBeNull();
		expect(calls[0]?.toolTitle).toBeUndefined();
	});

	it("keeps sequential ownership for skills without tool declarations", () => {
		const entries = [
			skillEntry("s1", plainBlock),
			toolCallEntry("a1", "call-1", "mcp__example__anything"),
			toolResultEntry("r1", "call-1", "{}"),
		];
		const { calls } = scanTranscript(entries);
		expect(calls[0]?.groupContext).toEqual({ name: "plain", instanceId: "s1" });
	});

	it("gates ownership while a skill block is streaming incomplete", () => {
		const incomplete = blockWithMeta.slice(0, blockWithMeta.indexOf("</skill>"));
		const entries = [
			skillEntry("s1", plainBlock),
			toolCallEntry("a1", "call-1", "mcp__example__query_alarm"),
			toolResultEntry("r1", "call-1", "{}"),
			skillEntry("s2", incomplete),
			toolCallEntry("a2", "call-2", "mcp__example__query_alarm"),
			toolResultEntry("r2", "call-2", "{}"),
		];
		const { calls } = scanTranscript(entries);
		// call-1 归 plain（s1）；call-2 到达时 s2 未完整 → 不延续任何实例
		expect(calls[0]?.groupContext).toEqual({ name: "plain", instanceId: "s1" });
		expect(calls[1]?.groupContext).toBeNull();
	});
});
