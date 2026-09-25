/** 技能库列表页：展示 opencode 配置（全局 + 项目 skills 目录）中的 skill，数据来自 GET /api/v1/skills */
import { useEffect, useMemo, useState } from "react"
import {
  Search,
  Grid3x3,
  ArrowRight,
  CircleAlert,
  Network,
  Gauge,
  Lightbulb,
  FlaskConical,
  RefreshCw,
  FileImage,
  Table2,
  BadgeDollarSign,
  FileText,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SkillInfoDTO } from "@platform/shared"
import { fetchSkills } from "../../../api/settings"
import { navigateRedesign } from "../../routes"

/** SKILL.md frontmatter 未声明 meta 的技能归类为通用能力 */
export const GENERAL_CATEGORY = "通用能力"

/** 技能类型：frontmatter meta，未写则兜底「通用能力」 */
export function skillCategory(skill: Pick<SkillInfoDTO, "meta">): string {
  return skill.meta && skill.meta.length > 0 ? skill.meta : GENERAL_CATEGORY
}

/** 来源标注 */
export const SOURCE_LABELS = { global: "全局", project: "项目" } as const

// SKILL.md 无图标声明，按已知技能 name 做装饰性图标映射；未知技能用默认图标
const skillIconMap: Record<string, LucideIcon> = {
  plant_cognition: Network,
  process_diagnosis: Gauge,
  scheme_generator: Lightbulb,
  scheme_simulation: FlaskConical,
  scheme_optimizer: RefreshCw,
  pfd_parser: FileImage,
  data_processing_and_analysis: Table2,
  investment_estimation: BadgeDollarSign,
  feasibility_report_generation: FileText,
}

export function getSkillIcon(name: string): LucideIcon {
  return skillIconMap[name] || Grid3x3
}

function toolLabel(tool: SkillInfoDTO["tools"][number]): string {
  return typeof tool === "string" ? tool : (tool.title ?? tool.name)
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfoDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("全部")

  useEffect(() => {
    let cancelled = false
    fetchSkills()
      .then((list) => {
        if (cancelled) return
        setSkills(list)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError("技能清单加载失败，请稍后重试")
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 分类 Tab 动态生成：全部 + 数据中出现过的类型（去重，保持出现顺序）
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const skill of skills) {
      const cat = skillCategory(skill)
      if (!seen.includes(cat)) seen.push(cat)
    }
    return ["全部", ...seen]
  }, [skills])

  const filteredSkills = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return skills.filter((skill) => {
      if (activeCategory !== "全部" && skillCategory(skill) !== activeCategory) return false
      if (keyword.length === 0) return true
      const haystack = `${skill.name} ${skill.title ?? ""} ${skill.description ?? ""}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [skills, search, activeCategory])

  return (
    <main className="sk-page">
      <header className="sk-page-header">
        <div className="sk-page-header-left">
          <div className="sk-page-icon"><Grid3x3 size={26} /></div>
          <div>
            <h1>技能库</h1>
            <p>浏览 opencode 已配置的技能能力，快速了解系统可以完成哪些工作。</p>
          </div>
        </div>
      </header>

      <div className="sk-toolbar">
        <div className="sk-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="搜索技能，或描述你想解决的问题"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="sk-category-tabs">
        {categories.map((cat) => (
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

      <section className="sk-card-grid">
        {loading ? (
          <div className="sk-empty-state">
            <p>正在加载技能…</p>
          </div>
        ) : error ? (
          <div className="sk-empty-state">
            <CircleAlert size={40} />
            <p>{error}</p>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="sk-empty-state">
            <Search size={40} />
            <p>未找到匹配的技能</p>
            <span>尝试更换关键词或调整筛选条件</span>
          </div>
        ) : (
          filteredSkills.map((skill) => {
            const Icon = getSkillIcon(skill.name)
            return (
              <article
                key={skill.name}
                className="sk-card"
                onClick={() => navigateRedesign(`skills/${encodeURIComponent(skill.name)}`)}
              >
                <div className="sk-card-top">
                  <div className="sk-card-icon">
                    <Icon size={24} />
                  </div>
                  <div className="sk-card-tags">
                    <span className="sk-tag sk-tag-scope">{SOURCE_LABELS[skill.source]}</span>
                    <span className="sk-tag sk-tag-cat">{skillCategory(skill)}</span>
                  </div>
                </div>
                <div className="sk-card-body">
                  <h3 className="sk-card-name">{skill.title ?? skill.name}</h3>
                  <span className="sk-card-id">{skill.name}</span>
                  <p className="sk-card-desc">
                    {skill.description ?? (skill.metadataUnavailable ? "SKILL.md 缺失或解析失败，暂无描述。" : "暂无描述。")}
                  </p>
                </div>
                <div className="sk-card-footer">
                  <div className="sk-card-scenarios">
                    {skill.tools.slice(0, 3).map((tool) => (
                      <span key={toolLabel(tool)} className="sk-scenario-chip">{toolLabel(tool)}</span>
                    ))}
                  </div>
                  <button type="button" className="sk-card-link">
                    查看详情 <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            )
          })
        )}
      </section>
    </main>
  )
}
