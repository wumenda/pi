import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
	it("applies defaults", () => {
		const config = loadConfig({});
		expect(config.agentPlanBaseUrl).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
		expect(config.modelId).toBe("glm-5.3-flash");
		expect(config.wsPort).toBe(8790);
		expect(config.dataDir).toBe(".data");
	});
	it("honors env overrides", () => {
		const config = loadConfig({
			AGENTPLAN_BASE_URL: "https://example.invalid/v3",
			AGENTPLAN_MODEL: "glm-5",
			APP_SERVER_WS_PORT: "9000",
			APP_SERVER_DATA_DIR: "tmp-data",
		});
		expect(config.agentPlanBaseUrl).toBe("https://example.invalid/v3");
		expect(config.modelId).toBe("glm-5");
		expect(config.wsPort).toBe(9000);
		expect(config.dataDir).toBe("tmp-data");
	});
});
