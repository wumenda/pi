import { useAppStore } from "../../stores/app-store";

/**
 * T9 长任务健康：进度"健康"窗口——窗口内有新 tool.progress 事件即视为长任务仍在推进，
 * 供 useStuckToolGuard 决定"持续 progress 不 abort"，避免误杀长耗时 MCP 工具。
 */
export const HEALTHY_PROGRESS_WINDOW_MS = 60_000;

/** 纯函数：progress 事件时间是否落在健康窗口内（测试友好）。null（从未有 progress）→ 不健康 */
export function isProgressFresh(
	lastProgressAt: number | null,
	now: number,
	windowMs = HEALTHY_PROGRESS_WINDOW_MS,
): boolean {
	return lastProgressAt !== null && now - lastProgressAt <= windowMs;
}

/**
 * useToolHealth（T9 长任务健康）：
 * 读取事件侧信号——最近一次 tool.progress 事件时间（useSessionEvents 经 store 记账），
 * 并折算为"会话是否仍在持续推进"（active）。服务端运行态由守卫在决策时查询（见 useStuckToolGuard）。
 */
export function useToolHealth(sessionId: string | null): {
	recentProgressAt: number | null;
	active: boolean;
} {
	const recentProgressAt = useAppStore((s) => (sessionId ? (s.toolProgressAt[sessionId] ?? null) : null));
	return { recentProgressAt, active: isProgressFresh(recentProgressAt, Date.now()) };
}
