import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	type AskUserField,
	type AskUserQuestionInput,
	createAskUserQuestionTool,
} from "../../src/harness/tools/ask-user.ts";
import { validateQuestionStructure } from "../../src/harness/tools/ask-user-validation.ts";

type Page = AskUserQuestionInput["pages"][number];

function option(id: string, label = id): { id: string; label: string } {
	return { id, label };
}

function makeField(overrides: Partial<AskUserField> & Pick<AskUserField, "id">): AskUserField {
	return {
		label: overrides.id,
		valueType: "text",
		widget: "text",
		...overrides,
	} as AskUserField;
}

const enumOptions = [option("a"), option("b")];

/** 构造 question 输入并运行通用+预设校验 */
function issuesFor(pages: Page[]): ReturnType<typeof validateQuestionStructure> {
	return validateQuestionStructure({ title: "t", pages });
}

/** 统一断言：命中至少一条含指定关键字的 issue */
function expectIssue(pages: Page[], ...keywords: string[]): void {
	const issues = issuesFor(pages);
	const matched = issues.filter((issue) => keywords.every((keyword) => issue.message.includes(keyword)));
	expect(
		matched.length,
		`未命中含 ${JSON.stringify(keywords)} 的 issue；实际全部 issue：\n${issues.map((issue) => issue.message).join("\n")}`,
	).toBeGreaterThan(0);
}

describe("id 唯一性（§5.4）", () => {
	it("accepts unique page/field/column/option ids", () => {
		const pages: Page[] = [
			{
				type: "list-single",
				id: "p1",
				title: "t",
				fields: [makeField({ id: "f1", valueType: "enum", widget: "radio", options: enumOptions })],
			},
			{
				type: "table",
				id: "p2",
				title: "t",
				columns: [makeField({ id: "c1" })],
				rows: [{ c1: "v" }],
			},
		];
		expect(issuesFor(pages)).toEqual([]);
	});

	it("rejects duplicate page ids", () => {
		const pages: Page[] = [
			{ type: "list-single", id: "dup", title: "t", fields: [] },
			{
				type: "form",
				id: "dup",
				title: "t",
				fields: [makeField({ id: "count", valueType: "number", widget: "number" })],
			},
		];
		expectIssue(pages, "页 id", "dup", "唯一");
	});

	it("rejects duplicate field ids across pages (含 columns)", () => {
		const pages: Page[] = [
			{
				type: "form",
				id: "p1",
				title: "t",
				fields: [makeField({ id: "same", valueType: "number", widget: "number" })],
			},
			{
				type: "form",
				id: "p2",
				title: "t",
				fields: [makeField({ id: "same", valueType: "number", widget: "number" })],
			},
		];
		expectIssue(pages, "字段 id", "same", "唯一");
	});

	it("rejects duplicate option ids within one field", () => {
		const pages: Page[] = [
			{
				type: "list-single",
				id: "p1",
				title: "t",
				fields: [makeField({ id: "f1", valueType: "enum", widget: "radio", options: [option("a"), option("a")] })],
			},
		];
		expectIssue(pages, "选项 id", "唯一");
	});
});

describe("constraints 边界（§5.2）", () => {
	function fieldWithConstraints(constraints: Record<string, unknown>): Page {
		return {
			type: "file-collect",
			id: "p1",
			title: "t",
			fields: [makeField({ id: "f1", valueType: "file", widget: "file", constraints: constraints as never })],
		};
	}
	it("rejects min > max", () => {
		expectIssue([fieldWithConstraints({ min: 5, max: 1 })], "min ≤ max", "5", "1");
	});
	it("rejects minCount > maxCount", () => {
		expectIssue([fieldWithConstraints({ minCount: 3, maxCount: 2 })], "minCount ≤ maxCount");
	});
	it("rejects negative counts", () => {
		expectIssue([fieldWithConstraints({ minCount: -1 })], "minCount", "≥0");
		expectIssue([fieldWithConstraints({ maxCount: -2 })], "maxCount", "≥0");
	});
	it("rejects non-positive maxSizeMB", () => {
		expectIssue([fieldWithConstraints({ maxSizeMB: 0 })], "maxSizeMB", ">0");
	});
});

