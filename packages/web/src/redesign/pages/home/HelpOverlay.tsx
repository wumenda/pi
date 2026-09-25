import { useEffect, useState } from "react"
import {
  Bell,
  BookOpen,
  DatabaseZap,
  FileStack,
  Grid3x3,
  Home,
  PanelTop,
  PlayCircle,
  Target,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react"
import { navigateRedesign, useRedesignRoute } from "../../routes"
import { RedesignSidebar } from "../../components/RedesignSidebar"

/* ===== 帮助浮层内容数据（按现有功能编写） ===== */

interface HelpStep {
  title: string
  desc: string
  icon: LucideIcon
}

interface HelpNavItem {
  title: string
  desc: string
  icon: LucideIcon
  path: string
}

interface HelpFaqItem {
  question: string
  answer: string
}

const helpSteps: HelpStep[] = [
  {
    title: "选择改造目标",
    desc: "在首页从节能降碳、装置扩产能、产品质量提升、产品结构调整中选择目标，描述工厂现状与诉求，一键创建改造任务",
    icon: Target,
  },
  {
    title: "跟踪自主推进",
    desc: "进入会话工作台，AI 依次完成工厂认知、瓶颈诊断、改造推演、改造决策、工程指导；随时在对话流中补充信息或追问",
    icon: PlayCircle,
  },
  {
    title: "获取改造方案",
    desc: "任务完成后输出改造方案与报告，可在项目中心按项目回顾并继续历史会话",
    icon: FileStack,
  },
]

const helpNavItems: HelpNavItem[] = [
  { title: "首页", desc: "选择目标、描述现状，发起改造任务", icon: Home, path: "" },
  { title: "项目中心", desc: "项目与会话两级管理，回顾历史任务", icon: PanelTop, path: "projects" },
  { title: "知识库", desc: "标准规范、工艺原理等知识资产", icon: BookOpen, path: "knowledge" },
  { title: "技能库", desc: "专业分析方法与推演技能", icon: Grid3x3, path: "skills" },
  { title: "工具库", desc: "计算、解析与执行类工具", icon: Wrench, path: "tools" },
  { title: "数据中心", desc: "图纸、文档等数据资产管理", icon: DatabaseZap, path: "data-center" },
  { title: "消息中心", desc: "任务推进通知与提醒（预留）", icon: Bell, path: "messages" },
]

const helpFaqs: HelpFaqItem[] = [
  {
    question: "如何发起一次改造任务？",
    answer: "在首页选择目标卡片，输入工厂现状与诉求（可附资料），点击开始即可创建任务并进入会话工作台。",
  },
  {
    question: "任务推进中可以补充信息吗？",
    answer: "可以。在会话工作台右侧对话流中直接输入，AI 会结合新信息继续推进后续阶段。",
  },
  {
    question: "历史会话在哪里找回？",
    answer: "项目中心按项目归档所有会话，打开对应项目即可回顾或继续。",
  },
  {
    question: "Agent / Skill / Tool 如何协作？",
    answer: "Agent 负责智能调度与编排，Skill 提供专业方法与路径，Tool 执行计算、解析与操作，动态组织解决复杂改造问题。",
  },
]

/**
 * 帮助中心全屏浮层（#/help）。骨架复用产品理念浮层（concept-* 类）的交互形态：
 * Esc / 关闭按钮返回首页，功能导航直达对应页面。
 */
export function HelpOverlay() {
  const route = useRedesignRoute()
  const [isSidebarPinned, setIsSidebarPinned] = useState(false)

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
    // lineHeight 复位原因同 ConceptOverlay：抵消宿主 antd reset 的继承行高
    <section className="concept-overlay help-overlay" role="dialog" aria-modal="true" aria-labelledby="help-title" style={{ lineHeight: "normal" }}>
      <div className={`concept-canvas ${isSidebarPinned ? "sidebar-pinned" : ""}`}>
        <button
          className="sidebar-hot-zone"
          type="button"
          onClick={() => setIsSidebarPinned(true)}
          aria-label="展开导航栏"
          title="展开导航栏"
        />
        <RedesignSidebar
          isPinned={isSidebarPinned}
          onTogglePinned={() => setIsSidebarPinned((current) => !current)}
          route={route}
        />
        <div className="concept-main">
          <header className="concept-header">
            <div className="section-title compact">
              <span>?</span>
              <strong id="help-title">帮助中心</strong>
            </div>
            <div className="concept-actions">
              <button type="button" onClick={() => navigateRedesign("")}>
                <X size={19} />
                关闭
              </button>
            </div>
          </header>

          <div className="help-body">
            <section className="concept-card">
              <div className="section-title">
                <span>01</span>
                <strong>快速上手</strong>
                <small>三步发起并完成一次工业改造</small>
              </div>
              <div className="help-steps">
                {helpSteps.map((step, index) => {
                  const Icon = step.icon
                  return (
                    <article className="help-step" key={step.title}>
                      <span className="help-step-icon"><Icon size={24} /></span>
                      <strong>{index + 1}. {step.title}</strong>
                      <p>{step.desc}</p>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="concept-card">
              <div className="section-title">
                <span>02</span>
                <strong>功能导航</strong>
                <small>点击入口直达对应页面</small>
              </div>
              <div className="help-nav">
                {helpNavItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <button className="help-nav-item" type="button" key={item.title} onClick={() => navigateRedesign(item.path)}>
                      <Icon size={22} />
                      <span className="help-nav-copy">
                        <strong>{item.title}</strong>
                        <small>{item.desc}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="concept-card">
              <div className="section-title">
                <span>03</span>
                <strong>常见问题</strong>
              </div>
              <div className="help-faq">
                {helpFaqs.map((faq) => (
                  <article className="help-faq-item" key={faq.question}>
                    <strong>{faq.question}</strong>
                    <p>{faq.answer}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}
