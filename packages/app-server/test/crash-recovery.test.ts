import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { McpServerManager } from "@earendil-works/pi-agent-core/harness/mcp";
import type { Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionRuntime, type SessionRuntime } from "../src/runtime.ts";
import { createAgentController } from "../src/services/agent-controller.ts";
import { createSessionStore, type SessionStore } from "../src/sessions.ts";
import { createFauxLlm, type FauxLlm } from "./faux-llm.ts";

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "app-server-crash-"));
	dirs.push(dir);
	return dir;
};
afterEach(async () => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const askInput = {
	title: "确认",
	pages: [
		{
			type: "list-single",
			id: "p1",
			title: "选择",
			fields: [
				{
					id: "f1",
					label: "选项",
					valueType: "enum",
					widget: "radio",
					options: [{ id: "a", label: "A" }],
				},
			],
		},
	],
};

interface CrashScenario {
	runtimeA: SessionRuntime;
	runtimeB: SessionRuntime;
	staleToolCallId: string;
	faux: FauxLlm["faux"];
}

/**
 * 模拟崩溃恢复：进程 A 挂起在 ask_user_question 上后"崩溃"（不 close、不 close 会话句柄），
 * 独立 store（同 dataDir）重新 open 同一会话建 runtime B——等价于服务重启后重进会话。
 */
async function crashedAndReopenedSession(): Promise<CrashScenario> {
	const root = tempDir();
	const dataDir = join(root, "data");
	const workspaceDir = join(root, "ws");
	const storeA: SessionStore = createSessionStore({ dataDir, workspaceDir });
	const metadata = await storeA.create();
	const llm = createFauxLlm();

	// 进程 A：prompt 挂起在 ask_user_question 上，随后崩溃（promise 无人应答，进程消失）
	const runtimeA = await createSessionRuntime({
		session: await storeA.open(metadata),
		models: llm.models,
		model: llm.model,
		workspaceDir,
		mcp: new McpServerManager({}),
	});
	llm.faux.setResponses([fauxAssistantMessage([fauxToolCall("ask_user_question", askInput)])]);
	runtimeA.lane.prompt("ask me", undefined, BACKGROUND_CONTEXT).catch(() => undefined);
	await waitUntil(() => runtimeA.askUser.pending().length > 0);
	const staleToolCallId = runtimeA.askUser.pending()[0].toolCallId;

	// 进程 B（重启后）：全新 runtime，同一会话
	const storeB: SessionStore = createSessionStore({ dataDir, workspaceDir });
	const runtimeB = await createSessionRuntime({
		session: await storeB.open(metadata),
		models: llm.models,
		model: llm.model,
		workspaceDir,
		mcp: new McpServerManager({}),
	});
	return { runtimeA, runtimeB, staleToolCallId, faux: llm.faux };
}

describe("crash recovery: stale suspended ask run", () => {
	it("settles the stale run on the next prompt without an extra LLM call", { timeout: 20_000 }, async () => {
		const { runtimeA, runtimeB, staleToolCallId, faux } = await crashedAndReopenedSession();
		try {
			expect(runtimeB.staleRunOperationId).toBeDefined();

			// 捕获恢复后第一次发给模型的 messages
			let requestMessages: Message[] | undefined;
			const callCountBefore = faux.state.callCount;
			faux.setResponses([
				(context) => {
					requestMessages = context.messages;
					return fauxAssistantMessage([fauxText("after-crash")]);
				},
			]);

			const controller = createAgentController(runtimeB.lane, runtimeB.askUser, runtimeB.staleRunOperationId);
			const response = await controller.prompt({ message: "again", images: null }, BACKGROUND_CONTEXT);
			expect(response.accepted).toBe(true);
			await waitUntil(() => requestMessages !== undefined);
			await runtimeB.lane.waitForIdle(BACKGROUND_CONTEXT);

			// 恢复路径零 LLM 调用：只有重试的新 prompt 调了 1 次
			expect(faux.state.callCount - callCountBefore).toBe(1);

			// 消息流一致：遗留 ask toolCall 有 toolResult 跟随（interrupted 收尾），不再悬挂
			const askToolCall = requestMessages?.flatMap((message, index) =>
				message.role === "assistant"
					? message.content
							.filter((block) => block.type === "toolCall" && block.id === staleToolCallId)
							.map(() => index)
					: [],
			);
			expect(askToolCall?.length).toBe(1);
			const askCallIndex = askToolCall?.[0] ?? -1;
			const settled = requestMessages
				?.slice(askCallIndex + 1)
				.some((message) => message.role === "toolResult" && message.toolCallId === staleToolCallId);
			expect(settled).toBe(true);

			// lane 解放：再发消息正常受理
			faux.setResponses([fauxAssistantMessage([fauxText("next")])]);
			const next = await controller.prompt({ message: "next", images: null }, BACKGROUND_CONTEXT);
			expect(next.accepted).toBe(true);
		} finally {
			await runtimeB.close();
			await runtimeA.close().catch(() => undefined);
		}
	});

	it("answerAskUser for the stale tool call fails with an actionable error", { timeout: 20_000 }, async () => {
		const { runtimeA, runtimeB, staleToolCallId } = await crashedAndReopenedSession();
		try {
			expect(runtimeB.askUser.pending().length).toBe(0);
			const controller = createAgentController(runtimeB.lane, runtimeB.askUser, runtimeB.staleRunOperationId);
			await expect(
				controller.answerAskUser({ toolCallId: staleToolCallId, answers: { p1: { f1: "a" } } }, BACKGROUND_CONTEXT),
			).rejects.toThrow(/restarted/);
		} finally {
			await runtimeB.close();
			await runtimeA.close().catch(() => undefined);
		}
	});

	it(
		"stale ask tool call settles with an error result event so the frontend card can close",
		{ timeout: 20_000 },
		async () => {
			const { runtimeA, runtimeB, staleToolCallId, faux } = await crashedAndReopenedSession();
			try {
				const toolEnds: Array<{ toolCallId: string; toolName: string; isError: boolean }> = [];
				runtimeB.harness.events.on("tool_end", (event) => {
					if (event.type === "tool_end") {
						toolEnds.push({ toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
					}
				});
				faux.setResponses([fauxAssistantMessage([fauxText("after-crash")])]);
				const controller = createAgentController(runtimeB.lane, runtimeB.askUser, runtimeB.staleRunOperationId);
				const response = await controller.prompt({ message: "again", images: null }, BACKGROUND_CONTEXT);
				expect(response.accepted).toBe(true);
				await waitUntil(() =>
					toolEnds.some((end) => end.toolCallId === staleToolCallId && end.toolName === "ask_user_question"),
				);
				const settled = toolEnds.find((end) => end.toolCallId === staleToolCallId);
				expect(settled?.isError).toBe(true);
			} finally {
				await runtimeB.close();
				await runtimeA.close().catch(() => undefined);
			}
		},
	);
});

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitUntil timed out");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
