/**
 * MCP Apps progress 消费纯逻辑（Task 12）：
 * pi 侧 MCP 工具桥把 `notifications/progress` 归一化进 tool_update 事件的
 * `details.progress`，宿主工作区据此向 iframe 投递 `notifications/progress`。
 * 本模块只做三件事：事件映射（details → 载荷）、指纹去重（同页面生命周期内
 * 同一 (toolCallId, 指纹) 只投递一次）、监听器注册表（pi-app → 工作区解耦）。
 */

/** 单条 progress 推进载荷（pi 侧 McpProgressPayload 的宿主镜像） */
export interface ProgressPayload {
	progress: number;
	total: number | null;
	message: string | null;
	uiEvent: unknown;
}

/** tool_update 携带的 UI 归属信息（首次 progress 到达时用于引导创建执行 iframe） */
export interface LiveToolFrame {
	resourceUri: string;
	serverId: string;
	/** harness 工具名（`mcp__<serverId>__<name>`，工作区负责还原原始名） */
	toolName: string;
}

/** tool_update progress 转发监听器（pi-app transcript 订阅 → 工作区投递）；
 * frame 仅在 tool_update 的 details.mcpUi 存在时携带，用于运行中 iframe 引导 */
export type ToolProgressListener = (toolCallId: string, payload: ProgressPayload, frame?: LiveToolFrame) => void;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * 从 tool_update 事件的 `partialResult.details` 提取 progress 载荷。
 * details 形状 `{mcpUi?, progress?: {progress, total, message, uiEvent}}`；
 * 非 progress 更新（无 progress 字段或 progress 非数值）返回 null。
 */
export function extractProgressPayload(details: unknown): ProgressPayload | null {
	const progress = asRecord(asRecord(details)?.progress);
	const value = progress?.progress;
	if (progress === undefined || typeof value !== "number") return null;
	return {
		progress: value,
		total: typeof progress.total === "number" ? progress.total : null,
		message: typeof progress.message === "string" ? progress.message : null,
		uiEvent: progress.uiEvent ?? null,
	};
}

/** 指纹 = 载荷的稳定 JSON 序列（uiEvent 参与指纹：同值不同事件的扫描增量不可互相吞并） */
export function progressFingerprint(payload: ProgressPayload): string {
	return JSON.stringify([payload.progress, payload.total, payload.message, payload.uiEvent ?? null]);
}

/**
 * 按 toolCallId 记忆已投递指纹；同指纹重复推送（实时重发/重扫/恢复重放）不重复投递。
 * 纯函数：调用方持有 seen 记忆并控制其生命周期（会话切换清空，页面刷新自然重置）。
 */
export function shouldDeliverProgress(
	seen: Map<string, Set<string>>,
	toolCallId: string,
	payload: ProgressPayload,
): boolean {
	const fingerprints = seen.get(toolCallId) ?? new Set<string>();
	const fingerprint = progressFingerprint(payload);
	if (fingerprints.has(fingerprint)) return false;
	fingerprints.add(fingerprint);
	seen.set(toolCallId, fingerprints);
	return true;
}

/** ensureToolIframe 的调用到达形态（isNew = 本次 acquire 新建了实例；alreadyBound = 执行此前已绑定实例） */
export type ReplayDecision = {
	alreadyBound: boolean;
	isNew: boolean;
	status: "pending" | "running" | "completed" | "error";
};

/**
 * 终态调用是否补推已落盘 progress（冷启动/恢复）：
 * - 新建实例（冷启动）或复用已有实例且执行未绑定（重进会话的中间调用恢复）→ 补推，
 *   否则多调用共享实例（如增量 Tab UI）恢复后只有首个调用的进度可见；
 * - 执行已绑定（同页面实时 running→completed）→ 不补推：progress 已实时投递，
 *   补推只会被指纹去重空转一次 RPC。
 */
export function shouldReplayProgress(alreadyBound: boolean, isNew: boolean, status: ReplayDecision["status"]): boolean {
	return (status === "completed" || status === "error") && (isNew || !alreadyBound);
}

const listeners = new Set<ToolProgressListener>();

/** 注册 progress 转发监听器（pi-app transcript 订阅回调调用 emitToolProgress 投递） */
export function registerToolProgressListener(listener: ToolProgressListener): void {
	listeners.add(listener);
}

/** 反注册 progress 转发监听器 */
export function unregisterToolProgressListener(listener: ToolProgressListener): void {
	listeners.delete(listener);
}

/** 从 tool_update 事件的 `partialResult.details` 提取运行中 UI 引导信息（details.mcpUi）。 */
export function extractLiveToolFrame(details: unknown, toolName: string): LiveToolFrame | undefined {
	const mcpUi = asRecord(asRecord(details)?.mcpUi);
	const resourceUri = mcpUi?.resourceUri;
	const serverId = mcpUi?.serverId;
	if (typeof resourceUri !== "string" || !resourceUri.startsWith("ui://")) return undefined;
	if (typeof serverId !== "string" || serverId.length === 0) return undefined;
	return { resourceUri, serverId, toolName };
}

/** 转发一条 progress 到全部监听器（无监听器时丢弃——宿主工作区未挂载） */
export function emitToolProgress(toolCallId: string, payload: ProgressPayload, frame?: LiveToolFrame): void {
	for (const listener of listeners) listener(toolCallId, payload, frame);
}

/** 页面生命周期内的去重记忆：toolCallId → 已投递指纹集（会话切换清空） */
export const seenProgress = new Map<string, Set<string>>();

/** 清空去重记忆（会话切换时调用；与监听器反注册同点执行） */
export function clearSeenProgress(): void {
	seenProgress.clear();
}
