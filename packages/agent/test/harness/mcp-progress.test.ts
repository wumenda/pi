import { describe, expect, it } from "vitest";
import { matchProgressNotification } from "../../src/harness/mcp/progress.ts";

describe("matchProgressNotification", () => {
	it("delivers matched progress with uiEvent", () => {
		const received: unknown[] = [];
		const handler = matchProgressNotification({ token: "t1", onProgress: (p) => received.push(p) });
		handler({
			jsonrpc: "2.0",
			method: "notifications/progress",
			params: { progressToken: "t1", progress: 1, total: 3, message: "步骤 1", ui_event: { scanId: "s1" } },
		});
		expect(received).toEqual([{ progress: 1, total: 3, message: "步骤 1", uiEvent: { scanId: "s1" } }]);
	});

	it("delivers uiEvent from params._meta when not top-level", () => {
		const received: unknown[] = [];
		const handler = matchProgressNotification({ token: "t1", onProgress: (p) => received.push(p) });
		handler({
			jsonrpc: "2.0",
			method: "notifications/progress",
			params: { progressToken: "t1", progress: 2, total: 4, _meta: { uiEvent: { step: 2 } } },
		});
		expect(received).toEqual([{ progress: 2, total: 4, message: null, uiEvent: { step: 2 } }]);
	});

	it("delivers uiEvent from params.meta (mcp 1.x wire shape)", () => {
		const received: unknown[] = [];
		const handler = matchProgressNotification({ token: "t1", onProgress: (p) => received.push(p) });
		handler({
			jsonrpc: "2.0",
			method: "notifications/progress",
			params: { progressToken: "t1", progress: 4, total: 4, meta: { uiEvent: { review_pending: true } } },
		});
		expect(received).toEqual([{ progress: 4, total: 4, message: null, uiEvent: { review_pending: true } }]);
	});

	it("ignores other tokens and methods", () => {
		const received: unknown[] = [];
		const handler = matchProgressNotification({ token: "t1", onProgress: (p) => received.push(p) });
		handler({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "other", progress: 1 } });
		handler({ jsonrpc: "2.0", method: "notifications/message", params: {} });
		expect(received).toEqual([]);
	});
});
