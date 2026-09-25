import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, Button, Input, Space, Tag } from "antd"
import { replyQuestion, rejectQuestion } from "../../../api/questions"
import { callMcpTool, fetchMcpTools, matchMcpTool } from "../../../api/tools"
import { sessionDirectoryOf } from "../../../stores/app-store"
import type { ToolPartLike } from "../../../api/events"
import type { PendingQuestion } from "../../../types"
import { diagnoseAskUserInput, refreshMessagesAfterQuestionReply, type ParseFailReason } from "./answers"
import { AskUserCard } from "./AskUserCard"
import type { AskUserInput } from "./types"

/**
 * ask_user 校验失败兜底卡片（mcp-ask-user-question.md §7，方案 A）：
 * - 模型传入的 ask_user_question 参数无法渲染成交互卡片时，由 MessageList 渲染本组件，
 *   而不是静默降级为普通工具卡片（交互被吞）；
 * - 展示失败原因 + 可编辑参数摘要，两条恢复路径：
 *   ①「编辑参数重发」：host 直接重调（不依赖模型）——预检 + server 校验通过后，
 *      直接用修正后的参数渲染正常 AskUserCard，并**复用当前挂起点 requestID**
 *      （用户修正后作答即回复原挂起点，agent loop 恢复，无需重走两阶段）；
 *   ②「让模型重试」：把失败诊断作为 answer 回传挂起点，模型重新生成一次调用（§8.5）；
 * - 状态机与 AskUserCard 对齐：rendering → awaiting（持有 requestID 可操作）
 *   → submitted | rejected（定格）。
 */
