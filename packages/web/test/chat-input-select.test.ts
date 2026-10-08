/**
 * T2.9-1 ChatInput 派生标量订阅收窄验证：
 * - React Query select 标量的通知行为（useQuery 底层即 QueryObserver，行为等价）：
 *   流式投递期间圆环权威值（latestStepFinishTokens）零通知；历史段粗化档位仅跨档通知；
 * - 派生标量与 estimateContextSegments 三段一致（同一套缓存）；
 * - latestStepFinishTokens / quantizeTokens 行为边界。
 */

import { applyImmutable, type Op } from "@earendil-works/chord/delta";
import type { MessageDTO } from "@platform/shared";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { buildLongSessionFixture, type LongSessionFixture, STREAM_CHUNK } from "../bench/long-session-fixture";
import { TranscriptProjectionWorkspace } from "../src/api/transcript";
import {
	estimateContextSegments,
	historyTokensOf,
	latestStepFinishTokens,
	quantizeTokens,
	systemTokensOf,
	toolsTokensOf,
} from "../src/features/chat/contextEstimate";

// ---------------------------------------------------------------------------
// 流式投递驱动（bench 同款链路：applyImmutable + 增量投影 + setQueryData）
// ---------------------------------------------------------------------------

interface StreamingRig {
	fixture: LongSessionFixture;
	workspace: TranscriptProjectionWorkspace;
	client: QueryClient;
	queryKey: readonly ["messages", string];
	applyStreamingRound(round: number): MessageDTO[];
	applyTurnEnd(inputTokens: number): void;
}

function createStreamingRig(sessionId = "t291"): StreamingRig {
	const fixture = buildLongSessionFixture(200);
	const workspace = new TranscriptProjectionWorkspace();
	const baseline = workspace.rebuild(fixture.snapshot);
	const client = new QueryClient();
	const queryKey = ["messages", sessionId] as const;
	client.setQueryData(queryKey, baseline.messages);

	const lastIndex = fixture.entries.length - 1;
	const textPath = ["snapshot", "transcript", lastIndex, "message", "content", 0, "text"] as const;
	let value: { snapshot: LongSessionFixture["snapshot"]; event: null } = {
		snapshot: fixture.snapshot,
		event: null,
	};

	return {
		fixture,
		workspace,
		client,
		queryKey,
		applyStreamingRound(round: number): MessageDTO[] {
			const ops: Op[] = [["a", textPath, `${STREAM_CHUNK}${round}`]];
			const next = applyImmutable(value, ops);
			const projection = workspace.apply(next.snapshot, ops);
			client.setQueryData(queryKey, projection.messages);
			value = next;
			return projection.messages;
		},
		/** 轮次结束：pi 在轮次完成时为末条 assistant 写入 usage（真实 op 形态：
		 * ["s", [..., "usage"], {...}] → 投影 tail 重投影 → DTO 合成 step-finish part
		 * → select 通知一次）。走真实投影链路验证端到端。 */
		applyTurnEnd(inputTokens: number): void {
			const ops: Op[] = [
				[
					"s",
					["snapshot", "transcript", lastIndex, "message", "usage"],
					{ input: inputTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: inputTokens },
				],
			];
			const next = applyImmutable(value, ops);
			const projection = workspace.apply(next.snapshot, ops);
			client.setQueryData(queryKey, projection.messages);
			value = next;
		},
	};
}

/** select 观察者：返回收到的 data 序列（含订阅初始通知）。
 * notifyOnChangeProps: ["data"] 显式列表模式按 Object.is 比较 data 值——
 * 精确验证「select 返回原始标量、值相等即不通知」这一设计依赖的语义
 * （React useQuery 默认 tracked 模式下组件只读 data 时行为等价；tracked props
 * 由 React 渲染期的属性访问填充，非 React 订阅无法直接复现）。 */
function observe<T>(
	client: QueryClient,
	queryKey: readonly unknown[],
	select: (data: MessageDTO[]) => T,
	onNotify: (value: T) => void,
): () => void {
	const observer = new QueryObserver(client, {
		queryKey: [...queryKey],
		queryFn: () => Promise.resolve<MessageDTO[]>([]),
		staleTime: Infinity,
		notifyOnChangeProps: ["data"],
		select,
	});
	return observer.subscribe((result) => {
		onNotify(result.data as T);
	});
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("ChatInput select narrowing (T2.9-1)", () => {
	it("流式投递期间权威值零通知，历史段仅跨档通知", () => {
		const rig = createStreamingRig();
		const contextNotifies: Array<number | null> = [];
		const historyNotifies: number[] = [];
		const unsubscribeContext = observe(rig.client, rig.queryKey, latestStepFinishTokens, (v) =>
			contextNotifies.push(v),
		);
		const unsubscribeHistory = observe(
			rig.client,
			rig.queryKey,
			(messages) => quantizeTokens(historyTokensOf(messages)),
			(v) => historyNotifies.push(v),
		);
		const initialContext = contextNotifies.length;
		const initialHistory = historyNotifies.length;

		for (let round = 1; round <= 100; round++) rig.applyStreamingRound(round);

		// 权威值：step-finish 未更新 → 流式期间零通知
		expect(contextNotifies.length - initialContext).toBe(0);
		// 历史段：粗化后仅跨 500 token 档时通知（每轮 ~24 token → 100 轮应远少于 100 次）
		const historyDelta = historyNotifies.length - initialHistory;
		expect(historyDelta).toBeGreaterThan(0);
		expect(historyDelta).toBeLessThanOrEqual(10);

		// 轮次结束：step-finish 到达 → 权威值通知一次
		rig.applyTurnEnd(12_345);
		expect(contextNotifies.length - initialContext).toBe(1);
		expect(contextNotifies[contextNotifies.length - 1]).toBe(12_345);

		unsubscribeContext();
		unsubscribeHistory();
	});

	it("派生标量与 estimateContextSegments 三段一致", () => {
		const fixture = buildLongSessionFixture(300);
		const messages = new TranscriptProjectionWorkspace().rebuild(fixture.snapshot).messages;
		const agents = [{ name: "build", prompt: "You are a build agent." }];
		const tools = [{ name: "read_file", description: "读取", inputSchema: { type: "object" } }];
		const agentName = "build";

		const segments = estimateContextSegments({ messages, agents, agentName, tools });
		expect(systemTokensOf(agents, agentName)).toBe(segments.systemTokens);
		expect(toolsTokensOf(tools)).toBe(segments.toolsTokens);
		expect(historyTokensOf(messages)).toBe(segments.historyTokens);
	});

	it("latestStepFinishTokens 倒序命中与缺省行为", () => {
		expect(latestStepFinishTokens(undefined)).toBeNull();
		expect(latestStepFinishTokens([])).toBeNull();
		const messages = [
			{ id: "m1", role: "assistant", parts: [{ type: "step-finish", tokens: { input: 100, cache: { read: 40 } } }] },
			{ id: "m2", role: "assistant", parts: [{ type: "text", text: "无 finish" }] },
			{ id: "m3", role: "assistant", parts: [{ type: "step-finish", tokens: { input: 900 } }] },
		] as unknown as MessageDTO[];
		// 倒序：命中最新的 m3
		expect(latestStepFinishTokens(messages)).toBe(900);
	});

	it("quantizeTokens 粗化边界", () => {
		expect(quantizeTokens(0)).toBe(0);
		expect(quantizeTokens(249)).toBe(0);
		expect(quantizeTokens(250)).toBe(500);
		expect(quantizeTokens(251)).toBe(500);
		expect(quantizeTokens(749)).toBe(500);
		expect(quantizeTokens(750)).toBe(1000);
	});
});
