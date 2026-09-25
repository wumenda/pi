import { useAppStore } from "../stores/app-store";

/**
 * 测试样板：重置会话态，beforeEach 统一入口。
 * setCurrentSession 内部第一步即 destroyAllIframes（含 DOM 销毁 + messageBridge 解绑），
 * 并复位 streamingSessionId/sessionTerminalAt/skills/pendingQuestions 等全部会话态，
 * 故无需再成对调用 destroyAllIframes（那是冗余双清）。
 */
export function resetChatState(): void {
	useAppStore.getState().setCurrentSession(null);
}
