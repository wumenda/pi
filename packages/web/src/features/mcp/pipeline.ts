import type { JsonValue } from "@earendil-works/chord";
import type { ToolExecutionEvent } from "../../services/contracts.ts";
import { iframeInstanceKey, iframePool } from "./IframePool.ts";
import { messageBridge, THEME_CHANGED_METHOD } from "./MessageBridge.ts";
import { type ProgressPayload, seenProgress, shouldDeliverProgress, shouldReplayProgress } from "./progress.ts";
import { type SkillReadContext, SOLO_GROUP_KEY } from "./types.ts";

/** tool 调用推进状态（对齐参考应用 ToolPart.state.status 的子集语义） */
export type ToolUiStatus = "pending" | "running" | "completed" | "error";

/** 一次需要推送 UI 的 tool 调用（pi 侧由 transcript 条目流派生） */
export interface ToolUiCall {
	/** MCP Apps ui:// 资源 URI */
	resourceUri: string;
	/** 归属 MCP server 标识（决定 ui:// 资源路由与 iframe 池 key；pi 侧为约定字段） */
	serverId?: string;
	toolCallId: string;
	toolName: string;
	/** 工具展示名（skill 声明的 tool title；缺省回退 toolName） */
	toolTitle?: string;
	status: ToolUiStatus;
	input?: Record<string, unknown>;
	output?: string;
	/** 服务端结构化结果（details.structuredContent 透传；推送 tool-result 时优先于 output 文本解析） */
	structuredContent?: Record<string, unknown>;
	/** _meta.ui.permissions 特权声明（仅首次创建 iframe 时生效；约定字段） */
	permissions?: readonly string[];
	/**
	 * 归属判定上下文：tool 执行时最近一次 skill 读取实例（name + instanceId）。
	 * 由 transcript 派生层按条目流顺序维护，据此做上下文时序归属判定。
	 */
	groupContext?: SkillReadContext | null;
}

/** MCP Apps 宿主 → 应用的 tool-result 通知载荷（toolName/_embed 为宿主扩展字段） */
interface McpToolResultPayload {
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
	isError: boolean;
	toolName: string;
	_embed?: boolean;
}

/** MCP Apps 宿主 → 应用：主题变更广播通知（setTheme 时向全部存活 iframe 下发） */
export { THEME_CHANGED_METHOD };

/**
 * MCP Apps 宿主能力声明（ui/initialize 应答，SEP-1865 HostContext.capabilities）：
 * notifications 为宿主可下发的通知方法名；tools.call 为反向调用支持。
 */
export const HOST_CAPABILITIES = {
	notifications: [
		"notifications/progress",
		"ui/notifications/tool-input",
		"ui/notifications/tool-result",
		THEME_CHANGED_METHOD,
	],
	tools: { call: true },
} as const;

/**
 * 宿主运行环境注入点：MCP server 调用经 pi.mcp-host chord 服务路由到会话
 * worker，由应用层（App.tsx）在挂载时注入实现；未注入时缺省报错。
 * getHttpBase 为 app-server 的 ui-resources HTTP 端点基址（iframe 加载面）。
 */
export interface HostContext {
	getTheme(): "light" | "dark";
	getSessionId(): string | undefined;
	/** app-server HTTP 基址（如 http://127.0.0.1:8791），iframe 经它加载 ui:// 文档 */
	getHttpBase(): string;
	/**
	 * 反向 tools/call：经 pi.mcp-host 服务路由到 MCP server；
	 * serverId 缺省时按唯一工具名路由（iframe 反向调用的兜底）。
	 */
	callTool(name: string, args: JsonValue | null, serverId?: string): Promise<unknown>;
	/** 读取 MCP Apps ui:// 资源（SEP-1865 服务能力；iframe 渲染已改走 HTTP src） */
	getUiResource(serverId: string, resourceUri: string): Promise<{ mimeType: string; html: string }>;
	/** 读取本会话已落盘的工具执行事件（冷启动 progress 恢复；未注入时返回空集） */
	getToolEvents(): Promise<ToolExecutionEvent[]>;
}

let hostContext: HostContext = {
	getTheme: () => "light",
	getSessionId: () => undefined,
	getHttpBase: () => {
		throw new Error("HTTP 基址未接入：请通过 setHostContext 注入 getHttpBase 实现");
	},
	callTool: async () => {
		throw new Error("MCP tools/call 未接入：请通过 setHostContext 注入 callTool 实现");
	},
	getUiResource: async () => {
		throw new Error("MCP UI 资源未接入：请通过 setHostContext 注入 getUiResource 实现");
	},
	getToolEvents: async () => [],
};

export function setHostContext(context: HostContext): void {
	hostContext = context;
}

