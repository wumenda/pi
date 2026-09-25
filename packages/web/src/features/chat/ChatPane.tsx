import { useState } from "react"
import { EllipsisOutlined } from "@ant-design/icons"
import { ChatInput } from "./ChatInput"
import { MessageList } from "./MessageList"
import { SessionActivityCard } from "./SessionActivityCard"
import { useSessionEvents } from "./useSessionEvents"
import { useStuckToolGuard } from "./useStuckToolGuard"
import { useSkillLoader } from "../workspace/useSkillLoader"
import { useIframePipeline } from "../../mcp-iframe/useIframePipeline"
import { useAppStore } from "../../stores/app-store"

/** 纯描边消息图标（无填充，仅轮廓） */
function MessageOutlineIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeLinejoin="round" />
      <circle cx="8.5" cy="11.5" r="1" fill="none" />
      <circle cx="12" cy="11.5" r="1" fill="none" />
      <circle cx="15.5" cy="11.5" r="1" fill="none" />
    </svg>
  )
}

/** 右侧栏：AI 对话主框（头部 + 消息流 + 输入框，布局文档第 4 章） */
export function ChatPane() {
  const sessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const [activityOpen, setActivityOpen] = useState(false)
  useSessionEvents(sessionId)
  useStuckToolGuard(sessionId)
  useSkillLoader(sessionId)
  useIframePipeline(sessionId)

  if (sessionId === null) {
    return (
      <div className="chat-placeholder">创建或选择一个会话开始对话</div>
    )
  }

  const title = sessions.find((s) => s.id === sessionId)?.title ?? "对话"

  return (
    <div className="chat-pane">
      {/* key=sessionId：切换/创建会话时重挂载，播放标题下移入场动画 */}
      <div className="chat-header" key={`h-${sessionId}`}>
        <div className="chat-header-info">
          <div className="chat-header-icon">
            <MessageOutlineIcon />
          </div>
          <div className="chat-header-title" title={title}>
            {title}
          </div>
        </div>
        <div className="chat-header-actions">
          {/* 展开当前会话执行记录（工具/skill 浮层卡片） */}
          <button
            type="button"
            className="chat-header-activity-btn"
            aria-label="展开执行记录"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen((v) => !v)}
          >
            <EllipsisOutlined />
          </button>
        </div>
      </div>
      <MessageList sessionId={sessionId} />
      {/* key=sessionId：切换/创建会话时重挂载，播放输入框上移入场动画 */}
      <ChatInput key={sessionId} sessionId={sessionId} />
      <SessionActivityCard
        sessionId={sessionId}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
    </div>
  )
}
