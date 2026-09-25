/**
 * SKILL.md YAML frontmatter 解析（布局文档 3.2.1 / iframe-rendering.md 4.4）。
 * 只覆盖 Agent Skills frontmatter 所需的 YAML 子集：
 * 标量键值（name/title/description/version）+ 字符串或 { name, title? } 对象的
 * tools[] 列表，不引入 YAML 依赖。
 */
import type { ToolMeta } from "../types";

export interface Frontmatter {
	name: string;
	/** 中文名（展示用，可选；iframe-rendering.md 4.4） */
	title?: string;
	description?: string;
	version?: string;
	tools: ToolMeta[];
}

/** 解析文档顶部的 frontmatter；无 frontmatter 或缺少 name 时返回 null（降级判定） */
export function parseFrontmatter(markdown: string): Frontmatter | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
	const body = match?.[1];
	if (body === undefined) return null;

	let name: string | undefined;
	let title: string | undefined;
	let description: string | undefined;
	let version: string | undefined;
	const tools: ToolMeta[] = [];
	let inTools = false;
	// 正在解析的 { name, title? } 对象声明（name 先到、title 后到）
	let pendingTool: { name: string; title?: string } | null = null;

	const flushPendingTool = () => {
		if (pendingTool !== null) {
			tools.push(pendingTool);
			pendingTool = null;
		}
	};

	for (const rawLine of body.split(/\r?\n/)) {
		if (rawLine.trim().length === 0) continue;

		const listItem = /^ {2}- (.+)$/.exec(rawLine);
		const item = listItem?.[1];
		if (item !== undefined && inTools) {
			// 列表项：字符串工具名，或 { name: ..., title: ... } 对象的第一行
			const first = item.trim();
			if (/^name\s*:/.test(first)) {
				// 对象形式：记 name（title 由后续缩进行补进）
				flushPendingTool();
				const nameMatch = /^name\s*:\s*(.+)$/.exec(first);
				if (nameMatch) {
					pendingTool = { name: stripQuotes(nameMatch[1]!.trim()) };
				} else {
					// 空 name 的孤立对象行按字符串处理
					pendingTool = null;
					tools.push(stripQuotes(first));
				}
			} else {
				flushPendingTool();
				tools.push(stripQuotes(first));
			}
			continue;
		}

		// 对象声明内的 "title: ..." 行（紧跟列表项，缩进 4 空格）
		const toolTitleMatch = /^ {4}title\s*:\s*(.+)$/.exec(rawLine);
		if (toolTitleMatch && pendingTool !== null) {
			pendingTool.title = stripQuotes(toolTitleMatch[1]!.trim());
			continue;
		}

		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(rawLine.trim());
		const key = kv?.[1];
		if (key === undefined) {
			flushPendingTool();
			continue;
		}
		const value = stripQuotes((kv?.[2] ?? "").trim());
		if (value.length > 0) flushPendingTool();
		inTools = false;

		if (value.length === 0) {
			// 空值视为列表键声明行（如 "tools:"）
			if (key === "tools") inTools = true;
			continue;
		}
		if (key === "name" && name === undefined) {
			name = value;
		} else if (key === "title" && title === undefined) {
			title = value;
		} else if (key === "description" && description === undefined) {
			description = value;
		} else if (key === "version" && version === undefined) {
			version = value;
		}
	}
	flushPendingTool();

	return name !== undefined ? { name, title, description, version, tools } : null;
}

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}
