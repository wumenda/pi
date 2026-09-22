/**
 * Bridge MCP server tools into harness-native {@link AgentHarnessTool}s.
 *
 * Tool names are namespaced as `mcp__<serverId>__<toolName>` so they can never
 * collide with built-in tools or other servers. Tools whose `_meta.ui` declares
 * a `ui://` resourceUri (MCP Apps, SEP-1865) return a persisted
 * `details.mcpUi` descriptor; the web frontend scans tool-result details for
 * it to drive iframe rendering.
 */

import { isJsonValue } from "@earendil-works/chord";
import { type TSchema, Type } from "typebox";
import type { ExecutionToolContext } from "../tools/tool-context.ts";
import type { AgentHarnessTool } from "../types.ts";
import type { McpRoutedTool, McpServerManager } from "./manager.ts";
import type { McpContent } from "./types.ts";

/** UI descriptor persisted into tool-result details for MCP Apps tools. */
export interface McpToolUiDescriptor {
	resourceUri: string;
	serverId: string;
	permissions?: string[];
}

/** Shape of the `details` payload produced by bridged MCP tools. */
export interface McpToolDetails {
	mcpUi?: McpToolUiDescriptor;
}

const UI_RESOURCE_PREFIX = "ui://";

/** Extract the MCP Apps UI descriptor from a tool's `_meta.ui`, if any. */
export function extractMcpToolUi(tool: McpRoutedTool): McpToolUiDescriptor | undefined {
	const meta = tool.tool._meta;
	if (typeof meta !== "object" || meta === null) return undefined;
	const ui = (meta as { ui?: unknown }).ui;
	if (typeof ui !== "object" || ui === null) return undefined;
	const resourceUri = (ui as { resourceUri?: unknown }).resourceUri;
	if (typeof resourceUri !== "string" || !resourceUri.startsWith(UI_RESOURCE_PREFIX)) return undefined;
	const descriptor: McpToolUiDescriptor = { resourceUri, serverId: tool.serverId };
	const permissions = (ui as { permissions?: unknown }).permissions;
	if (Array.isArray(permissions)) {
		const list = permissions.filter((permission): permission is string => typeof permission === "string");
		if (list.length > 0) descriptor.permissions = list;
	}
	return descriptor;
}

function sanitizeNamePart(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 0 ? sanitized : "server";
}

/** Namespaced harness tool name for one MCP tool. */
export function mcpToolName(serverId: string, toolName: string): string {
	return `mcp__${sanitizeNamePart(serverId)}__${sanitizeNamePart(toolName)}`;
}

function toJsonObject(value: unknown): Record<string, unknown> {
	if (isJsonValue(value) && typeof value === "object" && !Array.isArray(value) && value !== null) {
		return value;
	}
	return {};
}

type MappedContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function mapContent(contents: McpContent[]): MappedContent[] {
	const mapped: MappedContent[] = [];
	for (const content of contents) {
		if (content.type === "text") {
			mapped.push({ type: "text", text: content.text });
		} else if (content.type === "image") {
			mapped.push({ type: "image", data: content.data, mimeType: content.mimeType });
		} else if (content.type === "audio") {
			mapped.push({ type: "text", text: `[audio (${content.mimeType}) not shown]` });
		} else {
			const details = content.resource.mimeType === undefined ? "" : ` (${content.resource.mimeType})`;
			const text = content.resource.text === undefined ? "" : `\n${content.resource.text}`;
			mapped.push({ type: "text", text: `[resource ${content.resource.uri}${details}]${text}` });
		}
	}
	if (mapped.length === 0) mapped.push({ type: "text", text: "(no content)" });
	return mapped;
}

/** Bridge every tool exposed by the manager's ready servers into harness tools. */
export function createMcpTools(
	manager: McpServerManager,
): AgentHarnessTool<ExecutionToolContext, TSchema, McpToolDetails>[] {
	const usedNames = new Set<string>();
	const tools: AgentHarnessTool<ExecutionToolContext, TSchema, McpToolDetails>[] = [];
	for (const routed of manager.tools()) {
		const ui = extractMcpToolUi(routed);
		let name = mcpToolName(routed.serverId, routed.tool.name);
		while (usedNames.has(name)) name = `${name}_`;
		usedNames.add(name);
		const description =
			routed.tool.description === undefined
				? `MCP tool ${routed.tool.name} from server ${routed.serverId}`
				: routed.tool.description;
		const label = routed.tool.title === undefined ? routed.tool.name : routed.tool.title;
		tools.push({
			name,
			label,
			description,
			parameters: Type.Unsafe<Record<string, unknown>>(routed.tool.inputSchema as TSchema),
			async execute(_toolCallId, params, _onUpdate, _toolContext, _invocation, context) {
				const result = await manager.callTool(
					routed.serverId,
					routed.tool.name,
					toJsonObject(params),
					context.abortSignal,
				);
				const details: McpToolDetails = ui === undefined ? {} : { mcpUi: ui };
				return { content: mapContent(result.content), details };
			},
		});
	}
	return tools;
}
