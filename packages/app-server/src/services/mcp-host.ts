import type { Context, JsonValue } from "@earendil-works/chord";
import type {
	McpContent,
	McpResourceContents,
	McpServerManager,
	McpServerStatus,
} from "@earendil-works/pi-agent-core/harness/mcp";
import {
	type McpHost,
	type McpHostServerStatus,
	type McpHostToolCallRequest,
	type McpHostToolCallResult,
	type McpHostToolContent,
	type McpHostUiResource,
} from "./contracts.ts";

const UI_RESOURCE_PREFIX = "ui://";

/** Bridges the session's McpServerManager onto the pi.mcp-host chord service. */
export function createMcpHostService(manager: McpServerManager): McpHost {
	return {
		async callTool(request: McpHostToolCallRequest, context: Context): Promise<McpHostToolCallResult> {
			if (typeof request.name !== "string" || request.name.length === 0) {
				throw new Error("MCP tool call requires a tool name");
			}
			const serverId = request.serverId === null ? undefined : request.serverId;
			const args = request.args === null ? undefined : toArgsObject(request.args);
			const result = await manager.callTool(serverId, request.name, args, context.abortSignal);
			return { content: result.content.map(mapToolContent), isError: result.isError === true };
		},
		async getUiResource(request, context): Promise<McpHostUiResource> {
			if (!request.resourceUri.startsWith(UI_RESOURCE_PREFIX)) {
				throw new Error(`MCP UI resources must use the ${UI_RESOURCE_PREFIX} scheme`);
			}
			const read = await manager.readResource(request.serverId, request.resourceUri, context.abortSignal);
			const withText = read.contents.filter(
				(entry): entry is McpResourceContents & { text: string } => typeof entry.text === "string",
			);
			const entry = withText.find((candidate) => candidate.mimeType?.startsWith("text/html")) ?? withText[0];
			if (entry === undefined) {
				throw new Error(`MCP server ${request.serverId} returned no text content for ${request.resourceUri}`);
			}
			return { mimeType: entry.mimeType ?? "text/html", html: entry.text };
		},
		async statuses(): Promise<McpHostServerStatus[]> {
			return manager.statuses().map(mapStatus);
		},
	};
}

function toArgsObject(args: JsonValue): Record<string, unknown> {
	if (typeof args !== "object" || args === null || Array.isArray(args)) {
		throw new Error("MCP tool arguments must be a JSON object");
	}
	return args as Record<string, unknown>;
}

function mapToolContent(content: McpContent): McpHostToolContent {
	if (content.type === "resource") {
		const resource = content.resource;
		return {
			type: "resource",
			resource: {
				uri: resource.uri,
				mimeType: resource.mimeType ?? null,
				text: resource.text ?? null,
				blob: resource.blob ?? null,
			},
		};
	}
	return content;
}

function mapStatus(status: McpServerStatus): McpHostServerStatus {
	return { id: status.id, state: status.state, error: status.error ?? null, toolCount: status.toolCount };
}
