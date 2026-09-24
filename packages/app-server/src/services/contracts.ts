import { type Context, defineService, type JsonValue, type ReplicatedState } from "@earendil-works/chord";
import type { LaneTranscriptSnapshot, LaneWatchEvent } from "@earendil-works/pi-agent-core";
import type { ServerId } from "@earendil-works/pi-protocol";

// Server-side mirrors of the app service contracts. Chord matches services by
// ID over the wire, so the descriptors must use identical IDs and compatible
// JSON shapes with the web client mirrors.

export interface TranscriptState {
	snapshot: LaneTranscriptSnapshot | null;
	/** The source event is retained for presentation side effects; hydration does not replay it. */
	event: LaneWatchEvent | null;
}

/** Coherent main-lane state replicated through Chord's operation stream. */
export interface Transcript {
	readonly state: ReplicatedState<TranscriptState>;
}

export const Transcript = defineService<Transcript>("pi.transcript");

export interface AgentPromptImage {
	type: "image";
	data: string;
	mimeType: string;
}

export interface AgentPromptRequest {
	message: string;
	images: AgentPromptImage[] | null;
}

export interface AgentOperationError {
	code: string;
	message: string;
}

export type AgentOperationResponse =
	| { accepted: true; operationId: string; error: AgentOperationError | null }
	| { accepted: false; operationId: string | null; error: AgentOperationError };

export type AgentQueueResponse =
	| { accepted: true; entryId: string; error: null }
	| { accepted: false; entryId: null; error: AgentOperationError };

export interface AgentCompactionRequest {
	customInstructions: string | null;
}

export interface AgentNavigationRequest {
	targetId: string | null;
	summarize: boolean;
	label: string | null;
	customInstructions: string | null;
}

export interface AgentAskUserAnswerRequest {
	toolCallId: string;
	/** Structured answers: { [pageId]: { [fieldId]: value | value[] } }. */
	answers: JsonValue;
}

/** Presentation-safe command facade over the worker-owned main AgentLane. */
export interface AgentController {
	prompt(request: AgentPromptRequest, context: Context): Promise<AgentOperationResponse>;
	requestAbort(operationId: string, context: Context): Promise<void>;
	steer(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	followUp(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	nextRun(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	cancelQueued(
		entryId: string,
		context: Context,
	): Promise<{ outcome: "cancelled" | "already_consumed" | "not_found" }>;
	resume(context: Context): Promise<AgentOperationResponse>;
	compact(request: AgentCompactionRequest, context: Context): Promise<AgentOperationResponse>;
	navigate(request: AgentNavigationRequest, context: Context): Promise<AgentOperationResponse>;
	/** Resolve a suspended ask_user_question tool call; throws when the call is not pending. */
	answerAskUser(request: AgentAskUserAnswerRequest, context: Context): Promise<void>;
}

export const AgentController = defineService<AgentController>("pi.agent-controller");

export interface SessionSummary {
	serverId: ServerId;
	sessionId: string;
	createdAt: number;
}

export interface SessionCreateOptions {
	id?: string;
}

export interface SessionDirectoryState {
	revision: number;
	sessions: SessionSummary[];
}

export interface SessionDirectory {
	readonly state: ReplicatedState<SessionDirectoryState>;
}

export const SessionDirectory = defineService<SessionDirectory>("pi.session-directory");

export interface SessionManagement {
	create(options: SessionCreateOptions, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
	attach(sessionId: string, context: Context): Promise<void>;
	detach(context: Context): Promise<void>;
}

export const SessionManagement = defineService<SessionManagement>("pi.session-management");

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

/** One recorded tool-execution event: arguments, progress, or result. */
export interface ToolExecutionEvent {
	kind: "input" | "progress" | "result";
	toolCallId: string;
	toolName: string | null;
	serverId: string | null;
	resourceUri: string | null;
	args: JsonValue | null;
	progress: number | null;
	total: number | null;
	message: string | null;
	uiEvent: JsonValue | null;
	isError: boolean;
	timestamp: number;
}

/** Recorded tool-execution events for the attached session. */
export interface ToolEvents {
	events(context: Context): Promise<ToolExecutionEvent[]>;
}
export const ToolEvents = defineService<ToolEvents>("pi.tool-events");
