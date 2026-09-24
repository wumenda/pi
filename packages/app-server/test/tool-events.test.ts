import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createToolEventRecorder } from "../src/tool-events.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ToolEventRecorder", () => {
	it("appends events as JSONL and reads them back in order", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tool-events-"));
		dirs.push(dir);
		const recorder = createToolEventRecorder(dir, "session-1");
		await recorder.record({
			kind: "input",
			toolCallId: "t1",
			toolName: "mcp__example__scan",
			serverId: "example",
			resourceUri: "ui://x",
			args: {},
			progress: null,
			total: null,
			message: null,
			uiEvent: null,
			isError: false,
			timestamp: 1,
		});
		await recorder.record({
			kind: "progress",
			toolCallId: "t1",
			toolName: null,
			serverId: null,
			resourceUri: null,
			args: null,
			progress: 1,
			total: 3,
			message: "步骤 1",
			uiEvent: { scanId: "s1" },
			isError: false,
			timestamp: 2,
		});
		await recorder.record({
			kind: "result",
			toolCallId: "t1",
			toolName: null,
			serverId: null,
			resourceUri: null,
			args: null,
			progress: null,
			total: null,
			message: null,
			uiEvent: null,
			isError: false,
			timestamp: 3,
		});
		const events = await recorder.events();
		expect(events.map((e) => e.kind)).toEqual(["input", "progress", "result"]);
		expect(events[1]?.uiEvent).toEqual({ scanId: "s1" });
		const lines = readFileSync(join(dir, "tool-events", "session-1.jsonl"), "utf8")
			.trim()
			.split("\n");
		expect(lines).toHaveLength(3);
	});

	it("recovers events written by a previous recorder instance", async () => {
		const dir = mkdtempSync(join(tmpdir(), "tool-events-"));
		dirs.push(dir);
		const first = createToolEventRecorder(dir, "session-2");
		await first.record({
			kind: "input",
			toolCallId: "t9",
			toolName: "t",
			serverId: null,
			resourceUri: null,
			args: null,
			progress: null,
			total: null,
			message: null,
			uiEvent: null,
			isError: false,
			timestamp: 1,
		});
		const second = createToolEventRecorder(dir, "session-2");
		expect((await second.events()).map((e) => e.toolCallId)).toEqual(["t9"]);
	});
});
