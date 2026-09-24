/**
 * Matching for JSON-RPC `notifications/progress` messages.
 *
 * MCP servers report long-running tool progress as notifications carrying a
 * `progressToken` that the client echoed in the request's `_meta`. Servers may
 * add custom fields (e.g. `ui_event`) for MCP Apps; they are passed through as
 * `uiEvent`.
 */

/** Normalized progress payload extracted from a `notifications/progress` notification. */
export interface McpProgressPayload {
	progress: number;
	total: number | null;
	message: string | null;
	uiEvent: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Build a message matcher for one progress token. The returned function is
 * called for every inbound JSON-RPC message; it invokes `onProgress` only for
 * `notifications/progress` notifications whose `params.progressToken` matches
 * `token`, and silently ignores everything else.
 */
export function matchProgressNotification(input: {
	token: string | number;
	onProgress: (payload: McpProgressPayload) => void;
}): (message: unknown) => void {
	const { token, onProgress } = input;
	return (message: unknown) => {
		const record = asRecord(message);
		if (record?.method !== "notifications/progress") return;
		const params = asRecord(record.params);
		if (params === undefined || params.progressToken !== token) return;
		onProgress({
			progress: typeof params.progress === "number" ? params.progress : 0,
			total: typeof params.total === "number" ? params.total : null,
			message: typeof params.message === "string" ? params.message : null,
			uiEvent: params.ui_event ?? params.uiEvent ?? null,
		});
	};
}
