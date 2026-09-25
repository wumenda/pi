import type { SkillWhitelistItem } from "@platform/shared";
import { create } from "zustand";
import { resetSkillRegistry } from "../api/transcript";
import { type IframeAcquireMeta, iframePool } from "../mcp-iframe/IframePool";
import { type IframeEventPayload, iframeEventReporter } from "../mcp-iframe/iframe-event-reporter";
import { messageBridge } from "../mcp-iframe/MessageBridge";
import { THEME_STORAGE_KEY } from "../theme-storage";
import type {
	IframeInstance,
	PendingPermission,
	PendingQuestion,
	PromptPrefs,
	SessionSummary,
	Skill,
	SkillInstance,
	SkillReadContext,
	ThemeMode,
	ToolExecution,
} from "../types";
import { SOLO_GROUP_KEY, toolNameOf, toolTitleOf } from "../types";
import type { SkillPartInfo } from "../utils/skill";

// 兼容既有导入（AppLayout/ToolTabBar/ToolExecutionPanel/测试从 store 导入）
export { SOLO_GROUP_KEY };

function initialTheme(): ThemeMode {
	// 全站（含 redesign 页面）已完成深色适配，恢复读取持久化偏好，缺省浅色。
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	return stored === "dark" || stored === "light" ? stored : "light";
}

/** 发送偏好持久化 key（Agent 预设 / 模型 / 思考强度，全局记忆） */
const PROMPT_PREFS_KEY = "prompt-prefs";

function initialPromptPrefs(): PromptPrefs {
	try {
		const raw = localStorage.getItem(PROMPT_PREFS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<PromptPrefs>;
			return {
				agent: typeof parsed.agent === "string" ? parsed.agent : undefined,
				model: typeof parsed.model === "string" ? parsed.model : undefined,
				reasoning:
					parsed.reasoning === "low" || parsed.reasoning === "medium" || parsed.reasoning === "high"
						? parsed.reasoning
						: "off",
			};
		}
	} catch {
		// 损坏的本地数据按默认值处理
	}
	return { reasoning: "off" };
}

/** 单视图模式（<900px）下的当前视图 */
export type MobileView = "sessions" | "workspace" | "chat";

/**
 * tool → 一级分组判定（v2.2/v2.7 上下文时序）：tool 归入哪个一级分组取决于
 * 「该 tool 执行时是否处于某次 Skill 读取动作之后」——即 groupContext 指定的
 * 最近读取 Skill 实例是否声明了该 tool；而非遍历全部已加载 skills[] 按静态声明匹配。
 * opencode 为 MCP tool 加 `<server>_` 前缀（如 mcp-apps-ui-example_simple_tool），
 * 与 matchMcpTool 一致按「全等或后缀」匹配。
 * - 有 groupContext 且该 Skill（在 skills[] 中）的 tools 声明包含 toolName
 *   → 归入该 Skill **实例**（v2.7：返回 `<name>#<instanceId>` 实例键，同名 Skill
 *   每次读取独立分组，同 resourceUri 的 tool 跨实例不复用 iframe）；
 * - 无 groupContext / 该 Skill 未声明此 tool / 该 Skill 尚不在 skills[]（SKILL.md 未就绪）
 *   → "单独调用"。
 */
function resolveToolGroup(
	toolName: string | undefined,
	skills: Skill[],
	groupContext?: SkillReadContext | null,
): string {
	if (toolName && groupContext) {
		const owner = skills.find((skill) => skill.name === groupContext.name);
		if (
			owner &&
			(owner.tools.some((t) => toolNameOf(t) === toolName) ||
				owner.tools.some((t) => toolName.endsWith(`_${toolNameOf(t)}`)))
		) {
			return `${groupContext.name}#${groupContext.instanceId}`;
		}
	}
	return SOLO_GROUP_KEY;
}

