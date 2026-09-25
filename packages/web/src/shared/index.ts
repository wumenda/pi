/**
 * 平台 API DTO 类型（原 @platform/shared 的 web 端子集）。
 * pi 后端不提供统一响应外壳与 opencode 投影，此处类型作为前端渲染契约保留：
 * 适配层（src/api/*）把 pi 会话/transcript 数据投影为这些 DTO，页面组件零改动。
 */

/** 失败响应外壳（保留给 axios 面的兼容解析） */
export interface FailureEnvelope {
	code: number;
	requestId: string;
	message: string;
	details?: unknown[];
}

/** 前端解包用的响应外壳 TS 类型 */
export type ApiEnvelope<T> = { code: 0; data: T; requestId: string } | FailureEnvelope;

/** 会话 DTO */
export interface SessionDTO {
	id: string;
	title: string;
	/** 会话工作目录（创建时指定；pi 侧恒为 "/"） */
	directory: string;
	/** 父会话 id（subagent 子会话；pi 侧无子会话概念，不使用） */
	parentID?: string;
	createdAt: string; // ISO 8601
	updatedAt: string;
}

/** 项目 DTO（工作目录注册表条目，一个目录下可有多个会话） */
export interface ProjectDTO {
	id: string;
	name: string;
	/** 绝对路径 */
	directory: string;
	createdAt: string; // ISO 8601
}

/** 消息 DTO；parts 为 opencode Part 形状（ToolPart 的 state 含 input/output/metadata） */
export interface MessageDTO {
	id: string;
	role: "user" | "assistant";
	agent?: string;
	model?: { providerID: string; modelID: string };
	createdAt: string; // ISO 8601
	completedAt: string | null;
	parts: unknown[];
}

/** 文件内容 DTO */
export interface FileContentDTO {
	type: "text" | "binary";
	content: string;
}

/**
 * MCP Apps 工具定义（工具名 → ui:// 绑定，SEP-1865）。
 * 每条工具必带 serverId（归属的 MCP server 标识），
 * 前端按 (serverId, name) 路由 ui-resources 读取与 tools/call 反向调用。
 */
export interface McpUiToolDTO {
	/** MCP Server 侧原始 tool 名 */
	name: string;
	resourceUri: string;
	permissions: string[];
	csp?: string;
	/** 归属 MCP server 标识 */
	serverId: string;
	/** pi 桥接工具名 `mcp__<server>__<tool>`（撞名 `_` 后缀含）；缺省 = A1 前的旧清单 */
	harnessName?: string;
	/** 兼容保留字段（pi 侧不使用） */
	_serverUrl?: string;
}

/** 工具库默认分类 */
export const TOOL_CATEGORY_DEFAULT = "通用能力";

/** 工具库条目输入（元数据子集） */
export interface ToolLibraryItemInput {
	name: string;
	description?: string;
	category?: string;
	readOnlyHint?: boolean;
	inputSchema?: unknown;
}

/**
 * 工具库条目：MCP tool 清单（pi 侧由 GET /api/v1/mcp-tools 投影）。
 */
export interface ToolLibraryItem extends ToolLibraryItemInput {
	category: string;
	/** 归属 MCP server 标识 */
	serverId: string;
	/** 来源：plugin=带 ui:// 声明的 MCP Apps 工具；native=其他 MCP 工具 */
	source: "plugin" | "native";
}

/** Agent 预设 */
export interface AgentInfoDTO {
	name: string;
	description?: string;
	/** 系统提示词原文（前端上下文分段估算用；缺省未知） */
	prompt?: string;
	mode: "subagent" | "primary" | "all";
	builtIn: boolean;
}

/** 可选模型 */
export interface ModelInfoDTO {
	providerID: string;
	modelID: string;
	name: string;
	reasoning: boolean;
	/** 模型上下文窗口（token）。0/缺失表示未知（前端回退默认值）。 */
	contextWindow: number | null;
}

/** MCP server 连接状态 */
export interface McpStatusInfoDTO {
	status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration";
	/** 连接失败时的错误信息 */
	error?: string;
}

/** 默认 mcp 配置项（名称 + 配置 + 连接状态） */
export interface DefaultMcpServerDTO {
	name: string;
	/** local: 启动命令；remote: url */
	type: "local" | "remote";
	command?: string[];
	url?: string;
	enabled?: boolean;
	status: McpStatusInfoDTO;
}

/** 插件注册的 MCP server */
export interface PluginMcpServerDTO {
	prefix: string;
	url?: string;
	command?: string;
	args?: string[];
}

/** 设置页聚合数据 */
export interface SettingsInfoDTO {
	pluginMcpServers: PluginMcpServerDTO[];
	defaultMcpServers: DefaultMcpServerDTO[];
	/** 已注册 tool id 清单 */
	toolIds: string[];
}

