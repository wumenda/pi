import { describe, expect, it } from "vitest";
import { formatPromptTemplateInvocation } from "../../src/harness/prompt-templates.ts";
import { formatSkillInvocation } from "../../src/harness/skills.ts";

describe("resource formatting helpers", () => {
	it("formats skill invocations with additional instructions", () => {
		const skill = {
			name: "inspect",
			description: "Inspect things",
			content: "Use inspection tools.",
			filePath: "/project/.pi/skills/inspect/SKILL.md",
		};

		expect(formatSkillInvocation(skill, "Check errors.")).toBe(
			'<skill name="inspect" location="/project/.pi/skills/inspect/SKILL.md">\nReferences are relative to /project/.pi/skills/inspect.\n\nUse inspection tools.\n</skill>\n\nCheck errors.',
		);
	});

	it("embeds title and tool declarations as a skill-meta comment", () => {
		const skill = {
			name: "equipment",
			description: "Manage equipment",
			content: "Use the tools.",
			filePath: "/project/.pi/skills/equipment/SKILL.md",
			title: "设备管理",
			tools: [{ name: "query_equipment" }, { name: "query_alarm", title: "查询告警" }],
		};

		expect(formatSkillInvocation(skill)).toBe(
			'<skill name="equipment" location="/project/.pi/skills/equipment/SKILL.md">\n' +
				"References are relative to /project/.pi/skills/equipment.\n" +
				'<!-- skill-meta {"title":"设备管理","tools":[{"name":"query_equipment"},{"name":"query_alarm","title":"查询告警"}]} -->\n' +
				"\nUse the tools.\n</skill>",
		);
	});

	it("omits the skill-meta comment when no title or tools are declared", () => {
		const skill = {
			name: "plain",
			description: "Plain skill",
			content: "Do things.",
			filePath: "/project/.pi/skills/plain/SKILL.md",
		};

		expect(formatSkillInvocation(skill)).toBe(
			'<skill name="plain" location="/project/.pi/skills/plain/SKILL.md">\nReferences are relative to /project/.pi/skills/plain.\n\nDo things.\n</skill>',
		);
	});

	it("formats prompt template invocations with positional arguments", () => {
		expect(
			formatPromptTemplateInvocation({ name: "review", content: "Review $1 with $ARGUMENTS" }, ["a.ts", "care"]),
		).toBe("Review a.ts with a.ts care");
	});
});
