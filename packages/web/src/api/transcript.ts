/**
 * pi transcript（wire JSON）→ opencode MessageDTO 投影（页面渲染契约单一事实源）。
 *
 * pi 侧数据形状：
 * - transcript 条目 { id, type: "message" | "compaction" | ..., message?: AgentMessage }
 * - AgentMessage wire：{ role: "user" | "assistant" | "toolResult", content, timestamp }
 *   - assistant content part：{ type: "text" | "thinking" | "toolCall", ... }
 *   - toolResult：{ toolCallId, toolName, isError, content, details?: { mcpUi?, structuredContent? } }
 * - skill 调用不是 tool part，而是 user message 文本中的 `<skill name location>` 块
 *   （formatSkillInvocation 产物，块内含 skill-meta 注释声明 title/tools）
 *
 * 投影规则：
 * - user/assistant 条目 → MessageDTO；thinking → reasoning part；toolCall → tool part
 *   （state 内联结果：status/output/metadata._meta.ui，opencode 消费契约）
 * - toolResult 条目 → 按 toolCallId 合并进 assistant tool part，不产生独立消息
 * - skill 块 → 合成 assistant skill tool part（part.tool === "skill"，output 带
 *   "Base directory for this skill:" 前缀行，驱动 useSkillLoader/iframe 分组管线）
 * - skill-meta 声明 → 记入模块级 skill 注册表缓存（fetchSkills 数据源，供元数据加载）
 */

import type { MessageDTO, SharedToolMeta, SkillInfoDTO } from "@platform/shared";

/** pi transcript 条目最小结构视图（wire JSON） */
export interface PiTranscriptEntry {
	readonly id: string;
	readonly type: string;
	/** MessageEntry：AgentMessage wire JSON */
	readonly message?: unknown;
	/** compaction / branch_summary 条目的摘要文本 */
	readonly summary?: unknown;
}

/** pi LaneSnapshot 的最小视图（只消费 transcript 与 operation.id） */
export interface PiTranscriptSnapshotLike {
	readonly transcript?: readonly PiTranscriptEntry[];
	readonly operation?: { readonly id?: string } | null;
}

// ---------------------------------------------------------------------------
// skill 块解析（与 pi parseSkillBlock / formatSkillInvocation 同源）
// ---------------------------------------------------------------------------

const SKILL_BLOCK_RE = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

interface ParsedSkillBlock {
	name: string;
	/** skill 目录（pi location 是 SKILL.md 文件路径，取目录部分） */
	directory: string;
	filePath: string;
	title?: string;
	tools?: SharedToolMeta[];
}

function dirnameOf(filePath: string): string {
	const index = filePath.replace(/\\/g, "/").lastIndexOf("/");
	return index > 0 ? filePath.slice(0, index) : filePath;
}

function normalizeToolDeclarations(raw: unknown): SharedToolMeta[] {
	if (!Array.isArray(raw)) return [];
	const out: SharedToolMeta[] = [];
	for (const item of raw) {
		if (typeof item === "string" && item.length > 0) {
			out.push(item);
		} else if (typeof item === "object" && item !== null) {
			const record = item as { name?: unknown; title?: unknown };
			if (typeof record.name === "string" && record.name.length > 0) {
				out.push({
					name: record.name,
					...(typeof record.title === "string" && record.title.length > 0 ? { title: record.title } : {}),
				});
			}
		}
	}
	return out;
}

