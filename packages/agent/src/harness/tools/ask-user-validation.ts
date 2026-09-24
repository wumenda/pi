/**
 * ask_user_question 结构预设 + 通用契约校验（文档 §4/§5/§6，工具层第一道防线）：
 * - 类型预设（§6 规则表）：字段数 / valueType+widget 组合 / columns 与 rows 归属；
 * - 通用契约（§5）：id 全局唯一、constraints 边界、defaultValue 自洽；
 * - 未知字段拒绝由 typebox schema additionalProperties:false 在参数校验层完成。
 * 校验失败返回可行动 issue（页 id + 期望规则 + 实际值），模型可据此自纠重试。
 */

import { type AskUserPage, type AskUserQuestionInput, validateFileDownloadPage } from "./ask-user.ts";

/** 单条结构校验问题（message 自含页 id 与「期望 vs 实际」） */
export interface ValidationIssue {
	pageId: string;
	message: string;
}

type AskUserField = NonNullable<AskUserPage["fields"]>[number];

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

/** table：非空 columns 且不提供 fields；rows 键必须是列 id；rowOps 边界与预设行单元格类型（§4.4） */
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
	// rowOps 边界（缺省 allowAdd/allowDelete=true、minRows=1、maxRows 无上限）
	const rowOps = page.rowOps;
	const minRows = typeof rowOps?.minRows === "number" ? rowOps.minRows : 1;
	const allowAdd = rowOps?.allowAdd ?? true;
	if (typeof rowOps?.minRows === "number" && rowOps.minRows < 1) {
		messages.push(`页 ${page.id}：table rowOps 期望 minRows ≥1，实际 ${rowOps.minRows}`);
	}
	if (typeof rowOps?.maxRows === "number") {
		if (rowOps.maxRows < 1) {
			messages.push(`页 ${page.id}：table rowOps 期望 maxRows ≥1，实际 ${rowOps.maxRows}`);
		} else if (minRows > rowOps.maxRows) {
			messages.push(
				`页 ${page.id}：table rowOps 期望 maxRows ≥ minRows，实际 maxRows=${rowOps.maxRows}, minRows=${minRows}`,
			);
		}
	}
	const maxRows = typeof rowOps?.maxRows === "number" ? rowOps.maxRows : undefined;
	const rowCount = rows.length;
	if (maxRows !== undefined && rowCount > maxRows) {
		messages.push(`页 ${page.id}：table 期望预设行数 ≤ maxRows=${maxRows}，实际 ${rowCount} 行`);
	}
	if (allowAdd === false && rowCount < minRows) {
		messages.push(`页 ${page.id}：table allowAdd=false 时期望预设行数 ≥ minRows=${minRows}，实际 ${rowCount} 行`);
	}
	// 预设行单元格类型按列 valueType 校验
	const columnById = new Map(columns.map((column) => [column.id, column]));
	for (const [index, row] of rows.entries()) {
		for (const [key, cell] of Object.entries(row)) {
			const column = columnById.get(key);
			if (column === undefined) continue; // 未知键已另行报告
			const problem = presetCellProblem(column, cell);
			if (problem !== null) {
				messages.push(`页 ${page.id}：table 行 ${index} 列 "${key}" ${problem}，实际 ${JSON.stringify(cell)}`);
			}
		}
	}
	return messages;
}

/** table 预设行单元格按列 valueType 的类型检查（空单元格允许；required 校验后续接入） */
function presetCellProblem(column: AskUserField, cell: unknown): string | null {
	if (cell === undefined || cell === null) return null;
	if (column.valueType === "number") {
		return typeof cell === "number" ? null : "期望数值";
	}
	if (column.valueType === "text") {
		return typeof cell === "string" ? null : "期望字符串";
	}
	if (column.valueType === "file") {
		return "file 列禁止在预设行提供文件对象（文件仅交互时上传）";
	}
	// enum：字符串或字符串数组，取值都在列 options 内
	const optionIds = new Set((column.options ?? []).map((option) => option.id));
	const values = Array.isArray(cell) ? cell : [cell];
	for (const value of values) {
		if (typeof value !== "string" || !optionIds.has(value)) return "期望取值在列 options 内";
	}
	return null;
}

