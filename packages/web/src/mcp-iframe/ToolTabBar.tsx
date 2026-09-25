import { CloseOutlined } from "@ant-design/icons"
import { SOLO_GROUP_KEY, useAppStore } from "../stores/app-store"

/**
 * 二级 tool Tab 栏（原型 workspace-tabs，浏览器式标签）：
 * 仅显示当前一级分组（activeSkillName 对应 skill / "单独调用"）内的 tool Tab；
 * 每个带 UI 的 tool 创建 iframe 即生成一个 Tab；点击切换激活，× 关闭并销毁。
 */
export function ToolTabBar() {
  const pool = useAppStore((s) => s.iframePool)
  const activeUri = useAppStore((s) => s.activeIframeUri)
  const activeSkillName = useAppStore((s) => s.activeSkillName)
  const activateIframe = useAppStore((s) => s.activateIframe)
  const releaseIframe = useAppStore((s) => s.releaseIframe)

  // 分组过滤：activeSkillName 为 null（无一级分组上下文）时显示全部
  const visible = [...pool.entries()].filter(
    ([, instance]) =>
      activeSkillName === null ||
      (instance.group ?? SOLO_GROUP_KEY) === activeSkillName,
  )

  if (visible.length === 0) return null

  return (
    <div className="tool-tabbar" data-active-uri={activeUri ?? ""}>
      <div className="tool-tabbar-tabs">
        {visible.map(([uri, instance]) => (
          <div
            key={uri}
            className={`tool-tab${uri === activeUri ? " tool-tab-active" : ""}`}
            data-uri={uri}
            role="tab"
            aria-selected={uri === activeUri}
            tabIndex={0}
            title={uri}
            onClick={() => activateIframe(uri)}
            onKeyDown={(e) => {
              if (e.key === "Enter") activateIframe(uri)
            }}
          >
            <span className="tool-tab-label">{instance.title ?? uri}</span>
            <button
              type="button"
              className="tool-tab-close"
              aria-label={`关闭 ${instance.title ?? uri}`}
              onClick={(e) => {
                e.stopPropagation()
                releaseIframe(uri)
              }}
            >
              <CloseOutlined />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
