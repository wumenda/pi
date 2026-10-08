/**
 * T2.8-4 扫描链游标化对拍：
 * - estimateContextSegments（游标化）与全量基线（serializeHistoryTokens + estimateTokens）
 *   在随机消息序列下位级一致（ceil 时机与分隔符成本一致）；
 * - resolveAskAnchors（每消息候选缓存）与朴素倒序全量扫描 + 同规则匹配输出一致。
 */

import type { MessageDTO } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { isToolPart, type ToolPartLike } from "../src/api/events";
import { resolveAskAnchors } from "../src/features/chat/ask-anchors";
import { isAskUserTool, isPlaceholderQuestions, QUESTION_TOOL_NAME } from "../src/features/chat/cards/answers";
import {
	BUILTIN_TOOLS_TOKENS,
	estimateContextSegments,
	estimateTokens,
	FALLBACK_SYSTEM_PROMPT_TOKENS,
	PER_MESSAGE_OVERHEAD_TOKENS,
	serializeHistoryTokens,
} from "../src/features/chat/contextEstimate";

// ---------------------------------------------------------------------------
// 随机基建（可复现）
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randInt(rand: () => number, bound: number): number {
	return Math.floor(rand() * bound);
}

const WORDS = ["检查", "sensor", "read", "温度", "value", "{}", "[1,2]", "line\nnext", " ", "Ab3"];
function randomText(rand: () => number): string {
	const parts: string[] = [];
	const count = 1 + randInt(rand, 5);
	for (let i = 0; i < count; i++) parts.push(WORDS[randInt(rand, WORDS.length)]!);
	return parts.join("");
}

function message(id: string, role: string, parts: unknown[]): MessageDTO {
	return { id, role, createdAt: "2026-01-01T00:00:00.000Z", completedAt: null, parts } as MessageDTO;
}

// ---------------------------------------------------------------------------
// contextEstimate 对拍
// ---------------------------------------------------------------------------

/** 全量基线（游标化前的原实现；history 段用与实现一致的 12 分制整数路径） */
function baselineEstimate(
	messages: MessageDTO[],
	agents: { name: string; prompt?: string }[],
	agentName: string | undefined,
	tools: { name: string; description?: string; inputSchema?: unknown }[],
): { systemTokens: number; toolsTokens: number; historyTokens: number; segmentTotal: number } {
	const prompt = agents.find((a) => a.name === agentName)?.prompt;
	const systemTokens = prompt ? estimateTokens(prompt) : FALLBACK_SYSTEM_PROMPT_TOKENS;
	let toolsTokens = BUILTIN_TOOLS_TOKENS;
	for (const t of tools) {
		toolsTokens += estimateTokens(`${t.name}${t.description ?? ""}${JSON.stringify(t.inputSchema ?? {})}`);
	}
	// 原实现：estimateTokens(整串) = ceil(整数和 / 12)；整数分段求和与整串求和精确一致
	const serialized = serializeHistoryTokens(messages);
	let sumTwelfths = 0;
	for (const ch of serialized) {
		const code = ch.codePointAt(0) ?? 0;
		const isCjk =
			(code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
		if (isCjk) sumTwelfths += 12;
		else if ('{}[]()",:'.includes(ch)) sumTwelfths += 4;
		else sumTwelfths += 3;
	}
	const historyTokens = Math.ceil(sumTwelfths / 12) + messages.length * PER_MESSAGE_OVERHEAD_TOKENS;
	return { systemTokens, toolsTokens, historyTokens, segmentTotal: systemTokens + toolsTokens + historyTokens };
}

describe("contextEstimate cursorization", () => {
	it("随机消息序列下与全量基线位级一致", () => {
		const rand = mulberry32(0xc0ffee);
		const agents = [
			{ name: "build", prompt: `You are a build agent. ${randomText(rand)}` },
			{ name: "plan", prompt: `Planning prompt ${randomText(rand)}` },
		];
		const tools = [
			{
				name: "read_file",
				description: "读取文件",
				inputSchema: { type: "object", properties: { path: { type: "string" } } },
			},
			{ name: "bash", description: "执行命令", inputSchema: { type: "object" } },
		];

		const messages: MessageDTO[] = [];
		let counter = 0;
		for (let round = 0; round < 300; round++) {
			const action = randInt(rand, 4);
			if (action === 0 || messages.length === 0) {
				// 追加消息（流式新条目）
				messages.push(
					message(`m${counter++}`, rand() < 0.5 ? "user" : "assistant", [
						{ type: "text", text: randomText(rand) },
						...(rand() < 0.4
							? [
									{
										type: "tool",
										tool: "read_file",
										state: { input: { path: randomText(rand) }, output: randomText(rand) },
									},
								]
							: []),
						...(rand() < 0.2 ? [{ type: "step-finish", tokens: { input: 100 } }] : []),
					]),
				);
			} else if (action === 1) {
				// 末条内容替换（流式增长 → 新引用，模拟投影记忆化）
				const last = messages[messages.length - 1]!;
				messages[messages.length - 1] = message(last.id, last.role, [
					...last.parts,
					{ type: "text", text: randomText(rand) },
				]);
			} else if (action === 2) {
				// agent 切换
				messages.push(message(`m${counter++}`, "user", [{ type: "text", text: randomText(rand) }]));
			}
			const agentName = rand() < 0.5 ? "build" : "plan";
			const incremental = estimateContextSegments({ messages, agents, agentName, tools });
			const baseline = baselineEstimate(messages, agents, agentName, tools);
			expect(incremental).toEqual(baseline);
		}
	});
});

// ---------------------------------------------------------------------------
// resolveAskAnchors 对拍
// ---------------------------------------------------------------------------

/** 朴素参考实现（游标化前的原逻辑：倒序全量扫描 + 同规则匹配） */
function naiveResolveAskAnchors(
	messages: MessageDTO[],
	pendingByRequest: Record<string, PendingQuestionFixture>,
): { partId: string; requestID: string; kind: string }[] {
	interface Candidate {
		part: ToolPartLike;
		kind: string;
	}
	const candidates: Candidate[] = [];
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		for (const part of [...messages[mi]!.parts].reverse()) {
			if (!isToolPart(part)) continue;
			const toolPart = part as ToolPartLike;
			if (isAskUserTool(toolPart.tool)) {
				candidates.push({ part: toolPart, kind: "ask" });
			} else if (toolPart.tool === QUESTION_TOOL_NAME && toolPart.state.status === "running") {
				candidates.push({ part: toolPart, kind: "question" });
			}
		}
	}
	const anchors: { partId: string; requestID: string; kind: string }[] = [];
	const claimed = new Set<string>();
	const callIDOf = (p: ToolPartLike): unknown => (p as ToolPartLike & { callID?: unknown }).callID;
	const messageIDOf = (p: ToolPartLike): unknown => (p as ToolPartLike & { messageID?: unknown }).messageID;
	for (const q of Object.values(pendingByRequest)) {
		const kind = isPlaceholderQuestions(q.questions) ? "ask" : "question";
		const free = candidates.filter((c) => c.kind === kind && !claimed.has(c.part.id));
		let hit: Candidate | undefined;
		if (q.tool?.callID !== undefined) {
			hit = free.find((c) => callIDOf(c.part) === q.tool?.callID);
		}
		if (hit === undefined && q.tool?.messageID !== undefined) {
			const byMsg = free.filter((c) => messageIDOf(c.part) === q.tool?.messageID);
			if (byMsg.length > 0) hit = byMsg[0];
		}
		if (hit === undefined) hit = free[0];
		if (hit !== undefined) {
			anchors.push({ partId: hit.part.id, requestID: q.requestID, kind });
			claimed.add(hit.part.id);
		}
	}
	return anchors;
}

