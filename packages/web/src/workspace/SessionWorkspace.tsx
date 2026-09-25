import { useState } from "react"
import { ConfigProvider } from "antd"
import { RedesignSidebar } from "../redesign/components/RedesignSidebar"
import { useTheme } from "../redesign/theme"
import { SkillTabBar } from "./SkillTabBar"
import { SkillPanel } from "../features/workspace/SkillPanel"
import { ToolExecutionPanel } from "../mcp-iframe/ToolExecutionPanel"
import { ToolTabBar } from "../mcp-iframe/ToolTabBar"
import { TechDiamondIcon } from "../components/icons/TechDiamondIcon"
import { ChatPane } from "../features/chat/ChatPane"
import { useAppStore } from "../stores/app-store"

const RIGHT_PANE_MIN = 320
const RIGHT_PANE_MAX = 720
const RIGHT_PANE_DEFAULT = 420

/**
 * 会话工作台（app-shell 结构）：
 * 左侧边栏 ｜ 中区（顶层分组 Tab（SkillTabBar，Skill 实例 + 单独调用）；
 * 工具 Tab；iframe 常驻渲染层/技能元数据视图/空态）｜ 右 Agent 对话流。
 * 分组导航全走通用技能分组机制：Skill 实例 Tab 由消息流中的 skill 读取建档，
 * 工具 iframe 按 SKILL.md tools 声明归属实例分组（无任何业务专属逻辑）。
 * iframe 池常驻挂载策略与 CenterPane 一致（切视图不卸载）。
 */
export function SessionWorkspace() {
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const centerView = useAppStore((s) => s.centerView)
  const hasIframe = useAppStore((s) => s.iframePool.size > 0)
  // 会话工作台主题跟随 redesign 主题（与左 sidebar 同源），
  // antd 主色随其取 redesign 品牌蓝（亮 #3168ff / 暗 #6d93ff，对应 --blue）
  const [theme] = useTheme()
  const brandBlue = theme === "dark" ? "#6d93ff" : "#3168ff"

  const [width, setWidth] = useState(RIGHT_PANE_DEFAULT)
  const [resizing, setResizing] = useState(false)
  // 侧栏双态：rail（图标栏，默认）↔ 展开面板；点击切换按钮切换，展开时推开中区
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  // 拖拽期间禁用 iframe 指针事件防止拖拽被吞（与原 RightPane 行为一致）
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setResizing(true)
    document.body.classList.add("pane-col-resizing")
    const onMove = (ev: PointerEvent) =>
      setWidth(Math.min(RIGHT_PANE_MAX, Math.max(RIGHT_PANE_MIN, window.innerWidth - ev.clientX)))
    const onUp = () => {
      setResizing(false)
      document.body.classList.remove("pane-col-resizing")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <main className="app-shell sidebar-pinned session-workspace">
      <RedesignSidebar
        isPinned
        expanded={sidebarExpanded}
        onTogglePinned={() => setSidebarExpanded((v) => !v)}
        route={{ page: "projects" }}
      />
      <section className="workspace workspace-page session-center">
        <SkillTabBar />
        <ToolTabBar />
        <div className="session-center-body">
          <div className="center-content">
            {/*
              iframe 容器层常驻挂载（切视图不卸载）：卸载会把池内 iframe 移出文档，
              MCP 应用状态丢失。池非空期间仅以 hidden 切换可见性。
            */}
            <div className="center-content-layer" hidden={centerView !== "iframe"}>
              {hasIframe ? (
                <ToolExecutionPanel />
              ) : (
                <div className="center-placeholder">
                  <TechDiamondIcon
                    className="center-placeholder-icon tech-diamond"
                    aria-hidden="true"
                  />
                  <div className="center-placeholder-sub">
                    执行带界面的工具后，MCP 应用将在此展示
                  </div>
                </div>
              )}
            </div>
            <div className="center-content-layer" hidden={centerView !== "skill"}>
              <SkillPanel />
            </div>
          </div>
        </div>
      </section>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: brandBlue,
            colorInfo: brandBlue,
            fontFamily: "var(--font-family-primary)",
          },
        }}
      >
        <aside
          className="right-pane"
          data-resizing={resizing ? "true" : "false"}
          style={{ "--right-pane-width": `${width}px` } as React.CSSProperties}
        >
          <div
            className="pane-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整对话栏宽度"
            aria-valuemin={RIGHT_PANE_MIN}
            aria-valuemax={RIGHT_PANE_MAX}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={startResize}
          />
          {currentSessionId === null ? (
            <div className="right-placeholder">创建或选择一个会话开始对话</div>
          ) : (
            <ChatPane />
          )}
        </aside>
      </ConfigProvider>
    </main>
  )
}
