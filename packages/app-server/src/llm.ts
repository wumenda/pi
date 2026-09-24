import { createModels, createProvider, envApiKeyAuth, type Model, type Models } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export interface AgentPlanLlm {
	models: Models;
	model: Model<"openai-completions">;
}

/** AgentPlan OpenAI 兼容端点；凭据经 AGENTPLAN_API_KEY 环境变量解析。 */
export function createAgentPlanLlm(baseUrl: string, modelId: string): AgentPlanLlm {
	const provider = createProvider({
		id: "agentplan",
		name: "AgentPlan",
		baseUrl,
		auth: { apiKey: envApiKeyAuth("AgentPlan API key", ["AGENTPLAN_API_KEY"]) },
		models: [
			{
				id: modelId,
				name: modelId,
				api: "openai-completions",
				provider: "agentplan",
				baseUrl,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_768,
			},
		],
		api: openAICompletionsApi(),
	});
	const models = createModels();
	models.setProvider(provider);
	return { models, model: provider.getModels()[0] as Model<"openai-completions"> };
}