/** app-server HTTP 基址（宿主注入；未注入时抛错，调用方需自行兜底） */
export function hostHttpBase(): string {
	return hostContext.getHttpBase();
}

/**
 * 把 tool 调用输出映射为 MCP Apps tool-result 通知：
 * structuredContent 优先（服务端原样透传），否则 output 为 JSON 对象文本时
 * 解析为 structuredContent 回退，否则仅提供文本 content。
 */
function toMcpToolResult(call: ToolUiCall): McpToolResultPayload {
	const text = call.output ?? "";
	const payload: McpToolResultPayload = {
		content: [{ type: "text", text }],
		isError: call.status === "error",
		toolName: call.toolName,
		// 宿主工作台内嵌标记：App 据此隐藏自带外壳
		_embed: true,
	};
	if (!payload.isError && call.structuredContent !== undefined) {
		payload.structuredContent = call.structuredContent;
		return payload;
	}
	if (!payload.isError && text.length > 0) {
		try {
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				payload.structuredContent = parsed as Record<string, unknown>;
			}
		} catch {
			// 非 JSON 输出：仅文本 content
		}
	}
	return payload;
}

/** 取 resourceUri 在池中最近使用实例的归属 serverId（iframe 反向 tools/call 路由用） */
function latestServerIdForResourceUri(resourceUri: string): string | undefined {
	let best: string | undefined;
	let latest = -1;
	for (const entry of iframePool.entries.values()) {
		if (entry.resourceUri !== resourceUri) continue;
		if (entry.lastUsedSeq > latest) {
			latest = entry.lastUsedSeq;
			best = entry.serverId;
		}
	}
	return best;
}

/** 取 resourceUri（+ 归属 serverId）在池中最近使用的实例分组（按池的单调序号判定最近） */
function latestGroupForResourceUri(resourceUri: string, serverId: string | undefined): string | null {
	let bestGroup: string | null = null;
	let latest = -1;
	for (const entry of iframePool.entries.values()) {
		if (entry.resourceUri !== resourceUri || entry.serverId !== serverId) continue;
		if (entry.lastUsedSeq > latest) {
			latest = entry.lastUsedSeq;
			bestGroup = entry.group;
		}
	}
	return bestGroup;
}

/**
 * 解析 tool 调用的归属分组（复合键池辅助，语义对齐参考应用 resolveIframeGroup）：
 * - 有 groupContext（上下文时序）→ skill 实例键 `<name>#<instanceId>`
 *   （pi 的 SKILL.md frontmatter 无 tools 声明字段，无法做声明比对，
 *   只要 tool 执行紧随某次 skill 读取即归入该实例）；
 * - 无 groupContext → 沿用池内该 resourceUri 最近使用的实例分组（不误切分组）；
 * - 均无 → "单独调用"。
 */
export function resolveIframeGroup(
	resourceUri: string,
	groupContext: SkillReadContext | null | undefined,
	serverId: string | undefined,
): string {
	if (groupContext) {
		return `${groupContext.name}#${groupContext.instanceId}`;
	}
	return latestGroupForResourceUri(resourceUri, serverId) ?? SOLO_GROUP_KEY;
}

/**
 * 渲染管线（对齐参考应用 iframe-rendering.md 第 2/3 节）：
 * 池未命中 → 创建沙盒 iframe 并激活；命中 → 复用并保持激活（挂起实例重新提升）。
 * 按 MCP Apps 方言（SEP-1865）推送执行事件，追加式（iframe 自行消费）：
 * - pending/running → ui/notifications/tool-input（标记 processing）
 * - completed/error → ui/notifications/tool-result（标记 result_ready/error）
 *
 * 重新进入会话的重放：会话切换会全量回收 iframe（destroyAllIframes），
 * 重进后工具以最终状态重建 iframe。新建 iframe 的应用为冷启动，仅推 tool-result
 * 会卡在 App 的"等待任务"门，因此对新建 iframe 先补推 tool-input（过门），
 * 再推 tool-result（渲染最终 UI）——复用路径保持只推当前状态。
 */
