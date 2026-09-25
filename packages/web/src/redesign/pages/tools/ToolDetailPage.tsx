/** 工具详情抽屉：数据源 GET /api/v1/tool-library，展示真实工具字段（说明/参数/元信息） */
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Grid3x3,
  FileImage,
  FileSpreadsheet,
  Boxes,
  FlaskConical,
  Calculator,
  Wrench,
  Layers,
  FileText,
  X,
  Loader2,
  Check,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { fetchToolLibrary } from "../../../api/tool-library"
import { navigateRedesign } from "../../routes"
import { toolIconKeyOf, toolItemIdOf, toolThemeOf } from "./toolTypes"
import type { ToolLibraryItem } from "./toolTypes"
import { useTheme } from "../../theme"

// 图标 key 映射（toolTypes.toolIconKeyOf 按分类推导）
const iconMap: Record<string, LucideIcon> = {
  FileImage, FileSpreadsheet, Boxes, FlaskConical, Calculator,
  Wrench, Layers, FileText,
}

function getToolIcon(category: string): LucideIcon {
  return iconMap[toolIconKeyOf(category)] ?? Grid3x3
}

/** inputSchema.properties → 参数行（类型/必填/说明；非对象 schema 返回空） */
interface ToolParam {
  name: string
  type: string
  required: boolean
  description: string
}

function paramsOf(schema: unknown): ToolParam[] {
  if (!schema || typeof schema !== "object") return []
  const props = (schema as { properties?: Record<string, unknown> }).properties
  if (!props || typeof props !== "object") return []
  const rawRequired = (schema as { required?: unknown }).required
  const required = new Set(
    Array.isArray(rawRequired) ? rawRequired.filter((r): r is string => typeof r === "string") : [],
  )
  return Object.entries(props).map(([name, def]) => {
    const d = (def ?? {}) as { type?: unknown; description?: unknown }
    const type = Array.isArray(d.type)
      ? d.type.filter((t): t is string => typeof t === "string").join(" | ")
      : typeof d.type === "string"
        ? d.type
        : "any"
    return {
      name,
      type,
      required: required.has(name),
      description: typeof d.description === "string" ? d.description : "",
    }
  })
}

const TABS = [
  { key: "description", label: "工具说明" },
  { key: "params", label: "参数定义" },
] as const

type TabKey = (typeof TABS)[number]["key"]

export function ToolDetailPage({ toolId }: { toolId: string }) {
  const [appTheme] = useTheme()
  const [tools, setTools] = useState<ToolLibraryItem[] | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>("description")
  const sectionRefs = useRef<Partial<Record<TabKey, HTMLElement | null>>>({})
  const tabScrollLock = useRef(false)

  const onClose = (): void => navigateRedesign("tools")

  useEffect(() => {
    let cancelled = false
    fetchToolLibrary()
      .then((items) => {
        if (!cancelled) setTools(items)
      })
      .catch(() => {
        if (!cancelled) setTools([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const tool = useMemo(
    () => (tools ?? []).find((t) => toolItemIdOf(t) === toolId),
    [tools, toolId],
  )

  // 点击 Tab 平滑滚动到对应模块
  const handleTabClick = (key: TabKey): void => {
    setActiveTab(key)
    tabScrollLock.current = true
    const el = sectionRefs.current[key]
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    setTimeout(() => { tabScrollLock.current = false }, 600)
  }

  // 切换工具时重置滚动位置和 Tab
  useEffect(() => {
    const container = document.querySelector(".sk-drawer-body")
    if (container) container.scrollTop = 0
    setActiveTab("description")
  }, [toolId])

  // 滚动时更新 activeTab（sticky tab 联动）
  useEffect(() => {
    if (!tool) return undefined
    const container = document.querySelector(".sk-drawer-body")
    if (!container) return undefined

    const handleScroll = (): void => {
      if (tabScrollLock.current) return
      const containerTop = container.getBoundingClientRect().top
      let current: TabKey = TABS[0].key
      for (const tab of TABS) {
        const el = sectionRefs.current[tab.key]
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.top - containerTop <= 120) {
            current = tab.key
          }
        }
      }
      setActiveTab(current)
    }

    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [tool])

  if (!tool) {
    return tools === null ? (
      <div className="sk-drawer-overlay">
        <aside className="sk-drawer">
          <div className="sk-drawer-body">
            <div className="sk-empty-state">
              <Loader2 size={40} className="tl-loading-spin" />
              <p>正在加载工具详情…</p>
            </div>
          </div>
        </aside>
      </div>
    ) : null
  }

  const Icon = getToolIcon(tool.category)
  const theme = toolThemeOf(tool.category, appTheme === "dark")
  const params = paramsOf(tool.inputSchema)

  return (
    <div className="sk-drawer-overlay" onClick={onClose}>
      <aside className="sk-drawer" onClick={(e) => e.stopPropagation()}>
        {/* 抽屉头 */}
        <header className="sk-drawer-header">
          <div className="sk-drawer-header-main">
            <div className="sk-drawer-icon tl-drawer-icon" style={{ background: `linear-gradient(145deg, ${theme.color}, ${theme.color}dd)` }}>
              <Icon size={26} />
            </div>
            <div className="sk-drawer-title-area">
              <div className="sk-drawer-title-row">
                <h2>{tool.name}</h2>
                <div className="sk-detail-tags">
                  <span className="sk-tag tl-tag-cat" style={{ color: theme.chipColor, background: theme.chipBg }}>
                    {tool.category}
                  </span>
                  <span className="sk-tag tl-tag-source">{tool.source === "native" ? "原生" : "插件"}</span>
                  {tool.readOnlyHint === true && (
                    <span className="sk-tag tl-tag-source">只读</span>
                  )}
                </div>
              </div>
              <p className="sk-drawer-desc">{tool.description || "暂无工具描述。"}</p>
              <p className="tl-meta-line">来源 server：{tool.serverId}</p>
            </div>
          </div>
          <button type="button" className="sk-drawer-close" onClick={onClose}>
            <X size={22} />
          </button>
        </header>

        {/* Sticky Tabs */}
        <div className="sk-detail-tabs-wrap">
          <div className="sk-detail-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`sk-detail-tab ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => handleTabClick(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sk-drawer-body">
          <div className="sk-detail-content">
            <div className="sk-detail-main">
              {/* 工具说明 */}
              <section
                ref={(el) => { sectionRefs.current.description = el }}
                className="sk-detail-section"
                id="description"
              >
                <h2 className="sk-section-title">工具说明</h2>
                <p className="sk-section-intro">{tool.description || "该工具未提供描述。"}</p>
              </section>

              {/* 参数定义 */}
              <section
                ref={(el) => { sectionRefs.current.params = el }}
                className="sk-detail-section"
                id="params"
              >
                <h2 className="sk-section-title">参数定义</h2>
                {params.length === 0 ? (
                  <p className="sk-section-intro">该工具无需输入参数，或未声明参数 schema。</p>
                ) : (
                  <div className="tl-param-table">
                    <div className="tl-param-row tl-param-head">
                      <span>参数</span>
                      <span>类型</span>
                      <span>必填</span>
                      <span>说明</span>
                    </div>
                    {params.map((p) => (
                      <div className="tl-param-row" key={p.name}>
                        <span className="tl-param-name">{p.name}</span>
                        <span className="tl-param-type">{p.type}</span>
                        <span className={`tl-param-required ${p.required ? "is-required" : ""}`}>
                          {p.required ? <><Check size={13} /> 必填</> : "可选"}
                        </span>
                        <span className="tl-param-desc">{p.description || "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
