import { useState } from "react"
import { Progress } from "antd"
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from "@ant-design/icons"
import type { ToolExecution } from "../../types"

// 状态色对齐深色主题语义色（--state-*，与 ToolCard 一致）
const STATUS_ICON = {
  running: <LoadingOutlined style={{ color: "#3b82f6" }} />,
  success: <CheckCircleFilled style={{ color: "#22c55e" }} />,
  failure: <CloseCircleFilled style={{ color: "#ef4444" }} />,
} as const

const STATUS_TEXT = {
  running: "执行中",
  success: "成功",
  failure: "失败",
} as const

/** 简易时间格式化（本地时刻 HH:MM:SS；会话活动卡片子会话行复用） */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toTimeString().slice(0, 8)
}

/** 执行项：名称 + 状态（+ 可选时间），可展开看入参/结果摘要（会话活动卡片复用） */
export function ExecutionItem({
  exec,
  showTime = false,
}: {
  exec: ToolExecution
  showTime?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail =
    (exec.inputSummary !== undefined && exec.inputSummary.length > 0) ||
    (exec.resultSummary !== undefined && exec.resultSummary.length > 0)

  return (
    <div className="tool-exec-item" data-tool-status={exec.status}>
      <button
        type="button"
        className="tool-exec-item-head"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {STATUS_ICON[exec.status]}
        <span className="tool-exec-item-name" title={exec.toolName}>
          {exec.toolName}
        </span>
        <span className="tool-exec-item-status">{STATUS_TEXT[exec.status]}</span>
        {showTime && <span className="tool-exec-item-time">{formatTime(exec.startedAt)}</span>}
        {exec.progress && exec.status === "running" && (
          <>
            <span className="tool-exec-item-progress">
              <Progress
                percent={
                  exec.progress.total !== undefined
                    ? Math.round((exec.progress.progress / exec.progress.total) * 100)
                    : undefined
                }
                size="small"
                status="active"
              />
            </span>
            {exec.progress.message && (
              <span className="tool-exec-item-msg">{exec.progress.message}</span>
            )}
          </>
        )}
      </button>
      {expanded && (
        <div className="tool-exec-item-body">
          {exec.inputSummary !== undefined && exec.inputSummary.length > 0 && (
            <div className="tool-exec-item-section">
              <div className="tool-exec-item-label">入参</div>
              <pre className="tool-exec-item-pre">{exec.inputSummary}</pre>
            </div>
          )}
          {exec.resultSummary !== undefined && exec.resultSummary.length > 0 && (
            <div className="tool-exec-item-section">
              <div className="tool-exec-item-label">结果</div>
              <pre className="tool-exec-item-pre">{exec.resultSummary}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