/** constraints 边界（§5.2）：min≤max、minCount≤maxCount、计数≥0、maxSizeMB>0 */
function validateFieldConstraints(pageId: string, field: AskUserField): string[] {
	const messages: string[] = [];
	const constraints = field.constraints;
	if (constraints === undefined || constraints === null) return messages;
	if (
		typeof constraints.min === "number" &&
		typeof constraints.max === "number" &&
		constraints.min > constraints.max
	) {
		messages.push(
			`页 ${pageId} 字段 ${field.id}：constraints 期望 min ≤ max，实际 min=${constraints.min}, max=${constraints.max}`,
		);
	}
	if (
		typeof constraints.minCount === "number" &&
		typeof constraints.maxCount === "number" &&
		constraints.minCount > constraints.maxCount
	) {
		messages.push(
			`页 ${pageId} 字段 ${field.id}：constraints 期望 minCount ≤ maxCount，实际 minCount=${constraints.minCount}, maxCount=${constraints.maxCount}`,
		);
	}
	if (typeof constraints.minCount === "number" && constraints.minCount < 0) {
		messages.push(`页 ${pageId} 字段 ${field.id}：constraints 期望 minCount ≥0，实际 ${constraints.minCount}`);
	}
	if (typeof constraints.maxCount === "number" && constraints.maxCount < 0) {
		messages.push(`页 ${pageId} 字段 ${field.id}：constraints 期望 maxCount ≥0，实际 ${constraints.maxCount}`);
	}
	if (typeof constraints.maxSizeMB === "number" && constraints.maxSizeMB <= 0) {
		messages.push(`页 ${pageId} 字段 ${field.id}：constraints 期望 maxSizeMB >0，实际 ${constraints.maxSizeMB}`);
	}
	return messages;
}

/** defaultValue 自洽（§5.3）：按 valueType 匹配域与约束 */
function validateFieldDefault(pageId: string, field: AskUserField): string[] {
	const messages: string[] = [];
	const value = field.defaultValue;
	if (value === undefined || value === null) return messages;
	if (field.valueType === "file") {
		messages.push(
			`页 ${pageId} 字段 ${field.id}：file 字段期望不提供 defaultValue（文件仅交互时上传），实际 ${JSON.stringify(value)}`,
		);
		return messages;
	}
	if (field.valueType === "number") {
		if (typeof value !== "number") {
			messages.push(
				`页 ${pageId} 字段 ${field.id}：number 字段期望 defaultValue 为数值，实际 ${JSON.stringify(value)}`,
			);
			return messages;
		}
		const min = field.constraints?.min;
		const max = field.constraints?.max;
		if ((typeof min === "number" && value < min) || (typeof max === "number" && value > max)) {
			messages.push(
				`页 ${pageId} 字段 ${field.id}：number 字段期望 defaultValue 落在 min/max 内，实际 ${value}（min=${min ?? "无"}, max=${max ?? "无"}）`,
			);
		}
		return messages;
	}
	if (field.valueType === "text") {
		if (typeof value !== "string") {
			messages.push(
				`页 ${pageId} 字段 ${field.id}：text 字段期望 defaultValue 为字符串，实际 ${JSON.stringify(value)}`,
			);
		}
		return messages;
	}
	// enum：字符串或字符串数组；取值在 options 内；单选至多 1 个；数量满足 minCount/maxCount
	const optionIds = new Set((field.options ?? []).map((option) => option.id));
	const defaults = Array.isArray(value) ? value : [value];
	for (const item of defaults) {
		if (typeof item !== "string" || !optionIds.has(item)) {
			messages.push(
				`页 ${pageId} 字段 ${field.id}：enum 字段期望 defaultValue 取值都在 options 内，实际 ${JSON.stringify(item)}`,
			);
		}
	}
	const minCount = field.constraints?.minCount;
	const maxCount = field.constraints?.maxCount;
	const singleSelect = field.widget === "radio" || field.widget === "select" || maxCount === 1;
	if (singleSelect && Array.isArray(value) && value.length > 1) {
		messages.push(`页 ${pageId} 字段 ${field.id}：单选字段期望 defaultValue 至多 1 个值，实际 ${value.length} 个`);
	}
	const count = defaults.length;
	if (typeof minCount === "number" && count < minCount) {
		messages.push(
			`页 ${pageId} 字段 ${field.id}：enum 字段期望 defaultValue 数量满足 minCount=${minCount}，实际 ${count} 个`,
		);
	}
	if (typeof maxCount === "number" && count > maxCount) {
		messages.push(
			`页 ${pageId} 字段 ${field.id}：enum 字段期望 defaultValue 数量不超过 maxCount=${maxCount}，实际 ${count} 个`,
		);
	}
	return messages;
}

