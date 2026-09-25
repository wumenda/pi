import { useEffect, useMemo, useRef, useState } from "react"
import { App as AntdApp, Button, Tag } from "antd"
import { useQuery } from "@tanstack/react-query"
import { BulbOutlined, CheckOutlined, CopyOutlined } from "@ant-design/icons"
import { isToolPart, textPartsOf, type ToolPartLike } from "../../api/events"
import { useAppStore, sessionDirectoryOf } from "../../stores/app-store"
import { fetchMessages } from "../../api/messages"
import type { MessageDTO } from "@platform/shared"
import type { PendingQuestion } from "../../types"
import { StateEmpty } from "../../components/StateViews"
import { ToolCard } from "./ToolCard"
import { TaskCard } from "./TaskCard"
import { useTranslation } from "../../i18n"
import {
  diagnoseAskUserInput,
  isAskUserTool,
  isPlaceholderQuestions,
  QUESTION_TOOL_NAME,
} from "./cards/answers"
import { AskUserCard } from "./cards/AskUserCard"
import { AskUserRetryCard } from "./cards/AskUserRetryCard"
import { QuestionCard } from "./cards/QuestionCard"
import { PermissionCard } from "./cards/PermissionCard"
import { isNearBottom } from "./scroll"

/** 一个挂起请求在消息流中的锚点（part → requestID 的确定性绑定，T9） */
export interface AskAnchor {
  partId: string
  requestID: string
  /** 锚定的卡片类型：ask_user 占位流（AskUserCard/Retry）或原生 question 流（QuestionCard） */
  kind: "ask" | "question"
}

/**
 * 解析各挂起请求（requestID）应锚定的交互卡片 part（T9：request-scoped，多请求不串）：
 * - 每个 pending 独立成锚点——同会话并发多个 ask_user/question 互不串扰；
 * - 按确定性优先级绑定（阻止同消息多 part 时 messageID 弱匹配造成错绑）：
 *     ① callID 精确命中（发起调用的那个 part）；
 *     ② messageID 精确且候选唯一；
 *     ③ 回退最近未认领同类 part（keep MVP 串行兼容，缺 tool 字段时仍能弹卡）。
 * - ask_user 占位流只认 ask part；原生 question 流只认 running question part。
 */
function resolveAskAnchors(
  messages: MessageDTO[],
  pendingByRequest: Record<string, PendingQuestion>,
): AskAnchor[] {
  const anchors: AskAnchor[] = []
  const claimed = new Set<string>()

  interface Candidate {
    part: ToolPartLike
    kind: AskAnchor["kind"]
  }
  // 倒序收集候选 part（"最近优先"用于回退）
  const candidates: Candidate[] = []
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    for (const part of [...messages[mi]!.parts].reverse()) {
      if (!isToolPart(part)) continue
      const toolPart = part as ToolPartLike
      if (isAskUserTool(toolPart.tool)) {
        candidates.push({ part: toolPart, kind: "ask" })
      } else if (toolPart.tool === QUESTION_TOOL_NAME && toolPart.state.status === "running") {
        candidates.push({ part: toolPart, kind: "question" })
      }
    }
  }

  const callIDOf = (p: ToolPartLike): unknown => (p as ToolPartLike & { callID?: unknown }).callID
  const messageIDOf = (p: ToolPartLike): unknown =>
    (p as ToolPartLike & { messageID?: unknown }).messageID

  for (const q of Object.values(pendingByRequest)) {
    const kind: AskAnchor["kind"] = isPlaceholderQuestions(q.questions) ? "ask" : "question"
    const free = candidates.filter((c) => c.kind === kind && !claimed.has(c.part.id))

    let hit: Candidate | undefined = undefined
    // ① callID 精确
    if (q.tool?.callID !== undefined) {
      hit = free.find((c) => callIDOf(c.part) === q.tool?.callID)
    }
    // ② messageID 精确（候选唯一时才用；多候选时保持候选序 = 最近未认领，串行兼容）
    if (!hit && q.tool?.messageID !== undefined) {
      const byMsg = free.filter((c) => messageIDOf(c.part) === q.tool?.messageID)
      if (byMsg.length > 0) hit = byMsg[0]
    }
    // ③ 回退最近未认领同类 part（缺 tool 字段的兼容路径）
    if (!hit) hit = free[0]

    if (hit) {
      anchors.push({ partId: hit.part.id, requestID: q.requestID, kind })
      claimed.add(hit.part.id)
    }
  }
  return anchors
}

/** 已知但不渲染的内部 part（step 边界/快照/diff 补丁/agent 切换等噪音） */
const SILENT_PART_TYPES = new Set([
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "file",
])

/** error part 的可读文本提取（常见承载位：message / text / data.message） */
function errorPartText(part: unknown): string {
  const p = part as {
    message?: unknown
    text?: unknown
    data?: { message?: unknown }
  }
  for (const c of [p.message, p.text, p.data?.message]) {
    if (typeof c === "string" && c.trim().length > 0) return c
  }
  return ""
}

