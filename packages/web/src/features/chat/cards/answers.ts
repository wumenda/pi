/**
 * ask_user 卡片数据解析与作答编码（纯函数，供组件与单测复用）：
 * - parseAskUserInput：把 tool part 的 state.input 校验为渲染契约，失败返回 undefined（降级为普通工具卡片）；
 * - collectDefaultValues：按 defaultValue 初始化作答值；
 * - validateAnswers：必填校验，返回第一个错误提示；
 * - encodeAnswers：作答值 → opencode question reply 的 answers（单题，JSON 字符串承载结构化内容）。
 */

import type { QueryClient } from "@tanstack/react-query";
import type { ToolPartLike } from "../../../api/events";
import type { PendingQuestion } from "../../../types";
import type { AskUserInput, AskUserType, CardAnswers, FieldInput, PageInput, UploadedFileValue } from "./types";

/** opencode 为 MCP tool 加 `<server>_` 前缀（如 ask-user-question_ask_user_question） */
export function isAskUserTool(calledTool: string): boolean {
	return calledTool.includes("ask_user_");
}

/** 原生 question 工具（agent 可不经 ask_user_question 直接调用） */
export const QUESTION_TOOL_NAME = "question";

/**
 * MCP 流占位签名：ask_user_question 的指令要求模型以固定单问题参数调用
 * question 工具（ask_user_question/prompt.py build_question_tool_payload，
 * 选项 label 固定为「等待用户作答」）。据此区分 MCP 流与直接调用。
 */
export function isPlaceholderQuestions(questions: PendingQuestion["questions"]): boolean {
	return (
		questions.length === 1 && questions[0]!.options.length === 1 && questions[0]!.options[0]!.label === "等待用户作答"
	);
}

/** 该 tool part 是否为 pendingQuestion 指向的那次 question 工具调用（按 messageID+callID） */
export function matchesPendingQuestion(part: ToolPartLike, pending: PendingQuestion): boolean {
	if (!pending.tool) return false;
	const p = part as ToolPartLike & { messageID?: unknown; callID?: unknown };
	return p.messageID === pending.tool.messageID && p.callID === pending.tool.callID;
}

const TYPES: readonly AskUserType[] = [
	"list-single",
	"list-multi",
	"form",
	"table",
	"dropdown",
	"file-collect",
	"file-download",
];

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 结构校验失败原因（mcp-ask-user-question.md §7 触发条件） */
export type ParseFailReason =
	| "not-object" // 输入整体非对象（数组 / null / 标量）
	| "missing-title" // title 缺失或为空
	| "bad-pages" // pages 缺失 / 空数组 / 无合法页（每页需非空 id + title）
	| "page-missing-type" // 某页缺 type（页级 type 必填，无兜底）
	| "page-bad-type"; // 某页 type 不在 7 种预设

/**
 * 诊断 ask_user 输入为何校验失败（mcp-ask-user-question.md §7）：
 * 成功返回规范化契约；失败返回原因 + 原始参数（供错误卡片展示摘要与编辑重发）。
 * 交互类型为页级（Page.type 必填），顶层不设 type。
 */
export function diagnoseAskUserInput(
	input: unknown,
): { ok: true; input: AskUserInput } | { ok: false; reason: ParseFailReason; raw: unknown } {
	if (!isRecord(input)) return { ok: false, reason: "not-object", raw: input };
	if (typeof input.title !== "string" || input.title.length === 0)
		return { ok: false, reason: "missing-title", raw: input };
	const rawPages = input.pages;
	if (!Array.isArray(rawPages) || rawPages.length === 0) return { ok: false, reason: "bad-pages", raw: input };

	// lossy schema 容错：模型按近似 schema 生成参数可能缺页/字段标识（服务端 schema.py
	// 已做同款派生，前端直接消费 tool 原始入参，需等价派生）；无法派生标识的页/字段丢弃。
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

/** 按 defaultValue 初始化作答值（number 用 null 占位以便 InputNumber 受控） */
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

/**
 * 原生 question 每题答案是否空白（真源，供 QuestionCard 提交门控用）：
 * 答案为 label 数组；无任何非空 label 即空白（覆盖空数组与 `[""]` 等空 label 情况，
 * 语义与 ask_user 卡片的 isEmptyValue 对齐——同一「完成度」概念单一判定）。
 */
export function isAnswerBlank(answer: readonly string[]): boolean {
	return answer.length === 0 || answer.every((s) => s.trim().length === 0);
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
 * 完整完成度校验：返回全部失败项（唯一真源，文档《设计规避》§3.1/§3.4/§3.5）。
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
			// allowCustom 占位值：选了「自定义」但配套自由文本未填 → 实质无效（§3.4）
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

/** table 页错误：行数 minRows + 每行必填列（§3.2 多载体分别判定，缺一不可） */
function collectTableErrors(page: PageInput, values: CardAnswers, errors: CompletionError[]) {
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

/** file 字段错误：数量（min/maxCount）+ 每文件 fileMeta 必填元字段（§3.5 数量达标≠数据完整） */
function collectFileErrors(field: FieldInput, v: unknown, errors: CompletionError[]) {
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
 * 必填校验：返回第一个错误提示文案；undefined 表示通过（validateAnswersDetailed 的薄封装，
 * 供既有调用点与单测保持兼容；新代码请用 validateAnswersDetailed 获取完整错误集合）。
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

/**
 * 作答值 → question reply 的 answers。
 * 实际挂起点是单选项占位 question（见 ask_user_question/prompt.py），用户真实作答
 * 以 JSON 字符串承载在 answer 中，作为 question 工具结果回传模型。
 */
export function encodeAnswers(values: CardAnswers): string[][] {
	return [[JSON.stringify(normalizeAnswers(values))]];
}

/** 交互卡片提交/取消后延迟兜底刷新消息缓存的等待时长（ms） */
export const MESSAGES_REFRESH_DELAY_MS = 1000;

/**
 * 交互卡片提交/取消成功后主动刷新会话消息缓存（SSE 丢事件自愈）：
 * question 工具完成/取消状态的 message.part.updated 事件经 SSE 推送，断线/重连间隙
 * 可能丢失且无回放，导致工具卡片永久停留在「执行中」。reply/reject HTTP 成功即说明
 * opencode 侧已受理，此时立即 + 延迟各 invalidate 一次，让 React Query 以 opencode
 * 侧真实 part 状态覆写本地缓存（延迟刷新兜住工具完成事件晚于 reply 返回的情况）。
 */
export function refreshMessagesAfterQuestionReply(queryClient: QueryClient, sessionId: string): void {
	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
	};
	invalidate();
	window.setTimeout(invalidate, MESSAGES_REFRESH_DELAY_MS);
}
