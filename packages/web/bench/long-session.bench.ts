/**
 * 长会话性能基线（P2-9 T2.9-0）。
 *
 * 三项纯逻辑指标（node 环境，无真实布局；layout 类指标走手动验证清单）：
 * 1. coldRebuild   —— 5000 条 fixture 一次全量投影（会话切换/断线恢复冷路径）
 * 2. streamingApply —— 末条流式追加 ×100：applyImmutable + 增量投影 + React Query
 *                      setQueryData + 缓存订阅通知（流式热路径全链）
 * 3. derivedScalars —— 每次投递后的派生标量计算（contextEstimate 游标化路径，
 *                      未变消息命中 WeakMap 缓存，仅末条新引用重算）
 *
 * 运行（不进常规 CI；include 仅拾取 bench/*.bench.ts，常规 `--run test` 不含）：
 *   node ..\..\node_modules\vitest\dist\cli.js --run bench/long-session.bench.ts
 *
 * 数值为相对指标（与本机相关），用于优化前后对比与门控判断，不作绝对承诺。
 */

import { performance } from "node:perf_hooks";
import { describe, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applyImmutable, type Op } from "@earendil-works/chord/delta";
import { TranscriptProjectionWorkspace } from "../src/api/transcript";
import { estimateContextSegments } from "../src/features/chat/contextEstimate";
import { buildLongSessionFixture, STREAM_CHUNK, type LongSessionFixture } from "./long-session-fixture";

// ---------------------------------------------------------------------------
// 统计基建
// ---------------------------------------------------------------------------

interface Stats {
	rounds: number;
	p50: number;
	p95: number;
	mean: number;
}

function percentile(sortedSamples: readonly number[], p: number): number {
	const index = Math.min(sortedSamples.length - 1, Math.ceil((p / 100) * sortedSamples.length) - 1);
	return sortedSamples[Math.max(0, index)]!;
}

function report(label: string, samples: readonly number[]): Stats {
	const sorted = [...samples].sort((a, b) => a - b);
	const stats: Stats = {
		rounds: samples.length,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		mean: samples.reduce((a, b) => a + b, 0) / samples.length,
	};
	console.info(
		`[bench] ${label}: rounds=${stats.rounds} p50=${stats.p50.toFixed(3)}ms p95=${stats.p95.toFixed(3)}ms mean=${stats.mean.toFixed(3)}ms`,
	);
	return stats;
}

// ---------------------------------------------------------------------------
// 基准
// ---------------------------------------------------------------------------

describe("long-session performance baseline (P2-9 T2.9-0)", () => {
	it("coldRebuild / streamingApply / derivedScalars", () => {
		const fixture: LongSessionFixture = buildLongSessionFixture(5000);
		console.info(`[bench] fixture: ${fixture.entries.length} entries`);

		// 1) 冷切换：一次全量投影（会话切换/断线恢复冷路径）
		const coldSamples: number[] = [];
		for (let round = 0; round < 5; round++) {
			const start = performance.now();
			new TranscriptProjectionWorkspace().rebuild(fixture.snapshot);
			coldSamples.push(performance.now() - start);
		}
		const cold = report("coldRebuild(5000)", coldSamples);

		// 2) 流式热路径：末条 text 追加 ×100（applyImmutable + 增量投影 + React Query 通知）
		const workspace = new TranscriptProjectionWorkspace();
		const baseline = workspace.rebuild(fixture.snapshot);
		const queryClient = new QueryClient();
		const queryKey = ["messages", "bench"] as const;
		queryClient.setQueryData(queryKey, baseline.messages);
		let notifications = 0;
		const unsubscribe = queryClient.getQueryCache().subscribe(() => {
			notifications += 1;
		});

		const lastIndex = fixture.entries.length - 1;
		const textPath = ["snapshot", "transcript", lastIndex, "message", "content", 0, "text"] as const;
		// replica 值 = TranscriptState 形状（op 路径首段 snapshot；投影 apply 收其 snapshot 字段）
		let value: { snapshot: LongSessionFixture["snapshot"]; event: null } = {
			snapshot: fixture.snapshot,
			event: null,
		};
		const streamingSamples: number[] = [];
		const derivedSamples: number[] = [];
		const agents: never[] = [];
		const tools: never[] = [];
		let projection = baseline;

		for (let round = 1; round <= 100; round++) {
			const ops: Op[] = [["a", textPath, `${STREAM_CHUNK}${round}`]];
			const start = performance.now();
			const next = applyImmutable(value, ops);
			projection = workspace.apply(next.snapshot, ops);
			queryClient.setQueryData(queryKey, projection.messages);
			streamingSamples.push(performance.now() - start);
			value = next;

			// 3) 派生标量：游标化路径（未变消息命中缓存，仅末条新引用重算）
			const derivedStart = performance.now();
			estimateContextSegments({ messages: projection.messages, agents, agentName: undefined, tools });
			derivedSamples.push(performance.now() - derivedStart);
		}
		unsubscribe();
		const streaming = report("streamingApply(x100)", streamingSamples);
		const derived = report("derivedScalars(x100)", derivedSamples);

		// 一致性哨兵：流式期间每次投递都命中 React Query 缓存通知；增量投影未回落全量
		if (notifications !== 100) {
			throw new Error(`expected 100 cache notifications, got ${notifications}`);
		}
		if (projection.messages.length === 0) {
			throw new Error("streaming projection produced no messages");
		}
		if (cold.p95 <= 0 || streaming.p95 <= 0 || derived.p95 <= 0) {
			throw new Error("bench produced non-positive timings");
		}
	});
});
