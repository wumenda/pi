/**
 * ask_user / question 挂起请求的消息流锚点解析（T9：request-scoped，多请求不串）。
 *
 * 独立于 MessageList 组件：纯函数 + 引用缓存，无 store 副作用（可单测）。
 *
 * 游标化（T2.8-4）：候选收集按消息引用缓存（投影记忆化保证未变消息引用稳定），
 * 每次投递只重扫引用变化的消息，拼接成本降为 O(候选数)。
 */

import type { MessageDTO } from "@platform/shared";
import { isToolPart, type ToolPartLike } from "../../api/events";
import type { PendingQuestion } from "../../types";
import { isAskUserTool, isPlaceholderQuestions, QUESTION_TOOL_NAME } from "./cards/answers";

/** 一个挂起请求在消息流中的锚点（part → requestID 的确定性绑定，T9） */
export interface AskAnchor {
	partId: string;
	requestID: string;
	/** 锚定的卡片类型：ask_user 占位流（AskUserCard/Retry）或原生 question 流（QuestionCard） */
	kind: "ask" | "question";
}

interface AnchorCandidate {
	part: ToolPartLike;
	kind: AskAnchor["kind"];
}

/** 每消息候选缓存（消息内容不可变 → 引用稳定即候选不变） */
const anchorCandidatesCache = new WeakMap<object, AnchorCandidate[]>();

function anchorCandidatesOf(message: MessageDTO): AnchorCandidate[] {
	const cached = anchorCandidatesCache.get(message);
	if (cached !== undefined) return cached;
	const out: AnchorCandidate[] = [];
	for (let pi = message.parts.length - 1; pi >= 0; pi--) {
		const part = message.parts[pi]!;
		if (!isToolPart(part)) continue;
		const toolPart = part as ToolPartLike;
		if (isAskUserTool(toolPart.tool)) {
			out.push({ part: toolPart, kind: "ask" });
		} else if (toolPart.tool === QUESTION_TOOL_NAME && toolPart.state.status === "running") {
			out.push({ part: toolPart, kind: "question" });
		}
	}
	anchorCandidatesCache.set(message, out);
	return out;
}

/**
 * 解析各挂起请求（requestID）应锚定的交互卡片 part：
 * - 每个 pending 独立成锚点——同会话并发多个 ask_user/question 互不串扰；
 * - 按确定性优先级绑定（阻止同消息多 part 时 messageID 弱匹配造成错绑）：
 *     ① callID 精确命中（发起调用的那个 part）；
 *     ② messageID 精确且候选唯一；
 *     ③ 回退最近未认领同类 part（keep MVP 串行兼容，缺 tool 字段时仍能弹卡）。
 * - ask_user 占位流只认 ask part；原生 question 流只认 running question part。
 */
export function resolveAskAnchors(
	messages: MessageDTO[],
	pendingByRequest: Record<string, PendingQuestion>,
): AskAnchor[] {
	const anchors: AskAnchor[] = [];
	const claimed = new Set<string>();

	// 倒序收集候选 part（"最近优先"用于回退；消息倒序 × 消息内倒序 = 全量扫描同序）
	const candidates: AnchorCandidate[] = [];
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		for (const candidate of anchorCandidatesOf(messages[mi]!)) candidates.push(candidate);
	}

	const callIDOf = (p: ToolPartLike): unknown => (p as ToolPartLike & { callID?: unknown }).callID;
	const messageIDOf = (p: ToolPartLike): unknown => (p as ToolPartLike & { messageID?: unknown }).messageID;

	for (const q of Object.values(pendingByRequest)) {
		const kind: AskAnchor["kind"] = isPlaceholderQuestions(q.questions) ? "ask" : "question";
		const free = candidates.filter((c) => c.kind === kind && !claimed.has(c.part.id));

		let hit: AnchorCandidate | undefined;
		// ① callID 精确
		if (q.tool?.callID !== undefined) {
			hit = free.find((c) => callIDOf(c.part) === q.tool?.callID);
		}
		// ② messageID 精确（候选唯一时才用；多候选时保持候选序 = 最近未认领，串行兼容）
		if (hit === undefined && q.tool?.messageID !== undefined) {
			const byMsg = free.filter((c) => messageIDOf(c.part) === q.tool?.messageID);
			if (byMsg.length > 0) hit = byMsg[0];
		}
		// ③ 回退最近未认领同类 part（缺 tool 字段的兼容路径）
		if (hit === undefined) hit = free[0];

		if (hit !== undefined) {
			anchors.push({ partId: hit.part.id, requestID: q.requestID, kind });
			claimed.add(hit.part.id);
		}
	}
	return anchors;
}