export function ensureToolIframe(call: ToolUiCall): void {
	// serverId 未知时无法路由 ui:// 资源（服务端 getUiResource 要求 serverId），直接跳过
	if (!call.serverId) return;
	const group = resolveIframeGroup(call.resourceUri, call.groupContext, call.serverId);
	const iframeKey = iframeInstanceKey(call.resourceUri, group, call.serverId);
	// isNew 必须按「本次 acquire 是否真会新建实例」判定（含并发派生路径）：
	// 基键存在≠可复用——基实例被并发执行占用时会新建 #i<no> 派生实例。
	const alreadyBound = iframePool.keyForExecution(call.toolCallId) !== undefined;
	const isNew = !alreadyBound && !iframePool.hasReusable(call.resourceUri, group, call.serverId);
	// 首次即失败的调用（error）不创建 iframe：错误文本已在消息流可见——
	// 空载一个只显示错误的 iframe 无价值。已有 iframe 的 error 推送不受影响。
	if (isNew && call.status === "error") return;
	iframePool.acquire(call.resourceUri, {
		boundToolCall: call.toolCallId,
		permissions: call.permissions,
		serverId: call.serverId,
		// running/pending 为有效执行（占用实例）；completed/error 释放实例回可复用
		active: call.status === "running" || call.status === "pending",
		toolName: call.toolName,
		title: call.toolTitle ?? call.toolName,
		group,
		groupContext: call.groupContext ?? null,
	});
	// 发送键取执行实际绑定的实例（并发下可能被派到派生实例，预计算的 iframeKey 只是基键）
	const sendKey = iframePool.keyForExecution(call.toolCallId) ?? iframeKey;
	// 新建实例：src 指向 app-server ui-resources 端点（消息先排队直至应用就绪）
	if (isNew) {
		loadIframeSrc(sendKey, call.serverId, call.resourceUri);
	}
	if (call.status === "pending" || call.status === "running") {
		messageBridge.send(sendKey, "ui/notifications/tool-input", {
			toolName: call.toolName,
			args: { ...(call.input ?? {}), _embed: true },
		});
	} else if (isNew) {
		// 冷启动重放：先 tool-input（过门 + 消费端清空旧状态），再 tool-result（最终 UI）
		messageBridge.send(sendKey, "ui/notifications/tool-input", {
			toolName: call.toolName,
			args: { ...(call.input ?? {}), _embed: true },
		});
		messageBridge.sendToolResult(sendKey, toMcpToolResult(call));
	} else {
		messageBridge.sendToolResult(sendKey, toMcpToolResult(call));
	}
	// 冷启动/恢复补推：新建实例或复用实例的未绑定执行（重进会话的中间调用）在终态
	// 补推已落盘 progress（同页面已实时收过的指纹被去重抑制；刷新后全部真正送达）
	if (shouldReplayProgress(alreadyBound, isNew, call.status)) {
		void replayRecordedProgress(call.toolCallId);
	}
}

/**
 * ui:// 资源的 HTTP 加载地址：app-server 的 ui-resources 端点独立响应头
 * （content-type + 逐应用求交 CSP）对 iframe 生效。
 */
export function uiResourceUrl(httpBase: string, serverId: string, resourceUri: string): string {
	const base = httpBase.replace(/\/+$/, "");
	return `${base}/api/v1/ui-resources?serverId=${encodeURIComponent(serverId)}&resourceUri=${encodeURIComponent(resourceUri)}`;
}

/**
 * 新建 iframe 后加载 MCP Apps 应用文档：src 指向 app-server 的 ui-resources
 * HTTP 端点（CSP 求交响应头生效）。加载期间实例可能被回收/淘汰，回填前校验
 * 池内身份；失败仅记录——iframe 保持空白，出站通知持续排队直至会话切换回收
 * （MessageBridge 队列上限兜底）。
 */
function loadIframeSrc(key: string, serverId: string, resourceUri: string): void {
	const instance = iframePool.get(key);
	if (instance === undefined) return;
	try {
		instance.element.setAttribute("src", uiResourceUrl(hostContext.getHttpBase(), serverId, resourceUri));
	} catch (error) {
		console.warn(`[MCP] 解析 UI 资源地址失败 ${resourceUri}`, error);
	}
}

/**
 * 宿主 → 应用：转发一次 tool 执行进度（notifications/progress）。
 * 先过指纹去重（同页面生命周期内同 (toolCallId, 指纹) 只投递一次，实时重发/
 * 重扫/恢复重放共用此记忆），再按执行寻址实例键——同一执行的进度始终回其
 * 绑定的 iframe（并发下不串实例）；找不到绑定实例（已回收/会话已切换）则
 * 丢弃并 debug 记录：进度时效性强，过期投递无意义。
 */
export function sendToolProgress(toolCallId: string, payload: ProgressPayload): void {
	if (!shouldDeliverProgress(seenProgress, toolCallId, payload)) return;
	const sendKey = iframePool.keyForExecution(toolCallId);
	if (sendKey === undefined) {
		console.debug(`[MCP] progress 无绑定实例，丢弃：toolCallId=${toolCallId}`);
		return;
	}
	messageBridge.send(sendKey, "notifications/progress", {
		progress: payload.progress,
		total: payload.total,
		message: payload.message,
		uiEvent: payload.uiEvent ?? null,
	});
}

