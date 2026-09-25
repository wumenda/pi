import { useEffect, useState } from "react"
import { useRedesignRoute } from "../redesign/routes"
import { RedesignSidebar } from "../redesign/components/RedesignSidebar"
import { ConceptOverlay } from "../redesign/pages/home/ConceptOverlay"
import { HelpOverlay } from "../redesign/pages/home/HelpOverlay"
import { KnowledgePage } from "../redesign/pages/knowledge/KnowledgePage"
import { SkillDetailPage } from "../redesign/pages/skills/SkillDetailPage"
import { SkillsPage } from "../redesign/pages/skills/SkillsPage"
import { ToolDetailPage } from "../redesign/pages/tools/ToolDetailPage"
import { ToolsPage } from "../redesign/pages/tools/ToolsPage"
import { DataCenterPage } from "../redesign/pages/data-center/DataCenterPage"
import { SlotPage } from "../redesign/pages/slots/SlotPage"
import { ConsoleHome } from "../pages/home/ConsoleHome"
import { ProjectCenterPage } from "../pages/projects/ProjectCenterPage"
import { SessionWorkspace } from "../workspace/SessionWorkspace"
import { useAppBootstrap } from "./useAppBootstrap"
import { useAppStore } from "../stores/app-store"
import { useTheme } from "../redesign/theme"
// 原型样式移植（已由脚本统一加 .redesign-root 作用域前缀，勿手改）
// 主题变量表（生成物）：--th-* 亮/暗双值 + 语义变量暗色重定义，切换由 [data-theme="dark"] 驱动
import "../redesign/styles/theme.generated.css"
import "../redesign/styles/styles.css"
import "../redesign/styles/skills.css"
import "../redesign/styles/knowledge.css"
import "../redesign/styles/dataCenter.css"
import "../redesign/styles/redesign-integration.css"
import { SettingsModal } from "../features/workspace/SettingsModal"
import { ConnectionGate } from "../features/connection/ConnectionGate"

/**
 * 全站外壳：.redesign-root 作用域 + 左 rail + 路由出口。
 * 任务工作台（session 路由）同样套 app-shell 布局形态（redesign 任务页形态）。
 */
export default function ShellApp() {
  const route = useRedesignRoute()
  useAppBootstrap()
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setCurrentSession = useAppStore((s) => s.setCurrentSession)
  // 侧边栏双态：完整面板（默认）↔ 76px 图标 rail；点击 logo 切换（与会话工作台交互一致）
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [theme] = useTheme()

  // 深链 #/session/<id>：直接置当前会话（ChatPane/useSessionEvents 按其工作）。
  // 依赖取原始 sessionId——useRedesignRoute 每次渲染返回新对象，按对象依赖会让
  // ShellApp 任意一次重渲染都重置会话、清空工作台（store 侧另有同 id 幂等护栏）
  const sessionRouteId = route.page === "session" ? route.sessionId : null
  useEffect(() => {
    if (sessionRouteId !== null) setCurrentSession(sessionRouteId)
  }, [sessionRouteId, setCurrentSession])

  // 工作台整页接管（自带 icon rail），不套 app-shell 外壳——避免双 rail
  if (route.page === "session") {
    return (
      <div className="redesign-root" data-theme={theme}>
        <SessionWorkspace />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ConnectionGate />
      </div>
    )
  }

  return (
    <div className="redesign-root" data-theme={theme}>
      <main className={`app-shell sidebar-pinned${sidebarExpanded ? "" : " sidebar-rail"}`}>
        <RedesignSidebar
          isPinned
          expanded={sidebarExpanded}
          onTogglePinned={() => setSidebarExpanded((current) => !current)}
          route={route}
        />
        <section className="workspace workspace-page">
          {route.page === "home" && <ConsoleHome />}
          {route.page === "projects" && <ProjectCenterPage />}
          {route.page === "knowledge" && <KnowledgePage />}
          {route.page === "skills" && <SkillsPage />}
          {route.page === "tools" && <ToolsPage />}
          {route.page === "data-center" && <DataCenterPage />}
          {route.page === "messages" && (
            <SlotPage
              title="消息中心"
              description="汇聚任务推进通知、校核结果提醒与协作消息。此为预留插槽。"
            />
          )}
        </section>
        {route.page === "skills" && route.skillId && <SkillDetailPage skillId={route.skillId} />}
        {route.page === "tools" && route.toolId && <ToolDetailPage toolId={route.toolId} />}
        {route.page === "concept" && <ConceptOverlay />}
        {route.page === "help" && <HelpOverlay />}
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConnectionGate />
    </div>
  )
}