describe("defaultValue 自洽（§5.3）", () => {
	function fieldWithDefault(overrides: Partial<AskUserField>): Page {
		return { type: "form", id: "p1", title: "t", fields: [makeField({ id: "f1", ...overrides })] };
	}
	it("number default must be numeric and within min/max", () => {
		expectIssue(
			[fieldWithDefault({ valueType: "number", widget: "number", defaultValue: "x" as never })],
			"number",
			"数值",
		);
		expectIssue(
			[
				fieldWithDefault({
					valueType: "number",
					widget: "number",
					defaultValue: 5,
					constraints: { min: 10 } as never,
				}),
			],
			"min/max",
		);
	});
	it("enum default values must be in options", () => {
		expectIssue(
			[fieldWithDefault({ valueType: "enum", widget: "checkbox", options: enumOptions, defaultValue: "z" })],
			"options",
			"z",
		);
		expectIssue(
			[fieldWithDefault({ valueType: "enum", widget: "checkbox", options: enumOptions, defaultValue: ["a", "z"] })],
			"options",
			"z",
		);
	});
	it("single-select fields must not default to multiple values", () => {
		expectIssue(
			[fieldWithDefault({ valueType: "enum", widget: "radio", options: enumOptions, defaultValue: ["a", "b"] })],
			"单选",
		);
		expectIssue(
			[
				fieldWithDefault({
					valueType: "enum",
					widget: "checkbox",
					options: enumOptions,
					defaultValue: ["a", "b"],
					constraints: { maxCount: 1 } as never,
				}),
			],
			"单选",
		);
	});
	it("enum default count must satisfy minCount/maxCount", () => {
		expectIssue(
			[
				fieldWithDefault({
					valueType: "enum",
					widget: "checkbox",
					options: enumOptions,
					defaultValue: ["a"],
					constraints: { minCount: 2 } as never,
				}),
			],
			"minCount",
		);
	});
	it("text default must be a string", () => {
		expectIssue(
			[fieldWithDefault({ valueType: "text", widget: "text", defaultValue: 42 as never })],
			"text",
			"字符串",
		);
	});
	it("file fields must not carry defaultValue", () => {
		expectIssue(
			[fieldWithDefault({ valueType: "file", widget: "file", defaultValue: "x.pdf" as never })],
			"file",
			"defaultValue",
		);
	});
});

describe("rowOps 默认与边界（§4.4）", () => {
	function tablePage(rowOps: Record<string, unknown> | undefined, rows: Array<Record<string, unknown>>): Page {
		return {
			type: "table",
			id: "p1",
			title: "t",
			columns: [makeField({ id: "item" })],
			...(rowOps === undefined ? {} : { rowOps: rowOps as never }),
			rows,
		};
	}
	it("applies defaults (allowAdd=true, minRows=1): empty preset rows stay valid", () => {
		expect(issuesFor([tablePage(undefined, [])])).toEqual([]);
	});
	it("requires minRows >= 1 and maxRows >= minRows >= 1", () => {
		expectIssue([tablePage({ minRows: 0 }, [])], "minRows", "≥1");
		expectIssue([tablePage({ maxRows: 0 }, [])], "maxRows", "≥1");
		expectIssue([tablePage({ minRows: 3, maxRows: 2 }, [])], "maxRows ≥ minRows");
	});
	it("with allowAdd=false preset rows must already reach minRows", () => {
		expectIssue([tablePage({ allowAdd: false, minRows: 2 }, [{ item: "a" }])], "allowAdd=false", "minRows");
		expect(issuesFor([tablePage({ allowAdd: false, minRows: 1 }, [{ item: "a" }])])).toEqual([]);
	});
	it("preset rows must not exceed maxRows", () => {
		expectIssue([tablePage({ maxRows: 1 }, [{ item: "a" }, { item: "b" }])], "maxRows");
	});
});

