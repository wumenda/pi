/**
 * 会话 API 适配层：pi session-directory / session-management（chord 服务）。
 * SessionDTO 投影：pi SessionSummary 只有 serverId/sessionId/createdAt，
 * title 取会话 id 前缀、directory 恒为 "/"（项目中心按目录分组语义保留）。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { SessionDTO } from "@platform/shared";
import { requirePiServices, usePiStore } from "../pi/pi-app";

/** pi 会话 id → 展示标题（pi 无 title 存储，取 id 前 8 位） */
export function sessionTitleOf(sessionId: string): string {
	return sessionId.slice(0, 8);
}

function toSessionDTO(sessionId: string, createdAt: number): SessionDTO {
	const createdAtIso = new Date(createdAt).toISOString();
	return {
		id: sessionId,
		title: sessionTitleOf(sessionId),
		directory: "/",
		createdAt: createdAtIso,
		updatedAt: createdAtIso,
	};
}

/** 会话清单（session-directory replicated state 快照） */
export async function fetchSessions(): Promise<SessionDTO[]> {
	const services = requirePiServices();
	const value = services.sessionDirectory.state.value;
	const sessions = value?.sessions ?? [];
	return sessions.map((s) => toSessionDTO(s.sessionId, s.createdAt));
}

/** 创建会话并 attach（pi 强制 attach 后才能取 transcript / 发送） */
export async function createSession(title?: string, _directory?: string): Promise<SessionDTO> {
	void title;
	void _directory;
	const sessionId = await usePiStore.getState().createSession();
	const services = requirePiServices();
	const summary = services.sessionDirectory.state.value?.sessions.find((s) => s.sessionId === sessionId);
	return toSessionDTO(sessionId, summary?.createdAt ?? Date.now());
}

/** 重命名：pi 无 title 存储，返回原 DTO（no-op） */
export async function renameSession(id: string, _title: string, _directory?: string): Promise<SessionDTO> {
	void _title;
	void _directory;
	const services = requirePiServices();
	const summary = services.sessionDirectory.state.value?.sessions.find((s) => s.sessionId === id);
	return toSessionDTO(id, summary?.createdAt ?? Date.now());
}

/** 删除会话（session-management.remove；当前会话被删时 detach） */
export async function deleteSession(id: string, _directory?: string): Promise<{ deleted: boolean }> {
	void _directory;
	const services = requirePiServices();
	await services.sessionManagement.remove(id, BACKGROUND_CONTEXT);
	const { activeSessionId, detach } = usePiStore.getState();
	if (activeSessionId === id) await detach();
	return { deleted: true };
}

/** 会话是否运行中（transcript 快照的 operation 存在即运行） */
export async function fetchSessionStatus(sessionId: string): Promise<{ running: boolean }> {
	const services = requirePiServices();
	const attached = usePiStore.getState().activeSessionId;
	if (attached !== sessionId) return { running: false };
	const snapshot = services.transcript.state.value?.snapshot;
	return { running: snapshot?.operation !== undefined && snapshot.operation !== null };
}