/** skill 的 tool 声明（同前端 ToolMeta：字符串或 { name, title? } 对象） */
export type SharedToolMeta = string | { name: string; title?: string };

/** 磁盘扫描的 skill 清单项 */
export interface SkillInfoDTO {
	name: string;
	/** 中文名（缺省回退 name） */
	title?: string;
	description?: string;
	version?: string;
	/** 技能类型（缺省 = 通用能力） */
	meta?: string;
	tools: SharedToolMeta[];
	/** skill 目录绝对路径 */
	directory: string;
	/** 来源 */
	source: "global" | "project";
	/** 元数据缺失（降级：仅展示 name） */
	metadataUnavailable: boolean;
}

/** 单个 skill 详情 */
export interface SkillDetailDTO extends SkillInfoDTO {
	/** SKILL.md 原文（缺失为空串，配合 metadataUnavailable 判断） */
	body: string;
}

/** skill tab 白名单项：name 为 skill 标识符，title 为兜底中文名 */
export interface SkillWhitelistItem {
	name: string;
	title?: string;
}

/** 服务器目录清单（目录选择器浏览） */
export interface DirectoryListDTO {
	/** 当前目录绝对路径 */
	path: string;
	/** 上一级目录（已在根时为 null） */
	parent: string | null;
	/** 子目录名列表（仅目录，按名称排序） */
	directories: string[];
}

// ============ 数据中心 ============

/** 数据中心任务（改造任务；成果按任务归组） */
export interface DataCenterTaskDTO {
	id: string;
	name: string;
	taskType: string;
	status: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

/** 资料的关联任务引用 */
export interface DataCenterTaskRefDTO {
	taskId: string;
	taskName: string;
	usedIn: string[];
}

/** 资料使用记录 */
export interface DataCenterUsageRecord {
	taskId: string;
	taskName: string;
	stage: string;
	time: string; // ISO 8601
	action: string;
}

/** AI 解析结果（未解析时为 null） */
export interface DataCenterParseResult {
	metrics: Array<{ label: string; value: string }>;
	notes?: string;
}

/** 原始资料（用户上传的真实文件） */
export interface DataCenterMaterialDTO {
	id: string;
	name: string;
	/** 资料类型（PFD / P&ID / 设备资料 …，UI 筛选用） */
	type: string;
	/** 文件扩展名（小写无点，pdf/xlsx/…） */
	fileType: string;
	sizeBytes: number;
	uploader: string;
	uploadedAt: string; // ISO 8601
	aiStatus: "未解析" | "解析中" | "已解析" | "需确认" | "解析异常";
	description: string;
	remark: string;
	relatedTasks: DataCenterTaskRefDTO[];
	usageRecords: DataCenterUsageRecord[];
	aiParseResult: DataCenterParseResult | null;
}

/** 任务成果（登记的真实产出文件，按任务归组） */
export interface DataCenterResultDTO {
	id: string;
	taskId: string;
	name: string;
	type: string;
	fileType: string;
	sizeBytes: number;
	generatedAt: string; // ISO 8601
	sourceStage: string;
	version: string;
	versionStatus: "当前版本" | "历史版本";
	description: string;
	remark: string;
	relatedResults: string[];
	versions: Array<{ version: string; status: string; time: string }>;
}

/** 关系图节点（type: raw 原始资料 | stage 任务阶段 | intermediate 中间成果 | final 最终成果） */
export interface DataCenterGraphNode {
	id: string;
	/** 关联资料/成果 id（raw/final 节点必带，供前端回查详情） */
	refId?: string;
	label: string;
	type: "raw" | "stage" | "intermediate" | "final";
	x: number;
	y: number;
}

/** 关系图边 */
export interface DataCenterGraphEdge {
	from: string;
	to: string;
}

/** 任务资料关系图 */
export interface DataCenterGraphDTO {
	taskId: string;
	nodes: DataCenterGraphNode[];
	edges: DataCenterGraphEdge[];
}

/** 数据中心聚合清单（任务 + 原始资料 + 任务成果） */
export interface DataCenterOverviewDTO {
	tasks: DataCenterTaskDTO[];
	materials: DataCenterMaterialDTO[];
	results: DataCenterResultDTO[];
}

/** 创建数据中心任务输入 */
export interface CreateDataCenterTaskInput {
	name: string;
	taskType: string;
}

/** 编辑资料元数据输入 */
export interface UpdateDataCenterMaterialInput {
	description?: string;
	remark?: string;
	type?: string;
	relatedTaskIds?: string[];
}

/** 上传资料元数据 */
export interface UploadMaterialMeta {
	name?: string;
	type?: string;
	description?: string;
	remark?: string;
	taskIds?: string[];
}