/**
 * 从已加载 Skill 的 tools 声明解析 tool 展示名（中文名优先，缺省回退标识符）。
 * 命中归属 Skill 且其声明包含 toolName（全等/后缀匹配）→ title ?? name；
 * 未命中（__solo__、SKILL.md 降级无声明、声明不含该 tool）→ undefined
 * （调用方维持 toolName 原样，iframe-rendering.md 4.4.2/4.4.3）。
 */
function resolveToolTitle(toolName: string | undefined, group: string, skills: Skill[]): string | undefined {
	if (!toolName || group === SOLO_GROUP_KEY) return undefined;
	// v2.7：group 为 skill 实例键 `<name>#<instanceId>`，解析出 skill 名再查元数据
	// （实例键只做分组隔离，不做元数据检索，见 iframe-rendering.md 4.1）
	const skillName = group.split("#")[0];
	const owner = skills.find((skill) => skill.name === skillName);
	if (!owner) return undefined;
	const declared =
		owner.tools.find((t) => toolNameOf(t) === toolName) ??
		owner.tools.find((t) => toolName.endsWith(`_${toolNameOf(t)}`));
	return declared === undefined ? undefined : toolTitleOf(declared);
}

/** 取分组内最近使用的 iframe（无则 null） */
function latestInGroup(pool: Map<string, IframeInstance>, group: string): string | null {
	let uri: string | null = null;
	let latest = -1;
	for (const [key, instance] of pool) {
		if ((instance.group ?? SOLO_GROUP_KEY) !== group) continue;
		if (instance.lastUsedAt > latest) {
			latest = instance.lastUsedAt;
			uri = key;
		}
	}
	return uri;
}

/**
 * 取 resourceUri（+ 归属 serverId，G4）在池中最近使用的实例。
 * 按实例字段匹配（不解析复合键）；serverId 缺省时仅匹配无 server 归属的旧条目。
 */
function latestInstanceForResourceUri(
	pool: Map<string, IframeInstance>,
	resourceUri: string,
	serverId?: string,
): { key: string; instance: IframeInstance } | null {
	let best: { key: string; instance: IframeInstance } | null = null;
	let latest = -1;
	for (const [key, instance] of pool) {
		if (instance.resourceUri !== resourceUri) continue;
		if (instance.serverId !== serverId) continue; // undefined 与具体 serverId 互不匹配（隔离）
		// B7：按池的单调序号 lastUsedSeq 判定最近——同毫秒多次使用（重放批量建档）
		// 时墙钟 lastUsedAt 相同，严格 > 恒假会恒选遍历序第一个
		if (instance.lastUsedSeq > latest) {
			latest = instance.lastUsedSeq;
			best = { key, instance };
		}
	}
	return best;
}

/**
 * 解析 tool 调用的归属分组（v2.7 复合键池辅助，pipeline.ts 与 store 共用）：
 * - 有 groupContext（上下文时序）→ 按 skills 声明解析 skill 实例键；
 * - 无 groupContext（ToolCard 手动激活）→ 沿用池内该 resourceUri 最近使用的实例分组，
 *   保持「手动激活不误切分组」既有保证（G4：限定同 serverId 的实例，跨 server 不串组）；
 * - 均无 → 「单独调用」。
 */
export function resolveIframeGroup(
	resourceUri: string,
	toolName: string | undefined,
	groupContext?: SkillReadContext | null,
	serverId?: string,
): string {
	const { skills, iframePool } = useAppStore.getState();
	if (groupContext) {
		return resolveToolGroup(toolName, skills, groupContext);
	}
	const existing = latestInstanceForResourceUri(iframePool, resourceUri, serverId);
	return existing ? (existing.instance.group ?? SOLO_GROUP_KEY) : SOLO_GROUP_KEY;
}

/**
 * 全局状态（布局文档第 5 章 + 原型双层 Tab）。
 * 一致性约束：
 * - activeIframeUri 必须指向 iframePool 中存在的 key，二者同步增删；
 * - iframe 按一级分组（Skill / 单独调用）保留：切换 Skill 不销毁 iframe，
 *   仅切换可见视图（切回由常驻 iframe 容器保证应用状态不丢）；
 * - setCurrentSession 是统一重置点：清 iframePool / skills / 激活态，centerView 复位。
 */
