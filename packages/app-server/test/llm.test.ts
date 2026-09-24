import { describe, expect, it } from "vitest";
import { createAgentPlanLlm } from "../src/llm.ts";

describe("createAgentPlanLlm", () => {
	it("registers the provider and resolves the configured model", () => {
		const llm = createAgentPlanLlm("https://example.invalid/v3", "glm-5.3-flash");
		expect(llm.models.getProvider("agentplan")?.baseUrl).toBe("https://example.invalid/v3");
		expect(llm.model.id).toBe("glm-5.3-flash");
		expect(llm.model.provider).toBe("agentplan");
	});
});
