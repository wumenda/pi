import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const source = (packagePath: string): string => fileURLToPath(new URL(packagePath, import.meta.url));

// Workspace packages resolve to TypeScript sources because their dist outputs are not built during web development.
const workspaceAliases = [
	{ find: "@platform/shared", replacement: source("./src/shared/index.ts") },
	{ find: /^@earendil-works\/chord\/context$/, replacement: source("../chord/src/context/index.ts") },
	{ find: /^@earendil-works\/chord$/, replacement: source("../chord/src/index.ts") },
	{ find: /^@earendil-works\/pi-agent-core$/, replacement: source("../agent/src/index.ts") },
	{ find: /^@earendil-works\/pi-ai$/, replacement: source("../ai/src/index.ts") },
	{ find: /^@earendil-works\/pi-protocol$/, replacement: source("../protocol/src/index.ts") },
	{ find: /^@earendil-works\/pi-client\/ws$/, replacement: source("../client/src/ws.ts") },
	{ find: /^@earendil-works\/pi-client$/, replacement: source("../client/src/index.ts") },
];

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: workspaceAliases,
	},
	server: {
		port: 8788,
		// pi app-server HTTP 面（ui-resources / mcp-tools / 会话文件）开发代理；
		// 生产同源静态托管无需代理。PI_APP_SERVER_HTTP 可覆盖（多实例隔离）。
		proxy: {
			"/api": {
				target: process.env.PI_APP_SERVER_HTTP ?? "http://127.0.0.1:8791",
				changeOrigin: true,
			},
		},
	},
});
