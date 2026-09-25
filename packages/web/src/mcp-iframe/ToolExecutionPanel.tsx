import { useEffect, useRef } from "react"
import { SOLO_GROUP_KEY, useAppStore } from "../stores/app-store"
import { messageBridge } from "./MessageBridge"
import { TechDiamondIcon } from "../components/icons/TechDiamondIcon"

/**
 * tool iframe 内容区（iframe-rendering.md 第 3-4 节）：
 * 池内所有 iframe 持续挂载在容器中——**属于当前激活分组（activeSkillName）且为激活者**
 * 才展示，其余（其他分组的 iframe、同组挂起者）一律 display:none
 * （保留浏览器上下文与应用状态，切回无重载）；Tab 切换/关闭由二级 ToolTabBar 承担。
 *
 * 分组隔离（v2.4）：不同 skill / 「单独调用」之间的 iframe 互不串台——即使
 * activeIframeUri 残留指向其他分组的 iframe，只要不属于当前激活分组就不展示；
 * 当前分组无 iframe 时（skill 已加载但尚未执行 tool）显示占位层
 * （与「池空」占位同文案，覆盖在 iframe 容器上方）。
 */
export function ToolExecutionPanel() {
  const pool = useAppStore((s) => s.iframePool)
  const activeUri = useAppStore((s) => s.activeIframeUri)
  const activeSkillName = useAppStore((s) => s.activeSkillName)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    for (const [uri, instance] of pool) {
      if (instance.element.parentElement !== container) {
        container.appendChild(instance.element)
      }
      // 分组隔离：仅当前激活分组内、且为激活者的 iframe 可见
      const group = instance.group ?? SOLO_GROUP_KEY
      const visible = uri === activeUri && group === activeSkillName
      instance.element.style.display = visible ? "block" : "none"
      messageBridge.attach(uri, instance.element)
    }
  }, [pool, activeUri, activeSkillName])

  // 当前激活分组是否有可见 iframe（决定是否渲染占位层）
  const hasActiveInGroup =
    activeUri !== null &&
    pool.has(activeUri) &&
    (pool.get(activeUri)!.group ?? SOLO_GROUP_KEY) === activeSkillName

  return (
    <div className="tool-exec-panel">
      <div ref={containerRef} className="tool-exec-container" />
      {!hasActiveInGroup && (
        <div className="center-placeholder tool-exec-placeholder">
          <TechDiamondIcon className="center-placeholder-icon tech-diamond" aria-hidden="true" />
          <div className="center-placeholder-sub">
            会话触发 Skill 加载后，将在此展示元数据与 tool 清单
          </div>
        </div>
      )}
    </div>
  )
}
