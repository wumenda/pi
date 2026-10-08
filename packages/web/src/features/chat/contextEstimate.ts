import type { AgentInfoDTO, MessageDTO, ToolLibraryItem } from "@platform/shared";

/**
 * 上下文分段估算（路线 A：前端零依赖启发式，全部为估算值）。
 *
 * 三段：系统提示（/agents 透传的 prompt 文本）、工具定义（/tool-library 的
 * JSON Schema）、历史消息（消息 parts 序列化）。估算 ≠ 权威总量
 * （step-finish 的 provider usage），仅用于感知上下文构成。
 *
 * 游标化（T2.8-4）：流式期间每次投递 messages 引用变化都会重算本估算。
 * 历史段按消息引用缓存单条 token 数（投影记忆化保证未变消息引用稳定，
 * 引用变化即内容变化）；系统提示/工具定义段按输入引用单槽缓存。
 * 全量重扫成本从 O(总字符) 降为 O(变更消息字符)。
 */

/** 选定 agent 无 prompt / 未选 agent 时的系统提示兜底常量 */
export const FALLBACK_SYSTEM_PROMPT_TOKENS = 2_000;
/** opencode 内置工具（bash/read/edit…）无 schema 端点，整段兜底常量 */
export const BUILTIN_TOOLS_TOKENS = 2_500;
/** 每条消息的角色标签与协议框架开销 */
export const PER_MESSAGE_OVERHEAD_TOKENS = 50;

/** JSON 结构字符：按 1/3 token 计（结构密度高于自然语言） */
const STRUCTURAL_CHARS = new Set(["{", "}", "[", "]", "(", ")", '"', ",", ":"]);

function isCjk(code: number): boolean {
	return (
		(code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef)
	);
}

/**
 * 启发式 token 估算（单趟按码点）：
 * CJK = 1 token/字；JSON 结构字符 = 1/3；其余（含空白）= 1/4；向上取整。
 */
export function estimateTokens(text: string): number {
	return Math.ceil(rawTokenSumTwelfths(text) / 12);
}

/**
 * 未取整 token 和（12 分制整数：CJK=12、结构=4、其他=3）。
 * 整数分段求和精确无舍入——游标化分段聚合与整串估算位级一致。
 */
function rawTokenSumTwelfths(text: string): number {
	let sum = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if (isCjk(code)) sum += 12;
		else if (STRUCTURAL_CHARS.has(ch)) sum += 4;
		else sum += 3;
	}
	return sum;
}

/** 消息序列化中可提取文本的 part 形状（opencode parts 为原始透传，宽松读取） */
interface LoosePart {
	type?: unknown;
	text?: unknown;
	message?: unknown;
	data?: { message?: unknown } | unknown;
	tool?: unknown;
	state?: { input?: unknown; output?: unknown } | unknown;
}

/** 元数据 part：无有效载荷，不计入历史估算 */
const SKIP_PART_TYPES = new Set(["step-start", "step-finish", "snapshot", "patch", "agent", "file"]);

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function partText(p: LoosePart): string {
	const type = asString(p.type);
	if (type === "text" || type === "reasoning") return asString(p.text);
	if (type === "tool") {
		const state = (p.state ?? {}) as { input?: unknown; output?: unknown };
		const input = state.input === undefined ? "" : (JSON.stringify(state.input) ?? "");
		const output =
			typeof state.output === "string"
				? state.output
				: state.output === undefined
					? ""
					: (JSON.stringify(state.output) ?? "");
		return `${asString(p.tool)} ${input} ${output}`;
	}
	if (type === "error") {
		const data = p.data as { message?: unknown } | undefined;
		return asString(p.text) || asString(p.message) || asString(data?.message);
	}
	return "";
}

/** 单条消息 → 文本行（role 标签协助对齐真实请求） */
function serializeMessageTokens(m: MessageDTO): string[] {
	const lines: string[] = [m.role];
	for (const raw of m.parts) {
		const p = (raw ?? {}) as LoosePart;
		if (SKIP_PART_TYPES.has(asString(p.type))) continue;
		const text = partText(p);
		if (text) lines.push(text);
	}
	return lines;
}

/** 历史消息 → 单串文本（供 estimateTokens 计数；保留导出作为游标化的对拍基线） */
export function serializeHistoryTokens(messages: MessageDTO[]): string {
	const lines: string[] = [];
	for (const m of messages) lines.push(...serializeMessageTokens(m));
	return lines.join("\n");
}

/** 单条消息 token 统计（按消息引用缓存；内容不可变 → 引用稳定即结果稳定） */
interface MessageTokenStat {
	/** 12 分制整数 token 和（整数分段求和精确，与整串估算位级一致） */
	sumTwelfths: number;
	/** 文本行数（跨行 \n 分隔符成本计入总估算） */
	lines: number;
}

