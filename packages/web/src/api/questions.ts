/**
 * 问答 API 适配层：opencode question reply → pi agent-controller.answerAskUser。
 * - requestID 即 pi 的 ask_user toolCallId；
 * - answers（string[][]，单题 JSON 字符串承载）→ 解析为结构化 answers
 *   （{ [pageId]: { [fieldId]: value | value[] } }）后交给 pi 解除挂起。
 */

import { usePiStore } from "../pi/pi-app";

/** 提交互卡答案（解析 JSON 承载的结构化作答 → answerAskUser） */
export async function replyQuestion(
	_sessionId: string,
	requestID: string,
	answers: string[][],
	_directory?: string,
): Promise<void> {
	void _directory;
	const payload = answers[0]?.[0];
	let parsed: unknown = {};
	if (typeof payload === "string" && payload.length > 0) {
		try {
			parsed = JSON.parse(payload);
		} catch {
			parsed = {};
		}
	}
	await usePiStore
		.getState()
		.answerAskUser(
			requestID,
			(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {}) as Record<
				string,
				never
			>,
		);
}

/** 取消挂起问题：pi agent-controller 无 reject 语义（answerAskUser 才能解除挂起），no-op */
export async function rejectQuestion(_sessionId: string, _requestID: string, _directory?: string): Promise<void> {
	void _sessionId;
	void _requestID;
	void _directory;
}