export interface AppState {
	currentSessionId: string | null;
	sessions: SessionSummary[];
	/** 会话内累计加载的 Skill 元数据缓存（按 name 去重，声明比对用；v2.7 起不再直接驱动一级 Tab） */
	skills: Skill[];
	/** 会话内 Skill 实例（v2.7 强流程：同名 Skill 每次读取建档一条，一级分组 Tab 数据源） */
	skillInstances: SkillInstance[];
	/** skill tab 白名单（.data/skill-whitelist.json 下发，允许列表 + title 兜底；空 = 全部允许，iframe-rendering.md 4.6） */
	skillWhitelist: SkillWhitelistItem[];
	/** 当前激活的一级分组（v2.7：skill 实例键 `<name>#<instanceId>` 或 SOLO_GROUP_KEY"单独调用"；字段名保留，语义为分组键） */
	activeSkillName: string | null;
	/** 中区内容视图：Skill 元数据面板 / tool iframe */
	centerView: "skill" | "iframe";
	iframePool: Map<string, IframeInstance>;
	activeIframeUri: string | null;
	toolExecutions: ToolExecution[];
	/** 正在等待 AI 回复的会话 ID（发送中禁用输入框；session.idle 后清除） */
	streamingSessionId: string | null;
	/** 各会话最近一次终态事件（session.idle/session.error）到达时间（A3：发送侧据此识别"终态先于 202"竞态） */
	sessionTerminalAt: Record<string, number>;
	/** 各会话最近一次发送发起时间（F2：挂载期 status 查询结果判陈旧用，与 sessionTerminalAt 同族） */
	sessionPromptAt: Record<string, number>;
	/** 当前会话 SSE 连接状态（useSessionEvents 回报；头部状态点据此展示"AI 在线/重连中/已断开"） */
	sseState: "connecting" | "open" | "reconnecting" | "closed" | null;
	/** SKILL.md 获取与解析进行中（布局文档 3.1 状态 (2)：Tab 显示加载动画） */
	skillLoading: boolean;
	/** 主会话挂起问答请求（T9：request-scoped，按 requestID 索引）。 */
	pendingQuestions: Record<string, PendingQuestion>;
	/** 各会话最近一次 tool.progress 事件时间（T9 长任务健康信号；useSessionEvents 记账，useToolHealth 消费） */
	toolProgressAt: Record<string, number>;
	/** 当前 permission 挂起请求（permission 事件 → 置入；回复后清除） */
	pendingPermission: PendingPermission | null;
	/** subagent 子会话的 question 挂起请求（按 childSessionID 隔离，subagent-mcp-apps-integration-steps.md 任务4） */
	childPendingQuestions: Record<string, PendingQuestion>;
	/** subagent 子会话的 permission 挂起请求（按 childSessionID 隔离） */
	childPendingPermissions: Record<string, PendingPermission>;
	/** 当前活跃的 subagent 子会话 id（P3 聚合事件出现过的 childSessionID；iframe/skill 管线据此扫描子会话缓存） */
	activeChildSessions: string[];
	/** 左栏会话抽屉开关（窄屏 900–1199px；置入 store 供新建会话联动收起） */
	drawerOpen: boolean;
	/** 设置卡片开关（顶栏 + 左栏底部按钮共用；置入 store 供两处控制） */
	settingsOpen: boolean;
	/** 单视图模式当前视图（<900px） */
	mobileView: MobileView;
	/** 主题模式（全局偏好；切换同步 <html data-theme> 与 localStorage） */
	theme: ThemeMode;
	/** 发送偏好（Agent 预设 / 模型 / 思考强度，全局记忆并持久化） */
	promptPrefs: PromptPrefs;

