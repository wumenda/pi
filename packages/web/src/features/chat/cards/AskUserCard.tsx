import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
} from "antd"
import { UploadOutlined } from "@ant-design/icons"
import { replyQuestion, rejectQuestion } from "../../../api/questions"
import { uploadFileToWorkspace, downloadSessionFiles } from "../../../api/files"
import { AssetSemanticModal } from "../AssetSemanticModal"
import { sessionDirectoryOf } from "../../../stores/app-store"
import type { ToolPartLike } from "../../../api/events"
import {
  CUSTOM_LABEL,
  collectDefaultValues,
  encodeAnswers,
  normalizeAnswers,
  refreshMessagesAfterQuestionReply,
  validateAnswers,
  validateAnswersDetailed,
  type CompletionError,
} from "./answers"
import type { AskUserInput, AskUserType, CardAnswers, FieldInput, PageInput, UploadedFileValue } from "./types"
import type { PendingQuestion } from "../../../types"

/**
 * ask_user_question 交互卡片（mcp-ask-user-question.md §6，Phase 8）：
 * - 数据源为 tool part 的 state.input（模型调用参数），无需等待工具返回；
 * - 状态机：rendering（渲染可填写）→ awaiting（持有 requestID 可提交）
 *   → submitted | rejected（定格；定格后以只读摘要展示）；
 * - requestID 来自 question.asked 事件（取卡片渲染之后到达的第一条挂起请求，
 *   MVP 约束同会话单卡片串行，见文档 §7）。
 *
 * 校验门控（《设计规避：多形态表单卡片校验门控一致性》修复后）：
 * - 唯一真源 validateAnswersDetailed：覆盖 table 必填列、file 每文件 fileMeta、
 *   allowCustom 占位值（§3.1/§3.4/§3.5/§3.7）；
 * - 内联错误：当前页每个失败项在对应字段/单元格下红字提示（与门控同源派生）；
 * - 按钮保持点击校验 + 定位跳页（多页可跳转失败页），内联红字保证「为什么不放行」可自解释。
 */
