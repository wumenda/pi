export interface AppServerConfig {
	/** AgentPlan（OpenAI 兼容）端点。 */
	agentPlanBaseUrl: string;
	modelId: string;
	/** WS 监听端口。 */
	wsPort: number;
	/** HTTP 监听端口（ui-resources 端点，iframe 加载面）。 */
	httpPort: number;
	/** 数据根目录：sessions/、tool-events/、mcp.json。 */
	dataDir: string;
	/** MCP 配置文件路径；缺省由 host 解析为 join(dataDir, "mcp.json")。 */
	mcpConfigPath?: string;
	/**
	 * 访问令牌（WS upgrade 与 /api/v1/* HTTP 共用；query ?token= 或 Authorization: Bearer）。
	 * 缺省 = 开发回环匿名（不校验）。已知边界（ADR-0003）：token 进 query 有日志泄漏风险，
	 * fastify logger 关闭、token-ws-listener 不打印 url。
	 */
	token?: string;
	/**
	 * 多用户映射（token→userId，Task 27）。配置后单用户 token 校验由本映射承担
	 * （token 必须命中映射，未命中 401），数据目录按用户派生为
	 * `<dataDir>/users/<userId>`；未配置 = 单用户模式，dataDir 原样。
	 */
	users?: Record<string, string>;
}

/** 连接/请求的身份解析结果（users 模式）；single 表示单用户模式（无 userId 维度）。 */
export type UserIdentity = { kind: "single" } | { kind: "user"; userId: string } | { kind: "reject" };

/**
 * users 模式身份解析：映射命中 → user；未命中/缺 token → reject；
 * 未配置 users → single（token 校验退回 APP_SERVER_TOKEN，由调用方处理）。
 */
export function resolveIdentity(users: Record<string, string> | undefined, token: string | undefined): UserIdentity {
	if (users === undefined) return { kind: "single" };
	if (token === undefined) return { kind: "reject" };
	const userId = users[token];
	return userId === undefined ? { kind: "reject" } : { kind: "user", userId };
}

function parseUsers(raw: string | undefined): Record<string, string> | undefined {
	if (raw === undefined || raw === "") return undefined;
	const parsed: unknown = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("APP_SERVER_USERS must be a JSON object mapping tokens to userIds");
	}
	const users: Record<string, string> = {};
	for (const [token, userId] of Object.entries(parsed)) {
		if (typeof userId !== "string") throw new Error("APP_SERVER_USERS must map tokens to string userIds");
		users[token] = userId;
	}
	return users;
}

/** API key 不进配置对象：由 envApiKeyAuth 在请求时读取 AGENTPLAN_API_KEY。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppServerConfig {
	return {
		agentPlanBaseUrl: env.AGENTPLAN_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/plan/v3",
		modelId: env.AGENTPLAN_MODEL ?? "glm-5.3-flash",
		wsPort: Number(env.APP_SERVER_WS_PORT ?? 8790),
		httpPort: Number(env.APP_SERVER_HTTP_PORT ?? 8791),
		dataDir: env.APP_SERVER_DATA_DIR ?? ".data",
		...(env.APP_SERVER_MCP_CONFIG === undefined ? {} : { mcpConfigPath: env.APP_SERVER_MCP_CONFIG }),
		...(env.APP_SERVER_TOKEN === undefined || env.APP_SERVER_TOKEN === "" ? {} : { token: env.APP_SERVER_TOKEN }),
		...usersEntries(env),
	};
}

function usersEntries(env: NodeJS.ProcessEnv): { users?: Record<string, string> } {
	const users = parseUsers(env.APP_SERVER_USERS);
	return users === undefined ? {} : { users };
}
