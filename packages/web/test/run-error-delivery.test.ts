/**
 * 运行失败 pill 的投递边界回归（真实 chord replica 端到端，非 mock）：
 * 服务端 = replicatedState + 真实 reducer（reduceLaneSnapshot，与 app-server transcript service 同路径），
 * 客户端 = createRemoteServiceBinding 经内存 loopback transport 订阅 transcript.state
 * （生产同款 ReplicatedStateReplica：applyImmutable 整批应用后才通知监听者）。
 *
 * 断言目标：每个 state.change（一个原子事务）恰好产生一个投递边界，selector 在每个边界
 * 只看到一致状态——尤其 run_end 的 lastResult 写入与 operation 清理必须同批到达，
 * 不允许出现「operation 已清、结果未写」的中间态投递。
 */

import {
	createRemoteServiceBinding,
	type Op,
	RemoteServiceProvider,
	type RemoteServiceTransport,
	replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	type LaneWatchEvent,
	reduceLaneSnapshot,
} from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { runFailureMessage } from "../src/features/chat/run-error";
import { Transcript, type TranscriptState } from "../src/pi/contracts";

const USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 初始快照：上一轮失败已落盘（模拟打开一个上轮失败的会话，pill 应先可见）。 */
const initialSnapshot: LaneTranscriptSnapshot = {
	lane: "main",
	transcript: [],
	tipId: null,
	lastResult: {
		operationId: "run-1",
		kind: "run",
		status: "failed",
		error: { code: "model_unavailable", message: "previous-boom" },
		fromTipId: null,
		tipId: null,
		startedAt: 1,
		endedAt: 2,
	},
	configuration: {
		model: { provider: "agentplan", modelId: "glm-5.3-flash" },
		thinkingLevel: "off",
		activeToolNames: [],
	},
	stats: { messageCount: 0, usage: USAGE },
	operation: null,
	queues: [],
	faulted: false,
};

const runStart = (runId: string): LaneWatchEvent => ({ type: "run_start", runId, startedAt: 10, lane: "main" });
const runFailed = (runId: string, message: string): LaneWatchEvent => ({
	type: "run_end",
	runId,
	fromTipId: null,
	tipId: null,
	endedAt: 20,
	status: "failed",
	error: { code: "model_unavailable", message },
	lane: "main",
});
const runCompleted = (runId: string): LaneWatchEvent => ({
	type: "run_end",
	runId,
	fromTipId: null,
	tipId: null,
	endedAt: 30,
	status: "completed",
	lane: "main",
});

/** 内存 loopback transport（不改变远端服务语义，仅省去序列化边界）。 */
function makeTransport(provider: RemoteServiceProvider): RemoteServiceTransport {
	return {
		invoke: (call, context) => provider.invoke(call, context),
		subscribe: async (serviceId, mode, listener, _context) => {
			const subscription = provider.subscribe(serviceId, mode, listener);
			return {
				snapshot: subscription.snapshot,
				activate: () => subscription.activate(),
				close: () => subscription.close(),
			};
		},
	};
}

interface Boundary {
	readonly kind: "hydrate" | "update";
	/** 该边界 selector 的读数（ChatInput 派生同源） */
	readonly failure: string | null;
	readonly ops: readonly Op[] | undefined;
	readonly value: TranscriptState;
}

/** ops 是否触达指定顶层路径键（"operation" / "lastResult"；"r" 为整值替换） */
function touchesKey(ops: readonly Op[] | undefined, key: string): boolean {
	return (ops ?? []).some((op) => {
		if (op[0] === "r") return false;
		const path = op[1];
		return Array.isArray(path) && (path as readonly unknown[]).includes(key);
	});
}

describe("运行失败 pill 投递边界（真实 chord replica）", () => {
	it("run_start → run_end 逐批投递：每个边界 selector 只看到一致状态", async () => {
		const provider = new RemoteServiceProvider([{ service: Transcript, mode: "singleton" }]);
		const state = replicatedState<TranscriptState>({ snapshot: initialSnapshot, event: null });
		provider.provide(Transcript, { state });

		const binding = createRemoteServiceBinding({
			services: [{ id: Transcript.id }],
			transport: makeTransport(provider),
			bound: true,
		});
		const transcript = binding.use(Transcript);
		await binding.ready(BACKGROUND_CONTEXT);

		// 订阅即 hydrate；此后每个 state.change 应恰好产生一个 update 投递
		const boundaries: Boundary[] = [];
		transcript.state.subscribe((value, _context, delivery) => {
			boundaries.push({
				kind: delivery.kind,
				failure: runFailureMessage(value),
				ops: delivery.kind === "update" ? delivery.ops : undefined,
				value,
			});
		});
		expect(boundaries).toHaveLength(1);

		const push = (event: LaneWatchEvent): void => {
			state.change(BACKGROUND_CONTEXT, (draft) => {
				reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event);
				draft.event = event;
			});
		};

		push(runStart("run-2"));
		push(runFailed("run-2", "boom-2"));
		push(runStart("run-3"));
		push(runCompleted("run-3"));

		// 边界序列：hydrate（上一轮失败可见）→ 运行中（旧失败被 operation 屏蔽）
		// → 本轮失败（同批写入结果）→ 再次运行中 → 成功（结果覆盖为 completed）
		expect(boundaries.map((b) => b.kind)).toEqual(["hydrate", "update", "update", "update", "update"]);
		expect(boundaries.map((b) => b.failure)).toEqual(["previous-boom", null, "boom-2", null, null]);

		// 每个边界都是自洽值：失败可见 ⟺ operation 已清且结果为 failed；运行中绝不显示失败
		for (const boundary of boundaries) {
			const snapshot = boundary.value.snapshot;
			if (boundary.failure !== null) {
				expect(snapshot?.operation ?? null).toBeNull();
				expect(snapshot?.lastResult?.status).toBe("failed");
			}
			if ((snapshot?.operation ?? null) !== null) expect(boundary.failure).toBeNull();
		}

		// 结构断言：run_start 批次只碰 operation，不动 lastResult（旧失败仍在快照内）
		expect(touchesKey(boundaries[1]!.ops, "operation")).toBe(true);
		expect(touchesKey(boundaries[1]!.ops, "lastResult")).toBe(false);

		// run_end 批次必须同批携带 operation 清理与 lastResult 写入（单事务，无中间态投递）
		expect(touchesKey(boundaries[2]!.ops, "operation")).toBe(true);
		expect(touchesKey(boundaries[2]!.ops, "lastResult")).toBe(true);

		// 通用不变量 A：任何写 lastResult 的投递必须同批触达 operation（结果写入不单独成批）
		for (const boundary of boundaries) {
			if (boundary.kind !== "update") continue;
			if (touchesKey(boundary.ops, "lastResult")) expect(touchesKey(boundary.ops, "operation")).toBe(true);
		}

		// 通用不变量 B：任何「运行中 → 非运行中」的边界必须同批写入 lastResult（清理不先于结果）
		for (let i = 1; i < boundaries.length; i++) {
			const prevOperation = boundaries[i - 1]!.value.snapshot?.operation ?? null;
			const boundary = boundaries[i]!;
			const nextOperation = boundary.value.snapshot?.operation ?? null;
			if (prevOperation !== null && nextOperation === null) {
				expect(touchesKey(boundary.ops, "lastResult")).toBe(true);
			}
		}

		await binding.dispose(BACKGROUND_CONTEXT);
		provider.dispose();
	});
});
