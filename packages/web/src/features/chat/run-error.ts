/**
 * 运行失败状态（输入区上方红色 pill 数据源）：
 * 数据源 = transcript 快照的 lastResult——服务端 reducer 在 run_end 时写入
 * （failed 携带 error{code,message}），随初始快照与增量 ops 同步，刷新后可恢复。
 * 此前运行失败在 UI 上没有任何反馈（用户表现为"发送消息没反应"），本模块提供派生。
 * 独立纯函数模块：无组件/store 副作用（可单测）。
 */

/** 运行结果最小视图（wire JSON；仅消费 run 失败态所需字段） */
export interface RunResultView {
	readonly kind?: unknown;
	readonly status?: unknown;
	readonly error?: { readonly message?: unknown } | undefined;
}

export interface RunErrorSnapshotView {
	/** 运行中 operation 非空（此时不展示上一次失败） */
	readonly operation?: unknown;
	readonly lastResult?: RunResultView | undefined;
}

export interface RunErrorTranscriptView {
	readonly snapshot?: RunErrorSnapshotView | null;
}

/**
 * 最近的 run 失败原因：
 * - 无失败 / 运行中 / aborted（用户主动停止）/ completed 返回 null；
 * - run failed 返回错误文案（wire 缺失 message 时为空串，由组件渲染通用文案）。
 */
export function runFailureMessage(transcript: RunErrorTranscriptView | undefined): string | null {
	const snapshot = transcript?.snapshot;
	if (snapshot === undefined || snapshot === null) return null;
	if (snapshot.operation !== null && snapshot.operation !== undefined) return null;
	const result = snapshot.lastResult;
	if (result === undefined || result.kind !== "run" || result.status !== "failed") return null;
	return typeof result.error?.message === "string" ? result.error.message.trim() : "";
}
