import { useState } from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  DownOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  RightOutlined,
} from "@ant-design/icons"
import { Segmented } from "antd"
import type { MessageDTO } from "@platform/shared"
import { fetchMessages } from "../../api/messages"
import { useAppStore } from "../../stores/app-store"
import { ExecutionItem, formatTime } from "./ToolExecutionBar"
import {
  buildChildRows,
  buildMainRows,
  filterActivity,
  type ActivityFilter,
  type ActivityRow,
  type ChildRow,
} from "./sessionActivity"

// 子会话行状态样式（与 ToolExecutionBar 视觉一致）
const CHILD_STATUS_ICON = {
  running: <LoadingOutlined style={{ color: "#3b82f6" }} />,
  success: <CheckCircleFilled style={{ color: "#22c55e" }} />,
  failure: <CloseCircleFilled style={{ color: "#ef4444" }} />,
} as const

const CHILD_STATUS_TEXT = {
  running: "执行中",
  success: "成功",
  failure: "失败",
} as const

/**
 * 会话活动卡片：chat-header 展开按钮打开的浮层，列出当前会话执行的工具信息
 * （skill 读取记录不进浮层），可筛选「全部 / MCP Tool」。子会话（subagent）
 * 作为一条工具执行记录展示，展开可见其内部工具明细。
 * 数据源：toolExecutions（SSE 增量 + 持久化恢复）+ 子会话消息缓存（明细）。
 */
export function SessionActivityCard({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const execs = useAppStore((s) => s.toolExecutions)
  const childSessions = useAppStore((s) => s.activeChildSessions)
  const [filter, setFilter] = useState<ActivityFilter>("all")

  // 子会话消息缓存：与 useIframePipeline 共用 key，逐个 childSID 加载/观察
  const childQueries = useQueries({
    queries: childSessions.map((childSID) => ({
      queryKey: ["messages", childSID] as const,
      queryFn: () => fetchMessages(childSID),
      staleTime: 30_000,
      placeholderData: () =>
        queryClient.getQueryData<MessageDTO[]>(["messages", childSID]) ?? [],
    })),
  })

  if (!open) return null

  const mainExecs = execs.filter((e) => e.sessionId === sessionId)
  const mainRows = buildMainRows(mainExecs)
  const messagesBySession = new Map(
    childSessions.map((sid, i) => [sid, childQueries[i]?.data]),
  )
  const childRows = buildChildRows(childSessions, messagesBySession)
  const rows: ActivityRow[] = [...mainRows, ...childRows]
  const filtered = filterActivity(rows, filter)
  const count = {
    all: rows.length,
    mcp: filterActivity(rows, "mcp").length,
  }

  return (
    <div className="session-activity-wrap">
      <div className="session-activity-backdrop" onClick={onClose} />
      <div
        className="session-activity-card"
        role="dialog"
        aria-modal="true"
        aria-label="会话执行记录"
      >
        <div className="session-activity-head">
          <span className="session-activity-title">执行记录</span>
          <Segmented
            size="small"
            value={filter}
            onChange={(value) => setFilter(value as ActivityFilter)}
            options={[
              { label: `全部 ${count.all}`, value: "all" },
              { label: `MCP Tool ${count.mcp}`, value: "mcp" },
            ]}
          />
          <button
            type="button"
            className="session-activity-close"
            aria-label="关闭执行记录"
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="session-activity-empty">暂无匹配的执行记录</div>
        ) : (
          <ul className="session-activity-list">
            {filtered.map((row) =>
              row.kind === "main" ? (
                <ExecutionItem key={row.exec.id} exec={row.exec} showTime />
              ) : (
                <ChildRowView key={row.childSessionId} row={row} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

/** 子会话行：整次子任务作为一条记录，展开列出内部工具明细 */
function ChildRowView({ row }: { row: ChildRow }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="tool-exec-item" data-tool-status={row.status}>
      <button
        type="button"
        className="tool-exec-item-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="展开子会话工具明细"
      >
        {CHILD_STATUS_ICON[row.status]}
        <NodeIndexOutlined style={{ fontSize: 11 }} />
        <span className="tool-exec-item-name" title={row.displayName}>
          {row.displayName}
        </span>
        <span className="tool-exec-item-status">{CHILD_STATUS_TEXT[row.status]}</span>
        {row.startedAt && (
          <span className="tool-exec-item-time">{formatTime(row.startedAt)}</span>
        )}
        {expanded ? (
          <DownOutlined style={{ fontSize: 10 }} />
        ) : (
          <RightOutlined style={{ fontSize: 10 }} />
        )}
      </button>
      {expanded &&
        (row.loaded && row.childTools.length > 0 ? (
          <div className="session-activity-child-tools">
            {row.childTools.map((exec) => (
              <ExecutionItem key={exec.id} exec={exec} showTime />
            ))}
          </div>
        ) : (
          <div className="session-activity-child-empty">暂无明细</div>
        ))}
    </div>
  )
}