	setCurrentSession: (id: string | null) => void;
	setSessions: (sessions: SessionSummary[]) => void;
	upsertSession: (session: SessionSummary) => void;
	removeSession: (id: string) => string | null;
	setSessionSummary: (id: string, summary: string) => void;
	setStreamingSession: (sessionId: string | null) => void;
	/** 记录会话最近一次终态事件时间（at 可注入供测试） */
	markSessionTerminal: (sessionId: string, at?: number) => void;
	/** 记录会话最近一次发送发起时间（at 可注入供测试） */
	markSessionPrompt: (sessionId: string, at?: number) => void;
	setSseState: (state: "connecting" | "open" | "reconnecting" | "closed" | null) => void;
	setSkillLoading: (loading: boolean) => void;
	/** 覆盖 skill tab 白名单（后端下发；空数组 = 全部允许） */
	setSkillWhitelist: (whitelist: SkillWhitelistItem[]) => void;
	/** 置入/覆盖指定 requestID 的 question 挂起请求（SSE 断线补发幂等） */
	upsertPendingQuestion: (question: PendingQuestion) => void;
	/** 按 requestID 清除挂起请求；不传 requestID 清空全部（会话切换/重置） */
	clearPendingQuestion: (requestID?: string) => void;
	/** 记录会话最近一次 progress 事件时间（T9 长任务健康；at 可注入供测试） */
	recordToolProgress: (sessionId: string, at?: number) => void;
	setPendingPermission: (permission: PendingPermission | null) => void;
	/** 子会话 question 挂起请求：置入 / 按 requestID 清除（无 requestID 时清空该会话全部） */
	setChildPendingQuestion: (childSessionId: string, question: PendingQuestion | null) => void;
	clearChildPendingQuestion: (childSessionId: string, requestID?: string) => void;
	/** 子会话 permission 挂起请求：置入 / 按 requestID 清除 */
	setChildPendingPermission: (childSessionId: string, permission: PendingPermission | null) => void;
	clearChildPendingPermission: (childSessionId: string, requestID?: string) => void;
	/** 登记/移除活跃 subagent 子会话 id（幂等） */
	addActiveChildSession: (childSessionId: string) => void;
	setDrawerOpen: (open: boolean) => void;
	/** 设置卡片开关（顶栏 + 左栏底部按钮共用） */
	setSettingsOpen: (open: boolean) => void;
	setMobileView: (view: MobileView) => void;
	setTheme: (theme: ThemeMode) => void;
	toggleTheme: () => void;
	/** 合并更新发送偏好并持久化 */
	setPromptPrefs: (partial: Partial<PromptPrefs>) => void;

	/** 加载（新增或更新）Skill 元数据缓存（按 name 去重，声明比对用；v2.7 不再驱动 Tab/视图） */
	upsertSkill: (skill: Skill) => void;
	/** 建档 Skill 实例（v2.7 强流程）：每次 skill 读取追加一条实例并激活对应分组 Tab */
	upsertSkillInstance: (info: SkillPartInfo) => void;
	/** 切换一级分组 Tab（入参为分组键：skill 实例键或 __solo__；仅切换视图，不回收 iframe） */
	setActiveSkill: (name: string) => void;
	setCenterView: (view: "skill" | "iframe") => void;
	/** 取得（创建或复用）iframe 并激活；池数据由 mcp-iframe/IframePool 管理，store 持快照供响应式渲染 */
	acquireIframe: (resourceUri: string, meta?: IframeAcquireMeta) => void;
	/** 激活池中已有的 iframe（仅在池内存在时生效） */
	activateIframe: (resourceUri: string) => void;
	/** 从池中移除并销毁对应 iframe DOM；池空回退 Skill 视图，否则自动激活剩余首个 */
	releaseIframe: (resourceUri: string) => void;
	/** 清空整个 iframe 池并销毁 DOM（会话切换/Skill 卸载） */
	destroyAllIframes: () => void;
	setToolExecutions: (list: ToolExecution[]) => void;
	/** 新执行记录插入头部（按时间倒序） */
	upsertToolExecution: (exec: ToolExecution) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
	currentSessionId: null,
	sessions: [],
	skills: [],
	skillInstances: [],
	skillWhitelist: [],
	activeSkillName: null,
	centerView: "skill",
	iframePool: new Map(),
	activeIframeUri: null,
	toolExecutions: [],
	streamingSessionId: null,
	sessionTerminalAt: {},
	sessionPromptAt: {},
	sseState: null,
	skillLoading: false,
	pendingQuestions: {},
	toolProgressAt: {},
	pendingPermission: null,
	childPendingQuestions: {},
	childPendingPermissions: {},
	activeChildSessions: [],
	drawerOpen: false,
	settingsOpen: false,
	mobileView: "workspace",
	theme: initialTheme(),
	promptPrefs: initialPromptPrefs(),

