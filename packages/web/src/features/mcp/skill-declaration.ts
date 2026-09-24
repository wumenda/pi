/**
 * SKILL.md frontmatter 声明的 transcript 通道解析（Task 15）：
 * pi 侧 `formatSkillInvocation` 把宿主声明（title/tools）以
 * `<!-- skill-meta {...} -->` 注释行嵌入 skill 块（开标签格式不变，
 * 既有解析正则零影响）。本模块从块文本恢复声明，供归属判定与展示名使用。
 */

import { rawMcpToolName } from "./naming.ts";

/** SKILL.md frontmatter tools[] 条目（web 侧镜像 agent 的 SkillToolDeclaration） */
export interface SkillToolDeclaration {
	name: string;
	title?: string;
}

/** skill 块中恢复的 frontmatter 声明 */
export interface SkillDeclaration {
	title?: string;
	tools?: readonly SkillToolDeclaration[];
}

const SKILL_META_RE = /<!--\s*skill-meta\s+([\s\S]*?)\s*-->/;

/**
 * 从 `<skill name="..." location="...">...</skill>` 消息文本解析声明。
 * 无注释 / JSON 损坏 / 形状不符一律返回 undefined（不抛）。
 */
export function parseSkillDeclaration(blockText: string): SkillDeclaration | undefined {
	const match = SKILL_META_RE.exec(blockText);
	if (!match) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(match[1] ?? "");
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
	const record = parsed as { title?: unknown; tools?: unknown };
	const declaration: SkillDeclaration = {};
	if (typeof record.title === "string" && record.title.trim() !== "") {
		declaration.title = record.title;
	}
	if (Array.isArray(record.tools)) {
		const tools: SkillToolDeclaration[] = [];
		for (const entry of record.tools) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
			const item = entry as { name?: unknown; title?: unknown };
			if (typeof item.name !== "string" || item.name.trim() === "") continue;
			const tool: SkillToolDeclaration = { name: item.name };
			if (typeof item.title === "string" && item.title.trim() !== "") tool.title = item.title;
			tools.push(tool);
		}
		if (tools.length > 0) declaration.tools = tools;
	}
	return Object.keys(declaration).length > 0 ? declaration : undefined;
}

/**
 * 归一化比对：声明名与裸 MCP 工具名（`mcp__<serverId>__<name>` 还原后）
 * 或完整 harness 名全等即命中。命中条目（含展示名）用 {@link findMatchingDeclaration}。
 */
export function toolMatchesDeclaration(
	harnessName: string,
	serverId: string,
	declarations: readonly SkillToolDeclaration[],
): boolean {
	return findMatchingDeclaration(harnessName, serverId, declarations) !== undefined;
}

/** 返回命中的声明条目（展示名从这里取）；未命中 undefined。 */
export function findMatchingDeclaration(
	harnessName: string,
	serverId: string,
	declarations: readonly SkillToolDeclaration[],
): SkillToolDeclaration | undefined {
	const raw = rawMcpToolName(harnessName, serverId);
	return declarations.find((declaration) => declaration.name === raw || declaration.name === harnessName);
}