/** id 唯一性（§5.4）：页 id 全局唯一；字段 id（含 columns）跨页全局唯一；选项 id 字段内唯一 */
function validateIdUniqueness(input: AskUserQuestionInput): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const pageCount = new Map<string, number>();
	for (const page of input.pages) pageCount.set(page.id, (pageCount.get(page.id) ?? 0) + 1);
	for (const [pageId, count] of pageCount) {
		if (count > 1) {
			issues.push({ pageId, message: `Question 期望页 id 全局唯一，实际页 id "${pageId}" 出现 ${count} 次` });
		}
	}
	const fieldSeen = new Map<string, { count: number; ownerPageId: string }>();
	for (const page of input.pages) {
		for (const field of [...(page.fields ?? []), ...(page.columns ?? [])]) {
			const seen = fieldSeen.get(field.id);
			if (seen === undefined) {
				fieldSeen.set(field.id, { count: 1, ownerPageId: page.id });
			} else {
				seen.count += 1;
				seen.ownerPageId = page.id; // 重复归属后见页
			}
		}
	}
	for (const [fieldId, seen] of fieldSeen) {
		if (seen.count > 1) {
			issues.push({
				pageId: seen.ownerPageId,
				message: `Question 期望字段 id 全局唯一（含跨页与 columns），实际字段 id "${fieldId}" 出现 ${seen.count} 次`,
			});
		}
	}
	for (const page of input.pages) {
		for (const field of [...(page.fields ?? []), ...(page.columns ?? [])]) {
			const optionCount = new Map<string, number>();
			for (const option of field.options ?? []) {
				optionCount.set(option.id, (optionCount.get(option.id) ?? 0) + 1);
			}
			for (const [optionId, count] of optionCount) {
				if (count > 1) {
					issues.push({
						pageId: page.id,
						message: `页 ${page.id} 字段 ${field.id}：期望选项 id 在字段内唯一，实际选项 id "${optionId}" 出现 ${count} 次`,
					});
				}
			}
		}
	}
	return issues;
}

/** 七类型结构预设 + 通用契约校验入口；返回空数组表示合法。 */
export function validateQuestionStructure(input: AskUserQuestionInput): ValidationIssue[] {
	const issues: ValidationIssue[] = validateIdUniqueness(input);
	for (const page of input.pages) {
		// 通用字段契约（constraints 边界 + defaultValue 自洽）覆盖 fields 与 columns
		for (const field of [...(page.fields ?? []), ...(page.columns ?? [])]) {
			for (const message of [...validateFieldConstraints(page.id, field), ...validateFieldDefault(page.id, field)]) {
				issues.push({ pageId: page.id, message });
			}
		}
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