	setCurrentSession: (id) => {
		// 统一重置点：先全量回收 iframe（含 DOM 销毁），再复位其余状态
		get().destroyAllIframes();
		resetSkillRegistry(); // pi 适配：skill 注册表缓存随会话切换重建
		set({
			currentSessionId: id,
			skills: [],
			skillInstances: [],
			activeSkillName: null,
			centerView: "skill",
			toolExecutions: [],
			skillLoading: false,
			sseState: null,
			pendingQuestions: {},
			toolProgressAt: {},
			sessionTerminalAt: {}, // A3：终态记账一并重置
			sessionPromptAt: {},
			pendingPermission: null,
			childPendingQuestions: {},
			childPendingPermissions: {},
			activeChildSessions: [],
		});
	},

	setSessions: (sessions) => set({ sessions }),

	upsertSession: (session) =>
		set((state) => {
			const rest = state.sessions.filter((s) => s.id !== session.id);
			// 列表保持倒序：新会话/刚更新的会话放最前
			return { sessions: [session, ...rest] };
		}),

	removeSession: (id) => {
		const { sessions, currentSessionId } = get();
		const index = sessions.findIndex((s) => s.id === id);
		const next = sessions.filter((s) => s.id !== id);
		set({ sessions: next });
		if (currentSessionId === id) {
			// 删除当前会话：自动切到列表中最近的下一个会话（原列表中该会话的后一项）
			const nextSession = next[Math.min(index, next.length - 1)] ?? null;
			get().setCurrentSession(nextSession?.id ?? null);
			return nextSession?.id ?? null;
		}
		return currentSessionId;
	},

	setSessionSummary: (id, summary) =>
		set((state) => ({
			sessions: state.sessions.map((s) => (s.id === id ? { ...s, lastMessageSummary: summary } : s)),
		})),

	setStreamingSession: (sessionId) => set({ streamingSessionId: sessionId }),

	markSessionTerminal: (sessionId, at = Date.now()) =>
		set((state) => ({ sessionTerminalAt: { ...state.sessionTerminalAt, [sessionId]: at } })),
	markSessionPrompt: (sessionId, at = Date.now()) =>
		set((state) => ({ sessionPromptAt: { ...state.sessionPromptAt, [sessionId]: at } })),

	setSseState: (state) => set({ sseState: state }),

	setSkillLoading: (loading) => set({ skillLoading: loading }),

	/**
	 * 覆盖 skill tab 白名单（后端 /skills/whitelist 下发；空数组 = 全部允许）。
	 * 对已加载且尚无 title 的 skill 补注入白名单 title（iframe-rendering.md 4.6）：
	 * 白名单异步到达可能晚于 skill 加载（useSkillLoader 拉 SKILL.md 与白名单并发），
	 * 若不在到达时补齐，title 兜底会漏。SKILL.md 自带 title 的 skill 不覆盖（兜底优先度最低）。
	 * v2.7：Skill 实例的 title 副本同步补注入（实例可能在白名单到达前建档）。
	 */
	setSkillWhitelist: (whitelist) =>
		set((state) => ({
			skillWhitelist: whitelist,
			skills: state.skills.map((skill) => {
				if (skill.title !== undefined) return skill; // SKILL.md title 优先，不覆盖
				const wl = whitelist.find((w) => w.name === skill.name);
				return wl?.title !== undefined ? { ...skill, title: wl.title } : skill;
			}),
			skillInstances: state.skillInstances.map((inst) => {
				if (inst.title !== undefined) return inst;
				const wl = whitelist.find((w) => w.name === inst.name);
				return wl?.title !== undefined ? { ...inst, title: wl.title } : inst;
			}),
		})),

