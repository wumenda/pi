import type { MessageDTO } from "@platform/shared";
import { type QueryClient, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchFileContent } from "../../api/files";
import { fetchMessages } from "../../api/messages";
import { fetchSkills, fetchSkillWhitelist } from "../../api/settings";
import { SOLO_GROUP_KEY, useAppStore } from "../../stores/app-store";
import { parseFrontmatter } from "../../utils/frontmatter";
import { findAllSkillInfos, hasNonSkillToolCall, type SkillPartInfo } from "../../utils/skill";

/** 降级元数据（metadataUnavailable）的单实例最大重拉次数：SKILL.md 临时不可读时自愈 */
const METADATA_RETRY_LIMIT = 3;

/**
 * 拉取并写入 skill 元数据（方案3：注册表优先）。元数据以服务端 /api/v1/skills
 * 注册表为单一事实来源（全局 + 项目 skills 根扫描、去重、降级判定全部收敛在后端）；
 * 注册表未收录该 skill（如非标准 skills 根目录加载）时兜底直读 SKILL.md 解析 frontmatter；
 * 两路均失败降级为仅 name（布局文档 3.2.2 步骤 4-6）。
 */
async function loadSkill(info: SkillPartInfo, queryClient: QueryClient): Promise<void> {
	const { upsertSkill, upsertSkillInstance, setSkillLoading } = useAppStore.getState();
	setSkillLoading(true);
	try {
		// 注册表取自 React Query 缓存（与设置页共用 ["skills"] 键，60s 内复用，避免逐 skill 重拉）
		const registry = await queryClient
			.fetchQuery({
				queryKey: ["skills"],
				queryFn: fetchSkills,
				staleTime: 60_000,
			})
			// 注册表请求失败不阻断兜底直读
			.catch(() => undefined);
		const dto = registry?.find((s) => s.name === info.name);
		if (dto) {
			upsertSkill({
				name: dto.name,
				...(dto.title !== undefined ? { title: dto.title } : {}),
				description: dto.description,
				version: dto.version,
				tools: dto.tools,
				// 后端已判定 SKILL.md 缺失/解析失败（metadataUnavailable=true）→ 展示降级
				...(dto.metadataUnavailable === true ? { metadataUnavailable: true } : {}),
			});
			return;
		}
		// 兜底：注册表未收录（非标准 skills 根目录加载）→ 直读 SKILL.md
		const file = await fetchFileContent(`${info.directory}/SKILL.md`);
		if (file.type !== "text") throw new Error("SKILL.md 不是文本文件");
		const meta = parseFrontmatter(file.content);
		if (!meta) throw new Error("frontmatter 解析失败");
		upsertSkill({
			name: meta.name,
			...(meta.title !== undefined ? { title: meta.title } : {}),
			description: meta.description,
			version: meta.version,
			tools: meta.tools,
		});
	} catch {
		upsertSkill({ name: info.name, tools: [], metadataUnavailable: true });
	} finally {
		// v2.7 强流程：无论成功/降级都建档 Skill 实例（每次 skill 读取 = 一个新实例 Tab；
		// title/tools 由 store 从 skills[] 取副本）。降级时 tools=[]，Tab 与归属键仍存在。
		upsertSkillInstance(info);
		setSkillLoading(false);
	}
}

/**
 * Skill 加载链路（布局文档 3.2.2）：扫描消息流中的 skill tool part
 * （历史与 SSE 增量共享同一 React Query 缓存）→ 取最后一次加载 →
 * 元数据以 /api/v1/skills 注册表优先（兜底直读 SKILL.md）→ upsertSkill（顶层 Tab 累计）；
 * 并在 Skill 加载后首个（非 skill）tool 调用时自动切 iframe 视图（布局文档 3.1 状态 3→4）。
 */
