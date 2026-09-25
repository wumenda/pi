import { useEffect } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  CircleHelp,
  ClipboardCheck,
  Cpu,
  DatabaseZap,
  FileStack,
  FlaskConical,
  Gauge,
  Leaf,
  LineChart,
  Network,
  PlayCircle,
  RefreshCw,
  Settings,
  Target,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { navigateRedesign } from "../../routes"

/* ===== 数据常量：移植自原型 App.jsx conceptGoalCards / conceptFlow / levels ===== */

interface ConceptGoalCard {
  title: string
  desc: string
  icon: LucideIcon
  tone: string
}

interface ConceptFlowItem {
  title: string
  output: string
  points: string[]
  icon: LucideIcon
}

interface LevelItem {
  title: string
  tag: string
  desc: string
}

const conceptGoalCards: ConceptGoalCard[] = [
  { title: "节能降碳", desc: "降低能耗与碳排放", icon: Leaf, tone: "green" },
  { title: "装置扩产能", desc: "提高装置加工能力，增加产量", icon: LineChart, tone: "blue" },
  { title: "产品质量提升", desc: "提高产品纯度、稳定性等", icon: FlaskConical, tone: "purple" },
  { title: "产品结构调整", desc: "调整产品结构，实现柔性化生产", icon: Boxes, tone: "orange" },
]

const conceptFlow: ConceptFlowItem[] = [
  { title: "工厂认知", output: "数字工厂模型", points: ["图纸识别", "文档解析", "工艺流程构建", "工厂知识建模"], icon: DatabaseZap },
  { title: "瓶颈诊断", output: "关键约束识别", points: ["设备瓶颈", "装置瓶颈", "系统瓶颈", "全厂瓶颈"], icon: Gauge },
  { title: "改造推演", output: "多方案设计", points: ["节能推演", "扩产推演", "提质推演", "产品结构优化"], icon: Network },
  { title: "改造决策", output: "最优方案选择", points: ["投资分析", "收益分析", "风险分析", "实施难度分析"], icon: ClipboardCheck },
  { title: "工程指导", output: "改造报告", points: ["设备选型与校核", "工艺计算", "图纸生成", "文档编写"], icon: FileStack },
]

const levels: LevelItem[] = [
  { title: "全厂级", tag: "示例", desc: "面向全厂整体收益与资源优化" },
  { title: "系统级", tag: "示例", desc: "面向公用工程与系统平衡优化" },
  { title: "装置级", tag: "示例", desc: "面向装置产能、能耗、收率优化" },
  { title: "设备级", tag: "示例", desc: "面向单机设备性能与可靠性优化" },
]

function ConceptBrain() {
  return (
    <div className="concept-brain" aria-hidden="true">
      <div className="brain-platform">
        <Cpu size={80} />
      </div>
      <span className="orbit o1" />
      <span className="orbit o2" />
      <span className="orbit o3" />
      <span className="orbit o4" />
    </div>
  )
}

/**
 * 原型产品理念全屏浮层（App.jsx ConceptOverlay，#concept）。
 * 集成说明：原型通过 props 共享侧边栏状态并以 onClose 关闭；复刻区浮层为独立路由（#/concept），
 * 关闭（Esc 或"返回首页"按钮）即 navigateRedesign("")。
 */