	upsertPendingQuestion: (question) =>
		set((state) => ({
			pendingQuestions: { ...state.pendingQuestions, [question.requestID]: question },
		})),

	clearPendingQuestion: (requestID) =>
		set((state) => {
			if (requestID === undefined) return { pendingQuestions: {} };
			const next = { ...state.pendingQuestions };
			delete next[requestID];
			return { pendingQuestions: next };
		}),

	recordToolProgress: (sessionId, at = Date.now()) =>
		set((state) => ({ toolProgressAt: { ...state.toolProgressAt, [sessionId]: at } })),

	setTheme: (theme) => {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
		document.documentElement.dataset.theme = theme;
		set({ theme });
		// 向全部存活 iframe 广播主题变更，已挂载的 MCP App 实时换肤（不依赖 iframe 重建）
		messageBridge.broadcastTheme(theme);
	},

	toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

	setPromptPrefs: (partial) =>
		set((state) => {
			const promptPrefs = { ...state.promptPrefs, ...partial };
			try {
				localStorage.setItem(PROMPT_PREFS_KEY, JSON.stringify(promptPrefs));
			} catch {
				// 持久化失败不影响本次会话使用
			}
			return { promptPrefs };
		}),

	setPendingPermission: (permission) => set({ pendingPermission: permission }),

	setChildPendingQuestion: (childSessionId, question) =>
		set((state) => {
			const next = { ...state.childPendingQuestions };
			if (question === null) delete next[childSessionId];
			else next[childSessionId] = question;
			return { childPendingQuestions: next };
		}),

	clearChildPendingQuestion: (childSessionId, requestID) =>
		set((state) => {
			const current = state.childPendingQuestions[childSessionId];
			// 无 requestID 或匹配时清空该会话槽位（防并发会话/历史事件误清）
			if (!current || !requestID || requestID === current.requestID) {
				const next = { ...state.childPendingQuestions };
				delete next[childSessionId];
				return { childPendingQuestions: next };
			}
			return state;
		}),

	setChildPendingPermission: (childSessionId, permission) =>
		set((state) => {
			const next = { ...state.childPendingPermissions };
			if (permission === null) delete next[childSessionId];
			else next[childSessionId] = permission;
			return { childPendingPermissions: next };
		}),

	clearChildPendingPermission: (childSessionId, requestID) =>
		set((state) => {
			const current = state.childPendingPermissions[childSessionId];
			if (!current || !requestID || requestID === current.permissionID) {
				const next = { ...state.childPendingPermissions };
				delete next[childSessionId];
				return { childPendingPermissions: next };
			}
			return state;
		}),

	addActiveChildSession: (childSessionId) =>
		set((state) =>
			state.activeChildSessions.includes(childSessionId)
				? state
				: { activeChildSessions: [...state.activeChildSessions, childSessionId] },
		),

	setDrawerOpen: (open) => set({ drawerOpen: open }),

	setSettingsOpen: (open) => set({ settingsOpen: open }),

	setMobileView: (view) => set({ mobileView: view }),

	upsertSkill: (skill) => {
		const { skills, skillWhitelist } = get();
		const isNewSkill = !skills.some((s) => s.name === skill.name);
		// 白名单 title 兜底（iframe-rendering.md 4.6）：SKILL.md 自带 title 优先，
		// 缺省时用白名单声明的 title；两者皆无回退 name（渲染层 title ?? name）。
		// 归属判定仍用 skill.name，与 title 无关（4.1）。
		const whitelistTitle = skillWhitelist.find((w) => w.name === skill.name)?.title;
		const merged: Skill = {
			...skill,
			...(whitelistTitle !== undefined && skill.title === undefined ? { title: whitelistTitle } : {}),
		};
		// v2.7：仅维护按 name 去重的元数据缓存（声明比对/展示名解析用）；
		// 一级 Tab 与视图联动由 upsertSkillInstance 负责（每次 skill 读取建档实例）。
		// pi 适配：skill-events 审计上报端点不存在，观测数据仅在内存维护。
		set({
			skills: isNewSkill ? [...skills, merged] : skills.map((s) => (s.name === skill.name ? merged : s)),
		});
	},

