import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Tag } from "antd"
import { DownOutlined, RightOutlined } from "@ant-design/icons"
import { fetchMessages } from "../../api/messages"
import { sessionDirectoryOf, useAppStore } from "../../stores/app-store"
import { isToolPart, type ToolPartLike } from "../../api/events"
import type { MessageDTO } from "@platform/shared"
import { ToolCard } from "./ToolCard"
import { ReasoningBlock } from "./MessageList"
import { QuestionCard } from "./cards/QuestionCard"
import { PermissionCard } from "./cards/PermissionCard"

/** 递归展开的深度上限（防深层 subagent 链失控；超出显示占位提示） */
const MAX_TASK_DEPTH = 3

/**
 * 防御性兜底轮询间隔：running 且尚未收到任何实时缓存（P3 聚合缺失/登记失败）时，
 * 节流轮询子会话消息增量刷新；一旦有数据（SSE 已驱动）即自动停止。
 */
const POLL_INTERVAL_MS = 2_000

/**
 * task 卡片：subagent 执行过程懒加载展开（subagent-session-cohesion.md §4.1 P2 + §5 P3）：
 * - state.metadata.sessionId 存在（子会话锚点）才显示入口，running 早期无锚点不显示；
 * - 展开经 React Query 拉取子会话消息（子会话与父会话同工作目录，透传 directory），
 *   staleTime=Infinity + 缓存复用：收起再展开不重复请求；
 * - P3 实时透传：父会话 SSE 聚合事件已把子会话增量写入 ["messages", childSessionId] 缓存，
 *   展开时若缓存已有数据立即展示（无需等待 fetch）；卡片父状态 running 时显示执行中标识；
 * - 内嵌视图渲染子会话 part：text 文本行、reasoning 折叠思考块、tool 工具卡片；
 *   嵌套 subagent 的 task 卡片按深度上限递归展开（MAX_TASK_DEPTH），超限显示占位提示；
 * - subagent 等待用户输入（子会话 question/permission 挂起）时，内嵌视图渲染交互卡片
 *   （subagent-mcp-apps-integration-steps.md 任务5：childSessionId 传给卡片以子会话作答）。
 */
