/**
 * 增量投影 fuzz 对拍：chord track 驱动真实 op 序列（模拟 host 侧 diff），
 * applyImmutable 构造 replica 侧投递值（结构共享语义），断言
 * projectTranscriptIncremental ≡ projectTranscript（深度相等 + 引用稳定）。
 */

import { applyImmutable, type Op, track } from "@earendil-works/chord/delta";
import { describe, expect, it } from "vitest";
import type { PiTranscriptEntry } from "../src/api/transcript";
import {
	classifyTranscriptOps,
	type PendingAskUserCall,
	projectTranscript,
	projectTranscriptIncremental,
	TranscriptProjectionWorkspace,
} from "../src/api/transcript";

// ---------------------------------------------------------------------------
// 驱动基建
// ---------------------------------------------------------------------------

interface FakeState {
	snapshot: { transcript: PiTranscriptEntry[]; operation: { id: string } | null };
	event: Record<string, unknown> | null;
}

function makeEntry(id: string, message: Record<string, unknown>): PiTranscriptEntry {
	return { id, type: "message", message };
}

function messageOf(entry: PiTranscriptEntry): { role: string; content: unknown[] } | undefined {
	const message = entry.message;
	if (typeof message !== "object" || message === null) return undefined;
	const view = message as { role?: unknown; content?: unknown };
	if (typeof view.role !== "string" || !Array.isArray(view.content)) return undefined;
	return { role: view.role, content: view.content };
}

function lastAssistantEntry(entries: readonly PiTranscriptEntry[]): PiTranscriptEntry | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const view = messageOf(entries[i]!);
		if (view !== undefined && view.role === "assistant") return entries[i]!;
	}
	return undefined;
}

/** 可复现伪随机（mulberry32） */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randInt(rand: () => number, bound: number): number {
	return Math.floor(rand() * bound);
}

const CHUNK_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 \n";
function chunk(rand: () => number): string {
	const length = 1 + randInt(rand, 12);
	let out = "";
	for (let i = 0; i < length; i++) out += CHUNK_ALPHABET[randInt(rand, CHUNK_ALPHABET.length)];
	return out;
}

function pick<T>(rand: () => number, items: readonly T[]): T {
	return items[randInt(rand, items.length)]!;
}

/** 模拟 host：track 记录变更生成 ops；replica 值独立维护并经 applyImmutable 演进 */
class Driver {
	readonly tracker: ReturnType<typeof track<FakeState>>;
	#value: FakeState;
	#nextId = 0;
	#timestamp = 1000;

	constructor(initial: FakeState) {
		this.tracker = track<FakeState>(structuredClone(initial));
		this.#value = structuredClone(initial);
	}

	get value(): FakeState {
		return this.#value;
	}

	nextId(prefix: string): string {
		return `${prefix}-${this.#nextId++}`;
	}

	nextTimestamp(): number {
		this.#timestamp += 1000;
		return this.#timestamp;
	}

