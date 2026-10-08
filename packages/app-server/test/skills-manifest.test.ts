/**
 * skills-manifest：目录扫描 → SkillManifestEntry/Skill 投影。
 * - SKILL.md 子目录 + 根级带 frontmatter 的 .md 均识别；
 * - title/meta/version/tools 透传，directory 取文件所在目录；
 * - ignore 规则（.gitignore）生效；跨目录同名去重（先扫到的优先）；
 * - resolveSkillDirs：默认 global(~/.pi/agent/skills) + project(<cwd>/.pi/skills)，
 *   config.skillsDirs 追加为 global。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppServerConfig } from "../src/config.ts";
import { resolveSkillDirs, scanSkills } from "../src/skills-manifest.ts";

let root = "";
let globalDir = "";
let projectDir = "";

function baseConfig(): AppServerConfig {
	return {
		agentPlanBaseUrl: "http://localhost",
		modelId: "test-model",
		wsPort: 0,
		httpPort: 0,
		dataDir: root,
	};
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "skills-manifest-"));
	globalDir = join(root, "global-skills");
	projectDir = join(root, "project-skills");
	await mkdir(join(globalDir, "alpha"), { recursive: true });
	await mkdir(join(globalDir, "ignored", "beta"), { recursive: true });
	await mkdir(join(projectDir, "alpha"), { recursive: true });
	await writeFile(
		join(globalDir, "alpha", "SKILL.md"),
		[
			"---",
			"name: alpha",
			"description: Alpha skill for tests",
			"title: Alpha",
			"meta: 测试类",
			"version: 0.1.0",
			"tools:",
			"  - read",
			"  - name: write",
			"    title: Write",
			"---",
			"Alpha body.",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(join(globalDir, ".gitignore"), "ignored/\n", "utf8");
	await writeFile(
		join(globalDir, "ignored", "beta", "SKILL.md"),
		"---\nname: beta\ndescription: Should be ignored\n---\nBeta body.\n",
		"utf8",
	);
	await writeFile(
		join(globalDir, "root-skill.md"),
		"---\nname: root-skill\ndescription: Root level skill\n---\nRoot body.\n",
		"utf8",
	);
	await writeFile(
		join(projectDir, "alpha", "SKILL.md"),
		"---\nname: alpha\ndescription: Project alpha (deduped)\n---\nProject alpha body.\n",
		"utf8",
	);
});

afterAll(async () => {
	if (root.length > 0) await rm(root, { recursive: true, force: true });
});

describe("scanSkills", () => {
	it("projects SKILL.md and root .md files with source tags and metadata passthrough", async () => {
		const result = await scanSkills([
			{ path: globalDir, source: "global" },
			{ path: projectDir, source: "project" },
		]);
		const alpha = result.entries.find((entry) => entry.name === "alpha");
		expect(alpha).toMatchObject({
			name: "alpha",
			description: "Alpha skill for tests",
			title: "Alpha",
			meta: "测试类",
			version: "0.1.0",
			directory: join(globalDir, "alpha"),
			filePath: join(globalDir, "alpha", "SKILL.md"),
			source: "global",
			disableModelInvocation: false,
		});
		expect(alpha?.tools).toEqual([{ name: "read" }, { name: "write", title: "Write" }]);
		const rootSkill = result.entries.find((entry) => entry.name === "root-skill");
		expect(rootSkill).toMatchObject({
			name: "root-skill",
			description: "Root level skill",
			directory: globalDir,
			source: "global",
		});
		// 跨目录同名去重：global alpha 先扫到，project alpha 不重复出现
		expect(result.entries.filter((entry) => entry.name === "alpha")).toHaveLength(1);
		// .gitignore 规则生效
		expect(result.entries.some((entry) => entry.name === "beta")).toBe(false);
		// 注入 harness 用的 skills 与 entries 一一对应，携带正文
		const alphaSkill = result.skills.find((skill) => skill.name === "alpha");
		expect(alphaSkill?.content).toContain("Alpha body.");
	});

	it("skips missing directories without diagnostics", async () => {
		const result = await scanSkills([{ path: join(root, "does-not-exist"), source: "global" }]);
		expect(result.entries).toEqual([]);
		expect(result.diagnostics).toEqual([]);
	});
});

describe("resolveSkillDirs", () => {
	it("defaults to user + project skill dirs and appends config dirs as global", () => {
		const dirs = resolveSkillDirs({ ...baseConfig(), skillsDirs: [join(root, "extra")] });
		expect(dirs).toEqual([
			{ path: join(homedir(), ".pi", "agent", "skills"), source: "global" },
			{ path: join(process.cwd(), ".pi", "skills"), source: "project" },
			{ path: join(root, "extra"), source: "global" },
		]);
	});
});