export function TaskCard({ sessionId, part }: { sessionId: string; part: ToolPartLike }) {
  const meta = part.state.metadata as
    | { sessionId?: unknown; agent?: unknown; description?: unknown }
    | undefined
  const childSessionId = typeof meta?.sessionId === "string" ? meta.sessionId : undefined
  const [expanded, setExpanded] = useState(false)

  // 子会话挂起请求（subagent 等待用户输入）
  const childPendingQuestion = useAppStore((s) =>
    childSessionId ? s.childPendingQuestions[childSessionId] : undefined,
  )
  const childPendingPermission = useAppStore((s) =>
    childSessionId ? s.childPendingPermissions[childSessionId] : undefined,
  )
  const clearChildPendingQuestion = useAppStore((s) => s.clearChildPendingQuestion)

  const running = part.state.status === "running" || part.state.status === "pending"
  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", childSessionId],
    queryFn: () => fetchMessages(childSessionId as string, sessionDirectoryOf(sessionId)),
    enabled: expanded && childSessionId !== undefined,
    staleTime: Infinity,
    // P3 修复兜底：running 且尚无实时缓存（SSE 聚合缺失/登记失败）时节流轮询增量刷新；
    // 一旦拿到任何消息（SSE 已驱动）立即停止轮询
    refetchInterval: (query) => {
      const data = query.state.data as MessageDTO[] | undefined
      return running && childSessionId !== undefined && !((data ?? []).length > 0)
        ? POLL_INTERVAL_MS
        : false
    },
  })
  const hasLiveContent =
    childSessionId !== undefined && (messages ?? []).length > 0

  return (
    <div className="tool-card task-card" data-tool="task" data-tool-status={part.state.status}>
      <div className="task-card-head">
        <Tag color="purple">Subagent</Tag>
        <span className="task-card-agent">
          {typeof meta?.agent === "string" ? meta.agent : "task"}
        </span>
        {typeof meta?.description === "string" && meta.description.length > 0 && (
          <span className="task-card-desc">{meta.description}</span>
        )}
      </div>
      {childSessionId !== undefined && (
        <Button
          type="link"
          size="small"
          className="task-card-toggle"
          aria-expanded={expanded}
          icon={expanded ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "查看 Subagent 执行过程"}
        </Button>
      )}
      {expanded && (
        <div className="task-card-children" aria-label="Subagent 执行过程">
          {running && !hasLiveContent && (
            <div className="task-card-loading">Subagent 后台任务执行中…</div>
          )}
          {isLoading && !hasLiveContent && <div className="task-card-loading">加载中…</div>}
          <ChildMessages
            sessionId={sessionId}
            messages={messages ?? []}
            depth={1}
          />
          {/* subagent 等待用户输入：渲染交互卡片（以子会话 id 作答，清除子会话槽位） */}
          {childSessionId !== undefined && childPendingQuestion !== undefined && (
            <QuestionCard
              sessionId={childSessionId}
              pending={childPendingQuestion}
              onResolved={() => clearChildPendingQuestion(childSessionId)}
            />
          )}
          {childSessionId !== undefined && childPendingPermission !== undefined && (
            <PermissionCard
              sessionId={childSessionId}
              childSessionId={childSessionId}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 子会话消息渲染（可递归）：text 文本行、reasoning 折叠思考块、tool 工具卡片；
 * 嵌套 task part 按 depth 递归展开为独立的懒加载子卡片，depth 超过 MAX_TASK_DEPTH
 * 显示占位提示（防深层链失控，且避免一次性全量递归拉取）。
 */
function ChildMessages({
  sessionId,
  messages,
  depth,
}: {
  /** 父会话 id（directory 透传依据） */
  sessionId: string
  messages: MessageDTO[]
  depth: number
}) {
  return (
    <>
      {messages.map((m) =>
        m.parts.map((p, i) => {
          const type = (p as { type?: unknown }).type
          const text = (p as { text?: string }).text
          if (type === "text" && text !== undefined && text.trim().length > 0) {
            return (
              <div key={`${m.id}-${i}`} className="task-card-msg">
                {text}
              </div>
            )
          }
          if (type === "reasoning" && text !== undefined && text.trim().length > 0) {
            return <ReasoningBlock key={`${m.id}-${i}`} text={text} />
          }
          if (isToolPart(p)) {
            const toolPart = p as ToolPartLike
            // 嵌套 subagent（task 工具）：递归展开为独立子卡片（depth 上限防失控）
            if (toolPart.tool === "task") {
              return (
                <NestedTaskEntry
                  key={`${m.id}-${i}`}
                  sessionId={sessionId}
                  part={toolPart}
                  depth={depth}
                />
              )
            }
            return <ToolCard key={`${m.id}-${i}`} part={toolPart} />
          }
          return null
        }),
      )}
    </>
  )
}

/**
 * 嵌套 subagent 入口：有子会话锚点则渲染可展开的懒加载子卡片（复用顶层 TaskCard 的
 * 展开-拉取-缓存模式），无锚点或超过深度上限时显示占位提示。
 */
function NestedTaskEntry({
  sessionId,
  part,
  depth,
}: {
  sessionId: string
  part: ToolPartLike
  depth: number
}) {
  const meta = part.state.metadata as { sessionId?: unknown; agent?: unknown } | undefined
  const nestedChildSessionId =
    typeof meta?.sessionId === "string" ? meta.sessionId : undefined
  const [expanded, setExpanded] = useState(false)

  const running = part.state.status === "running" || part.state.status === "pending"
  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", nestedChildSessionId],
    queryFn: () => fetchMessages(nestedChildSessionId as string, sessionDirectoryOf(sessionId)),
    enabled: expanded && nestedChildSessionId !== undefined,
    staleTime: Infinity,
    // 同顶层：running 且无实时缓存时节流轮询兜底
    refetchInterval: (query) => {
      const data = query.state.data as MessageDTO[] | undefined
      return running && nestedChildSessionId !== undefined && !((data ?? []).length > 0)
        ? POLL_INTERVAL_MS
        : false
    },
  })

  const overDepth = depth >= MAX_TASK_DEPTH
  const hasLiveContent = nestedChildSessionId !== undefined && (messages ?? []).length > 0

  // 无锚点（running 早期）或超过深度上限：占位提示
  if (nestedChildSessionId === undefined) {
    return (
      <div className="task-card-msg task-card-nested">
        <Tag color="purple">Subagent</Tag> 嵌套执行过程（等待子会话锚点…）
      </div>
    )
  }
  if (overDepth) {
    return (
      <div className="task-card-msg task-card-nested">
        <Tag color="purple">Subagent</Tag> 嵌套执行过程（已达递归深度上限 {MAX_TASK_DEPTH}，不再展开）
      </div>
    )
  }

  return (
    <div className="task-card-nested" data-tool="task" data-tool-status={part.state.status}>
      <div className="task-card-head">
        <Tag color="purple">Subagent</Tag>
        <span className="task-card-agent">
          {typeof meta?.agent === "string" ? meta.agent : "task"}
        </span>
        <Button
          type="link"
          size="small"
          className="task-card-toggle"
          aria-expanded={expanded}
          icon={expanded ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "查看嵌套 Subagent 执行过程"}
        </Button>
      </div>
      {expanded && (
        <div className="task-card-children" aria-label="嵌套 Subagent 执行过程">
          {running && !hasLiveContent && (
            <div className="task-card-loading">嵌套 Subagent 后台任务执行中…</div>
          )}
          {isLoading && !hasLiveContent && <div className="task-card-loading">加载中…</div>}
          <ChildMessages
            sessionId={sessionId}
            messages={messages ?? []}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  )
}
