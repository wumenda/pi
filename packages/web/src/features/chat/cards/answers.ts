/**
 * ask_user 卡片数据解析与作答编码（纯函数，供组件复用）：
 * - parseAskUserInput：把工具调用入参校验为渲染契约，失败返回 undefined（降级为普通工具卡片）；
 * - collectDefaultValues：按 defaultValue 初始化作答值；
 * - validateAnswers：必填校验，返回第一个错误提示；
 * - normalizeAnswers：作答值 → 结构化作答对象（作为 answerAskUser 负载回传模型）。
 */

import type { AskUserInput, AskUserType, CardAnswers, FieldInput, PageInput, UploadedFileValue } from "./types.ts";

/** pi 端 ask_user 工具按名称识别（MCP server 前缀 + ask_user_* 工具名） */
export function isAskUserTool(calledTool: string): boolean {
	return calledTool.includes("ask_user_");
}

const TYPES: readonly AskUserType[] = ["list-single", "list-multi", "form", "table", "dropdown", "file-collect"];

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 结构校验失败原因 */
export type ParseFailReason =
	| "not-object" // 输入整体非对象（数组 / null / 标量）
	| "missing-title" // title 缺失或为空
	| "bad-pages" // pages 缺失 / 空数组 / 无合法页（每页需非空 id + title）
	| "page-missing-type" // 某页缺 type（页级 type 必填，无兜底）
	| "page-bad-type"; // 某页 type 不在 6 种预设

/**
 * 诊断 ask_user 输入为何校验失败：成功返回规范化契约；失败返回原因 + 原始参数
 * （供错误卡片展示摘要与编辑重发）。交互类型为页级（Page.type 必填），顶层不设 type。
 */
export function diagnoseAskUserInput(
	input: unknown,
): { ok: true; input: AskUserInput } | { ok: false; reason: ParseFailReason; raw: unknown } {
	if (!isRecord(input)) return { ok: false, reason: "not-object", raw: input };
	if (typeof input.title !== "string" || input.title.length === 0)
		return { ok: false, reason: "missing-title", raw: input };
	const rawPages = input.pages;
	if (!Array.isArray(rawPages) || rawPages.length === 0) return { ok: false, reason: "bad-pages", raw: input };

	// lossy schema 容错：模型按近似 schema 生成参数可能缺页/字段标识；无法派生标识的页/字段丢弃。
	const normalizeField = (f: unknown): FieldInput | null => {
		if (!isRecord(f)) return null;
		const fid =
			(typeof f.id === "string" && f.id) ||
			(typeof f.name === "string" && f.name) ||
			(typeof f.label === "string" && f.label) ||
			undefined;
		if (!fid) return null;
		const out = {
			...(f as unknown as FieldInput),
			id: fid,
			label: typeof f.label === "string" && f.label ? f.label : fid,
		};
		if (Array.isArray(f.fileMeta)) {
			out.fileMeta = f.fileMeta.map(normalizeField).filter((x): x is FieldInput => x !== null);
		}
		return out;
	};
	const normalizeFields = (v: unknown): FieldInput[] | null => {
		if (!Array.isArray(v)) return null;
		const out = v.map(normalizeField).filter((x): x is FieldInput => x !== null);
		return v.length === 0 ? [] : out.length > 0 ? out : null;
	};
	const pages: PageInput[] = [];
	for (const p of rawPages) {
		if (!isRecord(p)) continue;
		const pt = p.type;
		const id =
			(typeof p.id === "string" && p.id) ||
			(typeof p.title === "string" && p.title) ||
			(typeof pt === "string" ? pt : undefined);
		if (!id) continue;
		const title = (typeof p.title === "string" && p.title) || id;
		const page = { ...p, id, title } as PageInput;
		if ("fields" in p) page.fields = normalizeFields(p.fields);
		if ("columns" in p) page.columns = normalizeFields(p.columns);
		pages.push(page);
	}
	if (pages.length === 0) return { ok: false, reason: "bad-pages", raw: input };
	// 页级 type 必填：缺失 → page-missing-type；存在但非法 → page-bad-type
	for (const p of pages) {
		const pt = p.type;
		if (pt === undefined || pt === null) {
			return { ok: false, reason: "page-missing-type", raw: input };
		}
		if (typeof pt !== "string" || !TYPES.includes(pt as AskUserType)) {
			return { ok: false, reason: "page-bad-type", raw: input };
		}
	}
	const normalizedPages = pages.map((p) => ({ ...p, type: p.type as AskUserType }));
	return {
		ok: true,
		input: {
			title: input.title,
			...(typeof input.question === "string" ? { question: input.question } : { question: null }),
			...(input.allowCustom === true ? { allowCustom: true } : { allowCustom: false }),
			pages: normalizedPages,
		},
	};
}

