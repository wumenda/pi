/**
 * 会话事件订阅（pi 适配版）：
 * 数据源 = pi transcript（chord replicated state，全量快照 + 事件）。
 * 每次快照变化经 projectTranscript 投影为 MessageDTO[] 写入 React Query 缓存
 * （MessageList / iframe 管线 / skill 加载共享同一缓存）；
 * operation 起止驱动"AI 正在处理"状态与左栏摘要（对应原 SSE 的 session.idle/error）。
 * pi 无子会话聚合（parentSessionID）与独立权限审批面，相应分支移除。
 */

import type { MessageDTO } from "@platform/shared";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { useEffect } from "react";
import { messageSummary } from "../../api/events";
import { isSessionRunning, projectTranscript } from "../../api/transcript";
import { i18n } from "../../i18n";
import { usePiStore } from "../../pi/pi-app";
import { useAppStore } from "../../stores/app-store";

/**
 * 上下文溢出错误识别（provider 文案各异，覆盖 OpenAI/Anthropic/Google 及通用变体）。
 * 命中时 toast 不展示原始 provider 报错，而是给出可行动引导（精简对话/新开会话）——
 * 该类错误重发必然复现，必须引导用户换路径而非原样重试。
 */
const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
	/context[_ ]?length/i,
	/context window/i,
	/prompt is too long/i,
	/maximum context/i,
	/too many (input )?tokens/i,
	/token limit/i,
	/exceeds?[^.\n]*(context|token)/i,
	/(context|token)[^.\n]*(exceed|too long)/i,
];

export function isContextOverflowError(text: string): boolean {
	return CONTEXT_OVERFLOW_PATTERNS.some((p) => p.test(text));
}

/** 订阅当前会话的 pi transcript 流，驱动消息缓存与运行状态记账 */
export function useSessionEvents(sessionId: string | null): void {
	const queryClient = useQueryClient();
	const { message } = AntdApp.useApp();
	const setStreamingSession = useAppStore((s) => s.setStreamingSession);
	const setSessionSummary = useAppStore((s) => s.setSessionSummary);
	const setSseState = useAppStore((s) => s.setSseState);
	const recordToolProgress = useAppStore((s) => s.recordToolProgress);
	const markSessionTerminal = useAppStore((s) => s.markSessionTerminal);
	const upsertPendingQuestion = useAppStore((s) => s.upsertPendingQuestion);
	const clearPendingQuestion = useAppStore((s) => s.clearPendingQuestion);

	useEffect(() => {
		if (!sessionId) return;
		let cancelled = false;
		let prevOperationId: string | null = null;
		let prevTranscript: unknown;
		let prevPhase: string | undefined;
		let prevConnectionState: string | undefined;
		let prevPromptError: string | undefined;

		const syncConnectionState = (state: ReturnType<typeof usePiStore.getState>): void => {
			if (state.phase === prevPhase && state.connectionState === prevConnectionState) return;
			prevPhase = state.phase;
			prevConnectionState = state.connectionState;
			// pi 连接即"AI 在线"（chord replicated state 实时推送，无轮询重连态）
			setSseState(
				state.phase !== "ready" || state.connectionState !== "connected"
					? state.connectionState === "connecting"
						? "connecting"
						: "closed"
					: "open",
			);
		};

		const applyProjection = (state: ReturnType<typeof usePiStore.getState>): void => {
			if (cancelled || state.transcript === prevTranscript) return;
			prevTranscript = state.transcript;
			// 仅当 pi 当前 attach 的会话就是本 hook 的会话时写入缓存（切换会话防串）
			if (state.activeSessionId !== sessionId) return;
			const projection = projectTranscript(state.transcript?.snapshot ?? null);
			queryClient.setQueryData<MessageDTO[]>(["messages", sessionId], projection.messages);
			// ask_user 挂起槽位同步（MessageList 锚点绑定的数据源）：
			// 挂起 → 置入（占位 questions 形状标识 ask 流；tool 字段精确绑定到 part）；
			// 结果到达（挂起消失）→ 按 requestID 清除。requestID = ask_user toolCallId。
			const known = useAppStore.getState().pendingQuestions;
			const activeIds = new Set(projection.pendingAskUser.map((p) => p.toolCallId));
			for (const call of projection.pendingAskUser) {
				if (known[call.toolCallId] !== undefined) continue;
				upsertPendingQuestion({
					requestID: call.toolCallId,
					questions: [
						{
							question: "等待用户作答",
							header: "ask_user",
							options: [{ label: "等待用户作答", description: "" }],
						},
					],
					tool: { messageID: call.messageID, callID: call.toolCallId },
				});
			}
			for (const requestID of Object.keys(known)) {
				if (!activeIds.has(requestID)) clearPendingQuestion(requestID);
			}
			// 进度记账（T9 长任务健康信号）：tool_update 事件到达即视为会话仍在推进
			if (state.transcript?.event?.type === "tool_update") recordToolProgress(sessionId);
			// operation 起止 → streaming 状态（对应原 SSE session.idle/error 终态）
			const operationId = state.transcript?.snapshot?.operation?.id ?? null;
			if (prevOperationId !== null && operationId === null) {
				markSessionTerminal(sessionId);
				setStreamingSession(null);
				// 回复结束后更新左栏摘要（取最后一条 assistant 文本）
				const messages = queryClient.getQueryData<MessageDTO[]>(["messages", sessionId]);
				const lastAssistant = [...(messages ?? [])].reverse().find((m) => m.role === "assistant");
				const summary = lastAssistant !== undefined ? messageSummary(lastAssistant) : undefined;
				if (summary !== undefined) setSessionSummary(sessionId, summary);
			} else if (prevOperationId === null && operationId !== null) {
				setStreamingSession(sessionId);
			}
			prevOperationId = operationId;
		};

		// 挂载即同步一次（快照已到达时恢复历史消息与运行中状态；
		// 若尚未 attach，fetchMessages 的 queryFn 会 attach，快照到达后本订阅再投影）
		const initial = usePiStore.getState();
		prevTranscript = initial.transcript;
		prevPhase = initial.phase;
		prevConnectionState = initial.connectionState;
		syncConnectionState(initial);
		applyProjection(initial);

		const unsubscribe = usePiStore.subscribe((state) => {
			syncConnectionState(state);
			applyProjection(state);
			// 溢出错误引导：pi prompt rejected 文案命中溢出特征时替换为可行动引导
			if (state.promptError !== undefined && state.promptError !== prevPromptError) {
				prevPromptError = state.promptError;
				if (isContextOverflowError(state.promptError)) {
					message.error(i18n.t("chat.contextOverflowHint"));
				}
			}
		});

		return () => {
			cancelled = true;
			unsubscribe();
			setSseState(null);
		};
	}, [
		sessionId,
		queryClient,
		setStreamingSession,
		setSessionSummary,
		setSseState,
		recordToolProgress,
		markSessionTerminal,
		upsertPendingQuestion,
		clearPendingQuestion,
		message,
	]);
}

// isSessionRunning 保留导出：会话工作台状态恢复（刷新后"运行中/停止"识别）复用
export { isSessionRunning };
