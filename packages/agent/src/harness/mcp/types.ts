/**
 * Minimal MCP (Model Context Protocol) wire types.
 *
 * Only what the pi harness needs: server configuration, tool/resource
 * discovery, tool invocation, and resource reads. JSON-RPC 2.0 envelope types
 * are internal to the client transport.
 */

/** Protocol version advertised by this client during the initialize handshake. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** MCP server over stdio: newline-delimited JSON-RPC on the child process' stdio. */
export interface McpServerConfigStdio {
	type: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

/** MCP server over Streamable HTTP: POST JSON-RPC to a single endpoint URL. */
export interface McpServerConfigHttp {
	type: "http";
	url: string;
	headers?: Record<string, string>;
}

export type McpServerConfig = McpServerConfigStdio | McpServerConfigHttp;

/** Server configs keyed by a user-chosen server id. */
export type McpServerConfigMap = Record<string, McpServerConfig>;

/** JSON-Schema-backed input schema as declared by an MCP tool. */
export type McpJsonSchema = Record<string, unknown>;

/** Tool declared by an MCP server. */
export interface McpTool {
	name: string;
	title?: string;
	description?: string;
	inputSchema: McpJsonSchema;
	/** Server-declared metadata; `_meta.ui.resourceUri` marks MCP Apps UI tools. */
	_meta?: Record<string, unknown>;
}

/** Resource descriptor declared by an MCP server. */
export interface McpResource {
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
	_meta?: Record<string, unknown>;
}

/** One content block inside a tool result or resource read. */
export type McpContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| { type: "audio"; data: string; mimeType: string }
	| {
			type: "resource";
			resource: { uri: string; mimeType?: string; text?: string; blob?: string };
	  };

/** Result of an MCP tools/call. */
export interface McpCallToolResult {
	content: McpContent[];
	isError?: boolean;
}

/** One resource content entry inside a resources/read result. */
export interface McpResourceContents {
	uri: string;
	mimeType?: string;
	text?: string;
	blob?: string;
}

/** Result of an MCP resources/read. */
export interface McpReadResourceResult {
	contents: McpResourceContents[];
}
