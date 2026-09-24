import { type Static, Type } from "typebox";
import type { JsonValue } from "../session/types.ts";
import type { AgentHarnessTool } from "../types.ts";
import { validateQuestionStructure } from "./ask-user-validation.ts";
import type { ExecutionToolContext } from "./tool-context.ts";

// ---------------------------------------------------------------------------
// Tool parameters (mirrors the ask_user_question card contract)
// ---------------------------------------------------------------------------

const askUserOptionSchema = Type.Object(
	{
		id: Type.String({ description: "Stable option id referenced by the answers" }),
		label: Type.String({ description: "Human-readable option label" }),
		description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	},
	{ additionalProperties: false },
);

const askUserConstraintsSchema = Type.Object(
	{
		min: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		max: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		minCount: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		maxCount: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		accept: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
		maxSizeMB: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	},
	{ additionalProperties: false },
);

const askUserFieldSchema = Type.Object(
	{
		id: Type.String({ description: "Stable field id used as the answer key" }),
		label: Type.String({ description: "Field label shown to the user" }),
		valueType: Type.Union(
			[Type.Literal("enum"), Type.Literal("number"), Type.Literal("text"), Type.Literal("file")],
			{
				description: "Answer value domain for this field",
			},
		),
		widget: Type.Union(
			[
				Type.Literal("radio"),
				Type.Literal("checkbox"),
				Type.Literal("select"),
				Type.Literal("number"),
				Type.Literal("text"),
				Type.Literal("textarea"),
				Type.Literal("file"),
			],
			{ description: "Input control rendered for this field" },
		),
		description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		required: Type.Optional(Type.Boolean()),
		defaultValue: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Array(Type.String()), Type.Null()])),
		unit: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		hint: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		options: Type.Optional(Type.Union([Type.Array(askUserOptionSchema), Type.Null()])),
		constraints: Type.Optional(Type.Union([askUserConstraintsSchema, Type.Null()])),
		fileMeta: Type.Optional(Type.Union([Type.Array(Type.Object({})), Type.Null()])),
	},
	{ additionalProperties: false },
);

const askUserRowOpsSchema = Type.Object(
	{
		allowAdd: Type.Optional(Type.Boolean()),
		allowDelete: Type.Optional(Type.Boolean()),
		minRows: Type.Optional(Type.Number()),
		maxRows: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	},
	{ additionalProperties: false },
);

const askUserPageSchema = Type.Object(
	{
		type: Type.Union(
			[
				Type.Literal("list-single"),
				Type.Literal("list-multi"),
				Type.Literal("form"),
				Type.Literal("table"),
				Type.Literal("dropdown"),
				Type.Literal("file-collect"),
				Type.Literal("file-download"),
			],
			{ description: "Interaction preset for this page" },
		),
		id: Type.String({ description: "Stable page id used as the top-level answer key" }),
		title: Type.String({ description: "Page title shown to the user" }),
		question: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		fields: Type.Optional(Type.Union([Type.Array(askUserFieldSchema), Type.Null()])),
		columns: Type.Optional(Type.Union([Type.Array(askUserFieldSchema), Type.Null()])),
		rows: Type.Optional(Type.Union([Type.Array(Type.Record(Type.String(), Type.Unknown())), Type.Null()])),
		rowOps: Type.Optional(Type.Union([askUserRowOpsSchema, Type.Null()])),
	},
	{ additionalProperties: false },
);

const askUserSchema = Type.Object(
	{
		title: Type.String({ description: "Overall dialog title" }),
		question: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Overall question or context" })),
		allowCustom: Type.Optional(Type.Boolean({ description: "Whether the user may supply custom free-form answers" })),
		pages: Type.Array(askUserPageSchema, { minItems: 1, description: "Question pages, rendered in order" }),
	},
	{ additionalProperties: false },
);

export type AskUserQuestionInput = Static<typeof askUserSchema>;

export type AskUserPage = Static<typeof askUserPageSchema>;

export type AskUserField = Static<typeof askUserFieldSchema>;

// ---------------------------------------------------------------------------
// Structural preset validation: file-download (contract doc §4.7/§6)
// ---------------------------------------------------------------------------

/** file-download 选项 id 路径安全：违规返回违规描述，合法返回 null */
function pathSafetyProblem(value: string): string | null {
	if (value.length === 0) return "空路径";
	if (/^[a-zA-Z]:/.test(value)) return "盘符绝对路径";
	if (value.startsWith("/") || value.startsWith("\\")) return "以 / 或 \\ 开头的绝对路径";
	if (value.includes("\\")) return "含反斜杠（必须用 / 分隔）";
	if (value.split("/").includes("..")) return "含 .. 路径段（路径穿越）";
	return null;
}

/**
 * file-download 页结构预设校验（工具层第一道防线，权威校验在下载端点）：
 * 至少 1 个字段（valueType=enum + widget=checkbox + options 非空，
 * 选项 id 为工作区相对路径）；constraints.minCount ≥1（如提供）。
 * 返回可行动错误数组（含页 id 与「期望 vs 实际」），为空表示合法。
 */
