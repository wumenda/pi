/**
 * ask_user_question 结构预设校验（文档 §6 规则表，工具层第一道防线）：
 * 按页类型校验字段数 / valueType+widget 组合 / columns 与 rows 归属。
 * 校验失败返回可行动 issue（页 id + 期望规则 + 实际值），模型可据此自纠重试；
 * 通用校验（id 唯一 / defaultValue / constraints 边界 / 未知字段）由后续任务接入。
 */

import { type AskUserPage, type AskUserQuestionInput, validateFileDownloadPage } from "./ask-user.ts";

/** 单条结构校验问题（message 自含页 id 与「期望 vs 实际」） */
export interface ValidationIssue {
	pageId: string;
	message: string;
}

/** 枚举选择族（list-single/list-multi/dropdown）：字段数 + enum + 指定 widget + options 非空 */
function validateChoicePage(
	page: AskUserPage,
	expectedWidget: "radio" | "checkbox" | "select",
	exactOne: boolean,
): string[] {
	const messages: string[] = [];
	const fields = page.fields ?? [];
	const countRule = exactOne ? "恰好 1 个字段" : "至少 1 个字段";
	const countBad = exactOne ? fields.length !== 1 : fields.length === 0;
	if (countBad) {
		messages.push(
			`页 ${page.id}：${page.type} 期望${countRule}（valueType="enum" + widget="${expectedWidget}" + options 非空），实际 ${fields.length} 个字段`,
		);
	}
	for (const field of fields) {
		if (field.valueType !== "enum") {
			messages.push(`页 ${page.id} 字段 ${field.id}：${page.type} 期望 valueType="enum"，实际 "${field.valueType}"`);
		}
		if (field.widget !== expectedWidget) {
			messages.push(
				`页 ${page.id} 字段 ${field.id}：${page.type} 期望 widget="${expectedWidget}"，实际 "${field.widget}"`,
			);
		}
		if ((field.options ?? []).length === 0) {
			messages.push(`页 ${page.id} 字段 ${field.id}：${page.type} 期望 options 非空，实际 0 个选项`);
		}
	}
	return messages;
}

/** file-collect：至少 1 个字段（valueType=file + widget=file） */
function validateFileCollectPage(page: AskUserPage): string[] {
	const messages: string[] = [];
	const fields = page.fields ?? [];
	if (fields.length === 0) {
		messages.push(
			`页 ${page.id}：file-collect 期望至少 1 个字段（valueType="file" + widget="file"），实际 ${fields.length} 个字段`,
		);
	}
	for (const field of fields) {
		if (field.valueType !== "file") {
			messages.push(`页 ${page.id} 字段 ${field.id}：file-collect 期望 valueType="file"，实际 "${field.valueType}"`);
		}
		if (field.widget !== "file") {
			messages.push(`页 ${page.id} 字段 ${field.id}：file-collect 期望 widget="file"，实际 "${field.widget}"`);
		}
	}
	return messages;
}

/** form：至少 1 个字段；number→widget="number"；text→widget="text"/"textarea" */
function validateFormPage(page: AskUserPage): string[] {
	const messages: string[] = [];
	const fields = page.fields ?? [];
	if (fields.length === 0) {
		messages.push(
			`页 ${page.id}：form 期望至少 1 个字段（number→widget="number"；text→widget="text"/"textarea"），实际 ${fields.length} 个字段`,
		);
	}
	for (const field of fields) {
		const actual = `valueType="${field.valueType}" + widget="${field.widget}"`;
		if (field.valueType === "number" && field.widget !== "number") {
			messages.push(`页 ${page.id} 字段 ${field.id}：form 期望 number 字段用 widget="number"，实际 ${actual}`);
		} else if (field.valueType === "text" && field.widget !== "text" && field.widget !== "textarea") {
			messages.push(
				`页 ${page.id} 字段 ${field.id}：form 期望 text 字段用 widget="text" 或 "textarea"，实际 ${actual}`,
			);
		} else if (field.valueType !== "number" && field.valueType !== "text") {
			messages.push(`页 ${page.id} 字段 ${field.id}：form 期望 valueType="number" 或 "text"，实际 ${actual}`);
		}
	}
	return messages;
}

/** table：非空 columns 且不提供 fields；rows 键必须是列 id */
function validateTablePage(page: AskUserPage): string[] {
	const messages: string[] = [];
	const columns = page.columns ?? [];
	if (columns.length === 0) {
		messages.push(`页 ${page.id}：table 期望非空 columns（列定义在 columns），实际 ${columns.length} 列`);
	}
	const fields = page.fields ?? [];
	if (fields.length > 0) {
		messages.push(`页 ${page.id}：table 期望不提供 fields（列定义在 columns），实际 ${fields.length} 个字段`);
	}
	const columnIds = new Set(columns.map((column) => column.id));
	const rows = page.rows ?? [];
	for (const [index, row] of rows.entries()) {
		for (const key of Object.keys(row)) {
			if (!columnIds.has(key)) {
				messages.push(
					`页 ${page.id}：table rows 键期望为列 id（${[...columnIds].join("、") || "无可用列"}），实际行 ${index} 含未知键 "${key}"`,
				);
			}
		}
	}
	return messages;
}

/** 七类型结构预设校验入口；返回空数组表示合法。 */
export function validateQuestionStructure(input: AskUserQuestionInput): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const page of input.pages) {
		let messages: string[];
		switch (page.type) {
			case "list-single":
				messages = validateChoicePage(page, "radio", true);
				break;
			case "list-multi":
				messages = validateChoicePage(page, "checkbox", false);
				break;
			case "dropdown":
				messages = validateChoicePage(page, "select", false);
				break;
			case "file-collect":
				messages = validateFileCollectPage(page);
				break;
			case "form":
				messages = validateFormPage(page);
				break;
			case "table":
				messages = validateTablePage(page);
				break;
			case "file-download":
				messages = validateFileDownloadPage(page);
				break;
		}
		for (const message of messages) issues.push({ pageId: page.id, message });
	}
	return issues;
}
