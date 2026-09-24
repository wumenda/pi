/**
 * pi 侧 skill 加载解析：
 * pi 的 skill 调用不是 tool part，而是以 user message 文本进入 transcript
 * （`formatSkillInvocation` 生成 `<skill name="…" location="…">` 块，见
 * packages/agent/src/harness/skills.ts）。这里扫描 transcript 条目流，
 * 从 user message 条目的文本中提取 skill 读取实例（含 skill-meta 声明）。
 */

import { parseSkillDeclaration, type SkillDeclaration } from "../mcp/skill-declaration.ts";

/** skill 加载信息（对齐参考应用 SkillPartInfo 语义） */
export interface SkillPartInfo {
	name: string;
	/** skill 文件路径（pi 块的 location 字段） */
	directory: string;
	/** skill 实例标识：承载 skill 块的 user entry id（每次读取独立条目 → 独立实例） */
	instanceId: string;
	/** frontmatter 声明（title/tools；skill-meta 注释缺失时无此字段） */
	declaration?: SkillDeclaration;
}

/** 与 pi 侧 parseSkillBlock 同源的正则（packages/coding-agent/src/core/agent-session.ts） */
const SKILL_BLOCK_RE = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * 从 user message 文本解析 skill 块，返回 name + location（文件路径）。
 * 非 skill 块文本返回 null。
 */
export function parseSkillBlockText(text: string): { name: string; directory: string } | null {
	const match = SKILL_BLOCK_RE.exec(text);
	if (!match) return null;
	return { name: match[1] ?? "", directory: match[2] ?? "" };
}

/**
 * transcript 条目的最小结构视图（wire JSON 形状；pi 侧 Entry 以 type 判别的联合）。
 * 独立声明以避免与 state 层循环依赖。
 */
export interface SkillSourceEntry {
	readonly id: string;
	readonly type: string;
	/** MessageEntry：AgentMessage wire JSON */
	readonly message?: unknown;
}

/** 从 pi user message（wire JSON）提取纯文本内容 */
export function userMessageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const candidate = message as { role?: unknown; content?: unknown };
	if (candidate.role !== "user") return "";
	if (typeof candidate.content === "string") return candidate.content;
	if (Array.isArray(candidate.content)) {
		return candidate.content
			.filter(
				(part): part is { type: "text"; text: string } =>
					typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
			)
			.map((part) => part.text)
			.join("");
	}
	return "";
}

/** 识别单条 message 条目是否为 skill 读取（user message 文本块）；解析失败返回 null */
export function extractSkillRead(entry: SkillSourceEntry): SkillPartInfo | null {
	if (entry.type !== "message") return null;
	const text = userMessageText(entry.message);
	if (!text.startsWith("<skill ")) return null;
	const parsed = parseSkillBlockText(text);
	if (!parsed || parsed.name.length === 0) return null;
	if (entry.id.length === 0) return null;
	const declaration = parseSkillDeclaration(text);
	return {
		name: parsed.name,
		directory: parsed.directory,
		instanceId: entry.id,
		...(declaration !== undefined ? { declaration } : {}),
	};
}

/**
 * 就绪门控：skill 块已开始（`<skill ` 开头）但尚未完整到达（无 `</skill>` 收尾）。
 * 流式增量下，未完整块不应让后续 tool 调用误归上一个 skill 实例；全量重扫在
 * 块完整后自动纠正归属。
 */
export function isIncompleteSkillBlock(entry: SkillSourceEntry): boolean {
	if (entry.type !== "message") return false;
	const text = userMessageText(entry.message);
	if (!text.startsWith("<skill ")) return false;
	return parseSkillBlockText(text) === null;
}

/**
 * 按条目流顺序全量提取 skill 读取（按实例去重）。
 * 会话重放/恢复用：据此重建全部 skill 实例 Tab——pi 侧同名 Skill 每次调用
 * 生成独立 user entry（id 不同），按读取序全部返回。
 */
export function findAllSkillReads(entries: readonly SkillSourceEntry[]): SkillPartInfo[] {
	const seen = new Set<string>();
	const result: SkillPartInfo[] = [];
	for (const entry of entries) {
		const info = extractSkillRead(entry);
		if (info && !seen.has(info.instanceId)) {
			seen.add(info.instanceId);
			result.push(info);
		}
	}
	return result;
}
