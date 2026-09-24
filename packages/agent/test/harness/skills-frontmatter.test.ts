import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "../../src/harness/context.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { loadSkills } from "../../src/harness/skills.ts";
import { createTempDir } from "./session-test-utils.ts";

function writeSkill(env: NodeExecutionEnv, dirName: string, frontmatter: string, body = "do the thing") {
	return env.writeFile(
		`skills/${dirName}/SKILL.md`,
		`---\n${frontmatter}\n---\n\n# Test\n\n${body}\n`,
		BACKGROUND_CONTEXT,
	);
}

describe("SKILL.md frontmatter extension", () => {
	it("parses tools as strings and objects with titles", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		await writeSkill(
			env,
			"equipment",
			[
				"name: equipment",
				"title: 设备管理",
				"description: test",
				"tools:",
				"  - query_equipment",
				"  - name: query_alarm",
				"    title: 查询告警",
			].join("\n"),
		);

		const { skills, diagnostics } = await loadSkills(env, "skills", BACKGROUND_CONTEXT);

		expect(diagnostics).toEqual([]);
		expect(skills[0]?.title).toBe("设备管理");
		expect(skills[0]?.tools).toEqual([
			{ name: "query_equipment", title: undefined },
			{ name: "query_alarm", title: "查询告警" },
		]);
		expect(skills[0]?.filePath).toBe(join(root, "skills/equipment/SKILL.md"));
	});

	it("omits title and tools when absent from frontmatter", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		await writeSkill(env, "plain", "name: plain\ndescription: test");

		const { skills, diagnostics } = await loadSkills(env, "skills", BACKGROUND_CONTEXT);

		expect(diagnostics).toEqual([]);
		expect(skills[0]?.title).toBeUndefined();
		expect(skills[0]?.tools).toBeUndefined();
	});

	it("reports diagnostics for invalid tools entries", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		await writeSkill(env, "bad", ["name: bad", "description: test", "tools: 42"].join("\n"));

		const { diagnostics } = await loadSkills(env, "skills", BACKGROUND_CONTEXT);

		expect(diagnostics.length).toBeGreaterThan(0);
		expect(diagnostics[0]?.code).toBe("invalid_metadata");
	});

	it("drops invalid tool entries but keeps valid ones", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		await writeSkill(
			env,
			"mixed",
			[
				"name: mixed",
				"description: test",
				"tools:",
				"  - 42",
				"  - name: ok_tool",
				"  - name: 123",
				"    title: not-a-string-name",
			].join("\n"),
		);

		const { skills, diagnostics } = await loadSkills(env, "skills", BACKGROUND_CONTEXT);

		expect(diagnostics.length).toBe(2);
		expect(skills[0]?.tools).toEqual([{ name: "ok_tool", title: undefined }]);
	});
});
