import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { createAppServer } from "./index.ts";
import { createAgentPlanLlm } from "./llm.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("main");
const config = loadConfig();
log.info(
	`config: baseUrl=${config.agentPlanBaseUrl} model=${config.modelId} wsPort=${config.wsPort} httpPort=${config.httpPort} dataDir=${config.dataDir} users=${config.users === undefined ? "single" : Object.keys(config.users).length}`,
);
// 静态托管（Task 28）：缺省取 monorepo 内 web 生产构建目录；目录不存在（未构建/开发模式
// 由 vite 服务前端）时保持 undefined，不注册静态托管。APP_SERVER_WEB_DIST 可显式覆盖。
if (config.webDist === undefined) {
	const defaultDist = resolve(import.meta.dirname, "../../web/dist");
	if (existsSync(defaultDist)) config.webDist = defaultDist;
}
const llm = createAgentPlanLlm(config.agentPlanBaseUrl, config.modelId);
const handle = createAppServer({ wsPort: config.wsPort, httpPort: config.httpPort, deps: { config, llm } });
await handle.start();
console.log("app-server ready");
console.log(`  serverId: ${handle.serverId}`);
console.log(`  wsUrl:    ws://127.0.0.1:${handle.wsPort}`);
console.log(`  httpBase: http://127.0.0.1:${handle.httpPort}${config.webDist === undefined ? "" : " (static web)"}`);
