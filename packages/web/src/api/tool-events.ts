/**
 * tool 执行事件恢复适配层：pi.tool-events chord 服务（持久化 jsonl 记录）
 * → 前端 ToolExecution 投影（SessionActivityCard / iframe 管线恢复语义）。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionEvent as PiToolExecutionEvent } from "../pi/contracts";
import { requirePiServices } from "../pi/pi-app";
import type { ToolExecution } from "../types";

/** pi ToolExecutionEvent → ToolExecution 投影（input/progress/result 事件合并视图） */
function toExecution(sessionId: string, event: PiToolExecutionEvent): ToolExecution {
	return {
		id: event.toolCallId,
		sessionId,
		toolName: event.toolName ?? "tool",
		...(event.resourceUri?.startsWith("ui://") === true ? { resourceUri: event.resourceUri } : {}),
		// 单事件无终态语义：input/progress → running，result → success/failure
		status: event.kind === "result" ? (event.isError ? "failure" : "success") : "running",
		...(event.args !== null && Object.keys(event.args as object).length > 0
			? { inputSummary: JSON.stringify(event.args).slice(0, 120) }
			: {}),
		...(event.message !== null ? { resultSummary: event.message.slice(0, 120) } : {}),
		startedAt: new Date(event.timestamp).toISOString(),
		...(event.kind === "result" ? { endedAt: new Date(event.timestamp).toISOString() } : {}),
		...(event.kind === "progress" && event.progress !== null
			? {
					progress: {
						progress: event.progress,
						...(event.total !== null ? { total: event.total } : {}),
						...(event.message !== null ? { message: event.message } : {}),
					},
				}
			: {}),
	};
}

/** tool 执行事件恢复（pi.tool-events 持久化记录投影） */
export async function fetchToolEvents(sessionId: string): Promise<ToolExecution[]> {
	const services = requirePiServices();
	const events = await services.toolEvents.events(BACKGROUND_CONTEXT);
	// 同一执行的 input/progress/result 事件合并为一条记录（后者补前者）
	const merged = new Map<string, ToolExecution>();
	for (const event of events) {
		merged.set(event.toolCallId, {
			...(merged.get(event.toolCallId) ?? toExecution(sessionId, event)),
			...toExecution(sessionId, event),
		});
	}
	return [...merged.values()];
}

/**
 * 把持久化记录合并进内存执行列表（刷新/切会话后的恢复语义）：
 * - 内存缺失的记录直接追加（历史恢复）；
 * - 同 id 记录字段级补缺（progress/summary/endedAt），内存已有值以实时为准不覆盖。
 */
export function mergePersistedExecutions(current: ToolExecution[], persisted: ToolExecution[]): ToolExecution[] {
	if (persisted.length === 0) return current;
	const byId = new Map(current.map((exec) => [exec.id, exec]));
	const appended: ToolExecution[] = [];

	for (const record of persisted) {
		const existing = byId.get(record.id);
		if (existing === undefined) {
			appended.push(record);
			continue;
		}
		byId.set(record.id, {
			...existing,
			...(existing.progress === undefined && record.progress !== undefined ? { progress: record.progress } : {}),
			...(existing.inputSummary === undefined && record.inputSummary !== undefined
				? { inputSummary: record.inputSummary }
				: {}),
			...(existing.resultSummary === undefined && record.resultSummary !== undefined
				? { resultSummary: record.resultSummary }
				: {}),
			...(existing.endedAt === undefined && record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
		});
	}

	return [...byId.values(), ...appended];
}
