import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { downloadSessionFile, uploadSessionFiles } from "../../../api/files.ts";
import { hostHttpBase, hostSessionId } from "../../mcp/pipeline.ts";
import {
	CUSTOM_LABEL,
	collectDefaultValues,
	normalizeAnswers,
	validateAnswers,
	validateAnswersDetailed,
	type CompletionError,
} from "./answers.ts";
import type { AskUserInput, CardAnswers, FieldInput, PageInput, UploadedFileValue } from "./types.ts";

export type AskCardPhase = "awaiting" | "submitted" | "rejected";

export interface AskUserCardProps {
	input: AskUserInput;
	/** 对应 toolCall 是否已有结果（true → 定格为只读摘要；pi 侧由 transcript 派生） */
	resolved: boolean;
	/** 提交作答（App 层负责把结构化作答通过 answerAskUser 服务解析挂起的工具调用） */
	onSubmit(answers: CardAnswers): Promise<void>;
	/** 取消作答（缺省仅定格，不发送任何消息） */
	onCancel?(): Promise<void>;
}

/**
 * ask_user_question 交互卡片（自参考应用 AskUserCard 复刻并适配 pi）：
 * - 数据源为 assistant toolCall 的 arguments（模型调用参数），无需等待工具返回；
 * - 状态机：awaiting（可填写可提交）→ submitted | rejected（定格；定格后只读摘要）；
 *   pi 无挂起请求握手，渲染即 awaiting；transcript 中该调用已有 tool_result 则定格。
 * - 校验门控：唯一真源 validateAnswersDetailed（table 必填列、file 数量与 fileMeta、
 *   allowCustom 占位值）；内联红字 + 提交按钮校验定位跳页。
 * - 控件为原生 React 元素（pi 不引入 antd）；file 字段为本地选择（pi 无上传端点），
 *   仅记录 { filename, bytes } 随作答回传。
 */