export function AskUserRetryCard({
  sessionId,
  part,
  reason,
  raw,
  pending,
}: {
  sessionId: string
  part: ToolPartLike
  reason: ParseFailReason
  raw: unknown
  /** 该卡片绑定的挂起请求（T9：由 MessageList 锚点确定性解析，多挂起并发不串） */
  pending?: PendingQuestion
}) {
  const [phase, setPhase] = useState<"rendering" | "awaiting" | "submitted" | "rejected">(
    "rendering",
  )
  const [requestID, setRequestID] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [edited, setEdited] = useState(() => JSON.stringify(raw, null, 2))
  // 编辑重发成功后：直接用修正参数渲染正常卡片（复用当前挂起点 requestID）
  const [correctedInput, setCorrectedInput] = useState<AskUserInput | null>(null)
  const queryClient = useQueryClient()

  // 关联挂起请求：question.asked 到达后卡片进入可操作状态（T9：requestID 由 pending prop 绑定）
  useEffect(() => {
    if (phase === "rendering" && pending) {
      setRequestID(pending.requestID)
      setPhase("awaiting")
    }
  }, [pending, phase])

  // not-object 极端缺失：无法展示/编辑参数，隐藏编辑入口（§8.6 极端缺失降级）
  const canEdit = reason !== "not-object"

  const reasonText = useMemo(
    () =>
      ({
        "not-object": "模型传入的参数不是合法对象，无法渲染交互卡片",
        "missing-title": "缺少主标题 title（title 不能为空）",
        "bad-pages": "页面 pages 缺失或结构非法（需至少一个含 id 与 title 的页面）",
        "page-missing-type": "页面缺少必填的交互类型 type",
        "page-bad-type":
          "页面 type 不受支持（支持：list-single / list-multi / form / table / dropdown / file-collect / file-download）",
      }) as Record<ParseFailReason, string>,
    [],
  )[reason]

  /**
   * 编辑参数重发（§8.4，host 直接重调）：
   * 本地预检（JSON 语法 + 结构契约）→ callMcpTool 走 server 严格校验 →
   * 通过后用修正参数渲染 AskUserCard，复用当前挂起点 requestID。
   */
  const resend = async () => {
    if (!requestID || busy) return
    let parsed: unknown
    try {
      parsed = JSON.parse(edited)
    } catch {
      setError("参数不是合法 JSON，请检查后重试")
      return
    }
    const diagnosed = diagnoseAskUserInput(parsed)
    if (!diagnosed.ok) {
      setError(`参数仍不符合要求：${reasonTextOf(diagnosed.reason)}`)
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      // 复用 MCP Apps tools/call 反向通道：让 server 侧（pydantic 严格 schema）校验修正参数。
      // A1 修复：/mcp-tools/call 要求 serverId 必带（G4）——按 opencode 调用名（如
      // mcp-apps-ui-example_ask_user_question）反查工具清单定位归属 server；sessionId 与
      // iframe 宿主桥（pipeline.ts tools/call）同形状，注入会话工作区 capability。
      const tools = await fetchMcpTools()
      const serverId = matchMcpTool(part.tool, tools)?.serverId
      if (!serverId) {
        setError("无法定位该工具所属的 MCP server，请改用「让模型重试」")
        return
      }
      await callMcpTool("ask_user_question", diagnosed.input as unknown as Record<string, unknown>, {
        serverId,
        sessionId,
      })
      // 校验通过：直接渲染正常卡片，用户作答回复原挂起点（复用 requestID，不 reject）
      setCorrectedInput(diagnosed.input)
    } catch (e) {
      setError(`参数未通过服务端校验：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 让模型重试（§8.5）：把失败诊断作为 answer 回传挂起点，模型将重新生成一次调用 */
  const retryByModel = async () => {
    if (!requestID || busy) return
    setBusy(true)
    try {
      await replyQuestion(
        sessionId,
        requestID,
        [[JSON.stringify({ outcome: "card_parse_failed", reason, originalInput: raw })]],
        sessionDirectoryOf(sessionId),
      )
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

  // 编辑重发成功：直接渲染修正后的正常卡片（复用同一挂起点）
  if (correctedInput) {
    return (
      <AskUserCard sessionId={sessionId} part={part} input={correctedInput} pending={pending} />
    )
  }

  const finalized = phase === "submitted" || phase === "rejected"

  return (
    <div className="ask-card" data-phase={phase} data-ask-type="retry">
      <div className="ask-card-head">
        <Tag color="orange">卡片渲染失败</Tag>
        <span className="ask-card-title">无法渲染交互卡片</span>
        {phase === "submitted" && <Tag color="green">已处理</Tag>}
        {phase === "rejected" && <Tag color="red">已取消</Tag>}
      </div>

      <Alert type="warning" showIcon title={reasonText} />

      {finalized ? (
        <pre className="ask-card-summary">{edited}</pre>
      ) : (
        <>
          {canEdit && (
            <>
              <div className="ask-card-field-desc">
                以下是模型传入的原始参数，可直接编辑后重发：
              </div>
              <Input.TextArea
                className="ask-card-retry-editor"
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
                autoSize={{ minRows: 4, maxRows: 10 }}
                disabled={busy}
                aria-label="可编辑参数"
              />
            </>
          )}
          {phase === "rendering" && (
            <Alert type="info" showIcon title="等待交互组件就绪，操作按钮稍后可用" />
          )}
          {error && <Alert type="warning" showIcon title={error} />}
          <Space className="ask-card-actions">
            {canEdit && (
              <Button
                type="primary"
                size="small"
                aria-label="编辑参数重发"
                onClick={resend}
                disabled={phase !== "awaiting"}
                loading={busy}
              >
                编辑参数重发
              </Button>
            )}
            <Button
              size="small"
              aria-label="让模型重试"
              onClick={retryByModel}
              disabled={phase !== "awaiting" || busy}
            >
              让模型重试
            </Button>
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
      <span hidden aria-hidden data-part-id={part.id} />
    </div>
  )
}

/** 诊断原因的短文案（编辑重发预检失败时提示用） */
function reasonTextOf(reason: ParseFailReason): string {
  const map: Record<ParseFailReason, string> = {
    "not-object": "参数不是合法对象",
    "missing-title": "title 缺失或为空",
    "bad-pages": "pages 缺失或结构非法",
    "page-missing-type": "某页缺少必填的 type",
    "page-bad-type": "某页 type 不受支持（不在 7 种预设）",
  }
  return map[reason]
}
