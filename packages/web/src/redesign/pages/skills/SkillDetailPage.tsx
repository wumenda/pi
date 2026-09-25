/** 技能详情抽屉：展示单个 skill 的真实元数据与 SKILL.md 正文，数据来自 GET /api/v1/skills/:name */
import { useEffect, useState } from "react"
import { Grid3x3, Wrench, X, CircleAlert, FileWarning } from "lucide-react"
import type { SkillDetailDTO } from "@platform/shared"
import { fetchSkillDetail } from "../../../api/settings"
import { navigateRedesign } from "../../routes"
import { getSkillIcon, skillCategory, SOURCE_LABELS } from "./SkillsPage"

export function SkillDetailPage({ skillId }: { skillId: string }) {
  const [detail, setDetail] = useState<SkillDetailDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const onClose = (): void => navigateRedesign("skills")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSkillDetail(skillId)
      .then((data) => {
        if (cancelled) return
        setDetail(data)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError("技能详情加载失败，请稍后重试")
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [skillId])

  const Icon = detail ? getSkillIcon(detail.name) : Grid3x3

  return (
    <div className="sk-drawer-overlay" onClick={onClose}>
      <aside className="sk-drawer" onClick={(e) => e.stopPropagation()}>
        {/* 抽屉头 */}
        <header className="sk-drawer-header">
          <div className="sk-drawer-header-main">
            <div className="sk-drawer-icon"><Icon size={26} /></div>
            <div className="sk-drawer-title-area">
              <div className="sk-drawer-title-row">
                <h2>{detail ? (detail.title ?? detail.name) : skillId}</h2>
                {detail ? (
                  <div className="sk-detail-tags">
                    <span className="sk-tag sk-tag-scope">{SOURCE_LABELS[detail.source]}</span>
                    <span className="sk-tag sk-tag-cat">{skillCategory(detail)}</span>
                  </div>
                ) : null}
              </div>
              {detail?.description ? <p className="sk-drawer-desc">{detail.description}</p> : null}
            </div>
          </div>
          <button type="button" className="sk-drawer-close" onClick={onClose}>
            <X size={22} />
          </button>
        </header>

        <div className="sk-drawer-body">
          <div className="sk-detail-content">
            <div className="sk-detail-main">
              {loading ? (
                <section className="sk-detail-section">
                  <p className="sk-section-intro">正在加载技能详情…</p>
                </section>
              ) : error ? (
                <section className="sk-detail-section">
                  <div className="sk-tools-empty">
                    <CircleAlert size={32} />
                    <p>{error}</p>
                  </div>
                </section>
              ) : detail ? (
                <>
                  {/* 专业工具 */}
                  <section className="sk-detail-section">
                    <h2 className="sk-section-title">专业工具</h2>
                    <p className="sk-section-intro">本技能在执行任务时，会根据任务需要自动调用以下工具（SKILL.md tools 声明）。</p>
                    {detail.tools.length === 0 ? (
                      <div className="sk-tools-empty">
                        <Wrench size={32} />
                        <p>本技能未声明专业工具。</p>
                      </div>
                    ) : (
                      <div className="sk-tool-grid">
                        {detail.tools.map((tool) => {
                          const name = typeof tool === "string" ? tool : tool.name
                          const title = typeof tool === "string" ? undefined : tool.title
                          return (
                            <div className="sk-tool-card" key={name}>
                              <div className="sk-tool-icon"><Wrench size={20} /></div>
                              <div className="sk-tool-body">
                                <h4>{title ?? name}</h4>
                                <code className="sk-tool-id">{name}</code>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  {/* SKILL.md 正文 */}
                  <section className="sk-detail-section">
                    <h2 className="sk-section-title">技能定义（SKILL.md）</h2>
                    {detail.metadataUnavailable ? (
                      <div className="sk-tools-empty">
                        <FileWarning size={32} />
                        <p>SKILL.md 缺失或 frontmatter 解析失败，仅显示技能名。</p>
                      </div>
                    ) : (
                      <pre className="sk-skill-md">{detail.body}</pre>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
