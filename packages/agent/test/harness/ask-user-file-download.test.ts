import { describe, expect, it } from "vitest";
import { type AskUserQuestionInput, validateFileDownloadPage } from "../../src/harness/tools/ask-user.ts";

type Page = AskUserQuestionInput["pages"][number];
type Field = NonNullable<Page["fields"]>[number];

const validField: Field = {
	id: "files",
	label: "候选文件",
	valueType: "enum",
	widget: "checkbox",
	options: [
		{ id: "reports/summary.pdf", label: "分析报告" },
		{ id: "drawings/p-001.dwg", label: "图纸 P-001" },
	],
};

function page(fields: Field[] | undefined | null, fieldOverrides?: Partial<Field>): Page {
	const resolved =
		fields === undefined || fields === null
			? fields
			: fields.map((field) => (fieldOverrides === undefined ? field : { ...field, ...fieldOverrides }));
	return {
		type: "file-download",
		id: "downloads",
		title: "选择要下载的文件",
		...(resolved === null ? { fields: null } : resolved === undefined ? {} : { fields: resolved }),
	} as Page;
}

/** 统一断言：每条错误文案都含「期望」与「实际」 */
function expectActionable(errors: string[]): void {
	for (const message of errors) {
		expect(message, `错误文案缺「期望 vs 实际」: ${message}`).toMatch(/期望/);
		expect(message, `错误文案缺「期望 vs 实际」: ${message}`).toMatch(/实际/);
	}
}

describe("validateFileDownloadPage", () => {
	it("accepts a preset-conformant page (enum + checkbox + relative option paths)", () => {
		expect(validateFileDownloadPage(page([validField]))).toEqual([]);
	});

	it("requires at least one field", () => {
		const errors = validateFileDownloadPage(page([]));
		expectActionable(errors);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("downloads");
		expect(errors[0]).toContain("至少 1 个字段");
		expect(errors[0]).toContain("实际 0 个");
	});

	it("treats missing fields as empty", () => {
		expect(validateFileDownloadPage(page(undefined))).toHaveLength(1);
		expect(validateFileDownloadPage(page(null))).toHaveLength(1);
	});

	it("rejects valueType file (upload-only) with the preset reason", () => {
		const errors = validateFileDownloadPage(page([validField], { valueType: "file" }));
		expectActionable(errors);
		expect(errors.some((message) => message.includes('valueType="enum"') && message.includes("上传专用"))).toBe(true);
	});

	it("rejects non-checkbox widgets", () => {
		const errors = validateFileDownloadPage(page([validField], { widget: "radio" }));
		expectActionable(errors);
		expect(errors.some((message) => message.includes('widget="checkbox"'))).toBe(true);
	});

	it("requires non-empty options", () => {
		const errors = validateFileDownloadPage(page([validField], { options: [] }));
		expectActionable(errors);
		expect(errors.some((message) => message.includes("options 非空") && message.includes("实际 0 个"))).toBe(true);
	});

	it("rejects option ids containing backslashes", () => {
		const errors = validateFileDownloadPage(
			page([{ ...validField, options: [{ id: "reports\\a.pdf", label: "报告" }] }]),
		);
		expectActionable(errors);
		expect(errors[0]).toContain("反斜杠");
		expect(errors[0]).toContain('"reports\\\\a.pdf"');
	});

	it("rejects absolute and drive-letter option ids", () => {
		for (const id of ["/etc/passwd", "C:\\x", "\\x"]) {
			const errors = validateFileDownloadPage(page([{ ...validField, options: [{ id, label: "x" }] }]));
			expectActionable(errors);
			expect(errors[0]).toContain("期望工作区相对路径");
			expect(errors[0]).toContain(JSON.stringify(id));
		}
		const drive = validateFileDownloadPage(page([{ ...validField, options: [{ id: "C:\\x", label: "x" }] }]));
		expect(drive[0]).toContain("盘符");
	});

	it("rejects option ids with .. path segments", () => {
		const errors = validateFileDownloadPage(
			page([{ ...validField, options: [{ id: "reports/../secrets", label: "x" }] }]),
		);
		expectActionable(errors);
		expect(errors[0]).toContain("..");
	});

	it("requires constraints.minCount >= 1 when provided", () => {
		const errors = validateFileDownloadPage(page([{ ...validField, constraints: { minCount: 0 } }]));
		expectActionable(errors);
		expect(
			errors.some((message) => message.includes("minCount") && message.includes("≥1") && message.includes("0")),
		).toBe(true);
	});

	it("ignores null minCount and null constraints", () => {
		expect(validateFileDownloadPage(page([{ ...validField, constraints: null }]))).toEqual([]);
		expect(validateFileDownloadPage(page([{ ...validField, constraints: { minCount: null } }]))).toEqual([]);
	});
});
