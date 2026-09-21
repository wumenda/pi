import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const source = (packagePath: string): string => fileURLToPath(new URL(packagePath, import.meta.url));

// Workspace packages resolve to TypeScript sources because their dist outputs are not built during web development.
const workspaceAliases = [
	{ find: /^@earendil-works\/chord\/context$/, replacement: source("../chord/src/context/index.ts") },
	{ find: /^@earendil-works\/chord$/, replacement: source("../chord/src/index.ts") },
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
	},
});
