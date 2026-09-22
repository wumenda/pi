import { type Static, Type } from "typebox";
import type { JsonValue } from "../session/types.ts";
import type { AgentHarnessTool } from "../types.ts";
import type { ExecutionToolContext } from "./tool-context.ts";

// ---------------------------------------------------------------------------
// Tool parameters (mirrors the ask_user_question card contract)
// ---------------------------------------------------------------------------

const askUserOptionSchema = Type.Object({
	id: Type.String({ description: "Stable option id referenced by the answers" }),
	label: Type.String({ description: "Human-readable option label" }),
	description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const askUserConstraintsSchema = Type.Object({
	min: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	max: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	minCount: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	maxCount: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	accept: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
	maxSizeMB: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

const askUserFieldSchema = Type.Object({
	id: Type.String({ description: "Stable field id used as the answer key" }),
	label: Type.String({ description: "Field label shown to the user" }),
	valueType: Type.Union([Type.Literal("enum"), Type.Literal("number"), Type.Literal("text"), Type.Literal("file")], {
		description: "Answer value domain for this field",
	}),
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
});

const askUserRowOpsSchema = Type.Object({
	allowAdd: Type.Optional(Type.Boolean()),
	allowDelete: Type.Optional(Type.Boolean()),
	minRows: Type.Optional(Type.Number()),
	maxRows: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

const askUserPageSchema = Type.Object({
	type: Type.Union(
		[
			Type.Literal("list-single"),
			Type.Literal("list-multi"),
			Type.Literal("form"),
			Type.Literal("table"),
			Type.Literal("dropdown"),
			Type.Literal("file-collect"),
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
});

const askUserSchema = Type.Object({
	title: Type.String({ description: "Overall dialog title" }),
	question: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "Overall question or context" })),
	allowCustom: Type.Optional(Type.Boolean({ description: "Whether the user may supply custom free-form answers" })),
	pages: Type.Array(askUserPageSchema, { minItems: 1, description: "Question pages, rendered in order" }),
});

export type AskUserQuestionInput = Static<typeof askUserSchema>;

const askUserDescription = `Collect structured input from the user and suspend until they answer. Prefer this over guessing whenever you need a decision, confirmation, preferences, or multi-field data entry. Compose one or more pages; each page is one interaction preset: "list-single" (single choice), "list-multi" (multi choice), "form" (typed fields), "table" (editable rows with column definitions), "dropdown" (single choice select), "file-collect" (file uploads with optional per-file metadata). Fields declare valueType (enum|number|text|file) and widget (radio|checkbox|select|number|text|textarea|file) plus optional options/constraints/defaultValue. Answers arrive as JSON shaped {"<pageId>": {"<fieldId>": value or value[]}}; table pages answer an array of row objects under the page id. Do not use this for trivial choices you can reasonably decide yourself.`;

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
