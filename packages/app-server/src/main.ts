import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { createAppServer } from "./index.ts";
import { createAgentPlanLlm } from "./llm.ts";
import { createSessionStore } from "./sessions.ts";

const config = loadConfig();
const llm = createAgentPlanLlm(config.agentPlanBaseUrl, config.modelId);
const store = createSessionStore({
	dataDir: config.dataDir,
	workspaceDir: resolve(config.dataDir, "workspace"),
});
const handle = createAppServer({ wsPort: config.wsPort, deps: { config, store, llm } });
await handle.start();
console.log("app-server ready");
console.log(`  serverId: ${handle.serverId}`);
console.log(`  wsUrl:    ws://127.0.0.1:${handle.wsPort}`);
