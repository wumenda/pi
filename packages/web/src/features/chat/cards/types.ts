/**
 * ask_user_question 卡片渲染契约（镜像 ask_user_question/schema.py 统一字段模型）：
 * - 值域 valueType（enum/number/text/file）与控件 widget 正交；
 * - 6 种交互类型是统一 schema 的预设约束（list-single/list-multi/form/table/dropdown/file-collect）；
 * - tool part 的 state.input 即本契约实例（模型调用参数）。
 */

export type AskUserType = "list-single" | "list-multi" | "form" | "table" | "dropdown" | "file-collect";

export type ValueType = "enum" | "number" | "text" | "file";

export type WidgetType = "radio" | "checkbox" | "select" | "number" | "text" | "textarea" | "file";

export interface OptionInput {
	id: string;
	label: string;
	description?: string | null;
}

export interface ConstraintsInput {
	min?: number | null;
	max?: number | null;
	minCount?: number | null;
	maxCount?: number | null;
	accept?: string[] | null;
	maxSizeMB?: number | null;
}

export interface FieldInput {
	id: string;
	label: string;
	valueType: ValueType;
	widget: WidgetType;
	description?: string | null;
	required?: boolean;
	defaultValue?: string | number | string[] | null;
	unit?: string | null;
	hint?: string | null;
	options?: OptionInput[] | null;
	constraints?: ConstraintsInput | null;
	fileMeta?: FieldInput[] | null;
}

export interface RowOpsInput {
	allowAdd?: boolean;
	allowDelete?: boolean;
	minRows?: number;
	maxRows?: number | null;
}

export interface PageInput {
	/** 页级交互类型（6 种之一），必填；支持跨页混合（如第 1 页 form、第 2 页 table） */
	type: AskUserType;
	id: string;
	title: string;
	question?: string | null;
	fields?: FieldInput[] | null;
	columns?: FieldInput[] | null;
	rows?: Record<string, unknown>[] | null;
	rowOps?: RowOpsInput | null;
}

export interface AskUserInput {
	title: string;
	question?: string | null;
	allowCustom?: boolean;
	pages: PageInput[];
}

/** 已上传文件的值：file 字段作答数组的元素；fileMeta 声明时携带每个文件的附属元字段 */
export interface UploadedFileValue {
	filename: string;
	bytes: number;
	/** 每个文件附带的元字段值（键为 fileMeta[].id）；fileMeta 缺失时为空对象 */
	meta?: Record<string, unknown>;
}

/** 卡片作答值：{ [pageId]: { [fieldId]: 值 | 值数组 } }；table 页为 { [pageId]: 行数组 } */
export type CardAnswers = Record<string, Record<string, unknown>>;
