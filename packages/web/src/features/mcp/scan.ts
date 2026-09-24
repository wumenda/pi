/**
 * pi transcript 条目流 → MCP Apps tool 调用 / skill 实例扫描。
 *
 * pi 核心原生桥接 MCP server（agent harness createMcpTools）：带 UI 的 tool
 * （_meta.ui 声明 ui:// resourceUri，SEP-1865）在 tool-result 的 details.mcpUi
 * 持久化 UI 描述符。本扫描按 toolCallId 关联 assistant toolCall 与 toolResult
 * details.mcpUi，产出渲染管线所需的 ToolUiCall（终态：completed/error）。
 * 归属判定沿用参考应用的"上下文时序"：tool 调用归属其前最近一次 skill 读取实例。
 */

import {
	extractSkillRead,
	isIncompleteSkillBlock,
	type SkillPartInfo,
	type SkillSourceEntry,
} from "../skills/skill-parse.ts";
import { rawMcpToolName } from "./naming.ts";
import type { ToolUiCall, ToolUiStatus } from "./pipeline.ts";
import { findMatchingDeclaration } from "./skill-declaration.ts";
import type { SkillReadContext } from "./types.ts";

export type TranscriptEntryView = SkillSourceEntry;

export { rawMcpToolName };

/** skill 实例键 `<name>#<instanceId>`（分组复合键前缀，与 pipeline.resolveIframeGroup 一致） */
export function skillGroupKey(info: SkillPartInfo): string {
	return `${info.name}#${info.instanceId}`;
}

/** 从消息 wire JSON 提取 text content 拼接文本（tool 输出用） */
function messageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
				? String((part as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
}

/** agent 核心 McpToolDetails.mcpUi 的 UI 描述符形状（web 侧镜像） */
interface McpUiDescriptor {
	resourceUri: string;
	serverId: string;
	permissions?: string[];
}

/** 从 toolResult message 的 details 提取 MCP Apps UI 描述符（无则 null） */
function parseMcpUiDetails(message: unknown): McpUiDescriptor | null {
	if (typeof message !== "object" || message === null) return null;
	const details = (message as { details?: unknown }).details;
	if (typeof details !== "object" || details === null) return null;
	const mcpUi = (details as { mcpUi?: unknown }).mcpUi;
	if (typeof mcpUi !== "object" || mcpUi === null) return null;
	const resourceUri = (mcpUi as { resourceUri?: unknown }).resourceUri;
	const serverId = (mcpUi as { serverId?: unknown }).serverId;
	if (typeof resourceUri !== "string" || !resourceUri.startsWith("ui://")) return null;
	if (typeof serverId !== "string" || serverId.length === 0) return null;
	const descriptor: McpUiDescriptor = { resourceUri, serverId };
	const declared = (mcpUi as { permissions?: unknown }).permissions;
	if (Array.isArray(declared)) {
		const list = declared.filter((p): p is string => typeof p === "string");
		if (list.length > 0) descriptor.permissions = list;
	}
	return descriptor;
}

/** assistant toolCall part 中原生 MCP 桥接工具的挂起信息（结果到达前累积） */
interface OpenMcpCall {
	harnessName: string;
	input: Record<string, unknown>;
	groupContext: SkillReadContext | null;
}

export interface TranscriptScanResult {
	/** 条目流中全部 skill 读取实例（按出现顺序） */
	skillInstances: SkillPartInfo[];
	/** 带 UI 的 tool 调用（流序；details.mcpUi 随终态结果持久化，故条目均为终态） */
	calls: ToolUiCall[];
}

/**
 * 全量扫描 transcript 条目流：
 * - user message 条目 → skill 读取实例（extractSkillRead）；
 * - assistant message 的 `mcp__` 前缀 toolCall part → 记录挂起调用（input/groupContext）；
 * - toolResult message 的 details.mcpUi → 按 toolCallId 匹配，产出 completed/error 调用。
 * 归属：调用携带其 assistant 条目前最近一次 skill 读取（groupContext）。
 */
export function scanTranscript(entries: readonly TranscriptEntryView[]): TranscriptScanResult {
	const skillInstances: SkillPartInfo[] = [];
	const seenInstances = new Set<string>();
	const calls: ToolUiCall[] = [];
	// toolCallId → 挂起调用信息（结果条目回查产出 ToolUiCall）
	const openCalls = new Map<string, OpenMcpCall>();
	let lastSkill: SkillPartInfo | null = null;

	for (const entry of entries) {
		const skill = extractSkillRead(entry);
		if (skill !== null) {
			if (!seenInstances.has(skill.instanceId)) {
				seenInstances.add(skill.instanceId);
				skillInstances.push(skill);
			}
			lastSkill = skill;
			continue;
		}
		// 就绪门控：skill 块流式未完整 → 阻断上一实例延续，防误归（完整后全量重扫自动纠正）
		if (isIncompleteSkillBlock(entry)) {
			lastSkill = null;
			continue;
		}

		if (entry.type !== "message") continue;
		const message = entry.message;
		if (typeof message !== "object" || message === null) continue;
		const role = (message as { role?: unknown }).role;

		if (role === "assistant") {
			const content = (message as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			const groupContext: SkillReadContext | null =
				lastSkill === null ? null : { name: lastSkill.name, instanceId: lastSkill.instanceId };
			for (const part of content) {
				if (typeof part !== "object" || part === null) continue;
				const candidate = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
				if (candidate.type !== "toolCall") continue;
				const name = typeof candidate.name === "string" ? candidate.name : "";
				const toolCallId = typeof candidate.id === "string" ? candidate.id : "";
				if (!name.startsWith("mcp__") || toolCallId.length === 0) continue;
				const input =
					typeof candidate.arguments === "object" &&
					candidate.arguments !== null &&
					!Array.isArray(candidate.arguments)
						? (candidate.arguments as Record<string, unknown>)
						: {};
				openCalls.set(toolCallId, { harnessName: name, input, groupContext });
			}
			continue;
		}

		if (role === "toolResult") {
			const descriptor = parseMcpUiDetails(message);
			if (descriptor === null) continue;
			const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
			if (typeof toolCallId !== "string" || toolCallId.length === 0) continue;
			const open = openCalls.get(toolCallId);
			if (open === undefined) continue;
			const status: ToolUiStatus = (message as { isError?: unknown }).isError === true ? "error" : "completed";
			const output = messageText(message);
			// 声明比对：groupContext 实例声明了 tools 且不含本工具 → 不硬归该实例
			// （groupContext 置空，走 pipeline 的池内最近分组兜底）；未声明工具集的
			// 实例保持时序归属。命中声明条目时顺带取展示名。
			const declaredTools =
				open.groupContext === null
					? undefined
					: skillInstances.find((instance) => instance.instanceId === open.groupContext?.instanceId)?.declaration
							?.tools;
			const rawName = rawMcpToolName(open.harnessName, descriptor.serverId);
			const matched =
				declaredTools === undefined
					? undefined
					: findMatchingDeclaration(open.harnessName, descriptor.serverId, declaredTools);
			calls.push({
				resourceUri: descriptor.resourceUri,
				serverId: descriptor.serverId,
				toolCallId,
				toolName: rawName,
				...(matched?.title !== undefined ? { toolTitle: matched.title } : {}),
				status,
				input: open.input,
				...(descriptor.permissions !== undefined ? { permissions: descriptor.permissions } : {}),
				groupContext: declaredTools === undefined || matched !== undefined ? open.groupContext : null,
				...(output.length > 0 ? { output } : {}),
			});
		}
	}
	return { skillInstances, calls };
}