/** 用户消息复制按钮：写入剪贴板，成功后短暂显示"已复制" */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { message } = AntdApp.useApp()

  return (
    <Button
      size="small"
      type="text"
      className="message-copy"
      aria-label={copied ? "已复制" : "复制消息"}
      icon={copied ? <CheckOutlined /> : <CopyOutlined />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch (e) {
          message.error(`复制失败：${String(e)}`)
        }
      }}
    />
  )
}

/** 消息是否含可见内容（非空文本/reasoning 或 tool part）；否则视为"响应生成中" */
function hasVisibleContent(message: MessageDTO): boolean {
  return message.parts.some((part) => {
    const type = (part as { type?: unknown }).type
    if (type === "text" || type === "reasoning") {
      return ((part as { text?: string }).text ?? "").trim().length > 0
    }
    return isToolPart(part)
  })
}

/** 三点加载指示（动态光效）：替代响应生成中的空气泡 */
function TypingIndicator() {
  return (
    <div className="message-row message-row-assistant">
      <div className="message-content">
        <div className="message-body">
          <div
            className="message-bubble message-bubble-assistant typing-bubble"
            role="status"
            aria-label="AI 正在输入"
          >
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 思考过程折叠块：默认折叠，点击展开（导出供 TaskCard 内嵌 subagent 视图复用） */
export function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="message-reasoning">
      <button
        className="reasoning-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <BulbOutlined className="reasoning-icon" />
        <span className="reasoning-label">{expanded ? "收起思考" : "已折叠思考"}</span>
      </button>
      {expanded && <div className="reasoning-text">{text}</div>}
    </div>
  )
}