	/**
	 * 建档 Skill 实例（v2.7 强流程）：每次 skill 读取追加一条独立实例（一级分组 Tab 数据源），
	 * 激活该实例分组；实例组无 iframe 时切 skill 元数据视图（有 iframe 保持当前视图，
	 * 避免打断已执行的 tool iframe 展示，5.1）。重扫幂等：同 part.id 已建档则忽略。
	 */
	upsertSkillInstance: (info) => {
		const instanceKey = `${info.name}#${info.instanceId}`;
		if (get().skillInstances.some((i) => i.instanceId === info.instanceId)) return;
		// 从 skills[] 元数据缓存取 title/tools 副本（白名单 title 已并入 skills[].title，4.6）
		const skill = get().skills.find((s) => s.name === info.name);
		const title = skill?.title;
		const tools = skill?.tools ?? [];
		const hasIframeInGroup = latestInGroup(iframePool.snapshot(), instanceKey) !== null;
		set({
			skillInstances: [
				...get().skillInstances,
				{
					instanceId: info.instanceId,
					name: info.name,
					...(title !== undefined ? { title } : {}),
					tools,
					directory: info.directory,
					createdAt: Date.now(),
				},
			],
			activeSkillName: instanceKey,
			centerView: hasIframeInGroup ? get().centerView : "skill",
		});
	},

	/** 切换一级分组 Tab（入参为分组键：skill 实例键或 __solo__）：组内有 iframe → 激活组内最近使用者进 tool 视图；无 → 元数据视图，并复位激活 iframe（分组隔离，不残留其他分组 iframe） */
	setActiveSkill: (name) => {
		const uri = latestInGroup(iframePool.snapshot(), name);
		if (uri !== null) {
			iframePool.activate(uri);
			set({
				activeSkillName: name,
				iframePool: iframePool.snapshot(),
				activeIframeUri: iframePool.activeResourceUri,
				centerView: "iframe",
			});
			return;
		}
		set({ activeSkillName: name, activeIframeUri: null, centerView: "skill" });
	},

	setCenterView: (view) => set({ centerView: view }),

	/** 取得（创建或复用）iframe 并激活；归属分组按「上下文时序」判定（4.1，v2.7 落点为 skill 实例键），激活态同步一级 Tab */
	acquireIframe: (resourceUri, meta) => {
		// groupContext 是归属判定的上下文（最近读取的 Skill 实例），只在 store 层用于解析归属，
		// 不写入池实例，故从透传给 iframePool.acquire 的 meta 中剥离。
		// toolName（归属/展示名解析用标识符）同样仅用于 store 层解析，不写入池实例。
		const { groupContext, toolName, ...poolMeta } = meta ?? {};
		const name = toolName ?? poolMeta.title;
		// 复用已有实例时保留其归属分组（与 activateIframe 一致：激活不改变归属）；
		// 仅新建时才按上下文时序解析——否则 ToolCard 手动激活（无 groupContext，
		// 见 features/chat/ToolCard.tsx）会把已归入 Skill 分组的 iframe 误切为「单独调用」，
		// 分组隔离（ToolExecutionPanel.hasActiveInGroup）下中区退化为 MCP App 占位。
		// v2.7：existing 查找适配复合键池（resolveIframeGroup 内部按 resourceUri 字段找最近实例）
		const group = resolveIframeGroup(resourceUri, name, groupContext, poolMeta.serverId);
		// 展示名（v2.3，4.4.2）：显式 title 优先；否则从归属 Skill 的 tools 声明解析 title ?? name；
		// 取不到（单独调用/声明未命中）维持 toolName 原样
		const title = poolMeta.title ?? resolveToolTitle(name, group, get().skills) ?? name;
		iframePool.acquire(resourceUri, { ...poolMeta, title, group });
		set({
			iframePool: iframePool.snapshot(),
			activeIframeUri: iframePool.activeResourceUri,
			activeSkillName: group,
			centerView: "iframe",
		});
	},

