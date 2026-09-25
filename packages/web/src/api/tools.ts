/**
 * MCP 工具 API 适配层：
 * - fetchMcpTools：pi app-server GET /api/v1/mcp-tools（带 ui:// 声明的工具清单）；
 * - callMcpTool：pi.mcp-host chord 服务反向调用（iframe → 宿主 tools/call）。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { McpUiToolDTO } from "@platform/shared";
import { requirePiServices } from "../pi/pi-app";
import { http, unwrap } from "./client";

/** pi 清单条目（HTTP 面） */
interface PiMcpToolManifestEntry {
	serverId: string;
	name: string;
	resourceUri: string;
	harnessName?: string;
	visibility?: string[];
}

/** MCP Apps 工具定义（name → ui:// 资源绑定），用于 tool 调用 → iframe 映射 */
export function fetchMcpTools(): Promise<McpUiToolDTO[]> {
	return unwrap(http.get<PiMcpToolManifestEntry[]>("/mcp-tools")).then((entries) =>
		entries.map((entry) => ({
			name: entry.name,
			resourceUri: entry.resourceUri,
			permissions: [],
			serverId: entry.serverId,
			...(entry.harnessName === undefined ? {} : { harnessName: entry.harnessName }),
		})),
	);
}

/**
 * 从 tool 调用名解析 MCP Server 侧 tool 定义：
 * 1. pi 桥接名 `mcp__<server>__<name>` 与清单 harnessName 精确匹配（A1：
 *    撞名 `_` 后缀的桥接名也能唯一定位）；
 * 2. 旧清单（无 harnessName）退回「原始名全等 → `<server>_` 后缀匹配，
 *    多命中时优先 serverId 出现在调用名前缀中的那个」的既有启发式。
 */
export function matchMcpTool(calledTool: string, tools: McpUiToolDTO[]): McpUiToolDTO | undefined {
	const harnessMatch = tools.find((t) => t.harnessName !== undefined && t.harnessName === calledTool);
	if (harnessMatch !== undefined) return harnessMatch;
	const exact = tools.find((t) => calledTool === t.name);
	if (exact) return exact;
	const suffixMatches = tools.filter((t) => calledTool.endsWith(`_${t.name}`));
	if (suffixMatches.length === 0) return undefined;
	const byServer = suffixMatches.find((t) => t.serverId !== undefined && calledTool.includes(t.serverId));
	return byServer ?? suffixMatches[0];
}

/** MCP Apps tools/call 反向调用结果（CallToolResult 子集，UI 侧消费 structuredContent） */
export interface McpToolCallResult {
	structuredContent?: Record<string, unknown>;
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

/**
 * UI 反向调用 MCP Server 工具（read_image / submit_review 等 app 可见工具）：
 * iframe → 宿主(tools/call) → pi.mcp-host → MCP Server。
 * serverId 必带（目标 MCP server 归属，宿主据此路由）；sessionId 供 server 识别工作区。
 */
export function callMcpTool(
	name: string,
	args: Record<string, unknown>,
	opts: { sessionId?: string; serverId?: string } = {},
): Promise<McpToolCallResult> {
	void opts.sessionId;
	const services = requirePiServices();
	return services.mcpHost
		.callTool(
			{
				serverId: opts.serverId ?? null,
				name,
				args: Object.keys(args).length > 0 ? (args as Record<string, never>) : null,
			},
			BACKGROUND_CONTEXT,
		)
		.then((result) => {
			let structuredContent: Record<string, unknown> | undefined;
			const candidates: string[] = [];
			for (const c of result.content) {
				if (c.type === "text" && c.text.length > 0) candidates.push(c.text);
				if (c.type === "resource" && c.resource.text !== null) candidates.push(c.resource.text);
			}
			for (const candidate of candidates) {
				try {
					const parsed: unknown = JSON.parse(candidate);
					if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
						structuredContent = parsed as Record<string, unknown>;
						break;
					}
				} catch {
					// 非 JSON 输出：跳过
				}
			}
			return {
				content: result.content.map((c) => (c.type === "text" ? { type: "text", text: c.text } : { type: c.type })),
				isError: result.isError,
				...(structuredContent !== undefined ? { structuredContent } : {}),
			};
		});
}
