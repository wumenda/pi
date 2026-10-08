/**
 * 技能清单扫描（host 级，启动时一次）：
 * - 目录约定与 pi coding-agent 对齐：~/.pi/agent/skills（global）+ <cwd>/.pi/skills（project），
 *   APP_SERVER_SKILLS_DIRS 可追加额外目录（path.delimiter 分隔，记 global）；
 * - 扫描复用 agent 包原生 loadSourcedSkills（SKILL.md + 根级带 frontmatter 的 .md、
 *   ignore 规则、诊断告警；目录缺失跳过）；
 * - 产物一份两用：注入 harness resources.skills（agent 可调用）+ HTTP /api/v1/skills 清单
 *   （web 技能库）。快照在启动时定格，改动技能文件需重启 app-server。
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	loadSourcedSkills,
	type Skill,
	type SkillDiagnostic,
	type SkillToolDeclaration,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import type { AppServerConfig } from "./config.ts";

/** /api/v1/skills 清单条目（不含 body；详情端点另行携带 SKILL.md 原文） */
export interface SkillManifestEntry {
	name: string;
	description: string;
	/** SKILL.md / 技能 .md 文件绝对路径 */
	filePath: string;
	/** skill 目录（文件所在目录，前端引用相对路径用） */
	directory: string;
	/** 目录来源：global = 用户级；project = 项目级 */
	source: "global" | "project";
	/** 声明后模型不可见，仅显式调用可用 */
	disableModelInvocation: boolean;
	/** 中文名（frontmatter title） */
	title?: string;
	/** 技能类型（frontmatter meta，缺省由前端归「通用能力」） */
	meta?: string;
	/** 版本（frontmatter version） */
	version?: string;
	tools: SkillToolDeclaration[];
}

export interface SkillScanResult {
	entries: SkillManifestEntry[];
	/** 注入 harness resources.skills 用（含 SKILL.md 原文内容） */
	skills: Skill[];
	diagnostics: SkillDiagnostic[];
}

/** /api/v1/skills/:name 详情条目：清单条目 + SKILL.md 原文 */
export interface SkillDetailEntry extends SkillManifestEntry {
	/** SKILL.md 原文（frontmatter 之后的正文） */
	body: string;
	/** 恒 false：清单来自磁盘扫描，元数据总是可得 */
	metadataUnavailable: boolean;
}

/** 默认扫描目录：用户级 ~/.pi/agent/skills + 项目级 <cwd>/.pi/skills（与 coding-agent 约定一致） */
export function resolveSkillDirs(config: AppServerConfig): Array<{ path: string; source: "global" | "project" }> {
	const dirs = [
		{ path: join(homedir(), ".pi", "agent", "skills"), source: "global" as const },
		{ path: join(process.cwd(), ".pi", "skills"), source: "project" as const },
	];
	for (const extra of config.skillsDirs ?? []) {
		dirs.push({ path: extra, source: "global" });
	}
	return dirs;
}

function toEntry(skill: Skill, source: "global" | "project"): SkillManifestEntry {
	return {
		name: skill.name,
		description: skill.description,
		filePath: skill.filePath,
		directory: dirname(skill.filePath),
		source,
		disableModelInvocation: skill.disableModelInvocation === true,
		...(skill.title !== undefined ? { title: skill.title } : {}),
		...(skill.meta !== undefined ? { meta: skill.meta } : {}),
		...(skill.version !== undefined ? { version: skill.version } : {}),
		tools: [...(skill.tools ?? [])],
	};
}

/** 扫描全部技能目录并投影为清单条目；按 name 去重（先扫到的优先，global 在前） */
export async function scanSkills(
	dirs: Array<{ path: string; source: "global" | "project" }>,
): Promise<SkillScanResult> {
	const env = new NodeExecutionEnv({ cwd: process.cwd() });
	const loaded = await loadSourcedSkills(env, dirs, undefined, BACKGROUND_CONTEXT);
	const entries: SkillManifestEntry[] = [];
	const skills: Skill[] = [];
	const seen = new Set<string>();
	for (const { skill, source } of loaded.skills) {
		if (seen.has(skill.name)) continue;
		seen.add(skill.name);
		entries.push(toEntry(skill, source));
		skills.push(skill);
	}
	return { entries, skills, diagnostics: loaded.diagnostics };
}