export function AskUserCard({
  sessionId,
  part,
  input,
  pending,
}: {
  sessionId: string
  part: ToolPartLike
  input: AskUserInput
  /**
   * 该卡片绑定的挂起请求（T9：由 MessageList 锚点按 part→requestID 确定性解析，
   * 不再从全局单槽取"第一条"——同会话并发多卡片各持自己的 requestID，互不串扰）。
   * 缺省时卡片停留在 rendering（预绑定态），挂起到达后由 MessageList 重新挂载。
   */
  pending?: PendingQuestion
}) {
  const [phase, setPhase] = useState<"rendering" | "awaiting" | "submitted" | "rejected">(
    "rendering",
  )
  const [requestID, setRequestID] = useState<string | null>(null)
  const [values, setValues] = useState<CardAnswers>(() => collectDefaultValues(input))
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // 多页翻页：当前页索引（渲染层行为）。仅影响渲染层，不参与挂起状态机。
  const [pageIndex, setPageIndex] = useState(0)
  const lastIndex = input.pages.length - 1
  const isFirst = pageIndex === 0
  const isLast = pageIndex === lastIndex
  const currentPage = input.pages[pageIndex]!
  // file-download 页：提交前需先经后端下载端点取文件，全部成功才回传答案恢复 loop
  const isFileDownload = input.pages.some((p) => p.type === "file-download")
  const queryClient = useQueryClient()

  // 当前页完成度错误（唯一真源派生；实时内联红字 + 按钮门控依据）
  const pageErrors = useMemo(
    () => validateAnswersDetailed(input, values, { only: currentPage.id }),
    [input, values, currentPage],
  )

  // 关联挂起请求：question.asked 到达后卡片进入可提交状态（T9：requestID 由 pending prop 绑定）
  useEffect(() => {
    if (phase === "rendering" && pending) {
      setRequestID(pending.requestID)
      setPhase("awaiting")
    }
  }, [pending, phase])

  const setFieldValue = (pageId: string, fieldId: string, value: unknown) => {
    // 值变化即清除汇总错误：内联红字（pageErrors 实时派生）已可自解释「哪里没填对」
    setError(undefined)
    setValues((prev) => ({
      ...prev,
      [pageId]: { ...prev[pageId], [fieldId]: value },
    }))
  }

  // file-download 页勾选值即 option id（工作区相对路径，checkbox 以 id 为值）：
  // 收集全部 file-download 页的选中路径数组供下载端点使用
  const collectDownloadPaths = (): string[] => {
    const paths: string[] = []
    for (const page of input.pages) {
      if (page.type !== "file-download") continue
      for (const field of page.fields ?? []) {
        const v = values[page.id]?.[field.id]
        if (Array.isArray(v)) paths.push(...(v.filter((x): x is string => typeof x === "string")))
      }
    }
    return paths
  }

  const submit = async () => {
    if (!requestID || busy) return
    // 全量校验：拦截跳过中间页的情况，定位第一个失败的页并跳转过去（§6.5.1-5）
    let problem: string | undefined
    let failIndex = -1
    for (let i = 0; i < input.pages.length; i++) {
      problem = validateAnswers(input, values, { only: input.pages[i]!.id })
      if (problem) {
        failIndex = i
        break
      }
    }
    if (problem) {
      setError(problem)
      if (failIndex !== pageIndex) setPageIndex(failIndex)
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      // file-download：先经后端下载端点取文件（单文件原格式 / 多文件 zip），
      // 任一失败抛错 → 报错留卡不回传答案；全部成功才提交恢复 agent loop
      if (isFileDownload) {
        await downloadSessionFiles(sessionId, sessionDirectoryOf(sessionId), collectDownloadPaths())
      }
      await replyQuestion(sessionId, requestID, encodeAnswers(values), sessionDirectoryOf(sessionId))
      // 主动刷新消息缓存：SSE 丢事件时兜住 tool part 状态未同步（见 refreshMessagesAfterQuestionReply）
      refreshMessagesAfterQuestionReply(queryClient, sessionId)
      setPhase("submitted")
    } catch (e) {
      setError(`提交失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!requestID || busy) return
    setBusy(true)
    try {
      await rejectQuestion(sessionId, requestID, sessionDirectoryOf(sessionId))
    } catch {
      // 挂起请求可能已被 reject/清理（404）：同样按取消定格
    } finally {
      setBusy(false)
      refreshMessagesAfterQuestionReply(queryClient, sessionId)
      setPhase("rejected")
    }
  }

  // 多页翻页导航（§6.5.2）：下一步校验当前页必填，通过才前进；上一步不校验直接回退
  const goNext = () => {
    const problem = validateAnswers(input, values, { only: currentPage.id })
    if (problem) {
      setError(problem)
      return
    }
    setError(undefined)
    setPageIndex((i) => Math.min(i + 1, lastIndex))
  }

  const goBack = () => setPageIndex((i) => Math.max(i - 1, 0))

  const finalized = phase === "submitted" || phase === "rejected"

  return (
    <div className="ask-card" data-phase={phase} data-ask-type={currentPage.type}>
      <div className="ask-card-head">
        <Tag color="blue">交互问答</Tag>
        <span className="ask-card-title">{input.title}</span>
        {phase === "submitted" && <Tag color="green">已提交</Tag>}
        {phase === "rejected" && <Tag color="red">已取消</Tag>}
      </div>
      {input.question && <div className="ask-card-question">{input.question}</div>}

      {finalized ? (
        <pre className="ask-card-summary">{JSON.stringify(normalizeAnswers(values), null, 2)}</pre>
      ) : (
        <>
          <PageView
            key={currentPage.id}
            sessionId={sessionId}
            page={currentPage}
            type={currentPage.type}
            allowCustom={input.allowCustom ?? false}
            disabled={busy}
            values={values}
            errors={pageErrors}
            onChange={(fieldId, value) => setFieldValue(currentPage.id, fieldId, value)}
            onPageChange={(pageValues) => {
              // 值变化即清除汇总错误（同 setFieldValue 语义；table 行编辑走此路径）
              setError(undefined)
              setValues((prev) => ({ ...prev, [currentPage.id]: pageValues }))
            }}
          />
          {phase === "rendering" && (
            <Alert type="info" showIcon title="等待交互组件就绪，提交按钮稍后可用" />
          )}
          {error && <Alert type="warning" showIcon title={error} />}
          {input.pages.length > 1 && (
            <div className="ask-card-progress" aria-label={`第 ${pageIndex + 1} 页，共 ${input.pages.length} 页`}>
              第 {pageIndex + 1} / {input.pages.length} 页
            </div>
          )}
          <Space className="ask-card-actions">
            {!isFirst && (
              <Button
                size="small"
                aria-label="上一步"
                onClick={goBack}
                disabled={phase !== "awaiting" || busy}
              >
                上一步
              </Button>
            )}
            {isLast ? (
              <Button
                type="primary"
                size="small"
                aria-label={isFileDownload ? "确认下载" : "提交"}
                onClick={submit}
                disabled={phase !== "awaiting"}
                loading={busy}
              >
                {isFileDownload ? "确认下载" : "提交"}
              </Button>
            ) : (
              <Button
                type="primary"
                size="small"
                aria-label="下一步"
                onClick={goNext}
                disabled={phase !== "awaiting"}
              >
                下一步
              </Button>
            )}
            <Button
              size="small"
              aria-label="取消"
              onClick={cancel}
              disabled={phase !== "awaiting" || busy}
            >
              取消
            </Button>
          </Space>
        </>
      )}
      {/* 定格语义：completed 后以最终 input 定格；同一工具多次调用按各自 part 独立渲染 */}
      <span hidden aria-hidden data-part-id={part.id} />
    </div>
  )
}

/** 页渲染：fields 模式逐字段控件；table 模式行编辑（rowOps 控制增删与行数） */
function PageView({
  sessionId,
  page,
  type,
  allowCustom,
  disabled,
  values,
  errors,
  onChange,
  onPageChange,
}: {
  sessionId: string
  page: PageInput
  type: AskUserType
  allowCustom: boolean
  disabled: boolean
  values: CardAnswers
  errors: CompletionError[]
  onChange: (fieldId: string, value: unknown) => void
  onPageChange: (pageValues: Record<string, unknown>) => void
}) {
  const pageValues = values[page.id] ?? {}
  return (
    <div className="ask-card-page">
      <div className="ask-card-page-title">{page.title}</div>
      {page.question && <div className="ask-card-question">{page.question}</div>}
      {type === "table" ? (
        <TableEditor
          page={page}
          disabled={disabled}
          rows={(pageValues.__rows__ as Record<string, unknown>[] | undefined) ?? []}
          errors={errors}
          onChange={(rows) => onPageChange({ ...pageValues, __rows__: rows })}
        />
      ) : (
        (page.fields ?? []).map((field) => (
          <FieldView
            key={field.id}
            sessionId={sessionId}
            field={field}
            allowCustom={allowCustom}
            // file-download 页：checkbox 以 option id（工作区相对路径）为值，
            // 其余枚举控件沿用 label 为值（既有答案契约）
            valueById={type === "file-download"}
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
  )
}

/** 字段控件：widget → 宿主控件映射。
 * file 上传：经后端 POST /api/v1/sessions/:id/files 写入会话工作目录（路径安全由
 * resolveWorkspaceFile 保证），成功后在作答值中追加 { filename, bytes }——
 * encodeAnswers 随 values 一并回传模型（mcp-ask-user-question.md file-collect 场景）。
 * accept/maxSizeMB 约束来自 field.constraints（ask_user_question/schema.py）。
 * fileMeta：每个已传文件下方渲染元字段输入（§3.5 修复，值写入文件项的 meta）。
 * allowCustom：枚举字段追加「自定义」选项 + 自由文本（§3.4 修复，文本槽位为 `{id}__custom`）。
 */
function FieldView({
  sessionId,
  field,
  allowCustom,
  valueById,
  disabled,
  value,
  customValue,
  errors,
  onChange,
  onCustomChange,
}: {
  sessionId: string
  field: FieldInput
  allowCustom: boolean
  /** checkbox 以 option id 为值（file-download 路径选择），缺省用 label */
  valueById?: boolean
  disabled: boolean
  value: unknown
  customValue?: unknown
  errors: CompletionError[]
  onChange: (value: unknown) => void
  onCustomChange: (text: string) => void
}) {
  const { message } = AntdApp.useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [semanticOpen, setSemanticOpen] = useState(false)
  const options = field.options ?? []
  const files = Array.isArray(value) ? (value as UploadedFileValue[]) : []

  const isEnum = field.widget === "radio" || field.widget === "select"
  const showCustom = allowCustom && isEnum
  const isCustomSelected = value === CUSTOM_LABEL
  const customText = typeof customValue === "string" ? customValue : ""

  // 选文件（先按大小上限过滤）→ 弹语义框（语义由用户指定，服务端写入 .assets-uploads.md）
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (!selected || selected.length === 0) return
    const maxSizeMB = field.constraints?.maxSizeMB
    const accepted: File[] = []
    for (const file of Array.from(selected)) {
      if (maxSizeMB != null && file.size > maxSizeMB * 1024 * 1024) {
        message.error(`「${file.name}」超过大小上限 ${maxSizeMB}MB`)
        continue
      }
      accepted.push(file)
    }
    if (accepted.length === 0) return
    setPendingFiles(accepted)
    setSemanticOpen(true)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSemanticConfirm = async (semantic: string) => {
    setUploading(true)
    try {
      const uploaded: UploadedFileValue[] = []
      for (const file of pendingFiles) {
        const result = await uploadFileToWorkspace(
          sessionId,
          sessionDirectoryOf(sessionId),
          file,
          semantic,
        )
        uploaded.push(result)
      }
      if (uploaded.length > 0) {
        onChange([...files, ...uploaded])
        message.success(`已上传 ${uploaded.length} 个文件至工作目录`)
      }
      setSemanticOpen(false)
      setPendingFiles([])
    } catch (err) {
      message.error(`文件上传失败：${String(err)}`)
    } finally {
      setUploading(false)
    }
  }

  const setFileMeta = (fileIndex: number, metaId: string, metaValue: unknown) => {
    const next = files.map((f, i) =>
      i === fileIndex ? { ...f, meta: { ...(f.meta ?? {}), [metaId]: metaValue } } : f,
    )
    onChange(next)
  }

  const requiredErr = errors.find((e) => e.kind === "required")
  const customErr = errors.find((e) => e.kind === "custom-empty")
  const fileError = errors.find((e) => e.kind === "minCount" || e.kind === "maxCount")
  const metaErrors = (fileIndex: number) =>
    errors.find(
      (e): e is Extract<CompletionError, { kind: "file-meta" }> =>
        e.kind === "file-meta" && e.fileIndex === fileIndex,
    )

  return (
    <div className="ask-card-field">
      <label className="ask-card-field-label">
        {field.label}
        {field.required && <span className="ask-card-required">*</span>}
        {field.unit && <span className="ask-card-unit">{field.unit}</span>}
      </label>
      {field.description && (
        <div className="ask-card-field-desc">{field.description}</div>
      )}
      {field.widget === "radio" && (
        <Radio.Group
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <Space orientation="vertical">
            {options.map((o) => (
              <Radio key={o.id} value={o.label}>
                {o.label}
                {o.description && (
                  <span className="ask-card-option-desc"> · {o.description}</span>
                )}
              </Radio>
            ))}
            {showCustom && <Radio value={CUSTOM_LABEL}>{CUSTOM_LABEL}</Radio>}
          </Space>
        </Radio.Group>
      )}
      {field.widget === "checkbox" && (
        <Checkbox.Group
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          onChange={(v) => onChange(v)}
        >
          <Space orientation="vertical">
            {options.map((o) => (
              <Checkbox key={o.id} value={valueById ? o.id : o.label}>
                {o.label}
                {o.description && (
                  <span className="ask-card-option-desc"> · {o.description}</span>
                )}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      )}
      {field.widget === "select" && (
        <Select
          style={{ width: "100%" }}
          value={typeof value === "string" && value.length > 0 ? value : undefined}
          disabled={disabled}
          placeholder={field.hint ?? `请选择${field.label}`}
          options={[
            ...options.map((o) => ({ value: o.label, label: o.label })),
            ...(showCustom ? [{ value: CUSTOM_LABEL, label: CUSTOM_LABEL }] : []),
          ]}
          onChange={(v) => onChange(v)}
          allowClear
        />
      )}
      {showCustom && isCustomSelected && (
        <Input
          className="ask-card-custom-input"
          value={customText}
          disabled={disabled}
          placeholder="请输入自定义内容"
          onChange={(e) => onCustomChange(e.target.value)}
          aria-label={`${field.label}自定义内容`}
        />
      )}
      {field.widget === "number" && (
        <InputNumber
          style={{ width: "100%" }}
          value={typeof value === "number" ? value : null}
          disabled={disabled}
          min={field.constraints?.min ?? undefined}
          max={field.constraints?.max ?? undefined}
          placeholder={field.hint ?? undefined}
          onChange={(v) => onChange(v)}
        />
      )}
      {field.widget === "text" && (
        <Input
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          placeholder={field.hint ?? undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.widget === "textarea" && (
        <Input.TextArea
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          placeholder={field.hint ?? undefined}
          autoSize={{ minRows: 2, maxRows: 6 }}
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
            onChange={(e) => void handleFiles(e)}
            aria-label={`选择${field.label}文件`}
          />
          <Button
            size="small"
            icon={<UploadOutlined />}
            loading={uploading}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            {files.length > 0 ? `已选 ${files.length} 个文件` : "上传文件"}
          </Button>
          {field.constraints?.maxSizeMB != null && (
            <span className="ask-card-file-hint">上限 {field.constraints.maxSizeMB}MB</span>
          )}
          {files.length > 0 && (
            <div className="ask-card-file-list">
              {files.map((f) => (
                <Tag
                  key={f.filename}
                  closable={!disabled}
                  onClose={() => onChange(files.filter((x) => x.filename !== f.filename))}
                >
                  {f.filename}
                  {f.bytes > 0 && (
                    <span className="ask-card-file-bytes">
                      {" "}
                      {(f.bytes / 1024).toFixed(f.bytes >= 1024 * 1024 ? 1 : 0)}
                      {f.bytes >= 1024 * 1024 ? "MB" : "KB"}
                    </span>
                  )}
                </Tag>
              ))}
            </div>
          )}
          {field.fileMeta && field.fileMeta.length > 0 && files.length > 0 && (
            <div className="ask-card-file-meta">
              {files.map((f, fi) => (
                <div key={f.filename} className="ask-card-file-meta-item">
                  <span className="ask-card-file-meta-name">{f.filename}</span>
                  {field.fileMeta!.map((meta) => {
                    const metaErr = metaErrors(fi)?.metaId === meta.id ? metaErrors(fi) : undefined
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
                        {metaErr && (
                          <span className="ask-card-field-error">{metaErr.message}</span>
                        )}
                      </div>
                    )
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
      <AssetSemanticModal
        open={semanticOpen}
        fileNames={pendingFiles.map((f) => f.name)}
        confirmLoading={uploading}
        onCancel={() => {
          setSemanticOpen(false)
          setPendingFiles([])
        }}
        onConfirm={(semantic) => void handleSemanticConfirm(semantic)}
      />
    </div>
  )
}

/** fileMeta 元字段输入（text/number/select 与 FieldView 控件语义一致） */
function MetaInput({
  meta,
  disabled,
  value,
  onChange,
}: {
  meta: FieldInput
  disabled: boolean
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (meta.widget === "number") {
    return (
      <InputNumber
        size="small"
        style={{ width: "100%" }}
        value={typeof value === "number" ? value : null}
        disabled={disabled}
        min={meta.constraints?.min ?? undefined}
        max={meta.constraints?.max ?? undefined}
        onChange={onChange}
      />
    )
  }
  if (meta.widget === "select") {
    return (
      <Select
        size="small"
        style={{ width: "100%" }}
        value={typeof value === "string" && value.length > 0 ? value : undefined}
        disabled={disabled}
        options={(meta.options ?? []).map((o) => ({ value: o.label, label: o.label }))}
        onChange={onChange}
        allowClear
      />
    )
  }
  return (
    <Input
      size="small"
      value={typeof value === "string" ? value : undefined}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** table 行编辑：每行按 columns 渲染输入框，rowOps 控制增删与行数约束 */
function TableEditor({
  page,
  disabled,
  rows,
  errors,
  onChange,
}: {
  page: PageInput
  disabled: boolean
  rows: Record<string, unknown>[]
  errors: CompletionError[]
  onChange: (rows: Record<string, unknown>[]) => void
}) {
  const columns = useMemo(() => page.columns ?? [], [page.columns])
  const rowOps = page.rowOps
  const minRows = rowOps?.minRows ?? 1
  const maxRows = rowOps?.maxRows ?? undefined

  useEffect(() => {
    // 初始行数未达 minRows 时补空行（table 页无 defaultValue 语义）
    if (rows.length < minRows) {
      onChange(Array.from({ length: minRows }, () => ({})))
    }
    // 仅初始化时补齐
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setCell = (rowIndex: number, colId: string, value: unknown) => {
    const next = rows.map((row, i) => (i === rowIndex ? { ...row, [colId]: value } : row))
    onChange(next)
  }

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
        <div key={i} className="ask-card-table-row">
          {columns.map((col) => {
            const cellErr = errors.find(
              (e) =>
                e.kind === "table-cell" && e.rowIndex === i && e.colId === col.id,
            )
            return (
              <span key={col.id} className="ask-card-table-cell">
                {col.widget === "number" ? (
                  <InputNumber
                    size="small"
                    style={{ width: "100%" }}
                    status={cellErr ? "error" : undefined}
                    value={typeof row[col.id] === "number" ? (row[col.id] as number) : null}
                    disabled={disabled}
                    min={col.constraints?.min ?? undefined}
                    max={col.constraints?.max ?? undefined}
                    onChange={(v) => setCell(i, col.id, v)}
                  />
                ) : (
                  <Input
                    size="small"
                    status={cellErr ? "error" : undefined}
                    value={typeof row[col.id] === "string" ? (row[col.id] as string) : undefined}
                    disabled={disabled}
                    onChange={(e) => setCell(i, col.id, e.target.value)}
                  />
                )}
                {cellErr && <span className="ask-card-cell-error">{cellErr.message}</span>}
              </span>
            )
          })}
          {rowOps?.allowDelete !== false && rows.length > minRows && (
            <Button
              size="small"
              type="text"
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              删
            </Button>
          )}
        </div>
      ))}
      {rowOps?.allowAdd !== false && (maxRows === undefined || rows.length < maxRows) && (
        <Button
          size="small"
          type="dashed"
          block
          disabled={disabled}
          onClick={() => onChange([...rows, {}])}
        >
          添加一行
        </Button>
      )}
    </div>
  )
}
