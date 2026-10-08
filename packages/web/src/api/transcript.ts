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
 */

import type { Op, Path } from "@earendil-works/chord";
import type { MessageDTO, SharedToolMeta } from "@platform/shared";

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
// wire JSON 视图解析
// ---------------------------------------------------------------------------

interface ContentView {
	role: string;
	content: unknown;
	timestamp: number;
	/** 轮次完成时写入的 provider usage（pi AssistantMessage.usage；流式中间态无） */
	usage?: { input: number; cacheRead: number };
}

/** pi Usage 最小视图（权威上下文值数据源：input + cacheRead = 模型看到的上下文量） */
function parseUsage(raw: unknown): { input: number; cacheRead: number } | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const view = raw as { input?: unknown; cacheRead?: unknown };
	if (typeof view.input !== "number" || typeof view.cacheRead !== "number") return undefined;
	return { input: view.input, cacheRead: view.cacheRead };
}

function parseMessage(message: unknown): ContentView | null {
	if (typeof message !== "object" || message === null) return null;
	const candidate = message as { role?: unknown; content?: unknown; timestamp?: unknown; usage?: unknown };
	if (typeof candidate.role !== "string") return null;
	const usage = parseUsage(candidate.usage);
	return {
		role: candidate.role,
		content: candidate.content,
		timestamp: typeof candidate.timestamp === "number" ? candidate.timestamp : 0,
		...(usage !== undefined ? { usage } : {}),
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

// ---------------------------------------------------------------------------
// 投影记忆化：chord 结构共享保证未变更 entry 的对象引用跨快照稳定——
// 按 entry 引用缓存单条投影，流式期间只有正在增长的末条消息重建，
// 历史消息的投影成本从 O(总条目 × parts) 降为 O(缓存命中数 × 引用比较)。
// ---------------------------------------------------------------------------

interface CachedMessage {
	/** 该 entry 产生的全部 DTO（skill 条目可产生 skill 工具 + 附加指令两条） */
	dtos: MessageDTO[];
	/** 该消息投影依赖的 toolResult entry（引用逐项相等即依赖未变） */
	dependencies: readonly object[];
	/** ask_user 挂起（缓存命中时随 dto 一并复用） */
	askUser: PendingAskUserCall | null;
}

const messageCache = new WeakMap<object, CachedMessage>();

function sameDependencies(a: readonly object[], b: readonly object[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// 单条投影（全量与增量共享的构建块）
// ---------------------------------------------------------------------------

interface ProjectionContext {
	results: Map<string, ParsedToolResult>;
	resultEntries: Map<string, object>;
	skillBlocks: Map<string, ParsedSkillBlock>;
}

/**
 * 第一遍：收集 toolResult 解析结果与 skill 块。
 * 返回本条写入的 toolCallId（增量路径的依赖追踪输入）。
 */
function collectEntry(entry: PiTranscriptEntry, ctx: ProjectionContext): string[] {
	if (entry.type !== "message") return [];
	const view = parseMessage(entry.message);
	if (view === null) return [];
	if (view.role === "toolResult") {
		const parsed = parseToolResult(entry.message);
		if (parsed === null) return [];
		const toolCallId = (entry.message as { toolCallId: string }).toolCallId;
		ctx.results.set(toolCallId, parsed);
		ctx.resultEntries.set(toolCallId, entry);
		return [toolCallId];
	}
	if (view.role === "user") {
		const text = messageText(view.content);
		if (text.startsWith("<skill ")) {
			const block = parseSkillBlockText(text);
			if (block !== null) {
				ctx.skillBlocks.set(entry.id, block);
			}
		}
	}
	return [];
}

/** 从投影 part 提取 toolCallId（增量依赖反查用；非 tool part 返回 null） */
function toolPartCallId(part: unknown): string | null {
	if (typeof part !== "object" || part === null) return null;
	const view = part as { type?: unknown; callID?: unknown };
	if (view.type !== "tool" || typeof view.callID !== "string") return null;
	return view.callID;
}

/**
 * 第二遍：投影单条 message 条目（内部查写 messageCache）。
 * prevMessageRole 是该条目之前投影流的末条 role（assistant 空条目跳过判定）。
 */
function projectEntry(
	entry: PiTranscriptEntry,
	view: ContentView,
	ctx: ProjectionContext,
	prevMessageRole: string | undefined,
): { dtos: MessageDTO[]; askUser: PendingAskUserCall | null } {
	const createdAt = isoTimestamp(view.timestamp);

	if (view.role === "user") {
		const cached = messageCache.get(entry);
		if (cached !== undefined && cached.dependencies.length === 0) {
			return { dtos: cached.dtos, askUser: null };
		}
		const text = messageText(view.content);
		const skillBlock = ctx.skillBlocks.get(entry.id);
		if (skillBlock !== undefined) {
			// 合成 assistant skill tool part（驱动 useSkillLoader / iframe 分组管线）
			const skillDto: MessageDTO = {
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
			};
			const dtos: MessageDTO[] = [skillDto];
			// 块尾附加指令（additionalInstructions）作为用户消息展示
			const instructions = /^<skill name="[^"]+" location="[^"]+">\n[\s\S]*?\n<\/skill>\n\n([\s\S]+)$/.exec(text);
			if (instructions?.[1] !== undefined && instructions[1].trim().length > 0) {
				dtos.push({
					id: entry.id,
					role: "user",
					createdAt,
					completedAt: null,
					parts: [{ type: "text", text: instructions[1] }],
				});
			}
			messageCache.set(entry, { dtos, dependencies: [], askUser: null });
			return { dtos, askUser: null };
		}
		if (text.trim().length === 0) return { dtos: [], askUser: null };
		const dto: MessageDTO = {
			id: entry.id,
			role: "user",
			createdAt,
			completedAt: null,
			parts: contentParts(view.content).map((part) =>
				part.type === "text" ? { type: "text", text: String(part.text ?? "") } : part,
			),
		};
		messageCache.set(entry, { dtos: [dto], dependencies: [], askUser: null });
		return { dtos: [dto], askUser: null };
	}

	if (view.role === "assistant") {
		// 依赖收集：该消息引用的 toolResult entry（引用稳定即结果未变）
		const dependencies: object[] = [];
		for (const part of contentParts(view.content)) {
			if (part.type !== "toolCall") continue;
			const callId = typeof part.id === "string" ? part.id : "";
			if (callId.length === 0) continue;
			const resultEntry = ctx.resultEntries.get(callId);
			if (resultEntry !== undefined) dependencies.push(resultEntry);
		}
		const cached = messageCache.get(entry);
		if (cached !== undefined && sameDependencies(cached.dependencies, dependencies)) {
			return { dtos: cached.dtos, askUser: cached.askUser };
		}

		const parts: unknown[] = [];
		let askUser: PendingAskUserCall | null = null;
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
				const result = ctx.results.get(callId);
				const isAskUser = name.includes("ask_user_");
				const status = result === undefined ? "running" : result.isError ? "error" : "completed";
				if (isAskUser && result === undefined) {
					askUser = { toolCallId: callId, input: part.arguments, messageID: entry.id };
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
		// 轮次完成时合成 step-finish part（pi 无原生 step-finish part；从 AssistantMessage.usage
		// 合成 opencode 兼容形状：权威上下文值 = input + cacheRead，驱动 ChatInput 圆环）。
		// 渲染层经 SILENT_PART_TYPES 静默，估算层经 SKIP_PART_TYPES 排除。
		if (view.usage !== undefined) {
			parts.push({
				type: "step-finish",
				tokens: { input: view.usage.input, cache: { read: view.usage.cacheRead } },
			});
		}
		// 空 assistant（流式起始/abort 残留）也保留：MessageList 渲染"生成中"三点
		if (parts.length > 0 || prevMessageRole !== "assistant") {
			const dto: MessageDTO = { id: entry.id, role: "assistant", createdAt, completedAt: null, parts };
			messageCache.set(entry, { dtos: [dto], dependencies, askUser });
			return { dtos: [dto], askUser };
		}
		return { dtos: [], askUser: null };
	}
	// toolResult 条目已合并进 tool part；其余角色（system/compaction 等）不投影
	return { dtos: [], askUser: null };
}

// ---------------------------------------------------------------------------
// op 分类：chord delivery ops → 增量投影路径
// ---------------------------------------------------------------------------

/** 增量投影路径：append = 纯尾部追加条目；tail = 末条 entry 内部 / 非投影字段变更；fallback = 全量重建 */
export type ProjectionPath = "append" | "tail" | "fallback";

/**
 * 对 transcript 状态投递的 ops 做增量可行性分类。
 *
 * TranscriptState = { snapshot, event }；影响 messages 投影的只有
 * snapshot.transcript 条目数组。规则：
 * - `["r"]` 或任何数组层非纯尾部拼接（重排/中部插删/整数组替换）→ fallback
 * - 路径指向旧末条 entry（index === prevEntryCount - 1）内部 → tail
 * - 路径在 transcript 之外（event / snapshot.operation 等）→ 不影响 messages，tail
 * - 全部为 `["p", ["snapshot","transcript"], cursor, 0, items]`（cursor 递增）→ append
 */
export function classifyTranscriptOps(ops: readonly Op[], prevEntryCount: number): ProjectionPath {
	let appendCursor = prevEntryCount;
	let sawAppend = false;
	for (const op of ops) {
		const verb = op[0];
		if (verb === "r") return "fallback";
		const path: Path = op[1] as Path;
		if (path[0] === "event") continue;
		if (path[0] !== "snapshot") return "fallback";
		if (path.length === 1) return "fallback"; // snapshot 整体替换
		if (path[1] !== "transcript") continue;
		if (path.length === 2) {
			// transcript 数组层：只接受纯尾部拼接
			if (verb === "p" && (op[3] as number) === 0 && (op[2] as number) === appendCursor) {
				appendCursor += (op[4] as readonly unknown[]).length;
				sawAppend = true;
				continue;
			}
			return "fallback";
		}
		// 条目内部：只接受旧末条（流式增长条目）
		const index = path[2];
		if (typeof index !== "number" || index !== prevEntryCount - 1) return "fallback";
	}
	return sawAppend ? "append" : "tail";
}

function opPath(op: Op): Path | null {
	return op[0] === "r" ? null : (op[1] as Path);
}

// ---------------------------------------------------------------------------
// 增量投影 workspace：持有上一轮投影的全部中间状态
// （results / resultEntries / skillBlocks / 条目 → DTO 下标 / ask_user 挂起），
// chord delivery ops 可行时只重投影被触碰的条目，其余 DTO 引用原样保留。
// ---------------------------------------------------------------------------

export class TranscriptProjectionWorkspace {
	readonly #results = new Map<string, ParsedToolResult>();
	readonly #resultEntries = new Map<string, object>();
	readonly #skillBlocks = new Map<string, ParsedSkillBlock>();
	#entries: readonly PiTranscriptEntry[] = [];
	#messages: MessageDTO[] = [];
	/** entry.id → 该 entry 在 #messages 中的 DTO 下标（同位替换与触碰判定） */
	#entryIndices = new Map<string, number[]>();
	#askUser = new Map<string, PendingAskUserCall>();
	#running = false;

	/** 已投影的 transcript 条目数（classifyTranscriptOps 输入） */
	get entryCount(): number {
		return this.#entries.length;
	}

	/** 全量重建（首投影与 fallback 共用；与 projectTranscript 语义一致） */
	rebuild(snapshot: PiTranscriptSnapshotLike | null | undefined): TranscriptProjection {
		const entries = snapshot?.transcript ?? [];
		this.#results.clear();
		this.#resultEntries.clear();
		this.#skillBlocks.clear();
		this.#messages = [];
		this.#entryIndices.clear();
		this.#askUser.clear();
		const ctx: ProjectionContext = {
			results: this.#results,
			resultEntries: this.#resultEntries,
			skillBlocks: this.#skillBlocks,
		};
		for (const entry of entries) collectEntry(entry, ctx);
		for (const entry of entries) {
			if (entry.type !== "message") continue;
			const view = parseMessage(entry.message);
			if (view === null || view.role === "toolResult") {
				this.#entryIndices.set(entry.id, []);
				continue;
			}
			const prevRole = this.#messages[this.#messages.length - 1]?.role;
			const { dtos, askUser } = projectEntry(entry, view, ctx, prevRole);
			this.#recordDtos(entry.id, dtos);
			if (askUser !== null) this.#askUser.set(askUser.toolCallId, askUser);
		}
		this.#entries = entries;
		this.#running = typeof snapshot?.operation?.id === "string";
		return { messages: [...this.#messages], running: this.#running, pendingAskUser: [...this.#askUser.values()] };
	}

	/** 增量投影：ops 来自 chord update delivery；任何不确定形态回落全量重建 */
	apply(snapshot: PiTranscriptSnapshotLike | null | undefined, ops: readonly Op[]): TranscriptProjection {
		const entries = snapshot?.transcript ?? [];
		const prev = this.#entries;
		if (classifyTranscriptOps(ops, prev.length) === "fallback") return this.rebuild(snapshot);
		if (!this.#verifyPrefix(entries, prev)) return this.rebuild(snapshot);
		const ctx: ProjectionContext = {
			results: this.#results,
			resultEntries: this.#resultEntries,
			skillBlocks: this.#skillBlocks,
		};

		// 新增条目先收集（toolResult / skill 声明），旧条目重建依赖新结果
		const addedCallIds = new Set<string>();
		for (let i = prev.length; i < entries.length; i++) {
			for (const callId of collectEntry(entries[i]!, ctx)) addedCallIds.add(callId);
		}

		// 触碰集：批内写到的旧末条 + 依赖新增 toolCallId 的旧条目
		const touched = new Set<string>();
		if (prev.length > 0) {
			const lastIndex = prev.length - 1;
			const lastId = prev[lastIndex]!.id;
			for (const op of ops) {
				const path = opPath(op);
				if (path !== null && path[0] === "snapshot" && path[1] === "transcript" && path[2] === lastIndex) {
					touched.add(lastId);
					break;
				}
			}
		}
		if (addedCallIds.size > 0) {
			for (const dto of this.#messages) {
				for (const part of dto.parts) {
					const callId = toolPartCallId(part);
					if (callId !== null && addedCallIds.has(callId)) {
						touched.add(dto.id);
						break;
					}
				}
			}
		}

		// 重投影必须用新 entries 的引用（applyImmutable 为变更条目产生新对象，
		// prev 中的旧引用内容陈旧且会命中 messageCache 的过期 DTO）
		for (let i = 0; i < prev.length; i++) {
			const entry = entries[i]!;
			if (!touched.has(entry.id)) continue;
			if (!this.#reproject(entry, ctx)) return this.rebuild(snapshot);
		}
		for (let i = prev.length; i < entries.length; i++) {
			const entry = entries[i]!;
			const view = parseMessage(entry.message);
			if (view === null || view.role === "toolResult") {
				this.#entryIndices.set(entry.id, []);
				continue;
			}
			const prevRole = this.#messages[this.#messages.length - 1]?.role;
			const { dtos, askUser } = projectEntry(entry, view, ctx, prevRole);
			this.#recordDtos(entry.id, dtos);
			if (askUser !== null) this.#askUser.set(askUser.toolCallId, askUser);
		}

		this.#entries = entries;
		this.#running = typeof snapshot?.operation?.id === "string";
		return { messages: [...this.#messages], running: this.#running, pendingAskUser: [...this.#askUser.values()] };
	}

	#recordDtos(entryId: string, dtos: MessageDTO[]): void {
		if (dtos.length === 0) {
			this.#entryIndices.set(entryId, []);
			return;
		}
		const start = this.#messages.length;
		for (const dto of dtos) this.#messages.push(dto);
		const indices: number[] = [];
		for (let k = 0; k < dtos.length; k++) indices.push(start + k);
		this.#entryIndices.set(entryId, indices);
	}

	/** 前缀引用校验（安全网）：applyImmutable 结构共享保证未变条目引用稳定；违约即全量 */
	#verifyPrefix(entries: readonly PiTranscriptEntry[], prev: readonly PiTranscriptEntry[]): boolean {
		const prefixLen = entries.length === prev.length ? prev.length - 1 : prev.length;
		if (prefixLen < 0) return entries.length === 0;
		if (entries.length < prefixLen) return false;
		for (let i = 0; i < prefixLen; i++) {
			if (entries[i] !== prev[i]) return false;
		}
		return true;
	}

	/** 重投影单条已投影条目；返回 false 表示结构变化，调用方回落全量 */
	#reproject(entry: PiTranscriptEntry, ctx: ProjectionContext): boolean {
		const view = parseMessage(entry.message);
		const indices = this.#entryIndices.get(entry.id) ?? [];
		if (view === null || view.role === "toolResult") return indices.length === 0;
		const prevRole =
			indices.length > 0 ? this.#messages[indices[0]! - 1]?.role : this.#messages[this.#messages.length - 1]?.role;
		const { dtos, askUser } = projectEntry(entry, view, ctx, prevRole);
		if (dtos.length !== indices.length) {
			// 仅接受「无 DTO → 有 DTO」（末条 assistant 流式起步）；其余结构变化回落全量
			if (!(indices.length === 0 && dtos.length > 0)) return false;
			this.#recordDtos(entry.id, dtos);
		} else {
			for (let k = 0; k < dtos.length; k++) this.#messages[indices[k]!] = dtos[k]!;
		}
		for (const [callId, call] of this.#askUser) {
			if (call.messageID === entry.id) this.#askUser.delete(callId);
		}
		if (askUser !== null) this.#askUser.set(askUser.toolCallId, askUser);
		return true;
	}
}

/**
 * 全量投影：pi transcript 条目流 → MessageDTO[]（opencode 形状）。
 * 纯函数（无模块级副作用）。
 *
 * 记忆化：未变更 entry 返回缓存的同一 MessageDTO 引用（下游 React.memo
 * 据此跳过重渲染）；流式增长的末条 entry 引用变化，正常重建。
 */
export function projectTranscript(snapshot: PiTranscriptSnapshotLike | null | undefined): TranscriptProjection {
	return new TranscriptProjectionWorkspace().rebuild(snapshot);
}

/** 增量投影入口：delivery.ops 可行时只重投影被触碰条目，否则等价于 projectTranscript */
export function projectTranscriptIncremental(
	snapshot: PiTranscriptSnapshotLike | null | undefined,
	ops: readonly Op[],
	workspace: TranscriptProjectionWorkspace,
): TranscriptProjection {
	return workspace.apply(snapshot, ops);
}

/** 会话是否运行中（operation 存在即运行） */
export function isSessionRunning(snapshot: PiTranscriptSnapshotLike | null | undefined): boolean {
	return typeof snapshot?.operation?.id === "string";
}
