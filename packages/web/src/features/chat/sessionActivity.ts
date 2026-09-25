import type { MessageDTO } from "@platform/shared";
import { toolExecutionsFromMessage } from "../../api/events";
import type { ToolExecution } from "../../types";

/** 卡片筛选：全部 / MCP Tool（skill 读取记录不进入浮层） */
export type ActivityFilter = "all" | "mcp";

/** 主会话直属工具行 */
export interface MainRow {
	kind: "main";
	exec: ToolExecution;
}

/** 子会话（subagent）行：整次子任务作为一个工具调用展示，展开可见内部工具明细 */
export interface ChildRow {
	kind: "child";
	childSessionId: string;
	displayName: string;
	status: ToolExecution["status"];
	startedAt?: string;
	childTools: ToolExecution[];
	/** 子会话消息缓存是否已有内容（刷新后缓存为空时 false） */
	loaded: boolean;
}

export type ActivityRow = MainRow | ChildRow;

/** 宽松消息列表形状（避免外部依赖对只读 parts 的强类型要求） */
export type MessagesLike = readonly {
	parts: readonly unknown[];
}[];

/** 子会话整体状态：内部工具任一失败→failure，任一运行中→running，否则 success */
export function childStatus(messages: MessagesLike | undefined): { status: ToolExecution["status"]; loaded: boolean } {
	if (!messages || messages.length === 0) return { status: "running", loaded: false };
	const execs = childToolsOf(messages);
	const status: ToolExecution["status"] = execs.some((e) => e.status === "failure")
		? "failure"
		: execs.some((e) => e.status === "running")
			? "running"
			: "success";
	return { status, loaded: true };
}

/** 子会话展示名：首个带 agent 字段的 assistant 消息的 agent 名，缺省「子会话」 */
export function childName(messages: MessagesLike | undefined): string {
	if (!messages) return "子会话";
	for (const message of messages) {
		if ((message as { role?: unknown }).role === "assistant") {
			const agent = (message as { agent?: unknown }).agent;
			if (typeof agent === "string" && agent.length > 0) return agent;
		}
	}
	return "子会话";
}

/** 子会话内部工具记录（复用主链路 tool part → ToolExecution 提取，排除 skill 读取） */
export function childToolsOf(messages: MessagesLike | undefined): ToolExecution[] {
	if (!messages) return [];
	return (messages as readonly MessageDTO[])
		.flatMap((m) => toolExecutionsFromMessage("", m))
		.filter((e) => e.toolName !== "skill");
}

/** 子会话开始时间：缓存最早消息的 createdAt；无缓存返回 undefined */
export function childStartedAt(messages: MessagesLike | undefined): string | undefined {
	const first = messages?.[0];
	if (!first) return undefined;
	const createdAt = (first as { createdAt?: unknown }).createdAt;
	return typeof createdAt === "string" ? createdAt : undefined;
}

/** 顶层行筛选（skill 记录在组装层已剔除，「MCP Tool」与「全部」当前等价） */
export function filterActivity(rows: readonly ActivityRow[], filter: ActivityFilter): ActivityRow[] {
	switch (filter) {
		case "all":
			return [...rows];
		case "mcp":
			return rows.filter((r) => r.kind === "child" || r.kind === "main");
	}
}

/** 组装主会话行：剔除 skill 读取记录，仅保留真实工具调用 */
export function buildMainRows(execs: readonly ToolExecution[]): MainRow[] {
	return execs.filter((exec) => exec.toolName !== "skill").map((exec) => ({ kind: "main", exec }));
}

/**
 * 组装子会话行：按 activeChildSessions 顺序，与子会话消息缓存一一对应。
 * 供组件 aggregate 使用（childQueries 数据数组与 childSessions 同序）。
 */
export function buildChildRows(
	childSessions: readonly string[],
	messagesBySession: ReadonlyMap<string, MessagesLike | undefined>,
): ChildRow[] {
	return childSessions.map((childSessionId) => {
		const messages = messagesBySession.get(childSessionId);
		const { status, loaded } = childStatus(messages);
		return {
			kind: "child",
			childSessionId,
			displayName: childName(messages),
			status,
			startedAt: childStartedAt(messages),
			childTools: loaded ? childToolsOf(messages) : [],
			loaded,
		};
	});
}