	/** 执行一轮变更并 flush；无变更返回 undefined */
	step(action: (state: FakeState) => void): { ops: readonly Op[]; value: FakeState } | undefined {
		action(this.tracker.state);
		const ops = this.tracker.flush();
		if (ops.length === 0) return undefined;
		this.#value = applyImmutable(this.#value, ops);
		return { ops, value: this.#value };
	}
}

function sortedCalls(calls: PendingAskUserCall[]): PendingAskUserCall[] {
	return [...calls].sort((a, b) => (a.toolCallId < b.toolCallId ? -1 : a.toolCallId > b.toolCallId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 随机动作集
// ---------------------------------------------------------------------------

type FuzzAction = (state: FakeState, driver: Driver, rand: () => number) => void;

const FUZZ_ACTIONS: readonly FuzzAction[] = [
	// 用户消息追加
	(state, driver, rand) => {
		state.snapshot.transcript.push(
			makeEntry(driver.nextId("e"), {
				role: "user",
				content: [{ type: "text", text: `请求 ${chunk(rand)}` }],
				timestamp: driver.nextTimestamp(),
			}),
		);
	},
	// skill 块 user 条目
	(state, driver) => {
		state.snapshot.transcript.push(
			makeEntry(driver.nextId("e"), {
				role: "user",
				content: [
					{
						type: "text",
						text: `<skill name="demo" location="/skills/demo/SKILL.md">\nbody\n</skill>\n\n按 skill 执行`,
					},
				],
				timestamp: driver.nextTimestamp(),
			}),
		);
	},
	// assistant 流式起步（空 content）
	(state, driver) => {
		state.snapshot.transcript.push(
			makeEntry(driver.nextId("e"), { role: "assistant", content: [], timestamp: driver.nextTimestamp() }),
		);
	},
	// 末条 assistant 文本追加（流式热路径）
	(state, _driver, rand) => {
		const entry = lastAssistantEntry(state.snapshot.transcript);
		if (entry === undefined) return;
		const content = messageOf(entry)!.content;
		const part = content.find((p) => (p as { type?: string }).type === "text");
		if (part === undefined) content.push({ type: "text", text: chunk(rand) });
		else (part as { text: string }).text += chunk(rand);
	},
	// 末条 assistant thinking 追加
	(state, _driver, rand) => {
		const entry = lastAssistantEntry(state.snapshot.transcript);
		if (entry === undefined) return;
		const content = messageOf(entry)!.content;
		const part = content.find((p) => (p as { type?: string }).type === "thinking");
		if (part === undefined) content.push({ type: "thinking", thinking: chunk(rand) });
		else (part as { thinking: string }).thinking += chunk(rand);
	},
	// 末条 assistant 追加 toolCall（含 ask_user）
	(state, driver, rand) => {
		const entry = lastAssistantEntry(state.snapshot.transcript);
		if (entry === undefined) return;
		messageOf(entry)!.content.push({
			type: "toolCall",
			id: driver.nextId("call"),
			name: pick(rand, ["read_file", "edit_file", "ask_user_question", "mcp__demo__panel"]),
			arguments: { n: randInt(rand, 100) },
		});
	},
	// toolResult 追加（触发依赖的 assistant DTO 重建）
	(state, driver, rand) => {
		const pending: string[] = [];
		for (const entry of state.snapshot.transcript) {
			const view = messageOf(entry);
			if (view === undefined) continue;
			if (view.role === "assistant") {
				for (const part of view.content) {
					const p = part as { type?: string; id?: unknown };
					if (p.type === "toolCall" && typeof p.id === "string") pending.push(p.id);
				}
			}
			if (view.role === "toolResult") {
				const message = entry.message as { toolCallId?: unknown };
				if (typeof message.toolCallId === "string") {
					const at = pending.indexOf(message.toolCallId);
					if (at >= 0) pending.splice(at, 1);
				}
			}
		}
		if (pending.length === 0) return;
		state.snapshot.transcript.push(
			makeEntry(driver.nextId("e"), {
				role: "toolResult",
				toolCallId: pick(rand, pending),
				toolName: "tool",
				isError: rand() < 0.2,
				content: [{ type: "text", text: `结果 ${chunk(rand)}` }],
				timestamp: driver.nextTimestamp(),
			}),
		);
	},
	// operation 起止
	(state, _driver, rand) => {
		state.snapshot.operation = rand() < 0.5 ? { id: `op-${randInt(rand, 5)}` } : null;
	},
	// event 字段更新（tool progress 流）
	(state, _driver, rand) => {
		state.event = { type: "tool_update", seq: randInt(rand, 1_000_000) };
	},
	// compaction：中部删除（数组层非纯尾部 → fallback）
	(state) => {
		if (state.snapshot.transcript.length < 4) return;
		state.snapshot.transcript.splice(1, 2);
	},
	// compaction：重排（→ fallback）
	(state) => {
		if (state.snapshot.transcript.length > 2) state.snapshot.transcript.reverse();
	},
];

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("incremental transcript projection", () => {
	it("随机 op 序列下增量投影与全量投影对拍一致（1000 轮）", () => {
		const rand = mulberry32(0x5eed);
		const driver = new Driver({ snapshot: { transcript: [], operation: null }, event: null });
		const workspace = new TranscriptProjectionWorkspace();
		const counts = { append: 0, tail: 0, fallback: 0 };
		let prevCount = 0;

		for (let round = 0; round < 1000; round++) {
			const step = driver.step((state) => {
				const batch = 1 + randInt(rand, 3);
				for (let k = 0; k < batch; k++) {
					FUZZ_ACTIONS[randInt(rand, FUZZ_ACTIONS.length)]!(state, driver, rand);
				}
			});
			if (step === undefined) continue;
			counts[classifyTranscriptOps(step.ops, prevCount)] += 1;

			const full = projectTranscript(step.value.snapshot);
			const incremental = projectTranscriptIncremental(step.value.snapshot, step.ops, workspace);
			expect(incremental.messages).toEqual(full.messages);
			expect(incremental.running).toBe(full.running);
			expect(sortedCalls(incremental.pendingAskUser)).toEqual(sortedCalls(full.pendingAskUser));
			prevCount = workspace.entryCount;
		}

		// 三条路径都被随机序列覆盖
		expect(counts.append).toBeGreaterThan(0);
		expect(counts.tail).toBeGreaterThan(0);
		expect(counts.fallback).toBeGreaterThan(0);
	});

	it("classifyTranscriptOps 分类各 op 形态", () => {
		const ops = (...list: Op[]): Op[] => list;
		const transcript = ["snapshot", "transcript"] as const;
		expect(classifyTranscriptOps(ops(["p", transcript, 3, 0, [{}]]), 3)).toBe("append");
		expect(classifyTranscriptOps(ops(["p", transcript, 3, 0, [{}]], ["p", transcript, 4, 0, [{}]]), 3)).toBe(
			"append",
		);
		expect(
			classifyTranscriptOps(
				ops(
					["a", ["snapshot", "transcript", 2, "message", "content", 0, "text"], "x"],
					["p", transcript, 3, 0, [{}]],
				),
				3,
			),
		).toBe("append");
		expect(
			classifyTranscriptOps(ops(["a", ["snapshot", "transcript", 2, "message", "content", 0, "text"], "x"]), 3),
		).toBe("tail");
		expect(classifyTranscriptOps(ops(["s", ["snapshot", "operation"], { id: "o" }]), 3)).toBe("tail");
		expect(classifyTranscriptOps(ops(["s", ["event"], {}]), 3)).toBe("tail");
		expect(classifyTranscriptOps(ops(["d", ["snapshot", "transcript", 2, "message", "content", 0]]), 3)).toBe("tail");

		expect(classifyTranscriptOps(ops(["r", {}]), 3)).toBe("fallback");
		expect(classifyTranscriptOps(ops(["m", transcript, [1, 0, 2]]), 3)).toBe("fallback");
		expect(classifyTranscriptOps(ops(["p", transcript, 1, 0, [{}]]), 3)).toBe("fallback");
		expect(classifyTranscriptOps(ops(["p", transcript, 3, 1, []]), 3)).toBe("fallback");
		expect(classifyTranscriptOps(ops(["s", transcript, []]), 3)).toBe("fallback");
		expect(classifyTranscriptOps(ops(["s", ["snapshot"], {}]), 3)).toBe("fallback");
		expect(classifyTranscriptOps(ops(["s", ["snapshot", "transcript", 1, "message"], {}]), 3)).toBe("fallback");
	});

	it("流式期间未变更消息的 DTO 引用保持稳定", () => {
		const driver = new Driver({ snapshot: { transcript: [], operation: { id: "op-1" } }, event: null });
		const workspace = new TranscriptProjectionWorkspace();

		const seed = driver.step((state) => {
			state.snapshot.transcript.push(
				makeEntry("e-user", {
					role: "user",
					content: [{ type: "text", text: "帮我检查" }],
					timestamp: driver.nextTimestamp(),
				}),
				makeEntry("e-a", {
					role: "assistant",
					content: [{ type: "text", text: "好的" }],
					timestamp: driver.nextTimestamp(),
				}),
			);
		})!;
		const baseline = projectTranscriptIncremental(seed.value.snapshot, seed.ops, workspace);
		expect(baseline.messages).toHaveLength(2);
		const userDto = baseline.messages[0]!;
		const assistantDto = baseline.messages[1]!;

		// 流式文本追加：user DTO 引用不变，assistant DTO 内容增长
		let current = baseline;
		for (let round = 0; round < 3; round++) {
			const step = driver.step((state) => {
				const entry = lastAssistantEntry(state.snapshot.transcript)!;
				(messageOf(entry)!.content[0] as { text: string }).text += ` 第${round}段`;
			})!;
			current = projectTranscriptIncremental(step.value.snapshot, step.ops, workspace);
			expect(current.messages[0]).toBe(userDto);
			expect(current.messages[1]).not.toBe(current.messages[0]);
			const full = projectTranscript(step.value.snapshot);
			expect(current.messages).toEqual(full.messages);
		}
		expect((current.messages[1]!.parts[0] as { text: string }).text).toContain("第2段");
		expect(current.messages[1]).not.toBe(assistantDto);
	});

	it("toolResult 到达触发依赖的 assistant DTO 同位重建并复用其后引用", () => {
		const driver = new Driver({ snapshot: { transcript: [], operation: { id: "op-1" } }, event: null });
		const workspace = new TranscriptProjectionWorkspace();

		const seed = driver.step((state) => {
			state.snapshot.transcript.push(
				makeEntry("e-user", {
					role: "user",
					content: [{ type: "text", text: "查一下" }],
					timestamp: driver.nextTimestamp(),
				}),
				makeEntry("e-a", {
					role: "assistant",
					content: [
						{ type: "text", text: "开始" },
						{ type: "toolCall", id: "call-1", name: "read_sensor", arguments: {} },
					],
					timestamp: driver.nextTimestamp(),
				}),
			);
		})!;
		const before = projectTranscriptIncremental(seed.value.snapshot, seed.ops, workspace);
		const userDto = before.messages[0]!;
		const runningPart = before.messages[1]!.parts[1] as { state: { status: string } };
		expect(runningPart.state.status).toBe("running");

		// 结果到达（append）：assistant DTO 重建，status → completed，user DTO 引用不变
		const step = driver.step((state) => {
			state.snapshot.transcript.push(
				makeEntry("e-result", {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "read_sensor",
					isError: false,
					content: [{ type: "text", text: '{"temp":42}' }],
					timestamp: driver.nextTimestamp(),
				}),
			);
		})!;
		const after = projectTranscriptIncremental(step.value.snapshot, step.ops, workspace);
		expect(after.messages).toHaveLength(2);
		expect(after.messages[0]).toBe(userDto);
		expect(after.messages[1]).not.toBe(before.messages[1]);
		const completedPart = after.messages[1]!.parts[1] as { state: { status: string; output?: string } };
		expect(completedPart.state.status).toBe("completed");
		expect(completedPart.state.output).toBe('{"temp":42}');

		// 后续无关投递（event 更新）：重建后的 assistant DTO 引用保持稳定
		const quiet = driver.step((state) => {
			state.event = { type: "tool_update", seq: 1 };
		})!;
		const stable = projectTranscriptIncremental(quiet.value.snapshot, quiet.ops, workspace);
		expect(stable.messages[1]).toBe(after.messages[1]);
	});

	it("skill 条目多次投影不丢失合成的 skill 工具消息（缓存形状回归）", () => {
		const snapshot = {
			transcript: [
				makeEntry("e-skill", {
					role: "user",
					content: [
						{
							type: "text",
							text: '<skill name="demo" location="/skills/demo/SKILL.md">\nmeta\n</skill>\n\n执行指令',
						},
					],
					timestamp: 1000,
				}),
			],
			operation: null,
		};
		const first = projectTranscript(snapshot);
		expect(first.messages).toHaveLength(2);
		expect(first.messages[0]).toMatchObject({ id: "skill-e-skill", role: "assistant" });
		expect(first.messages[1]).toMatchObject({ id: "e-skill", role: "user" });

		// 第二次全量投影（同 entry 引用，记忆化命中）两条 DTO 都必须在
		const second = projectTranscript(snapshot);
		expect(second.messages).toHaveLength(2);
		expect(second.messages).toEqual(first.messages);
	});

	it("ask_user 挂起经增量投影与全量一致（挂起与恢复）", () => {
		const driver = new Driver({ snapshot: { transcript: [], operation: { id: "op-1" } }, event: null });
		const workspace = new TranscriptProjectionWorkspace();

		const ask = driver.step((state) => {
			state.snapshot.transcript.push(
				makeEntry("e-a", {
					role: "assistant",
					content: [{ type: "toolCall", id: "ask-1", name: "ask_user_question", arguments: { q: 1 } }],
					timestamp: driver.nextTimestamp(),
				}),
			);
		})!;
		const asked = projectTranscriptIncremental(ask.value.snapshot, ask.ops, workspace);
		const fullAsked = projectTranscript(ask.value.snapshot);
		expect(sortedCalls(asked.pendingAskUser)).toEqual(sortedCalls(fullAsked.pendingAskUser));
		expect(asked.pendingAskUser).toHaveLength(1);
		expect(asked.pendingAskUser[0]!.toolCallId).toBe("ask-1");

		// 结果到达：挂起清除，两路一致
		const answered = driver.step((state) => {
			state.snapshot.transcript.push(
				makeEntry("e-r", {
					role: "toolResult",
					toolCallId: "ask-1",
					toolName: "ask_user_question",
					isError: false,
					content: [{ type: "text", text: "answered" }],
					timestamp: driver.nextTimestamp(),
				}),
			);
		})!;
		const done = projectTranscriptIncremental(answered.value.snapshot, answered.ops, workspace);
		const fullDone = projectTranscript(answered.value.snapshot);
		expect(done.pendingAskUser).toEqual([]);
		expect(done.messages).toEqual(fullDone.messages);
	});
});
