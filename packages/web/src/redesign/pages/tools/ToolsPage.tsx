/** 工具库列表页：数据源 GET /api/v1/tool-library（opencode 配置中的 MCP tool） */
import { useEffect, useMemo, useState } from "react"
import {
  Search,
  Wrench,
  ArrowRight,
  FileImage,
  ScanText,
  GitFork,
  SlidersHorizontal,
  Boxes,
  FileSpreadsheet,
  Sparkles,
  Network,
  LineChart,
  FlaskConical,
  Scale,
  Flame,
  GitCompare,
  Calculator,
  ShieldCheck,
  RefreshCw,
  Gauge,
  Layers,
  FileText,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { fetchToolLibrary } from "../../../api/tool-library"
import { navigateRedesign } from "../../routes"
import { toolIconKeyOf, toolItemIdOf, toolThemeOf } from "./toolTypes"
import type { ToolLibraryItem } from "./toolTypes"
import { useTheme } from "../../theme"

// 图标 key 映射（toolTypes.toolIconKeyOf 按分类推导）
const iconMap: Record<string, LucideIcon> = {
  FileImage,
  ScanText,
  GitFork,
  SlidersHorizontal,
  Boxes,
  FileSpreadsheet,
  Sparkles,
  Network,
  LineChart,
  FlaskConical,
  Wrench,
  Scale,
  Flame,
  GitCompare,
  Calculator,
  ShieldCheck,
  RefreshCw,
  Gauge,
  Layers,
  FileText,
}

function getToolIcon(category: string): LucideIcon {
  return iconMap[toolIconKeyOf(category)] ?? Boxes
}

export function ToolsPage() {
  const [tools, setTools] = useState<ToolLibraryItem[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [appTheme] = useTheme()
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("全部")

  useEffect(() => {
    let cancelled = false
    fetchToolLibrary()
      .then((items) => {
        if (!cancelled) setTools(items)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 分类 tab：全部 + 实际出现的分类（中文序）；无数据时不展示
  const toolCategories = useMemo(() => {
    if (!tools) return []
    const cats = [...new Set(tools.map((t) => t.category))].sort((a, b) =>
      a.localeCompare(b, "zh"),
    )
    return ["全部", ...cats]
  }, [tools])

  const filteredTools = useMemo(() => {
    if (!tools) return []
    let result = tools
    if (activeCategory !== "全部") {
      result = result.filter((t) => t.category === activeCategory)
    }
    const keyword = search.trim().toLowerCase()
    if (keyword) {
      result = result.filter((t) =>
        [t.name, t.description ?? "", t.category, t.serverId]
          .join(" ")
          .toLowerCase()
          .includes(keyword),
      )
    }
    return result
  }, [tools, search, activeCategory])

  return (
    <main className="sk-page">
      <header className="sk-page-header">
        <div className="sk-page-header-left">
          <div className="sk-page-icon tl-page-icon"><Wrench size={26} /></div>
          <div>
            <h1>工具库</h1>
            <p>查看 opencode 已接入的 MCP 工具能力（插件接管与原生配置），了解它们的用途与参数。</p>
          </div>
        </div>
      </header>

      <div className="sk-toolbar">
        <div className="sk-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="搜索工具名称、说明或来源 server"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {tools !== null && toolCategories.length > 1 && (
        <div className="sk-category-tabs">
          {toolCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`sk-cat-tab ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {tools === null && !loadError && (
        <div className="sk-empty-state">
          <Loader2 size={40} className="tl-loading-spin" />
          <p>正在加载工具清单…</p>
        </div>
      )}
      {loadError && (
        <div className="sk-empty-state">
          <AlertTriangle size={40} />
          <p>工具清单加载失败</p>
          <span>{loadError}</span>
        </div>
      )}
      {tools !== null && filteredTools.length === 0 && (
        <div className="sk-empty-state">
          <Search size={40} />
          <p>未找到匹配的工具</p>
          <span>尝试调整关键词或筛选条件</span>
        </div>
      )}

      <section className="sk-card-grid tl-card-grid">
        {filteredTools.map((tool) => {
          const Icon = getToolIcon(tool.category)
          const theme = toolThemeOf(tool.category, appTheme === "dark")
          return (
            <article
              key={toolItemIdOf(tool)}
              className="sk-card tl-card"
              onClick={() => navigateRedesign(`tools/${encodeURIComponent(toolItemIdOf(tool))}`)}
            >
              <div className="sk-card-top">
                <div className="sk-card-icon tl-card-icon" style={{ color: theme.color, background: theme.bg }}>
                  <Icon size={24} />
                </div>
                <div className="sk-card-tags">
                  <span className="sk-tag tl-tag-cat" style={{ color: theme.chipColor, background: theme.chipBg }}>
                    {tool.category}
                  </span>
                  <span className="sk-tag tl-tag-source">{tool.source === "native" ? "原生" : "插件"}</span>
                </div>
              </div>
              <div className="sk-card-body">
                <h3 className="sk-card-name">{tool.name}</h3>
                <p className="sk-card-desc">{tool.description || "暂无工具描述。"}</p>
              </div>
              <div className="sk-card-footer">
                <span className="sk-scenario-chip" title={`来源 server：${tool.serverId}`}>
                  {tool.serverId}
                </span>
                <button type="button" className="sk-card-link">
                  查看详情 <ArrowRight size={14} />
                </button>
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