export function ConceptOverlay() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        navigateRedesign("")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    // lineHeight 复位原因同 HomePage：抵消宿主 antd reset 的继承行高，还原原型 normal 排版
    <section className="concept-overlay" role="dialog" aria-modal="true" aria-labelledby="concept-title" style={{ lineHeight: "normal" }}>
      <div className="concept-canvas">
        <div className="concept-main">
          <header className="concept-header">
            <div className="section-title compact">
              <span>01</span>
              <strong id="concept-title">产品理念</strong>
            </div>
            <div className="concept-actions">
              <button type="button" onClick={() => navigateRedesign("")}>
                <ArrowLeft size={19} />
                返回首页
              </button>
              <button type="button" onClick={() => navigateRedesign("help")}>
                <CircleHelp size={19} />
                帮助
              </button>
              <button type="button" className="demo-button">
                <PlayCircle size={20} />
                查看产品流程
              </button>
            </div>
          </header>

          <section className="concept-hero">
            <div className="concept-hero-copy">
              <h2>革新传统技改模式，<br />赋能工业改造</h2>
              <p>从目标理解、瓶颈推理到方案验证，构建自主推进工业改造的 AI 改造系统</p>
            </div>
            <ConceptBrain />
            <div className="concept-goals">
              {conceptGoalCards.map((item) => {
                const Icon = item.icon
                return (
                  <article className={`concept-goal tone-${item.tone}`} key={item.title}>
                    <span><Icon size={42} /></span>
                    <strong>{item.title}</strong>
                    <p>{item.desc}</p>
                  </article>
                )
              })}
            </div>
          </section>

          <div className="concept-grid">
            <section className="concept-card concept-flow-card">
              <div className="section-title">
                <span>02</span>
                <strong>能力全景</strong>
                <small>端到端自主推进工业改造</small>
              </div>
              <div className="concept-flow">
                {conceptFlow.map((item, index) => {
                  const Icon = item.icon
                  return (
                    <article className="concept-flow-item" key={item.title}>
                      <div className="concept-flow-icon"><Icon size={30} /></div>
                      <strong>{item.title}</strong>
                      <ul>
                        {item.points.map((point) => <li key={point}>{point}</li>)}
                      </ul>
                      <b>{item.output}</b>
                      {index < conceptFlow.length - 1 ? <ArrowRight className="concept-flow-arrow" size={26} /> : null}
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="concept-card level-card">
              <div className="section-title">
                <span>03</span>
                <strong>多层级改造需求</strong>
              </div>
              <div className="level-body">
                <div className="level-pyramid">
                  <div>全厂</div>
                  <div>系统</div>
                  <div>装置</div>
                  <div>设备</div>
                </div>
                <div className="level-list">
                  {levels.map((item) => (
                    <article key={item.title}>
                      <strong>{item.title}<em>{item.tag}</em></strong>
                      <p>{item.desc}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="concept-card agent-card">
              <div className="section-title">
                <span>04</span>
                <strong>Agent / Skill / Tool 生态</strong>
                <small>动态组织能力，解决复杂问题</small>
              </div>
              <div className="agent-map">
                <div className="agent-input">问题输入</div>
                <ArrowRight size={24} />
                <div className="agent-triad">
                  <div className="triad-node agent-node"><Cpu size={24} /><strong>Agent</strong><small>智能调度与编排</small></div>
                  <div className="triad-node skill-node"><Settings size={24} /><strong>Skill</strong><small>专业方法与路径</small></div>
                  <div className="triad-node tool-node"><Wrench size={24} /><strong>Tool</strong><small>计算、解析与执行</small></div>
                  <span className="triad-arrow arrow-a">↔</span>
                  <span className="triad-arrow arrow-b">↔</span>
                  <span className="triad-arrow arrow-c">↔</span>
                </div>
                <ArrowRight size={24} />
                <div className="agent-output">改造方案输出</div>
              </div>
              <div className="agent-steps">
                <span>自主规划</span>
                <span>动态选择</span>
                <span>协同执行</span>
                <span>结果验证</span>
              </div>
            </section>

            <section className="concept-card evolution-card">
              <div className="section-title">
                <span>05</span>
                <strong>工具在实践中持续进化</strong>
              </div>
              <div className="evolution-body">
                <div className="tool-types">
                  <b>工具体系</b>
                  <p><Wrench size={21} /><strong>内置工具</strong><small>沉淀行业通用工具，开箱即用</small></p>
                  <p><Target size={21} /><strong>衍生工具 - 通用工具</strong><small>适用于共性问题，跨项目复用</small></p>
                  <p><Boxes size={21} /><strong>衍生工具 - 个性工具</strong><small>针对特定工厂与问题，按需创造</small></p>
                </div>
                <div className="evolution-cycle">
                  <b>进化来源</b>
                  <span>新案例数据</span>
                  <span>新工况场景</span>
                  <span>用户反馈</span>
                </div>
                <div className="cycle-icon"><RefreshCw size={42} /></div>
                <div className="evolution-checks">
                  <b>持续进化</b>
                  <span>工具能力持续增强</span>
                  <span>覆盖场景持续扩展</span>
                  <span>分析效果持续提升</span>
                </div>
              </div>
            </section>

            <section className="concept-card knowledge-card">
              <div className="section-title">
                <span>06</span>
                <strong>知识与经验积累</strong>
              </div>
              <div className="knowledge-cols">
                <div>
                  <strong>案例库</strong>
                  {["扩产案例库", "节能案例库", "提质案例库", "系统优化案例库", "设备改造案例库"].map((item) => <p key={item}>{item}</p>)}
                </div>
                <div>
                  <strong>知识库</strong>
                  {["标准规范库", "工艺原理库", "工程设计库"].map((item) => <p key={item}>{item}</p>)}
                </div>
              </div>
            </section>
          </div>

          <footer className="concept-footer">
            从现状工厂到改造方案，从原始图纸到改造图纸，AI 端到端自主推进工业改造，创造最大价值
          </footer>
        </div>
      </div>
    </section>
  )
}
