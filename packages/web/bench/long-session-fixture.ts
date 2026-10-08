/**
 * 长会话合成 fixture（P2-9 T2.9-0 性能基线设施）：
 * 生成确定性的大 transcript（固定伪随机种子，可复现），混合真实会话的条目形态
 * （user 文本 / assistant 流式中间态（text+thinking+toolCall）/ toolResult / skill 块 /
 * compaction 摘要），供长会话性能基准使用。
 */

import type { PiTranscriptEntry } from "../src/api/transcript";

/** 确定性伪随机（mulberry32） */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"检查设备",
	"温度传感器",
	"read_file",
	"返回结果",
	'{"temp":42}',
	"反应段",
	"分离段回收段",
	"调整参数后重试",
	"line\nnext",
	"0123456789",
];

function randomText(rand: () => number): string {
	const count = 1 + Math.floor(rand() * 12);
	let out = "";
	for (let i = 0; i < count; i++) out += WORDS[Math.floor(rand() * WORDS.length)];
	return out;
}

export interface LongSessionFixture {
	entries: readonly PiTranscriptEntry[];
	/** pi LaneSnapshot 形状（transcript + operation） */
	snapshot: { transcript: readonly PiTranscriptEntry[]; operation: { id: string } | null };
}

/**
 * 合成长会话：约 messageCount 条目（按 5 类循环分布），每 500 条穿插一条 compaction。
 * 末条固定为带 text part 的 assistant（流式追加场景的锚点）。
 */
export function buildLongSessionFixture(messageCount = 5000): LongSessionFixture {
	const rand = mulberry32(0x7ea5e5);
	const entries: PiTranscriptEntry[] = [];
	let timestamp = 1_700_000_000_000;

	const push = (id: string, entry: Omit<PiTranscriptEntry, "id" | "type"> & { type?: string }): void => {
		entries.push({ id, type: entry.type ?? "message", message: entry.message, summary: entry.summary });
		timestamp += 1000;
	};

	for (let i = 0; i < messageCount; i++) {
		const id = `e${i}`;
		if (i % 500 === 499) {
			// compaction 摘要条目（不投影为消息，但参与前缀/结构）
			push(id, { type: "compaction", summary: `compaction @${i} ${randomText(rand)}` });
			continue;
		}
		const kind = i % 5;
		if (kind === 0) {
			push(id, {
				message: { role: "user", content: [{ type: "text", text: `请求 ${i} ${randomText(rand)}` }], timestamp },
			});
		} else if (kind === 1) {
			// assistant 流式中间态：text + thinking + toolCall（callId 由下一条 toolResult 消费）
			push(id, {
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: `回复 ${i} ${randomText(rand)}` },
						{ type: "thinking", thinking: `思考 ${i} ${randomText(rand)}` },
						{
							type: "toolCall",
							id: `call-${i}`,
							name: i % 25 === 1 ? "ask_user_question" : "read_sensor",
							arguments: { n: i },
						},
					],
					timestamp,
				},
			});
		} else if (kind === 2) {
			push(id, {
				message: {
					role: "toolResult",
					toolCallId: `call-${i - 1}`,
					toolName: "read_sensor",
					isError: false,
					content: [{ type: "text", text: `结果 ${i} ${randomText(rand)}` }],
					timestamp,
				},
			});
		} else if (kind === 3) {
			push(id, {
				message: { role: "assistant", content: [{ type: "text", text: `说明 ${i} ${randomText(rand)}` }], timestamp },
			});
		} else if (i % 25 === 4) {
			// skill 块条目（合成 skill 工具 part + 附加指令，2 条 DTO）
			push(id, {
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text: `<skill name="pfd-diagnosis" location="/skills/pfd/SKILL.md">\n诊断流程 ${i}\n</skill>\n\n按 skill 执行 ${randomText(rand)}`,
						},
					],
					timestamp,
				},
			});
		} else {
			push(id, {
				message: { role: "user", content: [{ type: "text", text: `跟进 ${i} ${randomText(rand)}` }], timestamp },
			});
		}
	}

	// 末条固定为 assistant 带 text part（流式追加基准的稳定锚点）
	const lastIndex = entries.length - 1;
	const last = entries[lastIndex]!;
	entries[lastIndex] = {
		id: last.id,
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "流式锚点" }], timestamp },
	};

	return { entries, snapshot: { transcript: entries, operation: { id: "bench-op" } } };
}

/** 流式追加的固定 chunk（流式热路径基准输入） */
export const STREAM_CHUNK = " 继续输出一段较长的流式文本内容用于压测追加成本。";
