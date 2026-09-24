import { describe, expect, it } from "vitest";
import {
	type AskUserQuestionInput,
	createAskUserQuestionTool,
	createAskUserRegistry,
} from "../../src/harness/tools/ask-user.ts";
import { validateQuestionStructure } from "../../src/harness/tools/ask-user-validation.ts";
import type { ExecutionToolContext } from "../../src/harness/tools/tool-context.ts";

type Page = AskUserQuestionInput["pages"][number];

function option(id: string, label = id): { id: string; label: string } {
	return { id, label };
}

/** 各类型合法页面（文档 §6 规则表） */
function validPage(type: Page["type"]): Page {
	switch (type) {
		case "list-single":
		case "list-multi":
		case "dropdown": {
			const widget = type === "list-single" ? "radio" : type === "list-multi" ? "checkbox" : "select";
			return {
				type,
				id: "p1",
				title: "t",
				fields: [{ id: "choice", label: "选择", valueType: "enum", widget, options: [option("a"), option("b")] }],
			} as Page;
		}
		case "form":
			return {
				type: "form",
				id: "p1",
				title: "t",
				fields: [
					{ id: "count", label: "数量", valueType: "number", widget: "number" },
					{ id: "name", label: "名称", valueType: "text", widget: "text" },
				],
			} as Page;
		case "table":
			return {
				type: "table",
				id: "p1",
				title: "t",
				columns: [{ id: "item", label: "条目", valueType: "text", widget: "text" }],
				rows: [{ item: "外设" }],
			} as Page;
		case "file-collect":
			return {
				type: "file-collect",
				id: "p1",
				title: "t",
				fields: [{ id: "photos", label: "现场照片", valueType: "file", widget: "file" }],
			} as Page;
		case "file-download":
			return {
				type: "file-download",
				id: "p1",
				title: "t",
				fields: [
					{
						id: "files",
						label: "候选文件",
						valueType: "enum",
						widget: "checkbox",
						options: [option("reports/summary.pdf"), option("drawings/p-001.dwg")],
					},
				],
			} as Page;
	}
}

function pageWith(type: Page["type"], patch: Partial<Page>): Page {
	return { ...validPage(type), ...patch } as Page;
}

function fieldPatch(type: Page["type"], index: number, patch: Record<string, unknown>): Page {
	const fields = validPage(type).fields ?? [];
	const patched = fields.map((field, position) => (position === index ? { ...field, ...patch } : field));
	return pageWith(type, { fields: patched }) as Page;
}

/** 统一断言：每条 issue 的文案含页 id 与「期望 vs 实际」 */
function expectActionable(pages: Page[]): void {
	const issues = validateQuestionStructure({ title: "t", pages });
	expect(issues.length).toBeGreaterThan(0);
	for (const issue of issues) {
		expect(issue.pageId).toBe("p1");
		expect(issue.message, `文案缺「期望 vs 实际」: ${issue.message}`).toMatch(/期望/);
		expect(issue.message, `文案缺「期望 vs 实际」: ${issue.message}`).toMatch(/实际/);
	}
}

describe("validateQuestionStructure", () => {
	it("accepts a preset-conformant question for all 7 types", () => {
		for (const type of [
			"list-single",
			"list-multi",
			"form",
			"table",
			"dropdown",
			"file-collect",
			"file-download",
		] as const) {
			expect(validateQuestionStructure({ title: "t", pages: [validPage(type)] })).toEqual([]);
		}
	});

	it("list-single: exactly 1 field with enum+radio+non-empty options", () => {
		expectActionable([
			pageWith("list-single", {
				fields: [
					...(validPage("list-single").fields ?? []),
					{ id: "extra", label: "x", valueType: "enum", widget: "radio", options: [option("a")] },
				],
			}),
		]);
		expectActionable([fieldPatch("list-single", 0, { widget: "select" })]);
		expectActionable([fieldPatch("list-single", 0, { options: [] })]);
	});

	it("list-multi: at least 1 field with enum+checkbox+non-empty options", () => {
		expectActionable([pageWith("list-multi", { fields: [] })]);
		expectActionable([pageWith("list-multi", { fields: null })]);
		expectActionable([fieldPatch("list-multi", 0, { valueType: "text" })]);
		expectActionable([fieldPatch("list-multi", 0, { options: null })]);
	});

	it("form: number→number and text→text|textarea only", () => {
		expectActionable([pageWith("form", { fields: [] })]);
		expectActionable([fieldPatch("form", 0, { widget: "text" })]);
		expectActionable([fieldPatch("form", 1, { widget: "radio" })]);
		expectActionable([fieldPatch("form", 0, { valueType: "enum" })]);
	});

	it("table: non-empty columns, no fields, rows keyed by column ids", () => {
		expectActionable([pageWith("table", { columns: [] })]);
		expectActionable([pageWith("table", { columns: null })]);
		expectActionable([
			pageWith("table", { fields: [{ id: "stray", label: "x", valueType: "text", widget: "text" }] }),
		]);
		expectActionable([pageWith("table", { rows: [{ unknown_key: "v" }] })]);
	});

	it("dropdown: enum+select fields", () => {
		expectActionable([pageWith("dropdown", { fields: [] })]);
		expectActionable([fieldPatch("dropdown", 0, { widget: "radio" })]);
		expectActionable([fieldPatch("dropdown", 0, { valueType: "file" })]);
	});

	it("file-collect: file+file fields", () => {
		expectActionable([pageWith("file-collect", { fields: [] })]);
		expectActionable([fieldPatch("file-collect", 0, { widget: "text" })]);
		expectActionable([fieldPatch("file-collect", 0, { valueType: "enum" })]);
	});

	it("file-download: enum+checkbox with workspace-relative option paths", () => {
		expectActionable([fieldPatch("file-download", 0, { valueType: "file" })]);
		expectActionable([fieldPatch("file-download", 0, { options: [{ id: "reports\\a.pdf", label: "x" }] })]);
	});

	it("reports one issue per violating page with its own pageId", () => {
		const issues = validateQuestionStructure({
			title: "t",
			pages: [validPage("list-single"), pageWith("form", { fields: [] })],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.pageId).toBe("p1");
	});
});

describe("ask_user_question execute preset gate", () => {
	it("returns an actionable error without suspending when structure is invalid", async () => {
		const registry = createAskUserRegistry();
		const tool = createAskUserQuestionTool();
		const toolContext = { env: {} as never, askUser: registry } as ExecutionToolContext;
		let thrown: unknown;
		try {
			await tool.execute(
				"call-1",
				{ title: "t", pages: [pageWith("list-multi", { fields: [] })] } as AskUserQuestionInput,
				() => {},
				toolContext,
				{} as never,
				{} as never,
			);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toContain("结构校验失败");
		expect((thrown as Error).message).toMatch(/期望/);
		expect(registry.pending()).toHaveLength(0);
	});

	it("suspends via the registry when structure is valid", async () => {
		const registry = createAskUserRegistry();
		const tool = createAskUserQuestionTool();
		const toolContext = { env: {} as never, askUser: registry } as ExecutionToolContext;
		const pendingPromise = tool.execute(
			"call-2",
			{ title: "t", pages: [validPage("list-single")] } as AskUserQuestionInput,
			() => {},
			toolContext,
			{} as never,
			{} as never,
		);
		await Promise.resolve();
		expect(registry.pending()).toHaveLength(1);
		registry.answer("call-2", { p1: { choice: "a" } });
		const result = await pendingPromise;
		expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify({ p1: { choice: "a" } }) });
	});
});
