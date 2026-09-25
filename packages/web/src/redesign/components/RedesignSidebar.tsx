import { useState } from "react"
import { Bell, BookOpen, ChevronDown, DatabaseZap, Grid3x3, Home, LogOut, Moon, PanelTop, Settings, Sun, Wrench } from "lucide-react"
import { navigateRedesign, type RedesignRoute } from "../routes"
import { useAppStore } from "../../stores/app-store"
import { useTheme } from "../theme"

/** 原型 App.jsx navItems：项目中心/消息中心在原型中未实现（导航空操作），复刻区落入插槽页 */
const NAV_ITEMS = [
  { label: "首页", icon: Home, path: "" },
  { label: "项目中心", icon: PanelTop, path: "projects" },
  { label: "知识库", icon: BookOpen, path: "knowledge" },
  { label: "技能库", icon: Grid3x3, path: "skills" },
  { label: "工具库", icon: Wrench, path: "tools" },
  { label: "数据中心", icon: DatabaseZap, path: "data-center" },
  { label: "消息中心", icon: Bell, path: "messages", badge: 3 },
] as const

function isNavActive(route: RedesignRoute, path: string): boolean {
  switch (path) {
    case "":
      return route.page === "home" || route.page === "concept"
    case "projects":
      return route.page === "projects"
    case "knowledge":
      return route.page === "knowledge"
    case "skills":
      return route.page === "skills"
    case "tools":
      return route.page === "tools"
    case "data-center":
      return route.page === "data-center"
    case "messages":
      return route.page === "messages"
    default:
      return false
  }
}

/** 移植自原型 App.jsx Sidebar（结构/类名保持一致）；设置/主题接真实 store。
 *  expanded：工作台按钮切换的展开态标记（pinned 在窄屏断点被解释为图标 rail，需区分） */
export function RedesignSidebar({
  isPinned,
  expanded = isPinned,
  onTogglePinned,
  route,
}: {
  isPinned: boolean
  expanded?: boolean
  onTogglePinned?: () => void
  route: RedesignRoute
}) {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const [theme, toggleTheme] = useTheme()
  const ThemeIcon = theme === "dark" ? Sun : Moon
  // 用户卡片 chevron 展开菜单（退出登录入口）；rail 形态无 chevron 入口，不开启
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const railMode = isPinned && !expanded
  return (
    <aside
      className={`sidebar ${isPinned ? "pinned" : ""}${expanded ? " sidebar-expanded" : ""}`}
      aria-label="主导航"
    >
      <div>
        <button
          className="brand sidebar-toggle"
          type="button"
          onClick={onTogglePinned}
          aria-pressed={expanded}
          title={onTogglePinned ? (expanded ? "收起导航栏" : "展开导航栏") : undefined}
        >
          <div className="brand-mark">
            <div className="brand-core" />
          </div>
          <div className="brand-copy">
            <strong>AI for Redesign</strong>
            <span>工业改造智能推理引擎</span>
          </div>
        </button>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={`nav-item ${isNavActive(route, item.path) ? "active" : ""}`}
                type="button"
                key={item.label}
                onClick={() => navigateRedesign(item.path)}
              >
                <Icon size={24} strokeWidth={2.2} />
                <span>{item.label}</span>
                {"badge" in item && item.badge ? <b>{item.badge}</b> : null}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <button
          className="utility-link"
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
          title={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"}
        >
          <ThemeIcon size={20} />
        </button>
        <div className="user-card-wrap">
          <button
            className="user-card"
            type="button"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => {
              // 折叠（rail）形态下点击头像等同 logo：展开侧边栏；展开态则开关用户菜单
              if (railMode) {
                onTogglePinned?.()
                return
              }
              setUserMenuOpen((current) => !current)
            }}
            title={railMode ? "展开导航栏" : undefined}
          >
            <span className="avatar">张</span>
            <span className="user-card-copy">
              <strong>张工</strong>
              <small>中石化 工艺工程师</small>
            </span>
            <ChevronDown
              size={18}
              className={`user-card-chevron${userMenuOpen ? " is-open" : ""}`}
            />
          </button>
          {userMenuOpen && (
            <>
              <div className="user-menu-backdrop" onClick={() => setUserMenuOpen(false)} />
              <div className="user-menu" role="menu">
                <button
                  className="user-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSettingsOpen(true)
                    setUserMenuOpen(false)
                  }}
                >
                  <Settings size={20} />
                  <span>系统设置</span>
                </button>
                <button
                  className="user-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <LogOut size={20} />
                  <span>退出登录</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