export function useSkillLoader(sessionId: string | null): void {
	const queryClient = useQueryClient();
	const activeChildSessions = useAppStore((s) => s.activeChildSessions);
	const setCenterView = useAppStore((s) => s.setCenterView);
	const activeSkillName = useAppStore((s) => s.activeSkillName);
	// 元数据列表：降级重试判定 + 扫描 effect 依赖（降级 upsert 触发有限重试）
	const skills = useAppStore((s) => s.skills);
	// iframe 池快照：自动切视图的状态 3→4 需观察池变化——iframe 晚于激活到达时
	// （就绪门控放行后的重扫建池）也要能完成切换，不能只盯 activeSkillName/messages
	const iframePool = useAppStore((s) => s.iframePool);

	const { data: messages = [] } = useQuery({
		queryKey: ["messages", sessionId],
		queryFn: () => fetchMessages(sessionId as string),
		enabled: sessionId !== null,
	});

	// 活跃 subagent 子会话消息缓存的响应式订阅：
	// 用 useQueries 观察每个子会话的 ["messages", childSID] 缓存（enabled=false 不发起请求，
	// placeholderData 读缓存），使子会话缓存被 setQueryData 增量更新时本 hook 重渲染、
	// 下方扫描 effect 随数据变化重跑——避免仅首次登记子会话时扫描一次、后续增量丢失。
	const childMessages = useQueries({
		queries: activeChildSessions.map((childSID) => ({
			queryKey: ["messages", childSID],
			queryFn: () => queryClient.getQueryData<MessageDTO[]>(["messages", childSID]) ?? [],
			enabled: false,
			staleTime: Infinity,
			placeholderData: () => queryClient.getQueryData<MessageDTO[]>(["messages", childSID]) ?? [],
		})),
	});
	// 缓存未更新时 useQueries 数据引用稳定；此处取各子会话缓存快照作 effect 依赖，
	// 子会话消息增量写入后引用变化即触发重扫（幂等：loadedRef 去重）。
	const childMessagesSnapshots = childMessages.map((q) => q.data);

	// 已处理的 skill 加载标记（"name:directory:instanceId"），避免每次消息更新重复拉取；
	// Set 支持会话内多 skill 各自去重（会话重放恢复全部 skill 实例 Tab，而非仅最后 1 个）。
	// v2.7：键含 instanceId——同名 Skill 每次读取（不同 part.id）都是独立实例，不再被吞。
	const loadedRef = useRef<Set<string>>(new Set());
	// 降级元数据（metadataUnavailable）的重试计数：SKILL.md 临时不可读（后端重启/瞬时
	// 失败）时限次重拉自愈；永久不可读则到限为止，不无限循环。键同 loadedRef。
	const metadataRetryRef = useRef(new Map<string, number>());

	// 会话切换：重置标记（skills/激活态由统一重置点 setCurrentSession 清空）
	// biome-ignore lint/correctness/useExhaustiveDependencies: refs 清理仅依赖会话 id
	useEffect(() => {
		loadedRef.current = new Set();
		metadataRetryRef.current.clear();
	}, [sessionId]);

	// skill tab 白名单拉取（iframe-rendering.md 4.6）：后端 /skills/whitelist 下发；
	// 失败静默保持空数组（= 全部允许，与现状一致）。随会话进入拉取一次，配置热更新后重进会话即生效。
	useEffect(() => {
		if (sessionId === null) return;
		void fetchSkillWhitelist()
			.then((whitelist) => useAppStore.getState().setSkillWhitelist(whitelist ?? []))
			.catch(() => undefined);
	}, [sessionId]);

	// 父会话 skill 加载扫描（布局文档 3.2.2）：会话内全部 skill 读取逐次建档
	// （会话重放恢复全部实例 Tab；仅取最后一个会让切回后多 skill 会话只剩 1 个）。
	// 依赖含 skills：降级重试的 upsertSkill 变更引用后重扫，驱动限次重拉
	useEffect(() => {
		if (sessionId === null) return;
		for (const info of findAllSkillInfos(messages as MessageDTO[])) {
			const key = `${info.name}:${info.directory}:${info.instanceId}`;
			if (loadedRef.current.has(key)) {
				// 已建档但元数据降级：有限重试（空 tools 声明会把该技能工具的 iframe
				// 永久误归「单独调用」，必须等声明到达后重新正确归属）
				const degraded = skills.some((s) => s.name === info.name && s.metadataUnavailable === true);
				if (!degraded || (metadataRetryRef.current.get(key) ?? 0) >= METADATA_RETRY_LIMIT) {
					continue;
				}
				metadataRetryRef.current.set(key, (metadataRetryRef.current.get(key) ?? 0) + 1);
			} else {
				loadedRef.current.add(key);
			}
			void loadSkill(info, queryClient);
		}
	}, [sessionId, messages, skills, queryClient]);

	// 活跃 subagent 子会话 skill 扫描（任务3）：子会话内 skill 加载同样产生分组 Tab
	// （降级重试逻辑与父会话扫描一致）
	// biome-ignore lint/correctness/useExhaustiveDependencies: childMessagesSnapshots 为有意依赖（子会话缓存快照触发重扫）
	useEffect(() => {
		if (sessionId === null || activeChildSessions.length === 0) return;
		for (const childSID of activeChildSessions) {
			const childMessagesList = queryClient.getQueryData<MessageDTO[]>(["messages", childSID]);
			if (!childMessagesList) continue;
			for (const info of findAllSkillInfos(childMessagesList)) {
				const key = `${info.name}:${info.directory}:${info.instanceId}`;
				if (loadedRef.current.has(key)) {
					const degraded = skills.some((s) => s.name === info.name && s.metadataUnavailable === true);
					if (!degraded || (metadataRetryRef.current.get(key) ?? 0) >= METADATA_RETRY_LIMIT) {
						continue;
					}
					metadataRetryRef.current.set(key, (metadataRetryRef.current.get(key) ?? 0) + 1);
				} else {
					loadedRef.current.add(key);
				}
				void loadSkill(info, queryClient);
			}
		}
	}, [sessionId, activeChildSessions, childMessagesSnapshots, skills, queryClient]);

	// 状态 (3)→(4)：Skill 加载完成后首个非 skill tool 调用 → 自动切 iframe 视图。
	// v2.4/v2.7 分组隔离：仅当当前激活分组（activeSkillName，v2.7 起为 skill 实例键）
	// 在 iframe 池中确有 iframe 时才切——若该实例尚未执行任何 tool（无本组 iframe），
	// 保持 skill 视图，避免切到其他分组（含同名 Skill 其他实例）的残留 iframe。
	const autoSwitchedRef = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 仅重置 ref，依赖数组有意最小化
	useEffect(() => {
		autoSwitchedRef.current = false;
	}, [activeSkillName]);

	useEffect(() => {
		if (!activeSkillName || autoSwitchedRef.current) return;
		if (!hasNonSkillToolCall(messages as MessageDTO[])) return;
		const hasIframeInGroup = [...iframePool.values()].some(
			(instance) => (instance.group ?? SOLO_GROUP_KEY) === activeSkillName,
		);
		if (!hasIframeInGroup) return;
		autoSwitchedRef.current = true;
		setCenterView("iframe");
	}, [activeSkillName, messages, iframePool, setCenterView]);
}
