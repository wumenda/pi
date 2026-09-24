import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionRuntime } from "../src/runtime.ts";
import { createSessionStore } from "../src/sessions.ts";
import { createFauxLlm } from "./faux-llm.ts";

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "app-server-"));
	dirs.push(dir);
	return dir;
};
afterEach(async () => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
	const root = tempDir();
	const store = createSessionStore({ dataDir: join(root, "data"), workspaceDir: join(root, "ws") });
	const metadata = await store.create();
	const session = await store.open(metadata);
	const llm = createFauxLlm();
	const runtime = await createSessionRuntime({
		session,
		models: llm.models,
		model: llm.model,
		workspaceDir: join(root, "ws"),
	});
	return { runtime, llm };
}

describe("SessionRuntime", () => {
	it("runs a prompt and persists the assistant reply", async () => {
		const { runtime, llm } = await setup();
		llm.faux.setResponses([fauxAssistantMessage([fauxText("hello from faux")])]);
		await runtime.lane.prompt("hi", undefined, BACKGROUND_CONTEXT);
		const watch = await runtime.lane.watch(BACKGROUND_CONTEXT);
		const text = JSON.stringify(watch.snapshot);
		expect(text).toContain("hello from faux");
		await runtime.close();
	});
	it("suspends ask_user_question until answered", async () => {
		const { runtime, llm } = await setup();
		llm.faux.setResponses([
			fauxAssistantMessage([
				fauxToolCall("ask_user_question", {
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
				}),
			]),
			fauxAssistantMessage([fauxText("answered")]),
		]);
		const pending = runtime.lane.prompt("ask me", undefined, BACKGROUND_CONTEXT);
		// registry 出现挂起项后作答
		await waitUntil(() => runtime.askUser.pending().length > 0);
		const pendingAsk = runtime.askUser.pending()[0];
		expect(pendingAsk.toolCallId).toBeTruthy();
		const answered = runtime.askUser.answer(pendingAsk.toolCallId, { p1: { f1: "a" } });
		expect(answered).toBe(true);
		await pending;
		await runtime.close();
	});
});

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitUntil timed out");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