export function AskUserCard({ input, resolved, onSubmit, onCancel }: AskUserCardProps): ReactNode {
	const [phase, setPhase] = useState<AskCardPhase>(resolved ? "submitted" : "awaiting");
	const [values, setValues] = useState<CardAnswers>(() => collectDefaultValues(input));
	const [error, setError] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	// 多页翻页：当前页索引（渲染层行为）。仅影响渲染层。
	const [pageIndex, setPageIndex] = useState(0);
	const lastIndex = input.pages.length - 1;
	const isFirst = pageIndex === 0;
	const isLast = pageIndex === lastIndex;
	const currentPage = input.pages[pageIndex] ?? input.pages[0];

	// transcript 重放后该调用已有结果（如会话刷新）→ 强制定格为已提交
	useEffect(() => {
		if (resolved && (phase === "awaiting" || phase === "submitted")) setPhase("submitted");
	}, [resolved, phase]);

	// 当前页完成度错误（唯一真源派生；实时内联红字 + 按钮门控依据）
	const pageErrors = useMemo(
		() => (currentPage === undefined ? [] : validateAnswersDetailed(input, values, { only: currentPage.id })),
		[input, values, currentPage],
	);

	if (currentPage === undefined) return null;

	const setFieldValue = (pageId: string, fieldId: string, value: unknown) => {
		// 值变化即清除汇总错误：内联红字已可自解释「哪里没填对」
		setError(undefined);
		setValues((prev) => ({
			...prev,
			[pageId]: { ...prev[pageId], [fieldId]: value },
		}));
	};

	const submit = async () => {
		if (busy) return;
		// 全量校验：拦截跳过中间页的情况，定位第一个失败的页并跳转过去
		let problem: string | undefined;
		let failIndex = -1;
		for (let i = 0; i < input.pages.length; i++) {
			const page = input.pages[i];
			if (page === undefined) continue;
			problem = validateAnswers(input, values, { only: page.id });
			if (problem !== undefined) {
				failIndex = i;
				break;
			}
		}
		if (problem !== undefined) {
			setError(problem);
			if (failIndex !== pageIndex && failIndex >= 0) setPageIndex(failIndex);
			return;
		}
		setError(undefined);
		setBusy(true);
		try {
			await onSubmit(normalizeAnswers(values));
			setPhase("submitted");
		} catch (e) {
			setError(`提交失败：${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const cancel = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await onCancel?.();
		} catch {
			// 取消失败同样按取消定格
		} finally {
			setBusy(false);
			setPhase("rejected");
		}
	};

	// 多页翻页导航：下一步校验当前页必填，通过才前进；上一步不校验直接回退
	const goNext = () => {
		const problem = validateAnswers(input, values, { only: currentPage.id });
		if (problem !== undefined) {
			setError(problem);
			return;
		}
		setError(undefined);
		setPageIndex((i) => Math.min(i + 1, lastIndex));
	};

	const goBack = () => setPageIndex((i) => Math.max(i - 1, 0));

	const finalized = phase === "submitted" || phase === "rejected";

	return (
		<div className="ask-card" data-phase={phase} data-ask-type={currentPage.type}>
			<div className="ask-card-head">
				<span className="ask-tag ask-tag-blue">交互问答</span>
				<span className="ask-card-title">{input.title}</span>
				{phase === "submitted" && <span className="ask-tag ask-tag-green">已提交</span>}
				{phase === "rejected" && <span className="ask-tag ask-tag-red">已取消</span>}
			</div>
			{input.question && <div className="ask-card-question">{input.question}</div>}

			{finalized ? (
				<pre className="ask-card-summary">{JSON.stringify(normalizeAnswers(values), null, 2)}</pre>
			) : (
				<>
					<PageView
						key={currentPage.id}
						page={currentPage}
						allowCustom={input.allowCustom ?? false}
						disabled={busy}
						values={values}
						errors={pageErrors}
						onChange={(fieldId, value) => setFieldValue(currentPage.id, fieldId, value)}
						onPageChange={(pageValues) => {
							// 值变化即清除汇总错误（同 setFieldValue 语义；table 行编辑走此路径）
							setError(undefined);
							setValues((prev) => ({ ...prev, [currentPage.id]: pageValues }));
						}}
					/>
					{error && <div className="ask-alert ask-alert-warning">{error}</div>}
					{input.pages.length > 1 && (
						<div className="ask-card-progress" aria-label={`第 ${pageIndex + 1} 页，共 ${input.pages.length} 页`}>
							第 {pageIndex + 1} / {input.pages.length} 页
						</div>
					)}
					<div className="ask-card-actions">
						{!isFirst && (
							<button type="button" className="ask-btn" aria-label="上一步" onClick={goBack} disabled={busy}>
								上一步
							</button>
						)}
						{isLast ? (
							<button
								type="button"
								className="ask-btn ask-btn-primary"
								aria-label="提交"
								onClick={() => void submit()}
								disabled={busy}
							>
								{busy ? "提交中…" : "提交"}
							</button>
						) : (
							<button type="button" className="ask-btn ask-btn-primary" aria-label="下一步" onClick={goNext} disabled={busy}>
								下一步
							</button>
						)}
						<button type="button" className="ask-btn" aria-label="取消" onClick={() => void cancel()} disabled={busy}>
							取消
						</button>
					</div>
				</>
			)}
		</div>
	);
}

/** 页渲染：fields 模式逐字段控件；table 模式行编辑（rowOps 控制增删与行数） */
function PageView({
	page,
	allowCustom,
	disabled,
	values,
	errors,
	onChange,
	onPageChange,
}: {
	page: PageInput;
	allowCustom: boolean;
	disabled: boolean;
	values: CardAnswers;
	errors: CompletionError[];
	onChange: (fieldId: string, value: unknown) => void;
	onPageChange: (pageValues: Record<string, unknown>) => void;
}): ReactNode {
	const pageValues = values[page.id] ?? {};
	return (
		<div className="ask-card-page">
			<div className="ask-card-page-title">{page.title}</div>
			{page.question && <div className="ask-card-question">{page.question}</div>}
			{page.type === "table" ? (
				<TableEditor
					page={page}
					disabled={disabled}
					rows={(pageValues.__rows__ as Record<string, unknown>[] | undefined) ?? []}
					errors={errors}
					onChange={(rows) => onPageChange({ ...pageValues, __rows__: rows })}
				/>
			) : page.type === "file-download" ? (
				(page.fields ?? []).map((field) => (
					<FileDownloadList
						key={field.id}
						field={field}
						disabled={disabled}
						value={pageValues[field.id]}
						errors={errors.filter((e) => e.fieldId === field.id)}
						onChange={(value) => onChange(field.id, value)}
					/>
				))
			) : (
				(page.fields ?? []).map((field) => (
					<FieldView
						key={field.id}
						field={field}
						allowCustom={allowCustom}
						disabled={disabled}
						value={pageValues[field.id]}
						customValue={pageValues[`${field.id}__custom`]}
						errors={errors.filter((e) => e.fieldId === field.id)}
						onChange={(value) => onChange(field.id, value)}
						onCustomChange={(text) => onChange(`${field.id}__custom`, text)}
					/>
				))
			)}
		</div>
	);
}

/**
 * 字段控件：widget → 原生控件映射。
 * file 字段：本地选择文件（pi 无上传端点），按 maxSizeMB 过滤后记录
 * { filename, bytes } 追加到作答值，随 encodeAnswers 回传模型。
 * fileMeta：每个已选文件下方渲染元字段输入（值写入文件项的 meta）。
 * allowCustom：枚举字段追加「自定义」选项 + 自由文本（文本槽位为 `{id}__custom`）。
 */
function FieldView({
	field,
	allowCustom,
	disabled,
	value,
	customValue,
	errors,
	onChange,
	onCustomChange,
}: {
	field: FieldInput;
	allowCustom: boolean;
	disabled: boolean;
	value: unknown;
	customValue?: unknown;
	errors: CompletionError[];
	onChange: (value: unknown) => void;
	onCustomChange: (text: string) => void;
}): ReactNode {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const options = field.options ?? [];
	const files = Array.isArray(value) ? (value as UploadedFileValue[]) : [];

	const isEnum = field.widget === "radio" || field.widget === "select";
	const showCustom = allowCustom && isEnum;
	const isCustomSelected = value === CUSTOM_LABEL;
	const customText = typeof customValue === "string" ? customValue : "";

	// 选文件（按大小上限过滤）→ 上传到会话工作区 → 记录 { filename, bytes, path } 引用
	const [uploadNote, setUploadNote] = useState<string | undefined>(undefined);
	const [uploading, setUploading] = useState(false);
	const handleFiles = async (e: ChangeEvent<HTMLInputElement>) => {
		const selected = e.target.files;
		if (!selected || selected.length === 0) return;
		const maxSizeMB = field.constraints?.maxSizeMB;
		const picked = Array.from(selected).filter((file) => maxSizeMB == null || file.size <= maxSizeMB * 1024 * 1024);
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (picked.length === 0) return;
		const sessionId = hostSessionId();
		if (sessionId === undefined) {
			setUploadNote("文件上传失败：未连接会话");
			return;
		}
		setUploading(true);
		setUploadNote(undefined);
		try {
			const refs = await uploadSessionFiles(hostHttpBase(), sessionId, picked);
			const sizeByName = new Map(picked.map((file) => [file.name, file.size]));
			onChange([
				...files,
				...refs.map((ref) => ({ filename: ref.filename, bytes: sizeByName.get(ref.filename) ?? 0, path: ref.path })),
			]);
		} catch (err) {
			setUploadNote(err instanceof Error ? err.message : String(err));
		} finally {
			setUploading(false);
		}
	};

	const setFileMeta = (fileIndex: number, metaId: string, metaValue: unknown) => {
		const next = files.map((f, i) =>
			i === fileIndex ? { ...f, meta: { ...(f.meta ?? {}), [metaId]: metaValue } } : f,
		);
		onChange(next);
	};

	const requiredErr = errors.find((e) => e.kind === "required");
	const customErr = errors.find((e) => e.kind === "custom-empty");
	const fileError = errors.find((e) => e.kind === "minCount" || e.kind === "maxCount");
	const metaErrors = (fileIndex: number) =>
		errors.find(
			(e): e is Extract<CompletionError, { kind: "file-meta" }> =>
				e.kind === "file-meta" && e.fileIndex === fileIndex,
		);

	return (
		<div className="ask-card-field">
			<label className="ask-card-field-label">
				{field.label}
				{field.required && <span className="ask-card-required">*</span>}
				{field.unit && <span className="ask-card-unit">{field.unit}</span>}
			</label>
			{field.description && <div className="ask-card-field-desc">{field.description}</div>}
			{field.widget === "radio" && (
				<div className="ask-option-group" role="radiogroup">
					{options.map((o) => (
						<label key={o.id} className="ask-option">
							<input
								type="radio"
								name={field.id}
								value={o.label}
								checked={value === o.label}
								disabled={disabled}
								onChange={() => onChange(o.label)}
							/>
							<span>
								{o.label}
								{o.description && <span className="ask-card-option-desc"> · {o.description}</span>}
							</span>
						</label>
					))}
					{showCustom && (
						<label className="ask-option">
							<input
								type="radio"
								name={field.id}
								value={CUSTOM_LABEL}
								checked={isCustomSelected}
								disabled={disabled}
								onChange={() => onChange(CUSTOM_LABEL)}
							/>
							<span>{CUSTOM_LABEL}</span>
						</label>
					)}
				</div>
			)}
			{field.widget === "checkbox" && (
				<div className="ask-option-group">
					{options.map((o) => {
						const checked = Array.isArray(value) && (value as unknown[]).includes(o.label);
						return (
							<label key={o.id} className="ask-option">
								<input
									type="checkbox"
									checked={checked}
									disabled={disabled}
									onChange={(e) => {
										const current = Array.isArray(value) ? [...(value as unknown[])] : [];
										onChange(e.target.checked ? [...current, o.label] : current.filter((v) => v !== o.label));
									}}
								/>
								<span>
									{o.label}
									{o.description && <span className="ask-card-option-desc"> · {o.description}</span>}
								</span>
							</label>
						);
					})}
				</div>
			)}
			{field.widget === "select" && (
				<select
					className="ask-select"
					value={typeof value === "string" && value.length > 0 ? value : ""}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
				>
					<option value="">{field.hint ?? `请选择${field.label}`}</option>
					{options.map((o) => (
						<option key={o.id} value={o.label}>
							{o.label}
						</option>
					))}
					{showCustom && <option value={CUSTOM_LABEL}>{CUSTOM_LABEL}</option>}
				</select>
			)}
			{showCustom && isCustomSelected && (
				<input
					className="ask-input ask-card-custom-input"
					value={customText}
					disabled={disabled}
					placeholder="请输入自定义内容"
					onChange={(e) => onCustomChange(e.target.value)}
					aria-label={`${field.label}自定义内容`}
				/>
			)}
			{field.widget === "number" && (
				<input
					className="ask-input"
					type="number"
					value={typeof value === "number" ? value : ""}
					disabled={disabled}
					min={field.constraints?.min ?? undefined}
					max={field.constraints?.max ?? undefined}
					placeholder={field.hint ?? undefined}
					onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
				/>
			)}
			{field.widget === "text" && (
				<input
					className="ask-input"
					value={typeof value === "string" ? value : ""}
					disabled={disabled}
					placeholder={field.hint ?? undefined}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}
			{field.widget === "textarea" && (
				<textarea
					className="ask-input ask-textarea"
					value={typeof value === "string" ? value : ""}
					disabled={disabled}
					placeholder={field.hint ?? undefined}
					rows={3}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}
			{field.widget === "file" && (
				<div className="ask-card-file">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept={field.constraints?.accept?.join(",") ?? undefined}
						style={{ display: "none" }}
						onChange={handleFiles}
						aria-label={`选择${field.label}文件`}
					/>
					<button
						type="button"
						className="ask-btn"
						disabled={disabled || uploading}
						onClick={() => fileInputRef.current?.click()}
					>
						{uploading ? "上传中…" : files.length > 0 ? `已选 ${files.length} 个文件` : "选择文件"}
					</button>
					{field.constraints?.maxSizeMB != null && (
						<span className="ask-card-file-hint">上限 {field.constraints.maxSizeMB}MB</span>
					)}
					{uploadNote && <span className="ask-card-field-error"> {uploadNote}</span>}
					{files.length > 0 && (
						<div className="ask-card-file-list">
							{files.map((f) => (
								<span key={f.filename} className="ask-tag">
									{f.filename}
									{f.bytes > 0 && (
										<span className="ask-card-file-bytes">
											{" "}
											{(f.bytes / 1024).toFixed(f.bytes >= 1024 * 1024 ? 1 : 0)}
											{f.bytes >= 1024 * 1024 ? "MB" : "KB"}
										</span>
									)}
									{!disabled && (
										<button
											type="button"
											className="ask-tag-close"
											aria-label={`移除 ${f.filename}`}
											onClick={() => onChange(files.filter((x) => x.filename !== f.filename))}
										>
											×
										</button>
									)}
								</span>
							))}
						</div>
					)}
					{field.fileMeta && field.fileMeta.length > 0 && files.length > 0 && (
						<div className="ask-card-file-meta">
							{files.map((f, fi) => (
								<div key={f.filename} className="ask-card-file-meta-item">
									<span className="ask-card-file-meta-name">{f.filename}</span>
									{field.fileMeta?.map((meta) => {
										const metaErr = metaErrors(fi)?.metaId === meta.id ? metaErrors(fi) : undefined;
										return (
											<div key={meta.id} className="ask-card-file-meta-field">
												<label className="ask-card-field-label">
													{meta.label}
													{meta.required && <span className="ask-card-required">*</span>}
												</label>
												<MetaInput
													meta={meta}
													disabled={disabled}
													value={f.meta?.[meta.id]}
													onChange={(v) => setFileMeta(fi, meta.id, v)}
												/>
												{metaErr && <span className="ask-card-field-error">{metaErr.message}</span>}
											</div>
										);
									})}
								</div>
							))}
						</div>
					)}
				</div>
			)}
			{customErr && <span className="ask-card-field-error">{customErr.message}</span>}
			{fileError && <span className="ask-card-field-error">{fileError.message}</span>}
			{requiredErr && <span className="ask-card-field-error">{requiredErr.message}</span>}
		</div>
	);
}

/** fileMeta 元字段输入（text/number/select 与 FieldView 控件语义一致） */
function MetaInput({
	meta,
	disabled,
	value,
	onChange,
}: {
	meta: FieldInput;
	disabled: boolean;
	value: unknown;
	onChange: (v: unknown) => void;
}): ReactNode {
	if (meta.widget === "number") {
		return (
			<input
				className="ask-input"
				type="number"
				value={typeof value === "number" ? value : ""}
				disabled={disabled}
				min={meta.constraints?.min ?? undefined}
				max={meta.constraints?.max ?? undefined}
				onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
			/>
		);
	}
	if (meta.widget === "select") {
		return (
			<select
				className="ask-select"
				value={typeof value === "string" && value.length > 0 ? value : ""}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
			>
				<option value="">请选择</option>
				{(meta.options ?? []).map((o) => (
					<option key={o.id} value={o.label}>
						{o.label}
					</option>
				))}
			</select>
		);
	}
	return (
		<input
			className="ask-input"
			value={typeof value === "string" ? value : ""}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

/**
 * file-download 下载清单：卡片式路径多选（选项 label + 工作区相对路径）。
 * 作答值存选项 id（相对路径），与通用 checkbox 存 label 的语义不同；
 * 「下载所选」触发会话文件下载端点（Task 24 接入）。
 */
function FileDownloadList({
	field,
	disabled,
	value,
	errors,
	onChange,
}: {
	field: FieldInput;
	disabled: boolean;
	value: unknown;
	errors: CompletionError[];
	onChange: (value: unknown) => void;
}): ReactNode {
	const options = field.options ?? [];
	const selected = Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === "string") : [];
	const [downloadNote, setDownloadNote] = useState<string | undefined>(undefined);

	const toggle = (id: string, checked: boolean) => {
		onChange(checked ? [...selected, id] : selected.filter((path) => path !== id));
	};

	const downloadSelected = async () => {
		if (selected.length === 0) return;
		setDownloadNote(undefined);
		const httpBase = hostHttpBase();
		const sessionId = hostSessionId();
		if (sessionId === undefined) {
			setDownloadNote("文件下载失败：未连接会话");
			return;
		}
		try {
			for (const path of selected) await downloadSessionFile(httpBase, sessionId, path);
			setDownloadNote("已开始下载所选文件");
		} catch (e) {
			setDownloadNote(e instanceof Error ? e.message : String(e));
		}
	};

	const error = errors.find((e) => e.kind === "minCount" || e.kind === "maxCount" || e.kind === "path-form");

	return (
		<div className="ask-card-field">
			<label className="ask-card-field-label">
				{field.label}
				{field.required && <span className="ask-card-required">*</span>}
			</label>
			{field.description && <div className="ask-card-field-desc">{field.description}</div>}
			<div className="ask-option-group">
				{options.map((o) => {
					const checked = selected.includes(o.id);
					return (
						<label key={o.id} className="ask-option">
							<input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => toggle(o.id, e.target.checked)} />
							<span>
								{o.label}
								<span className="ask-card-option-desc"> · {o.id}</span>
							</span>
						</label>
					);
				})}
			</div>
			<button
				type="button"
				className="ask-btn"
				disabled={disabled || selected.length === 0}
				onClick={() => void downloadSelected()}
			>
				下载所选{selected.length > 0 ? `（${selected.length}）` : ""}
			</button>
			{downloadNote && <span className="ask-card-file-hint"> {downloadNote}</span>}
			{error && <span className="ask-card-field-error">{error.message}</span>}
		</div>
	);
}

/** table 行编辑：每行按 columns 渲染输入框，rowOps 控制增删与行数约束 */
function TableEditor({
	page,
	disabled,
	rows,
	errors,
	onChange,
}: {
	page: PageInput;
	disabled: boolean;
	rows: Record<string, unknown>[];
	errors: CompletionError[];
	onChange: (rows: Record<string, unknown>[]) => void;
}): ReactNode {
	const columns = useMemo(() => page.columns ?? [], [page.columns]);
	const rowOps = page.rowOps;
	const minRows = rowOps?.minRows ?? 1;
	const maxRows = rowOps?.maxRows ?? undefined;
	const initializedRef = useRef(false);

	useEffect(() => {
		// 初始行数未达 minRows 时补空行（table 页无 defaultValue 语义）；仅初始化时补齐
		if (initializedRef.current) return;
		initializedRef.current = true;
		if (rows.length < minRows) {
			onChange(Array.from({ length: minRows }, () => ({})));
		}
		// 仅初始化时补齐
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const setCell = (rowIndex: number, colId: string, value: unknown) => {
		const next = rows.map((row, i) => (i === rowIndex ? { ...row, [colId]: value } : row));
		onChange(next);
	};

	return (
		<div className="ask-card-table">
			<div className="ask-card-table-row ask-card-table-head">
				{columns.map((col) => (
					<span key={col.id} className="ask-card-table-cell">
						{col.label}
						{col.required && <span className="ask-card-required">*</span>}
					</span>
				))}
			</div>
			{rows.map((row, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 行编辑以索引为稳定键（增删整行重建）
				<div key={i} className="ask-card-table-row">
					{columns.map((col) => {
						const cellErr = errors.find((e) => e.kind === "table-cell" && e.rowIndex === i && e.colId === col.id);
						const cellValue = row[col.id];
						return (
							<span key={col.id} className="ask-card-table-cell">
								{col.widget === "number" ? (
									<input
										className={`ask-input${cellErr ? " ask-input-error" : ""}`}
										type="number"
										value={typeof cellValue === "number" ? cellValue : ""}
										disabled={disabled}
										min={col.constraints?.min ?? undefined}
										max={col.constraints?.max ?? undefined}
										onChange={(e) => setCell(i, col.id, e.target.value === "" ? null : Number(e.target.value))}
									/>
								) : (
									<input
										className={`ask-input${cellErr ? " ask-input-error" : ""}`}
										value={typeof cellValue === "string" ? cellValue : ""}
										disabled={disabled}
										onChange={(e) => setCell(i, col.id, e.target.value)}
									/>
								)}
								{cellErr && <span className="ask-card-cell-error">{cellErr.message}</span>}
							</span>
						);
					})}
					{rowOps?.allowDelete !== false && rows.length > minRows && (
						<button
							type="button"
							className="ask-btn ask-btn-text"
							disabled={disabled}
							onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
						>
							删
						</button>
					)}
				</div>
			))}
			{rowOps?.allowAdd !== false && (maxRows === undefined || rows.length < maxRows) && (
				<button type="button" className="ask-btn ask-btn-dashed ask-btn-block" disabled={disabled} onClick={() => onChange([...rows, {}])}>
					添加一行
				</button>
			)}
		</div>
	);
}