/**
 * 冷启动恢复：新建 iframe（ensureToolIframe 的 isNew 路径）完成既有
 * tool-input → tool-result 重放之后，经 pi.tool-events 服务拉取本会话已落盘的
 * 执行事件，把该执行绑定的 progress 事件按时间顺序经 sendToolProgress 补推
 * （同样过指纹去重）。拉取失败仅记录——进度缺失不阻塞终态 UI。
 */
async function replayRecordedProgress(toolCallId: string): Promise<void> {
	let events: ToolExecutionEvent[];
	try {
		events = await hostContext.getToolEvents();
	} catch (error) {
		console.debug("[MCP] 拉取 tool-events 失败，跳过 progress 恢复", error);
		return;
	}
	for (const event of events) {
		if (event.kind !== "progress" || event.toolCallId !== toolCallId || event.progress === null) continue;
		sendToolProgress(toolCallId, {
			progress: event.progress,
			total: event.total,
			message: event.message,
			uiEvent: event.uiEvent,
		});
	}
}

let protocolStarted = false;
/** 本宿主唯一支持的 MCP Apps 协议版本（版本协商锚点；不兼容版本明确拒绝） */
export const PROTOCOL_VERSION = "2025-06-18";

/** app→host 请求型 method → handler（每个带 id 请求必须应答） */
type HostRequestHandler = (params: unknown, ctx: { id: number | string; resourceUri: string }) => void;

const handleInitialize: HostRequestHandler = (params, { id, resourceUri }) => {
	// 版本协商：读取 app 声明版本，与宿主唯一支持版本求交；不兼容返回明确 JSON-RPC error
	const version = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
	if (typeof version !== "string" || version.length === 0) {
		messageBridge.respondError(resourceUri, id, -32000, "缺少或无效的 protocolVersion");
		return;
	}
	if (version !== PROTOCOL_VERSION) {
		messageBridge.respondError(resourceUri, id, -32000, `协议版本不兼容: app=${version}, host=${PROTOCOL_VERSION}`);
		return;
	}
	// 主题跟随应用当前模式（宿主全局偏好），MCP App 据此切换自身配色
	messageBridge.respond(resourceUri, id, {
		protocolVersion: PROTOCOL_VERSION,
		theme: hostContext.getTheme(),
		capabilities: HOST_CAPABILITIES,
	});
};

const handleToolsCall: HostRequestHandler = (params, { id, resourceUri }) => {
	const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
	const name = typeof p.name === "string" ? p.name : "";
	const args: JsonValue | null =
		typeof p.arguments === "object" && p.arguments !== null ? (p.arguments as JsonValue) : null;
	if (name === "") {
		messageBridge.respondError(resourceUri, id, -32602, "tools/call 缺少工具名");
		return;
	}
	// iframe 只携带 resourceUri：从池中最近实例反查归属 serverId，供服务端路由 MCP server
	const serverId = latestServerIdForResourceUri(resourceUri);
	// 反向调用经 pi.mcp-host chord 服务路由到会话 worker 的 MCP server
	hostContext
		.callTool(name, args, serverId)
		.then((result) => messageBridge.respond(resourceUri, id, result))
		.catch((e: unknown) =>
			messageBridge.respondError(resourceUri, id, -32000, e instanceof Error ? e.message : String(e)),
		);
};

const requestHandlers: Record<string, HostRequestHandler> = {
	"ui/initialize": handleInitialize,
	"tools/call": handleToolsCall,
};

/**
 * MCP Apps 宿主侧协议（SEP-1865），应用挂载后调用（幂等）：
 * - method→handler map 分发；带 id 的请求每个都必须应答（应答或显式 -32601 拒绝）；
 * - ui/initialize 版本交集协商：版本不兼容/缺失 → 明确 JSON-RPC error；
 * - ui/notifications/initialized 为通知（无响应），标记就绪并冲刷积压通知。
 */
export function startHostProtocol(): void {
	if (protocolStarted) return;
	protocolStarted = true;
	messageBridge.onMessage((message, resourceUri) => {
		if (!("method" in message)) return;
		// 通知（应用握手完成 → 就绪冲刷；notification 无 id，无需响应）
		if (message.method === "ui/notifications/initialized") {
			messageBridge.markReady(resourceUri);
			return;
		}
		if (message.id === undefined) return; // 非请求通知：静默忽略
		const handler = requestHandlers[message.method];
		if (handler) {
			handler(message.params, { id: message.id, resourceUri });
			return;
		}
		// map 之外的请求：显式拒绝，避免应用挂起等待
		messageBridge.respondError(resourceUri, message.id, -32601, `宿主未实现方法：${message.method}`);
	});
}