/** 从 user message 文本解析 skill 块（含 skill-meta 宿主声明）；非 skill 块返回 null */
export function parseSkillBlockText(text: string): ParsedSkillBlock | null {
	const match = SKILL_BLOCK_RE.exec(text);
	if (!match) return null;
	const name = match[1] ?? "";
	const filePath = match[2] ?? "";
	if (name.length === 0 || filePath.length === 0) return null;
	const block: ParsedSkillBlock = { name, directory: dirnameOf(filePath), filePath };
	// skill-meta 注释：<!-- skill-meta {"title":..., "tools":[...]} -->
	const metaMatch = /<!--\s*skill-meta\s*(\{[\s\S]*?\})\s*-->/.exec(match[3] ?? "");
	if (metaMatch) {
		try {
			const meta = JSON.parse(metaMatch[1] ?? "{}") as { title?: unknown; tools?: unknown };
			if (typeof meta.title === "string" && meta.title.length > 0) block.title = meta.title;
			const tools = normalizeToolDeclarations(meta.tools);
			if (tools.length > 0) block.tools = tools;
		} catch {
			// 声明损坏按缺失处理（title/tools 回退 name/空）
		}
	}
	return block;
}

// ---------------------------------------------------------------------------
// skill 注册表缓存（api/settings.ts fetchSkills 的数据源）
// ---------------------------------------------------------------------------

const skillRegistry = new Map<string, SkillInfoDTO>();

/** 转译时发现的 skill 声明（fetchSkills 返回，loadSkill registry 路径命中 → 不降级） */
export function knownSkills(): SkillInfoDTO[] {
	return [...skillRegistry.values()];
}

/** 会话切换时清空（setCurrentSession 侧调用） */
export function resetSkillRegistry(): void {
	skillRegistry.clear();
}

function recordSkillDeclaration(block: ParsedSkillBlock): void {
	skillRegistry.set(block.name, {
		name: block.name,
		...(block.title !== undefined ? { title: block.title } : {}),
		tools: block.tools ?? [],
		directory: block.directory,
		source: "global",
		metadataUnavailable: false,
	});
}

// ---------------------------------------------------------------------------
// wire JSON 视图解析
// ---------------------------------------------------------------------------

interface ContentView {
	role: string;
	content: unknown;
	timestamp: number;
}

function parseMessage(message: unknown): ContentView | null {
	if (typeof message !== "object" || message === null) return null;
	const candidate = message as { role?: unknown; content?: unknown; timestamp?: unknown };
	if (typeof candidate.role !== "string") return null;
	return {
		role: candidate.role,
		content: candidate.content,
		timestamp: typeof candidate.timestamp === "number" ? candidate.timestamp : 0,
	};
}

function isoTimestamp(timestamp: number): string {
	return new Date(timestamp > 0 ? timestamp : Date.now()).toISOString();
}

