/**
 * 消息 API 适配层：pi transcript（chord replicated state）投影。
 * - fetchMessages：幂等 attach 后读 transcript 快照，经 projectTranscript 投影为 MessageDTO[]
 *   （attach 是会话级服务绑定前置，重复 attach 安全）；
 * - sendPrompt：agent-controller.prompt（异步受理，accepted=false 抛错）；
 * - abortSession：按当前 operation 调 requestAbort。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MessageDTO } from "@platform/shared";
import { requirePiServices, usePiStore } from "../pi/pi-app";
import { projectTranscript } from "./transcript";

/** 历史消息（transcript 快照投影；未 attach 时先 attach 保证服务绑定） */
export async function fetchMessages(sessionId: string, _directory?: string): Promise<MessageDTO[]> {
	void _directory;
	const services = requirePiServices();
	const { activeSessionId } = usePiStore.getState();
	if (activeSessionId !== sessionId) {
		await services.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
		usePiStore.setState({ activeSessionId: sessionId, transcript: undefined });
	}
	const snapshot = services.transcript.state.value?.snapshot ?? null;
	return projectTranscript(snapshot).messages;
}

/** 发送偏好（pi 侧仅消费文本；agent/model/reasoning 由 pi 配置决定） */
export interface PromptPrefsPayload {
	agent?: string;
	model?: string;
	reasoning?: string;
}

/** 发送消息（异步受理；拒绝时抛错供 ChatInput 展示） */
export async function sendPrompt(
	sessionId: string,
	text: string,
	_prefs?: PromptPrefsPayload,
	_directory?: string,
): Promise<{ accepted: boolean; sessionID: string }> {
	void _prefs;
	void _directory;
	const services = requirePiServices();
	const { activeSessionId } = usePiStore.getState();
	if (activeSessionId !== sessionId) {
		await services.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
		usePiStore.setState({ activeSessionId: sessionId, transcript: undefined });
	}
	const response = await services.agentController.prompt({ message: text, images: null }, BACKGROUND_CONTEXT);
	if (!response.accepted) {
		throw new Error(response.error.message);
	}
	return { accepted: true, sessionID: sessionId };
}

/** 中断执行（无运行中 operation 时为 no-op） */
export async function abortSession(sessionId: string, _directory?: string): Promise<{ aborted: boolean }> {
	void _directory;
	const services = requirePiServices();
	const { activeSessionId } = usePiStore.getState();
	if (activeSessionId !== sessionId) return { aborted: false };
	const operationId = services.transcript.state.value?.snapshot?.operation?.id;
	if (operationId === undefined) return { aborted: false };
	await services.agentController.requestAbort(operationId, BACKGROUND_CONTEXT);
	return { aborted: true };
}
