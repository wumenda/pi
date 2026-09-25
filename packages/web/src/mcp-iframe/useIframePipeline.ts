import type { McpUiToolDTO, MessageDTO } from "@platform/shared";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
	extractProgress,
	extractResourceUri,
	extractUiPermissions,
	extractUiServerId,
	isToolPart,
} from "../api/events";
import { fetchMessages } from "../api/messages";
import { fetchToolEvents, mergePersistedExecutions } from "../api/tool-events";
import { fetchMcpTools, matchMcpTool } from "../api/tools";
import { resolveIframeGroup, sessionDirectoryOf, useAppStore } from "../stores/app-store";
import type { Skill, SkillInstance, SkillReadContext } from "../types";
import { iframeInstanceKey, iframePool } from "./IframePool";
import { messageBridge } from "./MessageBridge";
import { ensureToolIframe, startHostProtocol } from "./pipeline";

/**
 * 扫描一批消息中的 MCP Apps tool part，追加式推送 iframe 通知流
 * （iframe-rendering.md 3.4：同状态不重复推送，progress 变化单独推送）。
 * 子会话（subagent）tool part 与父会话走同一管线（iframe 池按 resourceUri 全局共享）。
 *
 * 归属上下文（v2.2/v2.7）：按消息流顺序维护「最近一次 Skill 读取动作」游标
 * （part.tool === "skill" 的 input.name + part.id 实例标识），随后出现的 tool part
 * 以该游标为 groupContext 做上下文时序归属判定（iframe-rendering.md 4.1）——读取
 * Skill 后执行的 tool 归入该 Skill **实例**（v2.7）；无前置读取（单独执行）归「单独调用」。
 *
 * 就绪门控：groupContext 非空但 skills[] 尚不含该 Skill，或 skillInstances[] 尚未
 * 建档该实例（SKILL.md 异步拉取中，useSkillLoader 尚未 upsertSkill/upsertSkillInstance）
 * 时，**跳过该 tool part 的 iframe 创建**（不推进 pushedRef），待 skills/skillInstances
 * 变化重扫再判定——避免 SKILL.md 就绪前误归「单独调用」。
 * progress 通知不依赖归属，照常转发（进 messageBridge 队列，iframe 建好后送达）。
 */
