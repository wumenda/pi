/** 前端全局类型（对应布局文档第 5 章的状态定义） */

import type { SessionDTO } from "@platform/shared";

/** 左栏会话项：DTO + 消息摘要（摘要随当前会话消息流维护，历史会话可能缺失） */
export interface SessionSummary extends SessionDTO {
	lastMessageSummary?: string;
}

/** tool 声明：字符串或 { name, title? } 对象（SKILL.md tools[]，见 iframe-rendering.md 4.4） */
export type ToolMeta = string | { name: string; title?: string };

/** 取 tool 声明标识符（归属判定 / 执行名用；字符串形式即其本身） */
export function toolNameOf(t: ToolMeta): string {
	return typeof t === "string" ? t : t.name;
}

/** 取 tool 声明展示名（中文名优先，缺省回退标识符；iframe-rendering.md 4.4.2） */
export function toolTitleOf(t: ToolMeta): string {
	return typeof t === "string" ? t : (t.title ?? t.name);
}

/** Skill 元数据（服务端 /api/v1/skills 注册表为准；注册表未收录时兜底前端解析 SKILL.md frontmatter，见布局文档 3.2 / iframe-rendering.md 4.4） */
export interface Skill {
	/** 标识符（声明比对 / 归属判定按 name，不变） */
	name: string;
	/** 中文名（展示用，可选；Tab/面板缺省回退 name，iframe-rendering.md 4.4） */
	title?: string;
	description?: string;
	version?: string;
	tools: ToolMeta[];
	/** SKILL.md 缺失或解析失败（布局文档 3.2.2 降级规则：仅展示 name） */
	metadataUnavailable?: boolean;
}

/**
 * Skill 实例（v2.7 强流程，iframe-rendering.md 7 章）：
 * 同名 Skill 每次读取建档一条，驱动一级分组 Tab（skillInstances[]）；
 * instanceId = skill 读取 part.id（后端持久化，会话重放确定可复现）。
 */
export interface SkillInstance {
	/** skill 读取 part.id（实例标识，分组键 `<name>#<instanceId>` 的组成部分） */
	instanceId: string;
	/** skill 标识符（白名单按 name 过滤 / 声明比对） */
	name: string;
	/** 展示名副本（SKILL.md title ?? 白名单 title） */
	title?: string;
	/** 声明副本（徽标计数） */
	tools: ToolMeta[];
	directory: string;
	createdAt: number;
}

/** tool 归属判定的上下文（v2.7）：tool 执行时最近一次 skill 读取（name + part.id 实例标识） */
export interface SkillReadContext {
	name: string;
	instanceId: string;
}

/**
 * "单独调用"分组键（v2.7 起定义于 types 叶子模块，IframePool 与 store 共享，
 * 避免 store ↔ pool 循环依赖）：tool 不在任何 Skill 实例声明中时归属此组。
 */
export const SOLO_GROUP_KEY = "__solo__";

/** tool 执行进度（running 期间经 tool.progress 合成事件更新） */
export interface ToolExecutionProgress {
	progress: number;
	total?: number;
	message?: string;
}

/** tool 执行记录（「Tool 执行」状态条与右栏折叠卡片的数据源） */
export interface ToolExecution {
	id: string;
	sessionId: string;
	toolName: string;
	resourceUri?: string;
	status: "running" | "success" | "failure";
	inputSummary?: string;
	resultSummary?: string;
	startedAt: string;
	endedAt?: string;
	progress?: ToolExecutionProgress;
}

/** iframe 池实例（iframe-rendering.md 第 5 章；池管理细节见 mcp-iframe/IframePool.ts） */
export interface IframeInstance {
	element: HTMLIFrameElement;
	/** 绑定的 ui:// 资源 URI（G4：池查找按字段匹配，不解析复合键） */
	resourceUri: string;
	/** Task 4/G4：归属 MCP server 标识（GET /mcp-tools DTO 的 serverId；缺失 = 旧版无 server 场景） */
	serverId?: string;
	/**
	 * Task 5/G5：当前绑定在该实例上的有效（running/pending）tool 执行标识。
	 * 有值 = 实例被占用（并发下同资源的其它执行会派生新实例）；执行 completed/error
	 * 后由池清空，实例回到可复用（同资源下个执行复用基实例）。
	 */
	activeToolCallId?: string;
	/** 绑定到该 iframe 的 tool 调用 ID（追加式，去重） */
	boundToolCalls: string[];
	/** tool tab 展示名（首次创建时确定；v2.3 起 tool 声明中文名优先，缺省回退 tool 名，见 4.4） */
	title?: string;
	/**
	 * 归属分组（一级分组键，v2.7）：skill 实例键 `<skillName>#<instanceId>` 或
	 * SOLO_GROUP_KEY"单独调用"。首次创建时按上下文时序判定（iframe-rendering.md 4.1），
	 * 后续复用不变——同名 Skill 的多个实例是不同分组，同 resourceUri 互不复用。
	 */
	group?: string;
	createdAt: number;
	/** 最近一次使用时间（LRU 展示用；淘汰排序用池内单调序号） */
	lastUsedAt: number;
	/**
	 * 最近一次使用的单调序号（B7，池每次使用递增）：同毫秒多次使用（重放批量建档、
	 * 快速连续激活）时墙钟 lastUsedAt 相同无法定序，
	 * latestInstanceForResourceUri 按本序号判定最近使用的实例。
	 */
	lastUsedSeq: number;
}

/** 主题模式（全局偏好，localStorage 持久化；iframe 宿主协议同步下发） */
export type ThemeMode = "light" | "dark";

/** 思考强度选择（随 prompt 文本 part metadata 透传留存；opencode 1.18 内核暂不消费） */
export type ReasoningEffort = "off" | "low" | "medium" | "high";

/** 输入区发送偏好（Agent 预设 / 模型 / 思考强度，全局记忆） */
export interface PromptPrefs {
	agent?: string;
	model?: string;
	reasoning: ReasoningEffort;
}

/**
 * question 挂起请求（opencode question.asked 事件 payload，Phase 8）：
 * 交互卡片经它获得 requestID 后进入可提交状态。
 */
export interface PendingQuestion {
	requestID: string;
	questions: {
		question: string;
		header: string;
		options: { label: string; description: string }[];
		multiple?: boolean;
		/** opencode QuestionV1.Info 扩展：允许自定义输入（默认 true） */
		custom?: boolean;
	}[];
	tool?: { messageID: string; callID: string };
}

/**
 * permission 挂起请求（opencode permission.asked 事件 payload，1.18 实测形状）：
 * 权限审批卡片经它获得 permissionID 后进入可操作状态。
 */
export interface PendingPermission {
	permissionID: string;
	/** 权限类型（如 bash） */
	permissionType: string;
	/** 命令/操作摘要（bash 时 metadata.command，用于卡片展示；缺省回退 permissionType） */
	command?: string;
	/** 触发权限请求的工具调用上下文 */
	tool?: { messageID: string; callID: string };
	/** 工具附加信息原样保留 */
	metadata: Record<string, unknown>;
}
