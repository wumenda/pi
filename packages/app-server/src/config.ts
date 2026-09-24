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
	};
}