/** 文本块：超过 5 行时折叠，点击展开剩余部分 */
function TextBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    if (!expanded && ref.current) {
      setClamped(ref.current.scrollHeight > ref.current.clientHeight)
    }
  }, [text, expanded])

  return (
    <div className="message-text">
      <div ref={ref} className={expanded ? "message-text-full" : "message-text-clamp"}>
        {text}
      </div>
      {clamped && (
        <button
          className="text-toggle"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  )
}

/** 单条消息：扁平列表展示（无气泡），每种 part 类型独立渲染 */
function MessageBubble({
  message,
  sessionId,
  anchors,
  pendingByRequest,
  streaming,
}: {
  message: MessageDTO
  sessionId: string
  anchors: AskAnchor[]
  pendingByRequest: Record<string, PendingQuestion>
  streaming: boolean
}) {
  const { t } = useTranslation()
  // 助手消息无可见内容且仍在流式生成 → 三点加载指示。
  // 注意：必须依赖 streaming 判定——abort 后空消息（无任何 part）若不加此条件会永远显示 loading。
  if (message.role === "assistant" && !hasVisibleContent(message) && streaming) {
    return <TypingIndicator />
  }

  // 有文本的用户消息：提供复制按钮（悬浮行显示）
  const userText =
    message.role === "user" ? textPartsOf(message.parts) : ""

  return (
    <div className={`message-row message-row-${message.role}`}>
      <div className="message-content">
        <div className="message-body">
          {message.parts.map((part, i) => {
            const type = (part as { type?: unknown }).type
            if (type === "text") {
              const text = (part as { text?: string }).text ?? ""
              if (text.trim().length === 0) return null
              return <TextBlock key={i} text={text} />
            }
            if (type === "reasoning") {
              const text = (part as { text?: string }).text ?? ""
              if (text.trim().length === 0) return null
              return <ReasoningBlock key={i} text={text} />
            }
            if (type === "subtask") {
              const p = part as { description?: unknown; agent?: unknown }
              return (
                <div key={i} className="subtask-note">
                  <Tag color="purple">启动 Subagent</Tag>
                  <span>
                    {typeof p.description === "string" && p.description.length > 0
                      ? p.description
                      : "subagent 任务"}
                    {typeof p.agent === "string" && p.agent.length > 0 ? ` · ${p.agent}` : ""}
                  </span>
                </div>
              )
            }
            if (isToolPart(part)) {
              const toolPart = part as ToolPartLike
              if (toolPart.tool === "task") {
                return <TaskCard key={i} sessionId={sessionId} part={toolPart} />
              }
              const anchor = anchors.find((a) => a.partId === toolPart.id)
              if (isAskUserTool(toolPart.tool)) {
                const diagnosed = diagnoseAskUserInput(toolPart.state.input)
                if (anchor) {
                  // ask 锚点 part：契约合法 → 正常卡片；契约非法 → 错误卡片（§8，可编辑重发/让模型重试）。
                  // requestID 由锚点确定性绑定（T9），两路卡片各持自己的挂起点，并发不串。
                  const pending = pendingByRequest[anchor.requestID]
                  if (diagnosed.ok) {
                    return (
                      <AskUserCard
                        key={i}
                        sessionId={sessionId}
                        part={toolPart}
                        input={diagnosed.input}
                        pending={pending}
                      />
                    )
                  }
                  return (
                    <AskUserRetryCard
                      key={i}
                      sessionId={sessionId}
                      part={toolPart}
                      reason={diagnosed.reason}
                      raw={diagnosed.raw}
                      pending={pending}
                    />
                  )
                }
                return <ToolCard key={i} part={toolPart} />
              }
              if (anchor && anchor.kind === "question") {
                const pending = pendingByRequest[anchor.requestID]
                if (pending) {
                  return <QuestionCard key={i} sessionId={sessionId} pending={pending} />
                }
              }
              return <ToolCard key={i} part={toolPart} />
            }
            if (typeof type === "string" && SILENT_PART_TYPES.has(type)) {
              return null // 内部噪音 part：静默跳过
            }
            if (type === "error") {
              // 错误 part：可见占位（不再静默吞掉），提取可读 message
              const text = errorPartText(part)
              return (
                <div key={i} className="message-part-error" role="alert">
                  {text.length > 0 ? t("chat.partError", { message: text }) : t("chat.execError")}
                </div>
              )
            }
            if (typeof type === "string" && type.length > 0) {
              // 未知 part 类型：可见占位，避免内容被静默丢弃而无痕迹
              return (
                <div key={i} className="message-part-unknown">
                  {t("chat.unknownPart", { type })}
                </div>
              )
            }
            return null // 缺失 type 的畸形 part：无从展示，维持静默
          })}
          {userText.trim().length > 0 && <CopyButton text={userText} />}
        </div>
      </div>
    </div>
  )
}

/** 消息流（布局文档 4.1）：历史经 React Query，增量由 SSE 更新缓存；智能滚动 */
export function MessageList({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [hasUnread, setHasUnread] = useState(false)

  const {
    data: messages = [],
    isError,
    refetch,
  } = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => fetchMessages(sessionId, sessionDirectoryOf(sessionId)),
  })

  // question 挂起请求（request-scoped：question.asked 按 requestID 置入；replied/rejected 按 id 清除）
  // 与交互卡片锚点（每个 pending 独立锚点，T9：同会话并发多请求不串）
  const pendingByRequest = useAppStore((s) => s.pendingQuestions)
  const pendingPermission = useAppStore((s) => s.pendingPermission)
  const anchors = useMemo(
    () => resolveAskAnchors(messages, pendingByRequest),
    [messages, pendingByRequest],
  )

  // 发送后等待首个响应：最后一条为用户消息且流未结束 → 末尾三点加载指示
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const waitingForReply =
    streamingSessionId === sessionId &&
    messages[messages.length - 1]?.role === "user"

  // 渲染时过滤历史空 assistant 消息（abort 残留的空壳，无任何 part）。
  // 仅保留"streaming 中追加到末尾的那条空消息"（即当前正在生成的），
  // 避免之前 abort 留下的空消息在每次发送时都显示三点 loading。
  const streaming = streamingSessionId === sessionId
  const visibleMessages = messages.filter(
    (m, i) =>
      m.role !== "assistant" ||
      m.parts.length > 0 ||
      (streaming && i === messages.length - 1),
  )

  // 会话切换时重置滚动状态
  useEffect(() => {
    stickToBottom.current = true
    setHasUnread(false)
  }, [sessionId])

  // 新消息/权限请求/等待态变化：位于底部附近则自动滚动，否则显示"有新消息"浮标
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    } else {
      setHasUnread(true)
    }
  }, [messages, pendingPermission, waitingForReply])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    stickToBottom.current = isNearBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    )
    if (stickToBottom.current) setHasUnread(false)
  }

  const scrollToBottom = () => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickToBottom.current = true
    setHasUnread(false)
  }

  return (
    <div className="message-list-wrap">
      <div
        ref={containerRef}
        className="message-list"
        onScroll={handleScroll}
        data-session-id={sessionId}
      >
        {isError ? (
          // 首屏加载失败 ≠ 空会话：给出错误与重试，避免用户误以为会话内容丢失
          <div className="message-load-error" role="alert">
            <span>{t("chat.messagesLoadFailed")}</span>
            <Button
              size="small"
              autoInsertSpace={false}
              onClick={() => void refetch()}
            >
              {t("chat.retry")}
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <StateEmpty className="message-empty" title={t("chat.empty")} />
        ) : (
          <>
            {visibleMessages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                sessionId={sessionId}
                anchors={anchors}
                pendingByRequest={pendingByRequest}
                streaming={streamingSessionId === sessionId}
              />
            ))}
            {waitingForReply && <TypingIndicator />}
          </>
        )}
        <PermissionCard sessionId={sessionId} />
      </div>
      {hasUnread && (
        <Button
          className="message-unread-fab"
          size="small"
          onClick={scrollToBottom}
        >
          {t("chat.newMessages")}
        </Button>
      )}
    </div>
  )
}
