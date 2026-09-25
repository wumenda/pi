import { useState } from "react"
import { Alert, App as AntdApp, Button, Space, Tag } from "antd"
import axios from "axios"
import { replyPermission, type PermissionResponse } from "../../../api/permissions"
import { useAppStore, sessionDirectoryOf } from "../../../stores/app-store"
import { useTranslation } from "../../../i18n"
import type { PendingPermission } from "../../../types"

/**
 * 权限审批卡片（opencode permission.asked）：
 * bash 等工具在权限配置为 ask 时触发；挂在消息流底部，
 * once/always 放行、reject 拒绝；回复成功后本地清除挂起状态
 * （permission.replied 事件兜底清除，防本地清失败）。
 * 同会话权限为单槽挂起（pendingPermission）；ask_user 交互卡片
 * 已支持多挂起（T9，pendingQuestions 多槽），两流互不影响。
 * 子会话（subagent）卡片：childSessionId 非空时从子会话 pending 槽位取数并清除。
 */
export function PermissionCard({
  sessionId,
  childSessionId,
}: {
  sessionId: string
  childSessionId?: string
}) {
  const pendingPermission = useAppStore((s) =>
    childSessionId ? s.childPendingPermissions[childSessionId] : s.pendingPermission,
  )
  const setPendingPermission = useAppStore((s) => s.setPendingPermission)
  const clearChildPendingPermission = useAppStore((s) => s.clearChildPendingPermission)
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!pendingPermission) return null

  const resolve = () => {
    if (childSessionId) clearChildPendingPermission(childSessionId)
    else setPendingPermission(null)
  }

  const reply = async (response: PermissionResponse) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await replyPermission(sessionId, pendingPermission.permissionID, response, sessionDirectoryOf(sessionId))
      resolve()
    } catch (e) {
      // opencode 侧已无此挂起权限（会话循环终止时被丢弃）：卡片是僵尸，
      // 自动关闭给用户出路，而非永远 404 卡死在对话流底部。
      // HTTP 404 由 axios 直接抛 AxiosError（unwrap 只归一业务 envelope），
      // 按响应状态码判定即可命中。
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        resolve()
        message.warning(t("chat.permissionExpired"))
      } else {
        setError(t("chat.permissionFailed", { error: e instanceof Error ? e.message : String(e) }))
      }
    } finally {
      setBusy(false)
    }
  }

  // bash 权限无 title 字段：标题展示权限类型，命令块展示 metadata.command
  const command = pendingPermission.command ?? extractCommand(pendingPermission.metadata)
  const title = pendingPermission.permissionType || t("chat.permissionFallback")

  return (
    <div className="permission-card" data-permission-type={pendingPermission.permissionType}>
      <div className="ask-card-head">
        <Tag color="orange">{t("chat.permissionTag")}</Tag>
        <span className="ask-card-title">{title}</span>
      </div>
      {command && <pre className="permission-card-command">{command}</pre>}
      {error && <Alert type="warning" showIcon title={error} />}
      <Space className="ask-card-actions">
        <Button
          type="primary"
          size="small"
          aria-label={t("chat.allowOnce")}
          loading={busy}
          onClick={() => reply("once")}
        >
          {t("chat.allowOnce")}
        </Button>
        <Button
          size="small"
          aria-label={t("chat.allowAlways")}
          disabled={busy}
          onClick={() => reply("always")}
        >
          {t("chat.allowAlways")}
        </Button>
        <Button
          danger
          size="small"
          aria-label={t("chat.deny")}
          disabled={busy}
          onClick={() => reply("reject")}
        >
          {t("chat.deny")}
        </Button>
      </Space>
    </div>
  )
}

/** 提取用于展示的命令文本（bash 权限 metadata.command，兼容字符串/数组） */
function extractCommand(metadata: PendingPermission["metadata"]): string | undefined {
  const command = (metadata as { command?: unknown }).command
  if (typeof command === "string") return command
  if (Array.isArray(command)) return command.map(String).join("\n")
  return undefined
}