/** 宽松解析渲染契约；结构性缺失（type/title/pages）即判定不符并降级 */
export function parseAskUserInput(input: unknown): AskUserInput | undefined {
	const diagnosed = diagnoseAskUserInput(input);
	return diagnosed.ok ? diagnosed.input : undefined;
}

/** 页内可作答字段：fields 模式取 fields；table 模式无逐字段作答（整页编辑行） */
export function answerableFields(page: PageInput): FieldInput[] {
	return page.fields ?? [];
}

/** 按 defaultValue 初始化作答值（number 用 null 占位以便受控输入） */
export function collectDefaultValues(input: AskUserInput): CardAnswers {
	const values: CardAnswers = {};
	for (const page of input.pages) {
		const pageValues: Record<string, unknown> = {};
		for (const field of answerableFields(page)) {
			if (field.defaultValue !== undefined && field.defaultValue !== null) {
				pageValues[field.id] = field.defaultValue;
			} else if (field.widget === "checkbox" || field.widget === "file") {
				pageValues[field.id] = [];
			} else if (field.widget === "number") {
				pageValues[field.id] = null;
			} else {
				pageValues[field.id] = undefined;
			}
		}
		values[page.id] = pageValues;
	}
	return values;
}

/** 统一判空（真源）：undefined/null/空串/空数组 均视为空；供门控谓词与其他卡片共用 */
export function isEmptyValue(v: unknown): boolean {
	if (v === undefined || v === null) return true;
	if (typeof v === "string") return v.trim().length === 0;
	if (Array.isArray(v)) return v.length === 0;
	return false;
}

/** 完成度错误：唯一校验真源 validateAnswersDetailed 的输出单元（供门控与内联提示同源派生）。 */
export type CompletionError =
	| { kind: "required"; fieldId: string; message: string }
	| { kind: "minCount"; fieldId: string; message: string }
	| { kind: "maxCount"; fieldId: string; message: string }
	| { kind: "custom-empty"; fieldId: string; message: string }
	| { kind: "table-min-rows"; fieldId: string; message: string }
	| { kind: "table-cell"; fieldId: string; rowIndex: number; colId: string; message: string }
	| { kind: "file-meta"; fieldId: string; fileIndex: number; metaId: string; message: string };

/** 自定义占位 label：allowCustom 为真时追加的「自定义」选项 label（与渲染层共享，须一致） */
export const CUSTOM_LABEL = "其他（自定义）";

/**
 * 完整完成度校验：返回全部失败项（唯一真源）。
 * 覆盖：fields 必填、file 数量（min/maxCount）、file 每文件 fileMeta 必填元字段、
 *       allowCustom 占位值（选了「自定义」但未填文本 → custom-empty）、table 必填列。
 *  `scope` 可选：仅校验指定页 id（多页翻页的「下一步」当页校验用）；
 *  缺省时遍历全部页（提交全量校验）。
 */