describe("table 预设行单元格类型（§4.4）", () => {
	function tableWithColumns(columns: AskUserField[], rows: Array<Record<string, unknown>>): Page {
		return { type: "table", id: "p1", title: "t", columns, rows };
	}
	it("number columns only accept numeric cells", () => {
		expectIssue(
			[tableWithColumns([makeField({ id: "n", valueType: "number", widget: "number" })], [{ n: "x" }])],
			"数值",
		);
	});
	it("text columns only accept string cells", () => {
		expectIssue([tableWithColumns([makeField({ id: "s" })], [{ s: 42 }])], "字符串");
	});
	it("enum columns only accept option values", () => {
		expectIssue(
			[
				tableWithColumns(
					[makeField({ id: "e", valueType: "enum", widget: "checkbox", options: enumOptions })],
					[{ e: "zz" }],
				),
			],
			"options",
			"zz",
		);
	});
	it("file columns must not carry preset file objects", () => {
		expectIssue(
			[
				tableWithColumns(
					[makeField({ id: "f", valueType: "file", widget: "file" })],
					[{ f: { filename: "x.pdf" } }],
				),
			],
			"file 列",
		);
	});
});

describe("未知字段拒绝（additionalProperties: false 各层）", () => {
	const tool = createAskUserQuestionTool();

	function expectSchemaReject(input: unknown, path: string): void {
		let thrown: unknown;
		try {
			validateToolArguments(
				{ name: tool.name, parameters: tool.parameters } as never,
				{ name: tool.name, arguments: input } as never,
			);
		} catch (error) {
			thrown = error;
		}
		expect(thrown, `未知字段未被拒绝: ${path}`).toBeInstanceOf(Error);
		expect((thrown as Error).message).toContain(path);
	}

	it("rejects unknown keys at every contract level", () => {
		const baseField = makeField({ id: "f1", valueType: "enum", widget: "radio", options: enumOptions });
		expectSchemaReject({ title: "t", bogus: 1, pages: [{ type: "list-single", id: "p", title: "t" }] }, "bogus");
		expectSchemaReject(
			{ title: "t", pages: [{ type: "list-single", id: "p", title: "t", bogus: 1, fields: [] }] },
			"bogus",
		);
		expectSchemaReject(
			{
				title: "t",
				pages: [{ type: "list-single", id: "p", title: "t", fields: [{ ...baseField, bogus: 1 }] }],
			},
			"bogus",
		);
		expectSchemaReject(
			{
				title: "t",
				pages: [
					{
						type: "list-single",
						id: "p",
						title: "t",
						fields: [{ ...baseField, options: [{ id: "a", label: "a", bogus: 1 }] }],
					},
				],
			},
			"bogus",
		);
		expectSchemaReject(
			{
				title: "t",
				pages: [
					{
						type: "list-single",
						id: "p",
						title: "t",
						fields: [{ ...baseField, constraints: { minCount: 1, bogus: 1 } }],
					},
				],
			},
			"bogus",
		);
		expectSchemaReject(
			{
				title: "t",
				pages: [
					{
						type: "table",
						id: "p",
						title: "t",
						columns: [makeField({ id: "c" })],
						rowOps: { minRows: 1, bogus: 1 },
					},
				],
			},
			"bogus",
		);
	});

	it("accepts the contract-shaped input", () => {
		expect(() =>
			validateToolArguments(
				{ name: tool.name, parameters: tool.parameters } as never,
				{
					name: tool.name,
					arguments: {
						title: "t",
						pages: [
							{
								type: "list-single",
								id: "p",
								title: "t",
								question: null,
								fields: [
									{
										...makeField({ id: "f1", valueType: "enum", widget: "radio", options: enumOptions }),
										required: false,
										description: null,
										hint: null,
										unit: null,
										defaultValue: null,
									},
								],
							},
						],
					},
				} as never,
			),
		).not.toThrow();
	});
});
