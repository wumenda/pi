/**
 * Tool execution event recording: append-only JSONL per session under
 * `<dataDir>/tool-events/`, read back through the pi.tool-events chord service
 * for cold-start recovery in the web frontend.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isJsonValue } from "@earendil-works/chord";
import type { HarnessEvent } from "@earendil-works/pi-agent-core";
import type { McpToolDetails } from "@earendil-works/pi-agent-core/harness/mcp";
import type { ToolExecutionEvent } from "./services/contracts.ts";

/** Per-session append-only store of tool execution events. */
export interface ToolEventRecorder {
	record(event: ToolExecutionEvent): Promise<void>;
	events(): Promise<ToolExecutionEvent[]>;
}

function readMcpDetails(details: unknown): McpToolDetails | undefined {
	return typeof details === "object" && details !== null ? (details as McpToolDetails) : undefined;
}

function isToolExecutionEvent(value: unknown): value is ToolExecutionEvent {
	const record = asRecord(value);
	return record !== undefined && typeof record.kind === "string" && typeof record.toolCallId === "string";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function createToolEventRecorder(dataDir: string, sessionId: string): ToolEventRecorder {
	const file = join(dataDir, "tool-events", `${sessionId}.jsonl`);
	let directory: Promise<void> | undefined;
	let queue: Promise<void> = Promise.resolve();
	const ensureDirectory = (): Promise<void> => {
		directory ??= mkdir(join(dataDir, "tool-events"), { recursive: true }).then(() => undefined);
		return directory;
	};
	return {
		record(event) {
			// Serialize appends through a promise chain so concurrent records never interleave.
			const write = queue.then(async () => {
				await ensureDirectory();
				await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
			});
			queue = write.catch(() => undefined);
			return write;
		},
		async events() {
			let text: string;
			try {
				text = await readFile(file, "utf8");
			} catch {
				return [];
			}
			const events: ToolExecutionEvent[] = [];
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (trimmed.length === 0) continue;
				try {
					const parsed: unknown = JSON.parse(trimmed);
					if (isToolExecutionEvent(parsed)) events.push(parsed);
				} catch {
					// skip malformed lines
				}
			}
			return events;
		},
	};
}

/**
 * Map one harness tool event to a {@link ToolExecutionEvent} and record it.
 * Progress updates without MCP `details.progress` are skipped. Throws on
 * mapping failure; the caller is responsible for catching and logging.
 */
export async function recordToolEvent(recorder: ToolEventRecorder, event: HarnessEvent): Promise<void> {
	const timestamp = Date.now();
	if (event.type === "tool_start") {
		if (!isJsonValue(event.args)) {
			throw new Error(`tool_start args for ${event.toolName} are not JSON`);
		}
		await recorder.record({
			kind: "input",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			serverId: null,
			resourceUri: null,
			args: event.args,
			progress: null,
			total: null,
			message: null,
			uiEvent: null,
			isError: false,
			timestamp,
		});
		return;
	}
	if (event.type === "tool_update") {
		const details = readMcpDetails(event.partialResult.details);
		const progress = details?.progress;
		if (progress === undefined) return;
		await recorder.record({
			kind: "progress",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			serverId: details?.mcpUi?.serverId ?? null,
			resourceUri: details?.mcpUi?.resourceUri ?? null,
			args: null,
			progress: progress.progress,
			total: progress.total,
			message: progress.message,
			uiEvent: isJsonValue(progress.uiEvent) ? progress.uiEvent : null,
			isError: false,
			timestamp,
		});
		return;
	}
	if (event.type === "tool_end") {
		const details = readMcpDetails(event.result.details);
		await recorder.record({
			kind: "result",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			serverId: details?.mcpUi?.serverId ?? null,
			resourceUri: details?.mcpUi?.resourceUri ?? null,
			args: null,
			progress: null,
			total: null,
			message: null,
			uiEvent: null,
			isError: event.isError,
			timestamp,
		});
	}
}
