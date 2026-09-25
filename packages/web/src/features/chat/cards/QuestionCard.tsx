import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, Button, Checkbox, Input, Radio, Space, Tag } from "antd"
import { replyQuestion, rejectQuestion } from "../../../api/questions"
import { useAppStore, sessionDirectoryOf } from "../../../stores/app-store"
import { isAnswerBlank, refreshMessagesAfterQuestionReply } from "./answers"
import type { PendingQuestion } from "../../../types"

/**
 * 兜底交互卡片：agent 未经 ask_user_question、直接调用原生 question 工具时，
 * 以 question.asked 事件携带的 questions 数据渲染（opencode QuestionV1.Prompt 契约）。
 * 提交答案为每题选中 label 数组（有自定义输入时为其文本），与 question reply 契约
 * （QuestionV1.Reply，每题一组字符串）一致；提交/取消后清除 pendingQuestion，
 * 卡片回落为普通工具卡片，结果由 question 工具的 part output 展示。
 */
export function QuestionCard({
  sessionId,
  pending,
  onResolved,
}: {
  sessionId: string
  pending: PendingQuestion
  /** 回复/取消后的回调（默认清空父会话 pendingQuestion；子会话卡片传入清空子会话槽位） */
  onResolved?: () => void
}) {
  const [selected, setSelected] = useState<string[][]>(() =>
    pending.questions.map(() => []),
  )
  const [customs, setCustoms] = useState<string[]>(() =>
    pending.questions.map(() => ""),
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const setAnswer = (qi: number, answer: string[]) =>
    setSelected((prev) => prev.map((a, i) => (i === qi ? answer : a)))
  const setCustom = (qi: number, text: string) =>
    setCustoms((prev) => prev.map((t, i) => (i === qi ? text : t)))

  const resolve = () => {
    if (onResolved) onResolved()
    else useAppStore.getState().clearPendingQuestion(pending.requestID)
  }

  const submit = async () => {
    if (busy) return
    const answers = pending.questions.map((_, qi) => {
      const text = (customs[qi] ?? "").trim()
      if (text.length > 0) return [text]
      return selected[qi] ?? []
    })
    // 判空与 ask_user 卡片共用同一真源 isAnswerBlank（《设计规避》§3.1，禁止各自内联判空）
    const emptyIndex = answers.findIndex((a) => isAnswerBlank(a))
    if (emptyIndex >= 0) {
      const q = pending.questions[emptyIndex]!
      setError(`「${q.header || `问题 ${emptyIndex + 1}`}」尚未作答`)
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      await replyQuestion(sessionId, pending.requestID, answers, sessionDirectoryOf(sessionId))
      // 主动刷新消息缓存：SSE 丢事件时兜住工具卡片「执行中」不回落（见 refreshMessagesAfterQuestionReply）
      refreshMessagesAfterQuestionReply(queryClient, sessionId)
      resolve()
    } catch (e) {
      setError(`提交失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (busy) return
    setBusy(true)
    try {
      await rejectQuestion(sessionId, pending.requestID)
    } catch {
      // 挂起请求可能已被 reject/清理（404）：同样按取消回落
    } finally {
      setBusy(false)
      refreshMessagesAfterQuestionReply(queryClient, sessionId)
      resolve()
    }
  }

  return (
    <div className="ask-card" data-phase="awaiting" data-ask-type="question">
      <div className="ask-card-head">
        <Tag color="blue">交互问答</Tag>
        <span className="ask-card-title">
          {pending.questions[0]?.header || "用户确认"}
        </span>
      </div>
      {pending.questions.map((q, qi) => (
        <div key={qi} className="ask-card-field">
          <label className="ask-card-field-label">
            {q.header || `问题 ${qi + 1}`}
            <span className="ask-card-required">*</span>
          </label>
          <div className="ask-card-question">{q.question}</div>
          {q.multiple ? (
            <Checkbox.Group
              value={selected[qi] ?? []}
              disabled={busy}
              onChange={(v) => setAnswer(qi, v as string[])}
            >
              <Space orientation="vertical">
                {q.options.map((o) => (
                  <Checkbox key={o.label} value={o.label}>
                    {o.label}
                    {o.description && (
                      <span className="ask-card-option-desc"> · {o.description}</span>
                    )}
                  </Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          ) : (
            <Radio.Group
              value={selected[qi]?.[0]}
              disabled={busy}
              onChange={(e) => setAnswer(qi, [e.target.value])}
            >
              <Space orientation="vertical">
                {q.options.map((o) => (
                  <Radio key={o.label} value={o.label}>
                    {o.label}
                    {o.description && (
                      <span className="ask-card-option-desc"> · {o.description}</span>
                    )}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          )}
          {q.custom !== false && (
            <Input.TextArea
              value={customs[qi] ?? ""}
              disabled={busy}
              placeholder="或输入自定义回答（填写后将忽略上方选项）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={(e) => setCustom(qi, e.target.value)}
            />
          )}
        </div>
      ))}
      {error && <Alert type="warning" showIcon title={error} />}
      <Space className="ask-card-actions">
        <Button
          type="primary"
          size="small"
          aria-label="提交"
          onClick={submit}
          loading={busy}
        >
          提交
        </Button>
        <Button size="small" aria-label="取消" onClick={cancel} disabled={busy}>
          取消
        </Button>
      </Space>
    </div>
  )
}