	/** 激活池中已有 iframe（仅在池内存在时生效）；一级 Tab 同步为该 iframe 分组 */
	activateIframe: (resourceUri) => {
		if (iframePool.activate(resourceUri)) {
			const group = iframePool.snapshot().get(resourceUri)?.group ?? SOLO_GROUP_KEY;
			set({
				iframePool: iframePool.snapshot(),
				activeIframeUri: iframePool.activeResourceUri,
				activeSkillName: group,
				centerView: "iframe",
			});
		}
	},

	releaseIframe: (resourceUri) => {
		iframePool.release(resourceUri);
		messageBridge.detach(resourceUri);
		const remaining = iframePool.snapshot();
		// 关闭激活 tab 后：池空回退 Skill 视图；否则自动激活剩余首个（tab 关闭邻位聚焦）
		if (iframePool.activeResourceUri === null && remaining.size > 0) {
			const nextUri = remaining.keys().next().value!;
			iframePool.activate(nextUri);
			set({
				iframePool: iframePool.snapshot(),
				activeIframeUri: iframePool.activeResourceUri,
				activeSkillName: remaining.get(nextUri)?.group ?? SOLO_GROUP_KEY,
				centerView: "iframe",
			});
			return;
		}
		set({
			iframePool: iframePool.snapshot(),
			activeIframeUri: iframePool.activeResourceUri,
			centerView: iframePool.activeResourceUri === null ? "skill" : "iframe",
		});
	},

	destroyAllIframes: () => {
		iframePool.destroyAll();
		messageBridge.detachAll();
		set({ iframePool: iframePool.snapshot(), activeIframeUri: iframePool.activeResourceUri });
	},

	setToolExecutions: (list) => set({ toolExecutions: list }),

	upsertToolExecution: (exec) =>
		set((state) => {
			const rest = state.toolExecutions.filter((e) => e.id !== exec.id);
			return { toolExecutions: [exec, ...rest] };
		}),
}));

// ---- iframe 事件上报接线（D1/D2：生命周期 + 宿主↔应用 JSON-RPC 流落盘，模块级一次性） ----
function enqueueIframeEvent(event: Omit<IframeEventPayload, "seq">): void {
	const sessionId = useAppStore.getState().currentSessionId;
	if (sessionId === null) return;
	iframeEventReporter.enqueue(sessionId, event);
}

iframePool.onEvent = (e) => {
	// I1：LRU 淘汰路径与 release/destroyAll 对齐，同步清理 MessageBridge 通道——
	// 否则残留的 readyUris/出站队列泄漏内存，且同 key 复用时跳过握手门控
	// （tool-input/tool-result 被静默丢弃、旧队列消息串扰新执行）。
	if (e.action === "evict") messageBridge.detach(e.resourceUri);
	enqueueIframeEvent({
		kind: "lifecycle",
		resourceUri: e.resourceUri,
		action: e.action,
		...(e.group !== undefined ? { group: e.group } : {}),
		recordedAt: new Date().toISOString(),
	});
};

messageBridge.onObserved((o) => {
	enqueueIframeEvent({ ...o, recordedAt: new Date().toISOString() });
});

/** 取会话工作目录（会话级 API 调用路由用；非默认目录的会话必须携带） */
export function sessionDirectoryOf(sessionId: string | null | undefined): string | undefined {
	if (!sessionId) return undefined;
	return useAppStore.getState().sessions.find((s) => s.id === sessionId)?.directory;
}
