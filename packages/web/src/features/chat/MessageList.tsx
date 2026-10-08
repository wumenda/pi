import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
} from "./cards/answers"
import { AskUserCard } from "./cards/AskUserCard"
import { AskUserRetryCard } from "./cards/AskUserRetryCard"
import { QuestionCard } from "./cards/QuestionCard"
import { PermissionCard } from "./cards/PermissionCard"
import { isNearBottom } from "./scroll"
import { resolveAskAnchors, type AskAnchor } from "./ask-anchors"
import { shouldExpandWindow, windowedSlice, WINDOW_INIT, WINDOW_STEP } from "./message-window"

/** 已知但不渲染的内部 part（step 边界/快照/diff 补丁/agent 切换等噪音） */
const SILENT_PART_TYPES = new Set([
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "file",
])

// ---- T2.8-6 条件窗口化（常量与切片/扩窗判定见 ./message-window） ----

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

/** 单条消息：扁平列表展示（无气泡），每种 part 类型独立渲染。
 * memo + 投影层引用记忆化：流式期间只有正在更新的消息重渲染，历史消息跳过。 */
const MessageBubble = memo(function MessageBubble({
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
            // tool part 有稳定 id（callID）；其余按 type+序号（part 列表为追加式，中段稳定）
            const partKey = isToolPart(part)
              ? ((part as ToolPartLike).id as string | undefined) ?? `tool-${i}`
              : `${String(type ?? "part")}-${i}`
            if (type === "text") {
              const text = (part as { text?: string }).text ?? ""
              if (text.trim().length === 0) return null
              return <TextBlock key={partKey} text={text} />
            }
            if (type === "reasoning") {
              const text = (part as { text?: string }).text ?? ""
              if (text.trim().length === 0) return null
              return <ReasoningBlock key={partKey} text={text} />
            }
            if (type === "subtask") {
              const p = part as { description?: unknown; agent?: unknown }
              return (
                <div key={partKey} className="subtask-note">
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
                return <TaskCard key={partKey} sessionId={sessionId} part={toolPart} />
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
                        key={partKey}
                        sessionId={sessionId}
                        part={toolPart}
                        input={diagnosed.input}
                        pending={pending}
                      />
                    )
                  }
                  return (
                    <AskUserRetryCard
                      key={partKey}
                      sessionId={sessionId}
                      part={toolPart}
                      reason={diagnosed.reason}
                      raw={diagnosed.raw}
                      pending={pending}
                    />
                  )
                }
                return <ToolCard key={partKey} part={toolPart} />
              }
              if (anchor && anchor.kind === "question") {
                const pending = pendingByRequest[anchor.requestID]
                if (pending) {
                  return <QuestionCard key={partKey} sessionId={sessionId} pending={pending} />
                }
              }
              return <ToolCard key={partKey} part={toolPart} />
            }
            if (typeof type === "string" && SILENT_PART_TYPES.has(type)) {
              return null // 内部噪音 part：静默跳过
            }
            if (type === "error") {
              // 错误 part：可见占位（不再静默吞掉），提取可读 message
              const text = errorPartText(part)
              return (
                <div key={partKey} className="message-part-error" role="alert">
                  {text.length > 0 ? t("chat.partError", { message: text }) : t("chat.execError")}
                </div>
              )
            }
            if (typeof type === "string" && type.length > 0) {
              // 未知 part 类型：可见占位，避免内容被静默丢弃而无痕迹
              return (
                <div key={partKey} className="message-part-unknown">
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
})

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
  // anchors 引用稳定化：投影记忆化后 messages 元素引用稳定但数组引用每 token 新建，
  // 直接依赖会让 anchors 每 token 重建、击穿 MessageBubble 的 memo。
  // 元素逐项引用相等 → 复用上次数组。
  const anchorsRef = useRef<AskAnchor[]>([])
  const anchors = useMemo(() => {
    const next = resolveAskAnchors(messages, pendingByRequest)
    const previous = anchorsRef.current
    const same =
      previous.length === next.length &&
      previous.every((anchor, i) => {
        const candidate = next[i]!
        return (
          anchor.partId === candidate.partId &&
          anchor.requestID === candidate.requestID &&
          anchor.kind === candidate.kind
        )
      })
    if (same) return previous
    anchorsRef.current = next
    return next
  }, [messages, pendingByRequest])

  // 发送后等待首个响应：最后一条为用户消息且流未结束 → 末尾三点加载指示
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const waitingForReply =
    streamingSessionId === sessionId &&
    messages[messages.length - 1]?.role === "user"

  // 渲染时过滤历史空 assistant 消息（abort 残留的空壳，无任何 part）。
  // 仅保留"streaming 中追加到末尾的那条空消息"（即当前正在生成的），
  // 避免之前 abort 留下的空消息在每次发送时都显示三点 loading。
  // T2.8-4 游标化：memo 化避免每次渲染 O(n) filter（仅 messages/streaming 变化时重算）。
  // T2.8-6 条件窗口化：超阈值时只渲染尾部窗口（向上滚动扩窗）。
  const streaming = streamingSessionId === sessionId
  const [windowSize, setWindowSize] = useState(WINDOW_INIT)
  const filteredMessages = useMemo(
    () =>
      messages.filter(
        (m, i) =>
          m.role !== "assistant" ||
          m.parts.length > 0 ||
          (streaming && i === messages.length - 1),
      ),
    [messages, streaming],
  )
  const visibleMessages = useMemo(
    () => windowedSlice(filteredMessages, windowSize),
    [filteredMessages, windowSize],
  )

  // 会话切换时重置滚动状态与窗口
  useEffect(() => {
    stickToBottom.current = true
    setHasUnread(false)
    setWindowSize(WINDOW_INIT)
  }, [sessionId])

  // 新消息/权限请求/等待态变化：位于底部附近则自动滚动，否则显示"有新消息"浮标。
  // rAF 合帧：流式期间每 token 触发本 effect，直接写 scrollTop 会逐次强制同步
  // reflow——合并到下一帧，一帧至多一次。
  const scrollRafRef = useRef(0)
  useEffect(() => {
    if (!stickToBottom.current) {
      setHasUnread(true)
      return
    }
    if (scrollRafRef.current !== 0) return // 已有排程，合并
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const el = containerRef.current
      if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
    })
    return () => {
      if (scrollRafRef.current !== 0) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = 0
      }
    }
  }, [messages, pendingPermission, waitingForReply])

  // 扩窗补偿基准：扩窗 setState 前记录视口位置，渲染后用 scrollHeight 差回补
  const expandingRef = useRef<{ scrollTop: number; scrollHeight: number } | undefined>(undefined)

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    stickToBottom.current = isNearBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    )
    if (stickToBottom.current) setHasUnread(false)
    // T2.8-6：接近顶部且窗口未全开 → 扩窗（渲染后由 layout effect 补偿视口位置）。
    // 判定基数与窗口化一致：过滤后条数（空 assistant 不计入窗口阈值）
    if (shouldExpandWindow(el.scrollTop, windowSize, filteredMessages.length)) {
      expandingRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
      setWindowSize((size) => Math.min(filteredMessages.length, size + WINDOW_STEP))
    }
  }

  // 扩窗渲染后保持视口位置：prepend 内容使 scrollHeight 增长，scrollTop 增加同差值
  useLayoutEffect(() => {
    const el = containerRef.current
    const pending = expandingRef.current
    expandingRef.current = undefined
    if (el === null || pending === undefined) return
    el.scrollTop = pending.scrollTop + (el.scrollHeight - pending.scrollHeight)
  }, [windowSize])

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
