import type { ToolPartLike } from "../api/events";
import { callMcpTool } from "../api/tools";
import { resolveIframeGroup, useAppStore } from "../stores/app-store";
import type { SkillReadContext } from "../types";
import { iframeInstanceKey, iframePool } from "./IframePool";
import { messageBridge, THEME_CHANGED_METHOD } from "./MessageBridge";

/** 一次需要推送 UI 的 tool 调用（来自 ToolPart 状态） */
export interface ToolUiCall {
	resourceUri: string;
	/** Task 4/G4：归属 MCP server 标识（GET /mcp-tools DTO 的 serverId；决定的
	 *  ui:// 资源路由与 iframe 池 key，见 ensureToolIframe） */
	serverId?: string;
	toolCallId: string;
	toolName: string;
	status: ToolPartLike["state"]["status"];
	input?: Record<string, unknown>;
	output?: string;
	/** _meta.ui.permissions 特权声明（仅首次创建 iframe 时生效） */
	permissions?: readonly string[];
	/**
	 * 归属判定上下文（v2.2/v2.7）：tool 执行时最近一次读取的 Skill 实例
	 * （name + part.id）。由 useIframePipeline 按消息流顺序维护，store 层据此做
	 * 上下文时序归属判定（resolveToolGroup → skill 实例键）。
	 */
	groupContext?: SkillReadContext | null;
}

/** MCP Apps 宿主 → 应用的 tool-result 通知载荷（mcpApp.ts ToolResult 契约为子集；
 * toolName 为宿主扩展字段，供共享一份 UI 的多工具场景在重放（tool-input 可能缺失）时
 * 按 toolName 归位场景 Tab，ecommerce-ui 等 UI 消费，其余 App 忽略） */
interface McpToolResultPayload {
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
	isError: boolean;
	toolName: string;
}

/** MCP Apps 宿主 → 应用：主题变更广播通知（setTheme 时向全部存活 iframe 下发） */
export { THEME_CHANGED_METHOD };

/**
 * MCP Apps 宿主能力声明（ui/initialize 应答，SEP-1865 HostContext.capabilities）。
 * 如实声明本宿主实际支持的通知下发与请求处理，避免 MCP App 能力探测误判
 * （此前为 {} 空对象——占位实现，见 简约实现审查报告）。
 * ui 端 mcpApp.ts 的 HostContext.capabilities 为 Record<string, unknown> 透传，
 * 结构约定：notifications 为宿主可下发的通知方法名；tools.call 为反向调用支持。
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
 * 把 opencode ToolPart 状态映射为 MCP Apps tool-result 通知：
 * output 为 JSON 对象文本时作为 structuredContent 透传，否则仅提供文本 content。
 */
