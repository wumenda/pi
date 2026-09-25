import { beforeEach, describe, expect, it } from "vitest";
import type { PiTranscriptEntry } from "../src/api/transcript";
import { knownSkills, projectTranscript, resetSkillRegistry } from "../src/api/transcript";

/** 构造 pi transcript 条目（wire JSON 最小形状） */
function entry(id: string, message: unknown): PiTranscriptEntry {
	return { id, type: "message", message };
}

describe("projectTranscript", () => {
	beforeEach(() => {
		resetSkillRegistry();
	});

	it("投影 user/assistant 消息并合并 toolResult 进 tool part", () => {
		const snapshot = {
			transcript: [
				entry("e1", {
					role: "user",
					content: [{ type: "text", text: "帮我检查设备" }],
					timestamp: 1000,
				}),
				entry("e2", {
					role: "assistant",
					content: [
						{ type: "text", text: "好的" },
						{ type: "toolCall", id: "call-1", name: "mcp__demo__read_sensor", arguments: { id: 1 } },
					],
					timestamp: 2000,
				}),
				entry("e3", {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "read_sensor",
					isError: false,
					content: [{ type: "text", text: '{"temp":42}' }],
					details: {
						mcpUi: { resourceUri: "ui://demo/panel", permissions: ["clipboard-write"] },
					},
					timestamp: 3000,
				}),
			],
			operation: null,
		};
		const { messages, running } = projectTranscript(snapshot);
		expect(running).toBe(false);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({ id: "e1", role: "user" });
		const assistant = messages[1]!;
		expect(assistant.role).toBe("assistant");
		expect(assistant.parts).toHaveLength(2);
		const toolPart = assistant.parts[1] as {
			type: string;
			tool: string;
			id: string;
			state: { status: string; input: Record<string, unknown>; output?: string; metadata: Record<string, unknown> };
		};
		expect(toolPart.type).toBe("tool");
		expect(toolPart.tool).toBe("mcp__demo__read_sensor");
		expect(toolPart.state.status).toBe("completed");
		expect(toolPart.state.input).toEqual({ id: 1 });
		expect(toolPart.state.output).toBe('{"temp":42}');
		expect((toolPart.state.metadata._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe("ui://demo/panel");
	});

	it("无结果的 ask_user 调用进入 pendingAskUser 且状态为 running", () => {
		const snapshot = {
			transcript: [
				entry("e1", {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "ask-1", name: "ask_user_question", arguments: { title: "确认", pages: [] } },
					],
					timestamp: 1000,
				}),
			],
			operation: { id: "op-1" },
		};
		const { messages, running, pendingAskUser } = projectTranscript(snapshot);
		expect(running).toBe(true);
		expect(pendingAskUser).toEqual([{ toolCallId: "ask-1", input: { title: "确认", pages: [] }, messageID: "e1" }]);
		const toolPart = (messages[0]!.parts[0] ?? null) as { state: { status: string } };
		expect(toolPart.state.status).toBe("running");
	});

	it("skill 块合成 assistant skill tool part 并登记注册表（title/tools 来自 skill-meta）", () => {
		const skillText =
			'<skill name="pfd-review" location="/data/skills/pfd-review/SKILL.md">\nReferences are relative to /data/skills/pfd-review.\n<!-- skill-meta {"title":"PFD 审查","tools":[{"name":"review_pfd","title":"审查图纸"}]} -->\n\n# 步骤\n读取图纸。\n</skill>\n\n请审查 T201 塔的 PFD。';
		const snapshot = {
			transcript: [
				entry("e1", {
					role: "user",
					content: [{ type: "text", text: skillText }],
					timestamp: 1000,
				}),
			],
			operation: null,
		};
		const { messages } = projectTranscript(snapshot);
		// skill 合成 assistant + 尾随指令 user 消息
		expect(messages).toHaveLength(2);
		const skillPart = (messages[0]!.parts[0] ?? null) as {
			type: string;
			tool: string;
			id: string;
			state: { status: string; input: Record<string, unknown>; output?: string };
		};
		expect(skillPart.tool).toBe("skill");
		expect(skillPart.id).toBe("e1");
		expect(skillPart.state.status).toBe("completed");
		expect(skillPart.state.input).toEqual({ name: "pfd-review" });
		expect(skillPart.state.output).toContain("Base directory for this skill: /data/skills/pfd-review");
		expect(messages[1]).toMatchObject({ role: "user" });
		// 注册表（fetchSkills 数据源）
		const skills = knownSkills();
		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: "pfd-review",
			title: "PFD 审查",
			directory: "/data/skills/pfd-review",
			metadataUnavailable: false,
		});
		expect(skills[0]!.tools).toEqual([{ name: "review_pfd", title: "审查图纸" }]);
	});

	it("空 operation 的 thinking part 投影为 reasoning", () => {
		const snapshot = {
			transcript: [
				entry("e2", {
					role: "assistant",
					content: [{ type: "thinking", thinking: "推理过程" }],
					timestamp: 1000,
				}),
			],
		};
		const { messages } = projectTranscript(snapshot);
		const part = (messages[0]!.parts[0] ?? null) as { type: string; text?: string };
		expect(part.type).toBe("reasoning");
		expect(part.text).toBe("推理过程");
	});

	it("中止/错误终态 toolResult 携带 mcpUi 时投影进 part metadata（含 serverId）", () => {
		const snapshot = {
			transcript: [
				entry("e1", {
					role: "assistant",
					content: [{ type: "toolCall", id: "call-1", name: "mcp__demo__query_status", arguments: { id: 7 } }],
					timestamp: 1000,
				}),
				entry("e2", {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "query_status",
					isError: true,
					content: [{ type: "text", text: "Tool execution was cancelled before completion." }],
					// agent 核心 terminalDetails：中止/失败终态保留 UI 描述符
					details: { mcpUi: { resourceUri: "ui://demo/panel", serverId: "demo", permissions: [] } },
					timestamp: 2000,
				}),
			],
			operation: null,
		};
		const { messages } = projectTranscript(snapshot);
		const assistant = messages[0]!;
		expect(assistant.role).toBe("assistant");
		const toolPart = (assistant.parts[0] ?? null) as {
			type: string;
			state: { status: string; metadata: Record<string, unknown> };
		};
		expect(toolPart.type).toBe("tool");
		expect(toolPart.state.status).toBe("error");
		const ui = (toolPart.state.metadata._meta as { ui: { resourceUri: string; serverId: string } }).ui;
		expect(ui.resourceUri).toBe("ui://demo/panel");
		expect(ui.serverId).toBe("demo");
	});
});
