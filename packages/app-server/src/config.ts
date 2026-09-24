export interface AppServerConfig {
	/** AgentPlan（OpenAI 兼容）端点。 */
	agentPlanBaseUrl: string;
	modelId: string;
	/** WS 监听端口。 */
	wsPort: number;
	/** 数据根目录：sessions/、tool-events/、mcp.json。 */
	dataDir: string;
}

/** API key 不进配置对象：由 envApiKeyAuth 在请求时读取 AGENTPLAN_API_KEY。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppServerConfig {
	return {
		agentPlanBaseUrl: env.AGENTPLAN_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/plan/v3",
		modelId: env.AGENTPLAN_MODEL ?? "glm-5.3-flash",
		wsPort: Number(env.APP_SERVER_WS_PORT ?? 8790),
		dataDir: env.APP_SERVER_DATA_DIR ?? ".data",
	};
}