export function validateFileDownloadPage(pageField: AskUserPage): string[] {
	const errors: string[] = [];
	const pageId = pageField.id;
	const fields = pageField.fields ?? [];
	if (fields.length === 0) {
		errors.push(
			`页 ${pageId}：file-download 期望至少 1 个字段，实际 0 个；请提供 valueType="enum" + widget="checkbox" 且 options 非空的字段`,
		);
	}
	for (const field of fields) {
		if (field.valueType !== "enum") {
			errors.push(
				`页 ${pageId} 字段 ${field.id}：file-download 期望 valueType="enum"（valueType="file" 为上传专用，禁用于下载），实际 "${field.valueType}"`,
			);
		}
		if (field.widget !== "checkbox") {
			errors.push(
				`页 ${pageId} 字段 ${field.id}：file-download 期望 widget="checkbox"（下载卡片为路径多选），实际 "${field.widget}"`,
			);
		}
		const options = field.options ?? [];
		if (options.length === 0) {
			errors.push(
				`页 ${pageId} 字段 ${field.id}：file-download 期望 options 非空（选项 id 为工作区相对路径），实际 0 个`,
			);
		}
		for (const option of options) {
			const problem = pathSafetyProblem(option.id);
			if (problem !== null) {
				errors.push(
					`页 ${pageId} 字段 ${field.id} 选项 ${JSON.stringify(option.id)}：期望工作区相对路径（/ 分隔），实际 ${JSON.stringify(option.id)}（${problem}）`,
				);
			}
		}
		const minCount = field.constraints?.minCount;
		if (typeof minCount === "number" && minCount < 1) {
			errors.push(`页 ${pageId} 字段 ${field.id}：constraints.minCount 期望 ≥1，实际 ${minCount}`);
		}
	}
	return errors;
}

const askUserDescription = `Collect structured input from the user and suspend until they answer. Prefer this over guessing whenever you need a decision, confirmation, preferences, or multi-field data entry. Compose one or more pages; each page is one interaction preset: "list-single" (single choice), "list-multi" (multi choice), "form" (typed fields), "table" (editable rows with column definitions), "dropdown" (single choice select), "file-collect" (file uploads with optional per-file metadata), "file-download" (download checklist; fields are enum+checkbox and option ids MUST be workspace-relative paths using "/" separators — no absolute paths, drive letters, backslashes, or ".." segments). Fields declare valueType (enum|number|text|file) and widget (radio|checkbox|select|number|text|textarea|file) plus optional options/constraints/defaultValue. Answers arrive as JSON shaped {"<pageId>": {"<fieldId>": value or value[]}}; table pages answer an array of row objects under the page id. Do not use this for trivial choices you can reasonably decide yourself.`;

// ---------------------------------------------------------------------------
// Pending-ask registry
// ---------------------------------------------------------------------------

/** Structured user answers for one suspended ask_user_question call. */
export type AskUserAnswers = JsonValue;

/** One currently suspended ask_user_question tool call. */
export interface AskUserPendingAsk {
	toolCallId: string;
	input: AskUserQuestionInput;
}

interface PendingAskEntry {
	input: AskUserQuestionInput;
	resolve: (answers: AskUserAnswers) => void;
	reject: (error: Error) => void;
}

/** Tracks suspended ask_user_question calls and delivers user answers to them. */
export interface AskUserRegistry {
	/** Currently suspended asks in registration order. */
	pending(): AskUserPendingAsk[];
	/** Register a suspended ask. Called by the ask_user_question tool itself. */
	register(
		toolCallId: string,
		input: AskUserQuestionInput,
		resolve: (answers: AskUserAnswers) => void,
		reject: (error: Error) => void,
	): void;
	/** Resolve one suspended ask with the user's answers; false when not pending. */
	answer(toolCallId: string, answers: AskUserAnswers): boolean;
	/** Abandon one suspended ask, rejecting its pending promise; no-op when unknown. */
	cancel(toolCallId: string): void;
}

export function createAskUserRegistry(): AskUserRegistry {
	const pending = new Map<string, PendingAskEntry>();
	return {
		pending() {
			return [...pending].map(([toolCallId, entry]) => ({ toolCallId, input: entry.input }));
		},
		register(toolCallId, input, resolve, reject) {
			pending.set(toolCallId, { input, resolve, reject });
		},
		answer(toolCallId, answers) {
			const entry = pending.get(toolCallId);
			if (entry === undefined) return false;
			pending.delete(toolCallId);
			entry.resolve(answers);
			return true;
		},
		cancel(toolCallId) {
			const entry = pending.get(toolCallId);
			if (entry === undefined) return;
			pending.delete(toolCallId);
			entry.reject(new Error("ask_user_question was cancelled"));
		},
	};
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function createAskUserQuestionTool<
	TContext extends ExecutionToolContext = ExecutionToolContext,
>(): AgentHarnessTool<TContext, typeof askUserSchema, undefined> {
	return {
		name: "ask_user_question",
		label: "ask_user_question",
		description: askUserDescription,
		parameters: askUserSchema,
		async execute(toolCallId, params, _onUpdate, toolContext, _invocation, context) {
			const registry = toolContext.askUser;
			if (registry === undefined) {
				throw new Error("ask_user_question is not available: no ask-user registry is configured for this session");
			}
			// 结构预设校验（不挂起）：失败抛可行动报错（harness 置 error 结果），模型可自纠重试
			const issues = validateQuestionStructure(params);
			if (issues.length > 0) {
				throw new Error(
					`ask_user_question 结构校验失败，未向用户提问，请修正后重试：\n${issues.map((issue) => issue.message).join("\n")}`,
				);
			}
			const answers = await new Promise<AskUserAnswers>((resolve, reject) => {
				registry.register(toolCallId, params, resolve, reject);
				const signal = context.abortSignal;
				if (signal === undefined) return;
				const onAbort = (): void => registry.cancel(toolCallId);
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			});
			return { content: [{ type: "text", text: JSON.stringify(answers) }], details: undefined };
		},
	};
}