/** 从消息 wire JSON 提取 text content 拼接文本（tool 输出用） */
function messageText(content: unknown): string {
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

/** pi AgentMessage content part 最小视图 */
interface ContentPartView {
	type: string;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
	text?: unknown;
	thinking?: unknown;
}

function contentParts(content: unknown): ContentPartView[] {
	if (!Array.isArray(content)) return [];
	return content.filter(
		(part): part is ContentPartView =>
			typeof part === "object" && part !== null && typeof (part as { type?: unknown }).type === "string",
	);
}

/** pi toolResult details 的 mcpUi 描述符（agent 核心 McpToolDetails.mcpUi 的 web 侧镜像） */
interface McpUiDescriptor {
	resourceUri: string;
	serverId?: string;
	permissions?: string[];
}

interface ParsedToolResult {
	isError: boolean;
	output: string;
	mcpUi: McpUiDescriptor | null;
	structuredContent?: Record<string, unknown>;
	timestamp: number;
}

function parseToolResult(message: unknown): ParsedToolResult | null {
	const view = parseMessage(message);
	if (view === null || view.role !== "toolResult") return null;
	const record = message as {
		toolCallId?: unknown;
		isError?: unknown;
		details?: unknown;
	};
	const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : "";
	if (toolCallId.length === 0) return null;
	let mcpUi: McpUiDescriptor | null = null;
	let structuredContent: Record<string, unknown> | undefined;
	if (typeof record.details === "object" && record.details !== null) {
		const details = record.details as { mcpUi?: unknown; structuredContent?: unknown };
		if (typeof details.mcpUi === "object" && details.mcpUi !== null) {
			const ui = details.mcpUi as { resourceUri?: unknown; serverId?: unknown; permissions?: unknown };
			if (typeof ui.resourceUri === "string" && ui.resourceUri.startsWith("ui://")) {
				mcpUi = { resourceUri: ui.resourceUri };
				if (typeof ui.serverId === "string" && ui.serverId.length > 0) mcpUi.serverId = ui.serverId;
				if (Array.isArray(ui.permissions)) {
					const permissions = ui.permissions.filter((p): p is string => typeof p === "string");
					if (permissions.length > 0) mcpUi.permissions = permissions;
				}
			}
		}
		if (
			typeof details.structuredContent === "object" &&
			details.structuredContent !== null &&
			!Array.isArray(details.structuredContent)
		) {
			structuredContent = details.structuredContent as Record<string, unknown>;
		}
	}
	return {
		isError: record.isError === true,
		output: messageText(view.content),
		mcpUi,
		...(structuredContent !== undefined ? { structuredContent } : {}),
		timestamp: view.timestamp,
	};
}

// ---------------------------------------------------------------------------
// 投影主流程
// ---------------------------------------------------------------------------

/** ask_user 挂起调用（store pendingQuestions 置入数据源；requestID = toolCallId） */
export interface PendingAskUserCall {
	toolCallId: string;
	input: unknown;
	/** 承载该调用的 assistant 消息 id（part.messageID，锚点精确绑定用） */
	messageID: string;
}

export interface TranscriptProjection {
	messages: MessageDTO[];
	/** 上下文时序游标：skill 块 → 其后首个 toolCall（供 iframe 分组判定，落在 part.metadata） */
	running: boolean;
	pendingAskUser: PendingAskUserCall[];
}

/**
 * 全量投影：pi transcript 条目流 → MessageDTO[]（opencode 形状）。
 * 纯函数；副作用仅 skill 注册表缓存更新（recordSkillDeclaration）。
 */
export function projectTranscript(snapshot: PiTranscriptSnapshotLike | null | undefined): TranscriptProjection {
	const entries = snapshot?.transcript ?? [];
	// 第一遍：收集 toolResult（按 toolCallId）与 skill 声明
	const results = new Map<string, ParsedToolResult>();
	const skillBlocks = new Map<string, ParsedSkillBlock>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const view = parseMessage(entry.message);
		if (view === null) continue;
		if (view.role === "toolResult") {
			const parsed = parseToolResult(entry.message);
			if (parsed !== null) results.set((entry.message as { toolCallId: string }).toolCallId, parsed);
			continue;
		}
		if (view.role === "user") {
			const text = messageText(view.content);
			if (text.startsWith("<skill ")) {
				const block = parseSkillBlockText(text);
				if (block !== null) {
					skillBlocks.set(entry.id, block);
					recordSkillDeclaration(block);
				}
			}
		}
	}

	// 第二遍：投影消息流
	const messages: MessageDTO[] = [];
	const pendingAskUser: PendingAskUserCall[] = [];

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const view = parseMessage(entry.message);
		if (view === null) continue;
		const createdAt = isoTimestamp(view.timestamp);

		if (view.role === "user") {
			const text = messageText(view.content);
			const skillBlock = skillBlocks.get(entry.id);
			if (skillBlock !== undefined) {
				// 合成 assistant skill tool part（驱动 useSkillLoader / iframe 分组管线）
				messages.push({
					id: `skill-${entry.id}`,
					role: "assistant",
					createdAt,
					completedAt: createdAt,
					parts: [
						{
							id: entry.id,
							callID: entry.id,
							messageID: `skill-${entry.id}`,
							type: "tool",
							tool: "skill",
							state: {
								status: "completed",
								input: { name: skillBlock.name },
								output: `Base directory for this skill: ${skillBlock.directory}`,
								metadata: {},
							},
						},
					],
				});
				// 块尾附加指令（additionalInstructions）作为用户消息展示
				const instructions = /^<skill name="[^"]+" location="[^"]+">\n[\s\S]*?\n<\/skill>\n\n([\s\S]+)$/.exec(text);
				if (instructions?.[1] !== undefined && instructions[1].trim().length > 0) {
					messages.push({
						id: entry.id,
						role: "user",
						createdAt,
						completedAt: null,
						parts: [{ type: "text", text: instructions[1] }],
					});
				}
				continue;
			}
			if (text.trim().length === 0) continue;
			messages.push({
				id: entry.id,
				role: "user",
				createdAt,
				completedAt: null,
				parts: contentParts(view.content).map((part) =>
					part.type === "text" ? { type: "text", text: String(part.text ?? "") } : part,
				),
			});
			continue;
		}

		if (view.role === "assistant") {
			const parts: unknown[] = [];
			for (const part of contentParts(view.content)) {
				if (part.type === "text") {
					const text = String(part.text ?? "");
					if (text.trim().length === 0) continue;
					parts.push({ type: "text", text });
					continue;
				}
				if (part.type === "thinking") {
					const thinking = String(part.thinking ?? "");
					if (thinking.trim().length === 0) continue;
					parts.push({ type: "reasoning", text: thinking });
					continue;
				}
				if (part.type === "toolCall") {
					const callId = typeof part.id === "string" ? part.id : "";
					if (callId.length === 0) continue;
					const name = typeof part.name === "string" ? part.name : "tool";
					const result = results.get(callId);
					const isAskUser = name.includes("ask_user_");
					const status = result === undefined ? "running" : result.isError ? "error" : "completed";
					if (isAskUser && result === undefined) {
						pendingAskUser.push({ toolCallId: callId, input: part.arguments, messageID: entry.id });
					}
					// MCP Apps UI 描述符：优先结果 details.mcpUi；pi 桥接工具名 mcp__ 前缀。
					// 中止/错误终态同样携带 mcpUi（agent 核心 terminalDetails），绑定不依赖清单
					const metadata: Record<string, unknown> = {};
					if (result?.mcpUi !== undefined && result.mcpUi !== null) {
						metadata._meta = {
							ui: {
								resourceUri: result.mcpUi.resourceUri,
								...(result.mcpUi.serverId !== undefined ? { serverId: result.mcpUi.serverId } : {}),
								...(result.mcpUi.permissions !== undefined ? { permissions: result.mcpUi.permissions } : {}),
							},
						};
					}
					if (result?.structuredContent !== undefined) {
						metadata.structuredContent = result.structuredContent;
					}
					parts.push({
						id: callId,
						callID: callId,
						messageID: entry.id,
						type: "tool",
						tool: name,
						state: {
							status,
							input:
								typeof part.arguments === "object" && part.arguments !== null && !Array.isArray(part.arguments)
									? (part.arguments as Record<string, unknown>)
									: {},
							...(result !== undefined && result.output.length > 0 ? { output: result.output } : {}),
							metadata,
							...(view.timestamp > 0 ? { time: { start: view.timestamp } } : {}),
						},
					});
				}
			}
			// 空 assistant（流式起始/abort 残留）也保留：MessageList 渲染"生成中"三点
			if (parts.length > 0 || messages[messages.length - 1]?.role !== "assistant") {
				messages.push({ id: entry.id, role: "assistant", createdAt, completedAt: null, parts });
			}
		}
		// toolResult 条目已合并进 tool part；其余角色（system/compaction 等）不投影
	}

	return {
		messages,
		running: typeof snapshot?.operation?.id === "string",
		pendingAskUser,
	};
}

/** 会话是否运行中（operation 存在即运行） */
export function isSessionRunning(snapshot: PiTranscriptSnapshotLike | null | undefined): boolean {
	return typeof snapshot?.operation?.id === "string";
}
