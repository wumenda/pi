import { describe, expect, it } from "vitest";
import {
	extractProgressPayload,
	progressFingerprint,
	shouldDeliverProgress,
	shouldReplayProgress,
} from "../src/features/mcp/progress.ts";

describe("progressFingerprint", () => {
	it("distinguishes same value with different uiEvent", () => {
		expect(progressFingerprint({ progress: 1, total: 3, message: null, uiEvent: null })).not.toBe(
			progressFingerprint({ progress: 1, total: 3, message: null, uiEvent: { scanId: "s1" } }),
		);
	});
	it("is stable for identical payloads", () => {
		const payload = { progress: 2, total: 3, message: "x", uiEvent: { a: 1 } };
		expect(progressFingerprint(payload)).toBe(progressFingerprint(payload));
	});
});

describe("shouldDeliverProgress", () => {
	it("delivers first occurrence and suppresses repeats", () => {
		const seen = new Map<string, Set<string>>();
		const payload = { progress: 1, total: 3, message: null, uiEvent: null };
		expect(shouldDeliverProgress(seen, "t1", payload)).toBe(true);
		expect(shouldDeliverProgress(seen, "t1", payload)).toBe(false);
		expect(shouldDeliverProgress(seen, "t2", payload)).toBe(true);
	});
});

describe("shouldReplayProgress", () => {
	it("replays for new instance and reused-instance recovery on terminal status", () => {
		// 冷启动新建实例：补推
		expect(shouldReplayProgress(false, true, "completed")).toBe(true);
		// 重进会话复用已有实例（非新建、执行未绑定）：同样补推（多调用共享实例的中间调用）
		expect(shouldReplayProgress(false, false, "completed")).toBe(true);
		expect(shouldReplayProgress(false, false, "error")).toBe(true);
	});
	it("skips live status transitions and running calls", () => {
		// 同页面实时 running→completed（执行已绑定，progress 已实时投递）：不补推
		expect(shouldReplayProgress(true, false, "completed")).toBe(false);
		// 运行中：不补推
		expect(shouldReplayProgress(false, true, "running")).toBe(false);
		expect(shouldReplayProgress(false, true, "pending")).toBe(false);
	});
});

describe("extractProgressPayload", () => {
	it("extracts progress from MCP tool details", () => {
		const details = { progress: { progress: 2, total: 4, message: "scanning", uiEvent: { scanId: "s1" } } };
		expect(extractProgressPayload(details)).toEqual({
			progress: 2,
			total: 4,
			message: "scanning",
			uiEvent: { scanId: "s1" },
		});
	});
	it("returns null for non-progress details and normalizes missing fields", () => {
		expect(extractProgressPayload({ mcpUi: { resourceUri: "ui://x" } })).toBeNull();
		expect(extractProgressPayload({ progress: { progress: 1 } })).toEqual({
			progress: 1,
			total: null,
			message: null,
			uiEvent: null,
		});
		expect(extractProgressPayload(undefined)).toBeNull();
	});
});
