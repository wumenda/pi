/** 原生 MCP 桥接工具命名规则（scan / skill-declaration 共用，避免循环依赖） */

/** 与 agent 核心 mcpToolName 的 sanitize 一致（serverId 原始值 → 工具名片段） */
function sanitizeNamePart(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 0 ? sanitized : "server";
}

/** 原生 MCP 桥接工具名 `mcp__<serverId>__<toolName>` → MCP 侧原始 tool 名 */
export function rawMcpToolName(harnessName: string, serverId: string): string {
	const prefix = `mcp__${sanitizeNamePart(serverId)}__`;
	return harnessName.startsWith(prefix) ? harnessName.slice(prefix.length) : harnessName;
}