interface PendingQuestionFixture {
	requestID: string;
	questions: unknown;
	tool?: { messageID?: string; callID?: string };
}

const PLACEHOLDER_QUESTIONS = [
	{ question: "等待用户作答", header: "ask_user", options: [{ label: "等待用户作答", description: "" }] },
];

describe("resolveAskAnchors cursorization", () => {
	it("随机消息与挂起请求下与朴素全量扫描一致", () => {
		const rand = mulberry32(0xabcdef);
		let counter = 0;

		for (let round = 0; round < 300; round++) {
			const messages: MessageDTO[] = [];
			const callIds: { callID: string; messageID: string }[] = [];
			for (let mi = 0; mi < 1 + randInt(rand, 6); mi++) {
				const parts: unknown[] = [{ type: "text", text: randomText(rand) }];
				const toolCount = randInt(rand, 3);
				for (let ti = 0; ti < toolCount; ti++) {
					const callID = `call-${counter++}`;
					const messageID = `msg-${counter++}`;
					callIds.push({ callID, messageID });
					const kind = randInt(rand, 3);
					parts.push({
						id: callID,
						callID,
						messageID,
						type: "tool",
						tool: kind === 0 ? "ask_user_question" : kind === 1 ? QUESTION_TOOL_NAME : "read_file",
						state: { status: kind === 2 ? "completed" : rand() < 0.7 ? "running" : "completed" },
					});
				}
				messages.push(message(`m-${round}-${mi}`, rand() < 0.5 ? "user" : "assistant", parts));
			}

			const pendingByRequest: Record<string, PendingQuestionFixture> = {};
			const pendingCount = randInt(rand, 3);
			for (let pi = 0; pi < pendingCount; pi++) {
				const usePlaceholder = rand() < 0.6;
				const anchor = callIds[randInt(rand, Math.max(1, callIds.length))];
				pendingByRequest[`req-${pi}`] = {
					requestID: `req-${pi}`,
					questions: usePlaceholder
						? PLACEHOLDER_QUESTIONS
						: [
								{
									question: "原生问题",
									header: "other",
									options: [
										{ label: "a", description: "" },
										{ label: "b", description: "" },
									],
								},
							],
					tool:
						rand() < 0.8 && anchor !== undefined
							? rand() < 0.5
								? { callID: anchor.callID }
								: { messageID: anchor.messageID }
							: undefined,
				};
			}

			const incremental = resolveAskAnchors(
				messages,
				pendingByRequest as unknown as Record<string, Parameters<typeof resolveAskAnchors>[1][string]>,
			);
			const naive = naiveResolveAskAnchors(messages, pendingByRequest);
			expect(incremental).toEqual(naive);
		}
	});
});
