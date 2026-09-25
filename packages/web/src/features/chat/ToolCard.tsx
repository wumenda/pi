import { useEffect, useState } from "react"
import { Button, Progress } from "antd"
import { useQuery } from "@tanstack/react-query"
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  RightOutlined,
} from "@ant-design/icons"
import { useAppStore } from "../../stores/app-store"
import type { ToolPartLike } from "../../api/events"
import { extractProgress, extractResourceUri } from "../../api/events"
import { fetchMcpTools, matchMcpTool } from "../../api/tools"
import { useTranslation } from "../../i18n"
import { getStuckMs } from "./useStuckToolGuard"

// 状态色对齐深色主题语义色（--state-*）
const STATUS_ICON = {
  pending: <LoadingOutlined style={{ color: "#3b82f6" }} />,
  running: <LoadingOutlined style={{ color: "#3b82f6" }} />,
  completed: <CheckCircleFilled style={{ color: "#22c55e" }} />,
  error: <CloseCircleFilled style={{ color: "#ef4444" }} />,
} as const

// 状态文案经 i18n（chat.pendingStatus/running/success/failure）
const STATUS_TEXT_KEY = {
  pending: "chat.pendingStatus",
  running: "chat.running",
  completed: "chat.success",
  error: "chat.failure",
} as const

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m${(s % 60).toString().padStart(2, "0")}s`
}

/** tool 调用折叠卡片（布局文档 4.1）：tool 名 + 状态图标，可展开看入参与结果摘要 */
export function ToolCard({ part }: { part: ToolPartLike }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const acquireIframe = useAppStore((s) => s.acquireIframe)

  // running 态耗时显示：opencode ToolStateRunning.time.start（无该字段的旧数据静默不显示）
  const startedAt =
    part.state.status === "running" ? part.state.time?.start : undefined
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  const elapsedMs =
    startedAt !== undefined ? Math.max(0, now - startedAt) : undefined
  const stuck =
    elapsedMs !== undefined && elapsedMs >= getStuckMs()

  // 绑定判定与渲染管线一致（useIframePipeline）：优先结果元数据，否则按 tool 名匹配 MCP 定义
  const { data: mcpTools = [] } = useQuery({
    queryKey: ["mcp-tools"],
    queryFn: fetchMcpTools,
    staleTime: 5 * 60 * 1000,
  })
  const matched = matchMcpTool(part.tool, mcpTools)
  const resourceUri = extractResourceUri(part) ?? matched?.resourceUri
  const permissions = matched?.permissions ?? []
  const progressInfo = extractProgress(part)

  return (
    <div className="tool-card" data-tool-status={part.state.status}>
      <button
        type="button"
        className="tool-card-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {STATUS_ICON[part.state.status]}
        <span className="tool-card-name">{part.tool}</span>
        <span
          className={`tool-card-status${part.state.status === "running" ? " tool-card-status-running" : ""}`}
        >
          {t(STATUS_TEXT_KEY[part.state.status])}
        </span>
        {elapsedMs !== undefined && !stuck && (
          <span className="tool-card-elapsed">
            {t("chat.toolElapsed", { duration: formatDuration(elapsedMs) })}
          </span>
        )}
        {stuck && (
          <span className="tool-card-stuck">{t("chat.stuckHint")}</span>
        )}
        {expanded ? <DownGlyph /> : <RightOutlined style={{ fontSize: 10 }} />}
      </button>
      {expanded && (
        <div className="tool-card-body">
          <div className="tool-card-section">
            <div className="tool-card-label">{t("chat.inputLabel")}</div>
            <pre className="tool-card-pre">
              {JSON.stringify(part.state.input ?? {}, null, 2)}
            </pre>
          </div>
          {part.state.output !== undefined && (
            <div className="tool-card-section">
              <div className="tool-card-label">{t("chat.resultLabel")}</div>
              <pre className="tool-card-pre">{part.state.output}</pre>
            </div>
          )}
          {part.state.status === "error" && (
            <div className="tool-card-section">
              <div className="tool-card-label">{t("chat.errorLabel")}</div>
              <pre className="tool-card-pre tool-card-error">
                {(part.state as { error?: string }).error ?? t("chat.execFailed")}
              </pre>
            </div>
          )}
        </div>
      )}
      {resourceUri && (
        <Button
          size="small"
          type="link"
          className="tool-card-open-ui"
          onClick={() => {
            // 布局文档 4.3：切到 tool iframe 视图并激活对应 Tab（G4：带 serverId 归属）
            acquireIframe(resourceUri, {
              permissions,
              title: part.tool,
              serverId: matched?.serverId,
            })
          }}
        >
          {t("chat.viewInCenter")}
        </Button>
      )}
      {part.state.status === "running" && progressInfo && (
        <div className="tool-card-progress">
          <Progress
            percent={
              progressInfo.total !== undefined
                ? Math.round((progressInfo.progress / progressInfo.total) * 100)
                : undefined
            }
            size="small"
            status="active"
          />
          <span className="tool-card-progress-text">
            {progressInfo.message ??
              `${progressInfo.progress}/${progressInfo.total ?? "?"}`}
          </span>
        </div>
      )}
    </div>
  )
}

function DownGlyph() {
  const { t } = useTranslation()
  return (
    <RightOutlined
      style={{ fontSize: 10, transform: "rotate(90deg)" }}
      aria-label={t("common.collapse")}
    />
  )
}
