import { type Context, defineService, type JsonValue } from "@earendil-works/chord";

export interface McpHostToolCallRequest {
	/** Owning server id; null lets the host route by unique tool name. */
	serverId: string | null;
	name: string;
	/** Tool arguments object; null is treated as an empty argument set. */
	args: JsonValue | null;
}

export type McpHostToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| { type: "audio"; data: string; mimeType: string }
	| {
			type: "resource";
			resource: { uri: string; mimeType: string | null; text: string | null; blob: string | null };
	  };

export interface McpHostToolCallResult {
	content: McpHostToolContent[];
	isError: boolean;
}

export interface McpHostUiResourceRequest {
	serverId: string;
	/** ui:// resource URI as declared by the tool's _meta.ui (MCP Apps, SEP-1865). */
	resourceUri: string;
}

/** UI resource payload; `html` is the iframe srcdoc payload for MCP Apps. */
export interface McpHostUiResource {
	mimeType: string;
	html: string;
}

export interface McpHostServerStatus {
	id: string;
	state: "disconnected" | "connecting" | "ready" | "error";
	error: string | null;
	toolCount: number;
}

/** MCP bridge exposed to presentation layers: web iframes call tools and read UI resources. */
export interface McpHost {
	callTool(request: McpHostToolCallRequest, context: Context): Promise<McpHostToolCallResult>;
	getUiResource(request: McpHostUiResourceRequest, context: Context): Promise<McpHostUiResource>;
	statuses(context: Context): Promise<McpHostServerStatus[]>;
}

export const McpHost = defineService<McpHost>("pi.mcp-host");
