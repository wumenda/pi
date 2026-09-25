/**
 * MessageDTO part 工具（渲染与管线共用纯函数）：
 * ToolPart 状态守卫、MCP Apps 绑定提取（_meta.ui）、进度提取、tool 执行记录映射。
 * 事件传输层由 pi transcript 订阅（features/chat/useSessionEvents）承担。
 */

import type { MessageDTO } from "@platform/shared";
import type { ToolExecution } from "../types";

// ---- ToolPart 状态与 toolExecutions 的映射 ----

export interface ToolPartLike {
	id: string;
	type: "tool";
	tool: string;
	/** 顶层 metadata（插件 tool.execute.after 透传落点之一） */
	metadata?: Record<string, unknown>;
	state: {
		status: "pending" | "running" | "completed" | "error";
		input?: Record<string, unknown>;
		output?: string;
		metadata?: Record<string, unknown>;
		/** running 态耗时显示用（ms） */
		time?: { start?: number };
	};
}

export function isToolPart(part: unknown): part is ToolPartLike {
	return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "tool";
}

/**
 * 提取 MCP Apps 绑定：ToolPart 结果/元数据中的 _meta.ui.resourceUri（ui:// 前缀）。
 * 兼容两种承载位置（按优先级）：
 * 1. part.state.metadata._meta.ui.resourceUri（pi 转译层注入 / opencode 写 state.metadata）；
 * 2. part.metadata._meta.ui.resourceUri（插件 tool.execute.after 透传落点）。
 */
export function extractResourceUri(part: ToolPartLike): string | undefined {
	const stateMeta = part.state.metadata as
		| { ui?: { resourceUri?: unknown }; _meta?: { ui?: { resourceUri?: unknown } } }
		| undefined;
	const partMeta = part.metadata as
		| { ui?: { resourceUri?: unknown }; _meta?: { ui?: { resourceUri?: unknown } } }
		| undefined;
	const fromStateUi = stateMeta?.ui?.resourceUri;
	const fromStateMeta = stateMeta?._meta?.ui?.resourceUri;
	const fromPartUi = partMeta?.ui?.resourceUri;
	const fromPartMeta = partMeta?._meta?.ui?.resourceUri;
	const uri =
		typeof fromStateUi === "string"
			? fromStateUi
			: typeof fromStateMeta === "string"
				? fromStateMeta
				: typeof fromPartUi === "string"
					? fromPartUi
					: typeof fromPartMeta === "string"
						? fromPartMeta
						: undefined;
	return uri?.startsWith("ui://") ? uri : undefined;
}

/** 提取 _meta.ui.serverId（执行期描述符自带的归属 server；与 resourceUri 同承载位置） */
export function extractUiServerId(part: ToolPartLike): string | undefined {
	const stateMeta = part.state.metadata as
		| { ui?: { serverId?: unknown }; _meta?: { ui?: { serverId?: unknown } } }
		| undefined;
	const partMeta = part.metadata as
		| { ui?: { serverId?: unknown }; _meta?: { ui?: { serverId?: unknown } } }
		| undefined;
	const candidates = [
		stateMeta?.ui?.serverId,
		stateMeta?._meta?.ui?.serverId,
		partMeta?.ui?.serverId,
		partMeta?._meta?.ui?.serverId,
	];
	const serverId = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
	return typeof serverId === "string" ? serverId : undefined;
}

/** 提取 _meta.ui.permissions 特权声明（如 microphone；兼容 state.metadata / part.metadata 两种承载位置） */
export function extractUiPermissions(part: ToolPartLike): string[] {
	const stateMeta = part.state.metadata as
		| { ui?: { permissions?: unknown }; _meta?: { ui?: { permissions?: unknown } } }
		| undefined;
	const partMeta = part.metadata as
		| { ui?: { permissions?: unknown }; _meta?: { ui?: { permissions?: unknown } } }
		| undefined;
	const raw =
		stateMeta?.ui?.permissions ??
		stateMeta?._meta?.ui?.permissions ??
		partMeta?.ui?.permissions ??
		partMeta?._meta?.ui?.permissions;
	if (!Array.isArray(raw)) return [];
	return raw.filter((item): item is string => typeof item === "string");
}

// ---- tool 进度（part.state.metadata.progress，转译层/管线写入） ----

export interface ToolProgressPayload {
	sessionID: string;
	messageID?: string;
	/** 与 ToolPart.tool 一致的插件注册名 */
	tool: string;
	progress: number;
	total?: number;
	message?: string;
	/** MCP progress 通知的扩展字段（如 uiEvent），原样透传给 iframe */
	uiEvent?: unknown;
}

/** 从 part metadata 提取进度（running 期间写入） */
export function extractProgress(part: ToolPartLike): ToolProgressPayload | undefined {
	if (part.state.status !== "running") return undefined;
	const meta = part.state.metadata as
		| { progress?: unknown; total?: unknown; message?: unknown; uiEvent?: unknown }
		| undefined;
	if (typeof meta?.progress !== "number") return undefined;
	return {
		sessionID: "",
		tool: part.tool,
		progress: meta.progress,
		...(typeof meta.total === "number" ? { total: meta.total } : {}),
		...(typeof meta.message === "string" ? { message: meta.message } : {}),
		...(meta.uiEvent !== undefined ? { uiEvent: meta.uiEvent } : {}),
	};
}

const EXECUTION_STATUS: Record<ToolPartLike["state"]["status"], ToolExecution["status"]> = {
	pending: "running",
	running: "running",
	completed: "success",
	error: "failure",
};

/** 从消息 parts 中提取/更新 tool 执行记录 */
export function toolExecutionsFromMessage(sessionId: string, message: MessageDTO): ToolExecution[] {
	return message.parts.filter(isToolPart).map((part) => {
		const input = JSON.stringify(part.state.input ?? {});
		const progress = extractProgress(part);
		return {
			id: part.id,
			sessionId,
			toolName: part.tool,
			resourceUri: extractResourceUri(part),
			status: EXECUTION_STATUS[part.state.status],
			inputSummary: input === "{}" ? undefined : input.slice(0, 120),
			resultSummary: part.state.output?.slice(0, 120),
			startedAt: message.createdAt,
			endedAt:
				part.state.status === "completed" || part.state.status === "error"
					? (message.completedAt ?? undefined)
					: undefined,
			...(progress
				? {
						progress: {
							progress: progress.progress,
							...(progress.total !== undefined ? { total: progress.total } : {}),
							...(progress.message !== undefined ? { message: progress.message } : {}),
						},
					}
				: {}),
		};
	});
}

/** 提取 parts 中全部 text 部件文本（\n 连接；无文本返回空串） */
export function textPartsOf(parts: unknown[]): string {
	return parts
		.filter((p): p is { type: "text"; text?: string } => (p as { type?: unknown } | null)?.type === "text")
		.map((p) => p.text ?? "")
		.join("\n");
}

/** 提取消息文本摘要（最后一条 text part 的前 60 字，供左栏摘要显示） */
export function messageSummary(message: MessageDTO): string | undefined {
	const texts = message.parts
		.filter(
			(p): p is { type: "text"; text: string } =>
				(p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string",
		)
		.map((p) => p.text);
	const text = texts.join(" ").trim();
	return text.length > 0 ? text.slice(0, 60) : undefined;
}