function scanMessagesForIframes(
	messages: MessageDTO[],
	mcpTools: McpUiToolDTO[],
	skills: Skill[],
	skillInstances: SkillInstance[],
	pushedRef: { current: Map<string, string> },
	progressRef: { current: Map<string, string> },
	onUnknownMcpTool?: (tool: string) => void,
): void {
	let lastSkillRead: SkillReadContext | null = null;
	for (const message of messages) {
		for (const part of message.parts) {
			if (!isToolPart(part)) continue;
			// Skill 读取动作（part.tool === "skill"）：推进上下文游标（name + part.id 实例标识）
			if (part.tool === "skill") {
				const name = (part.state.input as { name?: unknown } | undefined)?.name;
				if (typeof name === "string" && name.length > 0 && typeof part.id === "string" && part.id.length > 0) {
					lastSkillRead = { name, instanceId: part.id };
				}
				continue;
			}
			// 绑定判定：优先 tool part 自带的 _meta.ui，其次按工具名匹配 MCP 定义清单。
			// matched 复用于：resourceUri（第二级判定）、toolName 归一化（见下）。
			const matched = matchMcpTool(part.tool, mcpTools);
			const partUri = extractResourceUri(part);
			// 执行期描述符自带的归属 server（agent 核心 terminalDetails 使中止/错误终态同样携带）
			const partServerId = extractUiServerId(part);
			if (partUri !== undefined && matched === undefined && partServerId === undefined) {
				// B2 修复：part 自带 _meta.ui.resourceUri 但 /mcp-tools 清单未命中且描述符未带
				// serverId → serverId 未知，iframe src 会被服务端 schema 400（serverId 必填）
				// → 空白 iframe 且无自愈。不推进 pushedRef：触发清单按需刷新（onUnknownMcpTool
				// 内部防抖），清单到达后重扫补建。描述符自带 serverId 时无需清单即可绑定。
				onUnknownMcpTool?.(part.tool);
				continue;
			}
			const resourceUri = partUri ?? matched?.resourceUri;
			if (!resourceUri) {
				// 清单缓存自愈（遗留观察）：part 无自带 resourceUri（第一级失败）且按
				// 当前（可能已冻结的）清单未命中（第二级失败）且是插件工具（mcp_ 前缀）
				// → 提示 hook 按需刷新 /mcp-tools 清单；refetch 后 mcpTools 更新 → effect
				// 重扫补建 iframe。防抖在 hook 侧（同一 tool 仅触发一次），避免刷新后
				// 仍未命中时反复无效请求。
				if (partUri === undefined && part.tool.startsWith("mcp_")) {
					onUnknownMcpTool?.(part.tool);
				}
				continue;
			}
			// 归属上下文对应的 Skill 未就绪：暂不建 iframe，等 skills/skillInstances 变化重扫
			// （就绪门控，避免误归「单独调用」）。就绪 = 元数据已加载且非降级（metadataUnavailable
			// 时 tools 声明为空，放行会把本应归属该技能的 iframe 永久错归「单独调用」）+ 实例已建档
			if (lastSkillRead !== null) {
				const meta = skills.find((s) => s.name === lastSkillRead!.name);
				const instanceReady = skillInstances.some((i) => i.instanceId === lastSkillRead!.instanceId);
				if (meta === undefined || meta.metadataUnavailable === true || !instanceReady) {
					continue;
				}
			}
			// toolName 归一化为 MCP Server 侧原名（opencode 调用名带 `<server>_` 前缀，
			// UI 的 PAGES 映射表按原名匹配；无清单命中时回退调用名原样）
			const toolName = matched?.name ?? part.tool;
			// 归属 server：执行期描述符优先（中止/错误终态不依赖清单），清单兜底
			const serverId = partServerId ?? matched?.serverId;
			// v2.7：复合键 = `<serverId>|<resourceUri>#<group>`（G4 serverId 隔离同 URI 跨 server），
			// 通知流按复合键寻址，只发往归属实例
			const group = resolveIframeGroup(resourceUri, toolName, lastSkillRead, serverId);
			const iframeKey = iframeInstanceKey(resourceUri, group, serverId);
			// 状态推送（tool-input/tool-result）按 status 去重
			if (pushedRef.current.get(part.id) !== part.state.status) {
				pushedRef.current.set(part.id, part.state.status);
				ensureToolIframe({
					resourceUri,
					serverId,
					toolCallId: part.id,
					toolName,
					status: part.state.status,
					input: part.state.input,
					output: part.state.output,
					permissions:
						extractUiPermissions(part).length > 0 ? extractUiPermissions(part) : (matched?.permissions ?? []),
					groupContext: lastSkillRead,
				});
			}
			// 追加式通知流（iframe-rendering.md 3.4）：running 期间 progress 变化即转发，
			// 与状态推送解耦（同状态多次进度更新都要送达），故不受上方 status 去重影响。
			// 去重键 = progress 值 + uiEvent 指纹：MCP Apps 场景同一数值可携带不同扩展字段
			// （如 server.py 在 progress=total 时推送 review_pending），仅按数值判重会吞掉
			// uiEvent 不同的推送，导致审核按钮收不到 review_pending 而保持禁用。
			//
			// 时序约束：必须在本 part 的 tool-input/tool-result 通知**之后**发送 progress。
			// review-ui 的 tool-input handler 会把 progress/progressEvents 重置为 null/[]，
			// 若 progress 先于 tool-input 到达，review_pending 等扩展字段会被清空，
			// 审核界面停留在 processing 态、按钮禁用（注入/重放/快速完成场景可复现）。
			const progress = extractProgress(part);
			if (progress) {
				const fingerprint = `${progress.progress}${progress.uiEvent !== undefined ? `:${JSON.stringify(progress.uiEvent)}` : ""}`;
				if (progressRef.current.get(part.id) !== fingerprint) {
					progressRef.current.set(part.id, fingerprint);
					// G5：progress 发往该执行绑定的实例（并发下 A/B 各发各的通道，不串线）；
					// ensureToolIframe 已在上方绑定执行→实例，未绑定时回退基键
					const progressKey = iframePool.keyForExecution(part.id) ?? iframeKey;
					messageBridge.send(progressKey, "notifications/progress", {
						progress: progress.progress,
						...(progress.total !== undefined ? { total: progress.total } : {}),
						...(progress.message !== undefined ? { message: progress.message } : {}),
						// MCP Apps 扩展字段（server.py uiEvent，如 review_pending）原样透传
						...(progress.uiEvent !== undefined ? { uiEvent: progress.uiEvent } : {}),
					});
				}
			}
		}
	}
}

/**
 * iframe 渲染管线订阅（数据源 = 消息流缓存，历史与 SSE 增量共享）：
 * 扫描带 _meta.ui.resourceUri 的 tool part（父会话 + 活跃 subagent 子会话缓存），
 * 按 partId 记录上次状态，状态发生变化即推送一次，实现追加式通知流
 * （iframe-rendering.md 3.4 + subagent-mcp-apps-integration-steps.md 任务2）；
 * iframe 创建/复用/激活由 ensureToolIframe 完成（池按 resourceUri 全局共享）。
 */
