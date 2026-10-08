/**
 * 运行失败 pill 派生测试（runFailureMessage）：
 * 数据源 = transcript 快照 lastResult（服务端 reducer 在 run_end 写入）——
 * 覆盖：运行中屏蔽、failed 带/无文案、completed/aborted 不算失败、
 * 非 run 结果（compaction）不展示、wire 异常形态降级。
 */

import { describe, expect, it } from "vitest";
import { type RunErrorTranscriptView, runFailureMessage } from "../src/features/chat/run-error";

const failedRun = (message: string): RunErrorTranscriptView => ({
	snapshot: {
		operation: null,
		lastResult: {
			kind: "run",
			status: "failed",
			error: { code: "model_unavailable", message },
		},
	},
});

describe("runFailureMessage", () => {
	it("无 transcript / 无 snapshot 返回 null", () => {
		expect(runFailureMessage(undefined)).toBeNull();
		expect(runFailureMessage({})).toBeNull();
		expect(runFailureMessage({ snapshot: null })).toBeNull();
	});

	it("运行中（operation 非空）不展示上次失败", () => {
		const view: RunErrorTranscriptView = {
			snapshot: {
				operation: { id: "op-1", kind: "run" },
				lastResult: { kind: "run", status: "failed", error: { message: "boom" } },
			},
		};
		expect(runFailureMessage(view)).toBeNull();
	});

	it("run failed 返回错误文案", () => {
		expect(runFailureMessage(failedRun("The configured model is unavailable in this process"))).toBe(
			"The configured model is unavailable in this process",
		);
	});

	it("failed 但 wire 缺 message 返回空串（组件渲染通用文案）", () => {
		expect(runFailureMessage({ snapshot: { operation: null, lastResult: { kind: "run", status: "failed" } } })).toBe(
			"",
		);
		expect(
			runFailureMessage({
				snapshot: { operation: null, lastResult: { kind: "run", status: "failed", error: { message: 42 } } },
			}),
		).toBe("");
	});

	it("completed / aborted 终态不算失败", () => {
		expect(
			runFailureMessage({ snapshot: { operation: null, lastResult: { kind: "run", status: "completed" } } }),
		).toBeNull();
		expect(
			runFailureMessage({ snapshot: { operation: null, lastResult: { kind: "run", status: "aborted" } } }),
		).toBeNull();
	});

	it("非 run 结果（compaction）不展示", () => {
		expect(
			runFailureMessage({
				snapshot: {
					operation: null,
					lastResult: { kind: "compaction", status: "failed", error: { message: "x" } },
				},
			}),
		).toBeNull();
	});

	it("无 lastResult（仅成功过/新会话）返回 null", () => {
		expect(runFailureMessage({ snapshot: { operation: null } })).toBeNull();
	});
});