export function validateAnswersDetailed(
	input: AskUserInput,
	values: CardAnswers,
	scope?: { only: string },
): CompletionError[] {
	const pages = scope ? input.pages.filter((p) => p.id === scope.only) : input.pages;
	const errors: CompletionError[] = [];

	for (const page of pages) {
		// 页级交互类型；table 页走行编辑校验，其余走逐字段校验
		if (page.type === "table") {
			collectTableErrors(page, values, errors);
			continue;
		}
		for (const field of answerableFields(page)) {
			const v = values[page.id]?.[field.id];
			if (field.widget === "file") {
				collectFileErrors(field, v, errors);
				continue;
			}
			// allowCustom 占位值：选了「自定义」但配套自由文本未填 → 实质无效
			if (
				input.allowCustom &&
				(field.widget === "radio" || field.widget === "select") &&
				v === CUSTOM_LABEL &&
				isEmptyValue(values[page.id]?.[`${field.id}__custom`])
			) {
				errors.push({
					kind: "custom-empty",
					fieldId: field.id,
					message: `「${field.label}」选择自定义后请填写具体内容`,
				});
				continue;
			}
			if (field.required && isEmptyValue(v)) {
				errors.push({ kind: "required", fieldId: field.id, message: `「${field.label}」为必填项` });
			}
		}
	}
	return errors;
}

/** table 页错误：行数 minRows + 每行必填列 */
function collectTableErrors(page: PageInput, values: CardAnswers, errors: CompletionError[]): void {
	const rows = values[page.id]?.__rows__;
	const rowsArr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
	const minRows = page.rowOps?.minRows ?? 1;
	if (rowsArr.length < minRows) {
		errors.push({
			kind: "table-min-rows",
			fieldId: page.id,
			message: `「${page.title}」至少需要 ${minRows} 行`,
		});
		return;
	}
	for (const col of page.columns ?? []) {
		if (!col.required) continue;
		for (let ri = 0; ri < rowsArr.length; ri++) {
			if (isEmptyValue(rowsArr[ri]?.[col.id])) {
				errors.push({
					kind: "table-cell",
					fieldId: page.id,
					rowIndex: ri,
					colId: col.id,
					message: `「${col.label}」为必填项`,
				});
			}
		}
	}
}

/** file 字段错误：数量（min/maxCount）+ 每文件 fileMeta 必填元字段（数量达标≠数据完整） */
function collectFileErrors(field: FieldInput, v: unknown, errors: CompletionError[]): void {
	const files = Array.isArray(v) ? (v as UploadedFileValue[]) : [];
	const minCount = field.constraints?.minCount ?? 1;
	if (files.length < minCount) {
		errors.push({
			kind: "minCount",
			fieldId: field.id,
			message: `「${field.label}」为必填项，请至少上传 ${minCount} 个文件`,
		});
	}
	if (field.constraints?.maxCount != null && files.length > field.constraints.maxCount) {
		errors.push({
			kind: "maxCount",
			fieldId: field.id,
			message: `「${field.label}」最多上传 ${field.constraints.maxCount} 个文件`,
		});
	}
	for (const meta of field.fileMeta ?? []) {
		if (!meta.required) continue;
		for (let fi = 0; fi < files.length; fi++) {
			const metaValue = files[fi]?.meta?.[meta.id];
			if (isEmptyValue(metaValue)) {
				errors.push({
					kind: "file-meta",
					fieldId: field.id,
					fileIndex: fi,
					metaId: meta.id,
					message: `「${field.label}」第 ${fi + 1} 个文件缺少「${meta.label}」`,
				});
			}
		}
	}
}

/**
 * 必填校验：返回第一个错误提示文案；undefined 表示通过（validateAnswersDetailed 的薄封装；
 * 新代码请用 validateAnswersDetailed 获取完整错误集合）。
 */
export function validateAnswers(
	input: AskUserInput,
	values: CardAnswers,
	scope?: { only: string },
): string | undefined {
	return validateAnswersDetailed(input, values, scope)[0]?.message;
}

/**
 * 合并自定义槽位（供 encodeAnswers 与卡片摘要共用）：
 * 字段值 = CUSTOM_LABEL 时，用同字段的 `${id}__custom` 自由文本替换并丢弃槽位；
 * 未选中自定义时丢弃残留的 `__custom` 槽位。不做静默兜底——文本为空时保持占位值原样。
 */
export function normalizeAnswers(values: CardAnswers): CardAnswers {
	const out: CardAnswers = {};
	for (const [pageId, pageValues] of Object.entries(values)) {
		const normalized: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(pageValues)) {
			if (key.endsWith("__custom")) continue;
			normalized[key] = v === CUSTOM_LABEL ? (pageValues[`${key}__custom`] ?? v) : v;
		}
		out[pageId] = normalized;
	}
	return out;
}