export function useIframePipeline(sessionId: string | null): void {
	const queryClient = useQueryClient();
	const activeChildSessions = useAppStore((s) => s.activeChildSessions);
	// 已加载 Skill 列表：v2.2 归属上下文就绪门控依赖（groupContext 对应 Skill 的
	// SKILL.md 异步拉取完成后，跳过待判定的 tool part 重扫）
	const skills = useAppStore((s) => s.skills);
	// v2.7：Skill 实例列表（实例建档完成 = 就绪门控的第二个条件）
	const skillInstances = useAppStore((s) => s.skillInstances);
	const { data: messages = [] } = useQuery({
		queryKey: ["messages", sessionId],
		queryFn: () => fetchMessages(sessionId as string, sessionDirectoryOf(sessionId)),
		enabled: sessionId !== null,
	});

	// MCP Apps 工具定义清单（tool 名 → ui:// 绑定，iframe-rendering.md 第 2 节）
	const { data: mcpTools = [] } = useQuery({
		queryKey: ["mcp-tools"],
		queryFn: fetchMcpTools,
		staleTime: 5 * 60 * 1000,
	});

	// 活跃 subagent 子会话消息缓存的响应式订阅（任务2）：与 useSkillLoader 同机制，
	// useQueries 观察每个子会话缓存，使子会话 tool part 增量写入后下方扫描 effect 重跑，
	// 否则子会话 tool 的后续状态（completed/error）不会被扫描，冷启动 iframe 收不到
	// tool-result 而卡在"等待任务"。
	const childMessages = useQueries({
		queries: activeChildSessions.map((childSID) => ({
			queryKey: ["messages", childSID],
			queryFn: () => queryClient.getQueryData<MessageDTO[]>(["messages", childSID]) ?? [],
			enabled: false,
			staleTime: Infinity,
			placeholderData: () => queryClient.getQueryData<MessageDTO[]>(["messages", childSID]) ?? [],
		})),
	});
	// 子会话缓存快照作 effect 依赖：增量写入后引用变化触发重扫（幂等：pushedRef/progressRef 去重）
	const childMessagesSnapshots = childMessages.map((q) => q.data);

	// 后端持久化的 tool 执行记录（input/进度/结果，刷新与切会话后恢复）
	const { data: persistedEvents = [] } = useQuery({
		queryKey: ["tool-events", sessionId],
		queryFn: () => fetchToolEvents(sessionId as string),
		enabled: sessionId !== null,
		staleTime: 30_000,
	});

	// 持久化记录恢复：字段级补缺合并进 toolExecutions（内存已有值以实时为准）
	useEffect(() => {
		if (persistedEvents.length === 0) return;
		const state = useAppStore.getState();
		state.setToolExecutions(mergePersistedExecutions(state.toolExecutions, persistedEvents));
	}, [persistedEvents]);

	// MCP Apps 宿主侧协议（ui/initialize 应答等），应用内只需启动一次
	useEffect(() => {
		startHostProtocol();
	}, []);

	// partId -> 上次推送时的 status；同状态不重复推送
	const pushedRef = useRef(new Map<string, string>());
	// partId -> 上次推送的 progress 指纹（progress 值 + uiEvent，running 期间随 metadata 变化推送 iframe）
	const progressRef = useRef(new Map<string, string>());
	// 已触发「按需刷新清单」的插件工具名（防抖：同一 tool 只刷新一次）
	const unknownMcpToolsRef = useRef(new Set<string>());

	// 方案 A：插件新工具未命中（可能已冻结的）清单时，按需刷新 /mcp-tools。
	// refetch 后 mcpTools 更新 → 下方扫描 effect 重跑 → 补建 iframe / 归一化 toolName。
	const handleUnknownMcpTool = useCallback(
		(tool: string): void => {
			if (unknownMcpToolsRef.current.has(tool)) return;
			unknownMcpToolsRef.current.add(tool);
			void queryClient.refetchQueries({ queryKey: ["mcp-tools"] }).catch(() => undefined);
		},
		[queryClient],
	);

	// 会话切换：清空处理记录（iframe 池由统一重置点回收；
	// Skill 切换回收由 upsertSkill 在激活 Skill 变化时执行）
	// biome-ignore lint/correctness/useExhaustiveDependencies: 仅清空 ref，依赖数组有意最小化
	useEffect(() => {
		pushedRef.current.clear();
		progressRef.current.clear();
		unknownMcpToolsRef.current.clear();
	}, [sessionId]);

	// 父会话 tool part 扫描
	useEffect(() => {
		if (sessionId === null) return;
		scanMessagesForIframes(
			messages as MessageDTO[],
			mcpTools,
			skills,
			skillInstances,
			pushedRef,
			progressRef,
			handleUnknownMcpTool,
		);
	}, [sessionId, messages, mcpTools, skills, skillInstances, handleUnknownMcpTool]);

	// 活跃 subagent 子会话缓存扫描（任务2）：聚合事件写入 ["messages", childSID] 后，
	// 子会话内 MCP Apps tool part 同样走 iframe 管线
	// biome-ignore lint/correctness/useExhaustiveDependencies: childMessagesSnapshots 为有意依赖（子会话缓存快照触发重扫）
	useEffect(() => {
		if (sessionId === null || activeChildSessions.length === 0) return;
		for (const childSID of activeChildSessions) {
			const childMessagesList = queryClient.getQueryData<MessageDTO[]>(["messages", childSID]);
			if (!childMessagesList) continue;
			scanMessagesForIframes(
				childMessagesList,
				mcpTools,
				skills,
				skillInstances,
				pushedRef,
				progressRef,
				handleUnknownMcpTool,
			);
		}
	}, [
		sessionId,
		activeChildSessions,
		childMessagesSnapshots,
		mcpTools,
		skills,
		skillInstances,
		queryClient,
		handleUnknownMcpTool,
	]);
}
