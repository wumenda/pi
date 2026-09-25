import { Button } from "antd"
import { useTranslation } from "../i18n"

/**
 * 状态视图组（工业视觉语言"状态即信号"：信号形状 + 颜色 + 文字冗余编码，绝不单色表达）。
 * 默认文案取 state.* 键（zh/en 成对）；label/title/description 可覆盖——
 * SkillPanel 复用 workspace.skillLoading 既有键，保持 aria-label 稳定。
 * className 用于挂接调用方既有布局类（session-empty/message-empty/skill-loading）。
 */

function classes(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(" ")
}

/** 加载中：呼吸信号点（brand 色 + dim 光环）+ 文案 */
export function StateLoading({
  label,
  description,
  className,
}: {
  label?: string
  description?: string
  className?: string
}) {
  const { t } = useTranslation()
  const text = label ?? t("state.loading")
  return (
    <div
      className={classes("state-view", "state-view-loading", className)}
      role="status"
      aria-label={text}
    >
      <span className="state-view-signal" aria-hidden="true" />
      <div className="state-view-body">
        <div className="state-view-title">{text}</div>
        {description && <div className="state-view-desc">{description}</div>}
      </div>
    </div>
  )
}

/** 空态：emoji + 文案（无数据 ≠ 异常，信号收敛不抢注意力；title/description 由调用方提供） */
export function StateEmpty({
  title,
  description,
  className,
}: {
  title?: string
  description?: string
  className?: string
}) {
  return (
    <div className={classes("state-view", "state-view-empty", className)}>
      <span className="state-view-signal" aria-hidden="true">/</span>
      <div className="state-view-body">
        {title && <div className="state-view-title">{title}</div>}
        {description && <div className="state-view-desc">{description}</div>}
      </div>
    </div>
  )
}

/** 错误：实心 err 信号方 + 文案 + 可选重试 */
export function StateError({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={classes("state-view", "state-view-error", className)} role="alert">
      <span className="state-view-signal" aria-hidden="true" />
      <div className="state-view-body">
        <div className="state-view-title">{title ?? t("state.errorTitle")}</div>
        {description && <div className="state-view-desc">{description}</div>}
        {onRetry && (
          <div>
            <Button size="small" autoInsertSpace={false} onClick={onRetry}>
              {retryLabel ?? t("state.retry")}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 降级：warn 信号方 + 文案（功能受限但服务可用） */
export function StateDegraded({
  title,
  description,
  className,
}: {
  title?: string
  description?: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={classes("state-view", "state-view-degraded", className)}>
      <span className="state-view-signal" aria-hidden="true" />
      <div className="state-view-body">
        <div className="state-view-title">{title ?? t("state.degradedTitle")}</div>
        <div className="state-view-desc">{description ?? t("state.degradedDesc")}</div>
      </div>
    </div>
  )
}
