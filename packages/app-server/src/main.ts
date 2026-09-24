import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { createAppServer } from "./index.ts";
import { createAgentPlanLlm } from "./llm.ts";
import { createLogger } from "./logger.ts";
import { createSessionStore } from "./sessions.ts";

const log = createLogger("main");
const config = loadConfig();
log.info(
	`config: baseUrl=${config.agentPlanBaseUrl} model=${config.modelId} wsPort=${config.wsPort} httpPort=${config.httpPort} dataDir=${config.dataDir}`,
);
const llm = createAgentPlanLlm(config.agentPlanBaseUrl, config.modelId);
const store = createSessionStore({
	dataDir: config.dataDir,
	workspaceDir: resolve(config.dataDir, "workspace"),
});
const handle = createAppServer({ wsPort: config.wsPort, httpPort: config.httpPort, deps: { config, store, llm } });
await handle.start();
console.log("app-server ready");
console.log(`  serverId: ${handle.serverId}`);
console.log(`  wsUrl:    ws://127.0.0.1:${handle.wsPort}`);
console.log(`  httpBase: http://127.0.0.1:${handle.httpPort}`);
