import type { AgentInfoDTO, MessageDTO, ToolLibraryItem } from "@platform/shared";

/**
 * 上下文分段估算（路线 A：前端零依赖启发式，全部为估算值）。
 *
 * 三段：系统提示（/agents 透传的 prompt 文本）、工具定义（/tool-library 的
 * JSON Schema）、历史消息（消息 parts 序列化）。估算 ≠ 权威总量
 * （step-finish 的 provider usage），仅用于感知上下文构成。
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
	let sum = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if (isCjk(code)) sum += 1;
		else if (STRUCTURAL_CHARS.has(ch)) sum += 1 / 3;
		else sum += 1 / 4;
	}
	return Math.ceil(sum);
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

/** 历史消息 → 单串文本（供 estimateTokens 计数；role 标签协助对齐真实请求） */
export function serializeHistoryTokens(messages: MessageDTO[]): string {
	const lines: string[] = [];
	for (const m of messages) {
		lines.push(m.role);
		for (const raw of m.parts) {
			const p = (raw ?? {}) as LoosePart;
			if (SKIP_PART_TYPES.has(asString(p.type))) continue;
			const text = partText(p);
			if (text) lines.push(text);
		}
	}
	return lines.join("\n");
}

/** 三段估算结果（token 数） */
export interface ContextSegments {
	systemTokens: number;
	toolsTokens: number;
	historyTokens: number;
	/** 三段之和（占比分母；≠ 权威总量） */
	segmentTotal: number;
}

/** 三段聚合：系统提示 / 工具定义 / 历史消息 */
export function estimateContextSegments(input: {
	messages: MessageDTO[];
	agents: AgentInfoDTO[];
	agentName?: string;
	tools: ToolLibraryItem[];
}): ContextSegments {
	const { messages, agents, agentName, tools } = input;

	const prompt = agents.find((a) => a.name === agentName)?.prompt;
	const systemTokens = prompt ? estimateTokens(prompt) : FALLBACK_SYSTEM_PROMPT_TOKENS;

	let toolsTokens = BUILTIN_TOOLS_TOKENS;
	for (const t of tools) {
		toolsTokens += estimateTokens(`${t.name}${t.description ?? ""}${JSON.stringify(t.inputSchema ?? {})}`);
	}

	const historyTokens =
		estimateTokens(serializeHistoryTokens(messages)) + messages.length * PER_MESSAGE_OVERHEAD_TOKENS;

	return { systemTokens, toolsTokens, historyTokens, segmentTotal: systemTokens + toolsTokens + historyTokens };
}
