import { describe, expect, it } from "vitest";
import {
	collectDefaultValues,
	diagnoseAskUserInput,
	isRelativeWorkspacePath,
	normalizeAnswers,
	validateAnswersDetailed,
} from "../src/features/chat/cards/answers.ts";
import type { AskUserInput, CardAnswers } from "../src/features/chat/cards/types.ts";

const downloadInput: AskUserInput = {
	title: "选择要下载的文件",
	question: null,
	allowCustom: false,
	pages: [
		{
			type: "file-download",
			id: "p1",
			title: "候选文件",
			fields: [
				{
					id: "files",
					label: "文件清单",
					valueType: "enum",
					widget: "checkbox",
					options: [
						{ id: "reports/summary.pdf", label: "分析报告" },
						{ id: "drawings/p-001.dwg", label: "图纸 P-001" },
					],
				},
			],
		},
	],
};

function valuesWith(paths: unknown[]): CardAnswers {
	return { p1: { files: paths } };
}

describe("diagnoseAskUserInput file-download", () => {
	it("accepts the file-download page type", () => {
		const diagnosed = diagnoseAskUserInput(downloadInput);
		expect(diagnosed.ok).toBe(true);
		if (diagnosed.ok) expect(diagnosed.input.pages[0]?.type).toBe("file-download");
	});
	it("still rejects unknown page types", () => {
		const bad = {
			...downloadInput,
			pages: [{ type: "file-magic", id: "p1", title: "t", fields: [] }],
		};
		const diagnosed = diagnoseAskUserInput(bad);
		expect(diagnosed.ok).toBe(false);
		if (!diagnosed.ok) expect(diagnosed.reason).toBe("page-bad-type");
	});
});

describe("isRelativeWorkspacePath", () => {
	it("accepts workspace-relative /-separated paths", () => {
		expect(isRelativeWorkspacePath("reports/summary.pdf")).toBe(true);
		expect(isRelativeWorkspacePath("a.pdf")).toBe(true);
	});
	it("rejects absolute paths, drive letters, backslashes and .. segments", () => {
		expect(isRelativeWorkspacePath("/etc/passwd")).toBe(false);
		expect(isRelativeWorkspacePath("C:\\x")).toBe(false);
		expect(isRelativeWorkspacePath("\\x")).toBe(false);
		expect(isRelativeWorkspacePath("reports\\a.pdf")).toBe(false);
		expect(isRelativeWorkspacePath("reports/../secrets")).toBe(false);
		expect(isRelativeWorkspacePath("")).toBe(false);
	});
});

describe("validateAnswersDetailed file-download", () => {
	it("requires at least minCount (default 1) selections", () => {
		const errors = validateAnswersDetailed(downloadInput, valuesWith([]));
		expect(errors).toHaveLength(1);
		expect(errors[0]?.kind).toBe("minCount");
		expect(errors[0]?.message).toContain("至少选择 1 个");
	});
	it("passes when selections meet the default minCount", () => {
		expect(validateAnswersDetailed(downloadInput, valuesWith(["reports/summary.pdf"]))).toEqual([]);
	});
	it("honors explicit minCount", () => {
		const input: AskUserInput = {
			...downloadInput,
			pages: [
				{
					...downloadInput.pages[0],
					fields: [{ ...downloadInput.pages[0].fields[0], constraints: { minCount: 2 } }],
				},
			],
		} as AskUserInput;
		const errors = validateAnswersDetailed(input, valuesWith(["reports/summary.pdf"]));
		expect(errors[0]?.kind).toBe("minCount");
		expect(errors[0]?.message).toContain("至少选择 2 个");
	});
	it("honors maxCount", () => {
		const input: AskUserInput = {
			...downloadInput,
			pages: [
				{
					...downloadInput.pages[0],
					fields: [{ ...downloadInput.pages[0].fields[0], constraints: { maxCount: 1 } }],
				},
			],
		} as AskUserInput;
		const errors = validateAnswersDetailed(input, valuesWith(["reports/summary.pdf", "drawings/p-001.dwg"]));
		expect(errors).toHaveLength(1);
		expect(errors[0]?.kind).toBe("maxCount");
	});
	it("rejects answer values that are not workspace-relative paths", () => {
		const errors = validateAnswersDetailed(downloadInput, valuesWith(["reports/../../etc/passwd"]));
		expect(errors.some((error) => error.kind === "path-form")).toBe(true);
	});
});

describe("collectDefaultValues / normalizeAnswers file-download", () => {
	it("initializes file-download fields to an empty path array", () => {
		const values = collectDefaultValues(downloadInput);
		expect(values.p1?.files).toEqual([]);
	});
	it("normalizeAnswers keeps the {pageId:{fieldId:[相对路径...]}} shape", () => {
		const normalized = normalizeAnswers(valuesWith(["reports/summary.pdf", "drawings/p-001.dwg"]));
		expect(normalized).toEqual({ p1: { files: ["reports/summary.pdf", "drawings/p-001.dwg"] } });
	});
});