const messageTokenCache = new WeakMap<object, MessageTokenStat>();

function messageTokenStat(m: MessageDTO): MessageTokenStat {
	const cached = messageTokenCache.get(m);
	if (cached !== undefined) return cached;
	const lines = serializeMessageTokens(m);
	let sumTwelfths = 0;
	for (const line of lines) sumTwelfths += rawTokenSumTwelfths(line);
	const stat: MessageTokenStat = { sumTwelfths, lines: lines.length };
	messageTokenCache.set(m, stat);
	return stat;
}

/** 系统提示段单槽缓存（prompt 字符串引用稳定时跳过逐码点重扫） */
const systemTokenCache = new WeakMap<object, { agentName: string | undefined; tokens: number }>();

/** 系统提示段 token 数（agents 数组引用稳定即命中缓存） */
export function systemTokensOf(agents: AgentInfoDTO[], agentName: string | undefined): number {
	const cached = systemTokenCache.get(agents);
	if (cached !== undefined && cached.agentName === agentName) return cached.tokens;
	const prompt = agents.find((a) => a.name === agentName)?.prompt;
	const tokens = prompt ? estimateTokens(prompt) : FALLBACK_SYSTEM_PROMPT_TOKENS;
	systemTokenCache.set(agents, { agentName, tokens });
	return tokens;
}

/** 工具定义段单槽缓存（tools 数组引用稳定时跳过重扫） */
const toolsTokenCache = new WeakMap<object, number>();

/** 工具定义段 token 数（tools 数组引用稳定即命中缓存） */
export function toolsTokensOf(tools: ToolLibraryItem[]): number {
	const cached = toolsTokenCache.get(tools);
	if (cached !== undefined) return cached;
	let tokens = BUILTIN_TOOLS_TOKENS;
	for (const t of tools) {
		tokens += estimateTokens(`${t.name}${t.description ?? ""}${JSON.stringify(t.inputSchema ?? {})}`);
	}
	toolsTokenCache.set(tools, tokens);
	return tokens;
}

/**
 * 历史段 token 数（游标化聚合；ChatInput select 派生标量用——
 * select 返回原始类型，值相等时 React Query 不触发组件重渲染）。
 */
export function historyTokensOf(messages: readonly MessageDTO[] | undefined): number {
	if (messages === undefined || messages.length === 0) return 0;
	let sumTwelfths = 0;
	let lines = 0;
	for (const m of messages) {
		const stat = messageTokenStat(m);
		sumTwelfths += stat.sumTwelfths;
		lines += stat.lines;
	}
	return (
		(lines === 0 ? 0 : Math.ceil((sumTwelfths + (lines - 1) * 3) / 12)) +
		messages.length * PER_MESSAGE_OVERHEAD_TOKENS
	);
}

/** 历史段粗化档位（500 token；流式期间每 token 投递都会使估算值变化，
 * 粗化后仅跨档时通知重渲染——128k 窗口下 0.4% 显示精度，明细本就是估算）。 */
export function quantizeTokens(tokens: number): number {
	return Math.round(tokens / 500) * 500;
}

/**
 * 最新 step-finish part 的 input token（含缓存读）——模型看到的上下文量。
 * 倒序扫描，命中首个 step-finish 即返回；无则 null。
 */
export function latestStepFinishTokens(messages: readonly MessageDTO[] | undefined): number | null {
	if (messages === undefined) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const parts = messages[i]?.parts ?? [];
		for (let j = parts.length - 1; j >= 0; j--) {
			const p = parts[j] as { type?: string; tokens?: { input?: number; cache?: { read?: number } } } | undefined;
			if (p?.type === "step-finish" && p.tokens) {
				return (p.tokens.input ?? 0) + (p.tokens.cache?.read ?? 0);
			}
		}
	}
	return null;
}

/** 三段估算结果（token 数） */
export interface ContextSegments {
	systemTokens: number;
	toolsTokens: number;
	historyTokens: number;
	/** 三段之和（占比分母；≠ 权威总量） */
	segmentTotal: number;
}

/** 三段聚合：系统提示 / 工具定义 / 历史消息（内部复用派生标量函数与同一套缓存） */
export function estimateContextSegments(input: {
	messages: MessageDTO[];
	agents: AgentInfoDTO[];
	agentName?: string;
	tools: ToolLibraryItem[];
}): ContextSegments {
	const { messages, agents, agentName, tools } = input;

	const systemTokens = systemTokensOf(agents, agentName);
	const toolsTokens = toolsTokensOf(tools);
	const historyTokens = historyTokensOf(messages);

	return { systemTokens, toolsTokens, historyTokens, segmentTotal: systemTokens + toolsTokens + historyTokens };
}