function toMcpToolResult(call: ToolUiCall): McpToolResultPayload {
	const text = call.output ?? "";
	const payload: McpToolResultPayload = {
		content: [{ type: "text", text }],
		isError: call.status === "error",
		toolName: call.toolName,
	};
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

/**
 * 渲染管线（iframe-rendering.md 第 2/3 节）：
 * 池未命中 → 创建沙盒 iframe 并激活；命中 → 复用并保持激活（挂起实例重新提升）。
 * 按 MCP Apps 方言（SEP-1865）推送执行事件，追加式（iframe 自行消费）：
 * - pending/running → ui/notifications/tool-input（标记 processing）
 * - completed/error → ui/notifications/tool-result（标记 result_ready/error）
 *
 * 重新进入会话的重放：会话切换会全量回收 iframe（setCurrentSession → destroyAllIframes），
 * 重进后工具以最终状态（completed/error）重建 iframe。新建 iframe 的应用为冷启动
 * （mcpApp store 的 toolInput/toolResult 全空），仅推 tool-result 会卡在 App 的
 * "等待任务" 门（!app.toolInput）。因此对**新建** iframe 先补推 tool-input（过门），
 * 再推 tool-result（渲染最终 UI）——复用路径保持只推当前状态，避免重复消费。
 */
export function ensureToolIframe(call: ToolUiCall): void {
	// B2 防御：serverId 未知时建 iframe 必被服务端 400（serverId 必填），直接跳过
	if (!call.serverId) return;
	// v2.7 复合键寻址：归属分组（上下文时序，resolveIframeGroup）决定 skill 实例键，
	// 复合键 = `<serverId>|<resourceUri>#<group>`（G4：serverId 隔离同 URI 的跨 server 实例）。
	const group = resolveIframeGroup(call.resourceUri, call.toolName, call.groupContext, call.serverId);
	const iframeKey = iframeInstanceKey(call.resourceUri, group, call.serverId);
	// B1 修复：isNew 必须按「本次 acquire 是否真会新建实例」判定（含 G5 派生路径），
	// 基键存在≠可复用——基实例被并发执行占用时会新建 #i<no> 派生实例，若按基键判定
	// 会漏掉冷启动补推（completed 派生卡"等待任务"门）。
	const alreadyBound = iframePool.keyForExecution(call.toolCallId) !== undefined;
	const isNew = !alreadyBound && !iframePool.hasReusable(call.resourceUri, group, call.serverId);
	// 首次即失败的调用（error）不创建 iframe：宿主无法区分 error 成因（参数校验、
	// 连接中断/超时、server isError、中断、服务重启收口等），且 error 的 tool-result
	// 无 structuredContent（toMcpToolResult 只在非 error 时解析），错误文本已在消息流
	// ToolCard 可见——空载一个只显示错误的 iframe 无价值。该复合键后续有成功调用
	// （running/completed）时正常创建；已存在 iframe 的 error 推送不受影响。
	if (isNew && call.status === "error") return;
	useAppStore.getState().acquireIframe(call.resourceUri, {
		boundToolCall: call.toolCallId,
		permissions: call.permissions,
		serverId: call.serverId,
		// G5：running/pending 为有效执行（占用实例）；completed/error 释放实例回可复用
		active: call.status === "running" || call.status === "pending",
		// v2.3：toolName 用于归属判定与展示名解析（title 由 store 层按 4.4 回退链确定）
		toolName: call.toolName,
		groupContext: call.groupContext,
	});
	// G5：发送键取执行实际绑定的实例（并发下 B 可能被派到派生实例 #i1，
	// 预计算的 iframeKey 只是基键，必须按 callToKey 解析，否则消息串到别的实例）
	const sendKey = iframePool.keyForExecution(call.toolCallId) ?? iframeKey;
	if (call.status === "pending" || call.status === "running") {
		messageBridge.send(sendKey, "ui/notifications/tool-input", {
			toolName: call.toolName,
			args: call.input ?? {},
		});
	} else if (isNew) {
		// 冷启动重放：先 tool-input（过门 + 消费端清空旧状态），再 tool-result（最终 UI）
		messageBridge.send(sendKey, "ui/notifications/tool-input", {
			toolName: call.toolName,
			args: call.input ?? {},
		});
		messageBridge.sendToolResult(sendKey, toMcpToolResult(call));
	} else {
		messageBridge.sendToolResult(sendKey, toMcpToolResult(call));
	}
}

let protocolStarted = false;

/** 本宿主唯一支持的 MCP Apps 协议版本（G6 版本协商锚点；不兼容版本明确拒绝） */
export const PROTOCOL_VERSION = "2025-06-18";

/** app→host 请求型 method → handler（G6：method→handler map，每个带 id 请求必须应答） */
type HostRequestHandler = (params: unknown, ctx: { id: number | string; resourceUri: string }) => void;

const handleInitialize: HostRequestHandler = (params, { id, resourceUri }) => {
	// G6 版本协商：读取 app 声明版本，与宿主唯一支持版本求交；不兼容返回明确
	// JSON-RPC error，不假装成功（此前硬编码应答、忽略入参）。
	const version = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
	if (typeof version !== "string" || version.length === 0) {
		messageBridge.respondError(resourceUri, id, -32000, "缺少或无效的 protocolVersion");
		return;
	}
	if (version !== PROTOCOL_VERSION) {
		messageBridge.respondError(resourceUri, id, -32000, `协议版本不兼容: app=${version}, host=${PROTOCOL_VERSION}`);
		return;
	}
	// 主题跟随应用当前模式（store 全局偏好），MCP App 据此切换自身配色
	messageBridge.respond(resourceUri, id, {
		protocolVersion: PROTOCOL_VERSION,
		theme: useAppStore.getState().theme,
		capabilities: HOST_CAPABILITIES,
	});
};

const handleToolsCall: HostRequestHandler = (params, { id, resourceUri }) => {
	const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
	const name = typeof p.name === "string" ? p.name : "";
	const args = typeof p.arguments === "object" && p.arguments !== null ? (p.arguments as Record<string, unknown>) : {};
	if (name === "") {
		messageBridge.respondError(resourceUri, id, -32602, "tools/call 缺少工具名");
		return;
	}
	// 携带当前会话 id：后端 /mcp-tools/call 据此注入会话工作区 capability
	// （MCP server 端 host_client 识别工作区身份；无会话时降级不注入）
	// G4：serverId 取自发来请求的 iframe 所归属的 MCP server（池实例字段），
	// 后端按它路由 tools/call 到正确 server（同 URI 多 server 场景不串线）。
	const sessionId = useAppStore.getState().currentSessionId;
	const serverId = iframePool.get(resourceUri)?.serverId;
	callMcpTool(name, args, {
		sessionId: sessionId ?? undefined,
		serverId,
	})
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
 * MCP Apps 宿主侧协议（SEP-1865），应用挂载后调用（幂等）。
 * G6 协议内核：
 * - method→handler map 分发；消息桥校验通过且带 id 的请求，每个都必须应答
 *   （handler 应答 或 显式 -32601 拒绝），杜绝静默挂起；
 * - ui/initialize 版本交集协商：版本不兼容/缺失 → 明确 JSON-RPC error；
 * - capabilities 只声明有 handler 与测试覆盖的通知/工具调用（resources/read、
 *   ui/message、ui/update-model-context 等协议族扩展不在 map 内 → 显式拒绝）；
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
		if (message.id === undefined) return; // 非请求通知：消息形状校验已通过，静默忽略
		const handler = requestHandlers[message.method];
		if (handler) {
			handler(message.params, { id: message.id, resourceUri });
			return;
		}
		// method→handler map 之外的请求（含 resources/read、ui/message、
		// ui/update-model-context 等协议族扩展）：显式拒绝，避免应用挂起等待
		messageBridge.respondError(resourceUri, message.id, -32601, `宿主未实现方法：${message.method}`);
	});
}
