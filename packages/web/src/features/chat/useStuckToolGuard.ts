import type { MessageDTO } from "@platform/shared";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { useEffect } from "react";
import { isToolPart } from "../../api/events";
import { abortSession, fetchMessages } from "../../api/messages";
import { fetchSessionStatus } from "../../api/sessions";
import { sessionDirectoryOf, useAppStore } from "../../stores/app-store";
import { isProgressFresh } from "./useToolHealth";

/**
 * 挂起判定阈值（ms）：running tool part 超过该时长仍无 output/progress 才判为"疑似挂起"。
 * 默认 10 分钟——长耗时合法工具靠 progress 门禁豁免、交互卡片靠 ask_user_question 豁免；
 * 自动中止另需 VITE_AUTO_ABORT_STUCK=true（默认关闭），故默认阈值只激活"复核刷新"，不误杀。
 * 可通过 apps/web/.env 的 VITE_STUCK_MS 配置覆盖。
 * 设计为函数以便测试用 vi.stubEnv 动态控制。
 */
export const DEFAULT_STUCK_MS = 600_000;

/** 疑似挂起阈值（ToolCard running 态提示复用同一阈值） */
export function getStuckMs(): number {
	const raw = import.meta.env.VITE_STUCK_MS;
	const n = raw !== undefined && raw !== "" ? Number(raw) : NaN;
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_STUCK_MS;
}

/**
 * 自动中止开关（T9：默认关闭）。只有显式配置 VITE_AUTO_ABORT_STUCK=true 时，
 * 挂起工具才允许被自动中止——并且仍需服务端确认 execution 丢失（见 useStuckToolGuard）。
 */
function getAutoAbortStuck(): boolean {
	return import.meta.env.VITE_AUTO_ABORT_STUCK === "true";
}
/** 兜底轮询周期（ms） */
const STUCK_CHECK_INTERVAL_MS = 15_000;

/** 消息中是否存在"疑似挂起"的 running tool part（无 output、消息未完成、超时） */
function hasStuckToolPart(message: MessageDTO, now: number, stuckMs = getStuckMs()): boolean {
	if (message.completedAt) return false;
	if (now - new Date(message.createdAt).getTime() < stuckMs) return false;
	return message.parts.some(
		(p) =>
			isToolPart(p) &&
			p.state.status === "running" &&
			p.state.output === undefined &&
			// 交互型工具（ask_user_question 等待用户作答）不算挂起：超时不代表异常
			!isQuestionTool(p) &&
			// 持续上报 progress 的工具仍在推进（长耗时合法工具，如 callToolTimeout=1h 的 MCP），
			// 不是挂起——不能按固定 60s 误中止
			!hasToolProgress(p),
	);
}

/** ask_user_question 这类交互工具（等待用户作答，长时间无 output 是正常的） */
function isQuestionTool(p: { tool?: string }): boolean {
	return typeof p.tool === "string" && p.tool.includes("ask_user_question");
}

/** running tool part 是否在上报 progress（有推进迹象 → 非挂起） */
function hasToolProgress(p: { state?: { metadata?: { progress?: unknown } } }): boolean {
	return p.state?.metadata?.progress !== undefined;
}

/**
 * 挂起工具兜底（fix-stuck-tool-permission.md 修复 3 + T9 长任务健康）：
 * 周期性扫描当前会话消息，若存在长时间未结束的 running tool part（如被权限挂起的 read，
 * 且 permission.asked 事件因 SSE 断线丢失、无审批卡片可点），主动：
 *   1) 刷新消息缓存（opencode 侧真实状态）；
 *   2) 复核仍卡且无 pendingPermission/问答卡片 → 才考虑中止。
 *
 * T9（长任务健康）收紧自动中止：
 * - 自动中止默认关闭（VITE_AUTO_ABORT_STUCK=true 才开启）；
 * - 持续上报 progress 的工具（useToolHealth：近期有 tool.progress 事件）绝不中止；
 * - 中止前向服务端确认：仅当 /sessions/:id/status 返回 running=false（session 已停、
 *   execution 丢失）才允许；running=true（仍在生成）或状态查询失败一律放行（fail-closed）。
 */
export function useStuckToolGuard(sessionId: string | null): void {
	const queryClient = useQueryClient();
	const { message } = AntdApp.useApp();

	useEffect(() => {
		if (!sessionId) return;
		const timer = window.setInterval(() => {
			const messages = queryClient.getQueryData<MessageDTO[]>(["messages", sessionId]) ?? [];
			const now = Date.now();
			const stuck = messages.some((m) => hasStuckToolPart(m, now));
			if (!stuck) return;
			// 1) 刷新缓存（opencode 侧真实 part 状态）
			void queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
			// 2) 拉最新消息复核 + 无审批卡片/问答卡片才继续
			void fetchMessages(sessionId, sessionDirectoryOf(sessionId))
				.then((latest) => {
					const stillStuck = latest.some((m) => hasStuckToolPart(m, Date.now()));
					const pending = useAppStore.getState().pendingPermission;
					// 问答卡片（ask_user_question）与权限审批一样属于"在等用户"，不算挂起，
					// 不能因用户思考时间超过 STUCK_MS 就误中止导致 "Tool execution aborted"。
					// T9：pendingQuestions 为 request-scoped 多槽（任一存在即视为在等用户）
					const hasPendingQuestion = Object.keys(useAppStore.getState().pendingQuestions).length > 0;
					if (!stillStuck || pending !== null || hasPendingQuestion) return;
					// 自动中止默认关闭（T9）：仅显式开启时才会真正中止
					if (!getAutoAbortStuck()) return;
					// 持续 progress 的长任务视为健康，绝不中止（T9：持续 progress 不 abort）
					const recentProgressAt = useAppStore.getState().toolProgressAt[sessionId] ?? null;
					if (isProgressFresh(recentProgressAt, Date.now())) return;
					// 服务端确认 execution 丢失（session 已停）才中止；running=true / 查询失败 → 放行
					void fetchSessionStatus(sessionId)
						.then(({ running }) => {
							if (running) return;
							void abortSession(sessionId, sessionDirectoryOf(sessionId)).catch(() => undefined);
							message.warning("检测到工具执行异常（可能为未审批的权限请求），已自动中止，请重试或重新发起");
						})
						.catch(() => undefined);
				})
				.catch(() => undefined);
		}, STUCK_CHECK_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [sessionId, queryClient, message]);
}
