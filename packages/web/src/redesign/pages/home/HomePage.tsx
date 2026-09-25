import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  BadgeDollarSign,
  BookOpen,
  Boxes,
  Check,
  CircleHelp,
  DatabaseZap,
  FileStack,
  FileText,
  FlaskConical,
  Gauge,
  Image,
  Leaf,
  LineChart,
  Map as MapIcon,
  Network,
  Plus,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Target,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { navigateRedesign, useRedesignRoute } from "../../routes"

/* ===== 数据常量：移植自原型 App.jsx goalCards / diagnosisCards / homeSlides / attachmentActions / flowItems / supportItems ===== */

type SlideKey = "goal" | "diagnosis"

interface HomeCard {
  id: string
  title: string
  desc: string[]
  icon: LucideIcon
  tone: string
  prompt: string
}

interface HomeSlide {
  key: SlideKey
  eyebrow: string
  title: string
  subtitle: string
  description: string
  sectionTitle: string
  cards: HomeCard[]
  inputLabel: string
  placeholder: string
  buttonText: string
  loadingText: string
  emptyNotice: string
  appliedNotice: string
  customNotice: string
}

interface AttachmentAction {
  key: string
  label: string
  hint: string
  icon: LucideIcon
  accept: string
}

interface EntryAttachment {
  id: string
  name: string
  size: number
  type: string
  sourceLabel: string
}

interface CapabilityItem {
  title: string
  desc: string
  icon: LucideIcon
}

const goalCards: HomeCard[] = [
  {
    id: "carbon",
    title: "节能降碳",
    desc: ["蒸汽系统能耗偏高，", "想降低蒸汽消耗，", "并识别高价值", "节能改造点。"],
    icon: Leaf,
    tone: "green",
    prompt: "蒸汽系统能耗偏高，希望降低蒸汽消耗，并识别高价值节能改造点。",
  },
  {
    id: "capacity",
    title: "装置扩产",
    desc: ["装置想扩产 20%，", "希望少改动、低投资，", "充分利用现有", "装置与公用工程。"],
    icon: LineChart,
    tone: "blue",
    prompt: "装置想扩产 20%，希望少改动、低投资，充分利用现有装置与公用工程。",
  },
  {
    id: "quality",
    title: "提升产品质量",
    desc: ["产品纯度波动较大，", "想提升质量稳定性，", "并找出影响", "质量的关键因素。"],
    icon: FlaskConical,
    tone: "purple",
    prompt: "产品纯度波动较大，希望提升产品质量稳定性，并识别关键影响因素。",
  },
  {
    id: "structure",
    title: "调整产品结构",
    desc: ["希望提高高价值", "产品占比，", "同时评估对装置", "负荷的影响。"],
    icon: Boxes,
    tone: "orange",
    prompt: "希望优化产品结构，提高高价值产品比例，并评估对装置负荷的影响。",
  },
  {
    id: "profit",
    title: "提高收益",
    desc: ["在现有装置和公用", "工程约束下，", "识别高价值改造机会，", "提升全厂收益。"],
    icon: BadgeDollarSign,
    tone: "gold",
    prompt: "希望在现有装置和公用工程约束下提升收益，识别高价值改造机会。",
  },
  {
    id: "custom",
    title: "自定义目标",
    desc: ["描述任意复杂", "改造目标，", "AI 自动识别任务", "层级和所需资料。"],
    icon: SlidersHorizontal,
    tone: "gray",
    prompt: "我有一个复杂改造目标，希望 AI 帮我识别任务层级、所需资料和验证路径。",
  },
]

const diagnosisCards: HomeCard[] = [
  {
    id: "capacity-blocked",
    title: "产能上不去",
    desc: ["装置负荷难以提升，", "扩产后受限点不清楚，", "需要先定位", "关键瓶颈。"],
    icon: LineChart,
    tone: "green",
    prompt: "装置负荷一直上不去，扩产后受限点不清楚，希望 AI 先诊断关键瓶颈。",
  },
  {
    id: "energy-high",
    title: "能耗偏高",
    desc: ["蒸汽、电、燃料气等", "消耗偏高，", "原因不明确，", "需要定位能耗瓶颈。"],
    icon: Zap,
    tone: "blue",
    prompt: "蒸汽、电、燃料气等消耗偏高，原因不明确，希望 AI 帮我定位能耗瓶颈。",
  },
  {
    id: "quality-unstable",
    title: "质量不稳定",
    desc: ["产品指标波动、", "杂质超标或收率下降，", "需要诊断影响", "质量的关键因素。"],
    icon: FlaskConical,
    tone: "purple",
    prompt: "产品指标波动、杂质超标或收率下降，希望 AI 诊断影响质量稳定性的关键因素。",
  },
  {
    id: "system-imbalance",
    title: "系统不平衡",
    desc: ["蒸汽、氢气、燃料气、", "换热网络存在错配，", "需要识别", "系统失衡来源。"],
    icon: Network,
    tone: "orange",
    prompt: "蒸汽、氢气、燃料气、换热网络存在错配，希望 AI 识别系统失衡来源。",
  },
  {
    id: "equipment-bottleneck",
    title: "设备有问题",
    desc: ["换热器、塔器、", "压缩机等设备", "限制运行表现，", "需要诊断瓶颈。"],
    icon: Settings,
    tone: "gold",
    prompt: "换热器、塔器、压缩机等设备限制运行表现，希望 AI 诊断设备瓶颈。",
  },
  {
    id: "unknown-cause",
    title: "说不清原因",
    desc: ["只有异常现象，", "暂时无法判断", "问题来源，", "需要先诊断瓶颈。"],
    icon: CircleHelp,
    tone: "gray",
    prompt: "现场只有异常现象，暂时无法判断问题来源，希望 AI 先帮我诊断瓶颈在哪里。",
  },
]

const homeSlides: HomeSlide[] = [
  {
    key: "goal",
    eyebrow: "AI for redesign",
    title: "你的改造目标是什么？",
    subtitle: "AI 自主理解 · 跨专业协同 · 生成最优方案 · 推动落地执行",
    description: "从目标理解到方案验证，AI 自主推进工业改造项目",
    sectionTitle: "我希望：",
    cards: goalCards,
    inputLabel: "描述你的目标",
    placeholder: "例如：全厂收益提升20% | 装置扩产15% | 蒸汽系统能耗降低10% | 换热网络节能优化 ...",
    buttonText: "启动任务",
    loadingText: "正在创建任务...",
    emptyNotice: "请先描述一个改造目标、选择上方目标模板，或上传相关资料",
    appliedNotice: "已套用“{title}”目标模板，可继续编辑",
    customNotice: "已切换为自定义目标，可直接描述复杂改造需求",
  },
  {
    key: "diagnosis",
    eyebrow: "AI for redesign",
    title: "先诊断，再改造",
    subtitle: "AI 先理解运行现象 · 定位关键瓶颈 · 确定改造方向",
    description: "从运行异常到瓶颈定位，AI 自主识别关键约束",
    sectionTitle: "我遇到的问题是：",
    cards: diagnosisCards,
    inputLabel: "描述你观察到的问题",
    placeholder: "例如：装置负荷一直上不去 | 蒸汽系统能耗偏高 | 产品纯度波动 | 换热网络温差异常 | 压缩机接近满负荷 | 不知道瓶颈在哪里",
    buttonText: "开始诊断",
    loadingText: "正在启动诊断...",
    emptyNotice: "请先描述观察到的问题、选择上方问题模板，或上传相关资料",
    appliedNotice: "已套用“{title}”问题模板，可继续补充现场现象",
    customNotice: "已选择不确定原因，可直接描述现场异常现象",
  },
]

const attachmentActions: AttachmentAction[] = [
  {
    key: "image",
    label: "添加照片",
    hint: "现场照片 / 仪表截图",
    icon: Image,
    accept: "image/*",
  },
  {
    key: "document",
    label: "添加文件",
    hint: "PDF / Word / 报告",
    icon: FileText,
    accept: ".pdf,.doc,.docx,.txt",
  },
  {
    key: "spreadsheet",
    label: "添加运行数据",
    hint: "Excel / CSV 数据表",
    icon: Table2,
    accept: ".xls,.xlsx,.csv",
  },
  {
    key: "drawing",
    label: "添加图纸资料",
    hint: "PFD / PID / 流程图",
    icon: MapIcon,
    accept: ".pdf,.png,.jpg,.jpeg,.dwg,.dxf",
  },
]

const flowItems: CapabilityItem[] = [
  {
    title: "多源数据理解",
    desc: "图纸、文档、运行数据全面解析与结构化",
    icon: DatabaseZap,
  },
  {
    title: "跨专业协同分析",
    desc: "工艺、设备、公用工程等多专业协同推理",
    icon: Network,
  },
  {
    title: "方案设计与评估",
    desc: "多方案设计、仿真验证、经济与风险评估",
    icon: Sparkles,
  },
  {
    title: "最优方案决策",
    desc: "综合收益、投资、风险，选择最优落地方案",
    icon: ShieldCheck,
  },
  {
    title: "工程落地指导",
    desc: "图纸输出、设备选型，实施与跟踪闭环",
    icon: FileStack,
  },
]

const supportItems: CapabilityItem[] = [
  { title: "知识驱动，持续进化", desc: "海量知识库与案例库支撑", icon: BookOpen },
  { title: "工具增强，深度计算", desc: "内置 + 自定义工具，持续扩展", icon: Wrench },
  { title: "可信可靠，安全合规", desc: "企业级安全保障，数据可控", icon: ShieldCheck },
]

/* ===== 子组件：移植自原型 App.jsx TopActions / GoalCard / IndustrialMap / CapabilityPanorama / ProjectLaunchTransition ===== */

function TopActions({ onOpenConcept, onOpenHelp }: { onOpenConcept: () => void; onOpenHelp: () => void }) {
  return (
    <div className="top-actions">
      <button type="button" onClick={onOpenHelp}>
        <CircleHelp size={20} />
        帮助
      </button>
      <button type="button" className="idea-link" onClick={onOpenConcept}>
        <Target size={22} />
        产品理念
      </button>
    </div>
  )
}

function GoalCard({
  card,
  selected,
  onSelect,
}: {
  card: HomeCard
  selected: boolean
  onSelect: () => void
}) {
  const Icon = card.icon
  return (
    <button
      type="button"
      className={`goal-card tone-${card.tone} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="goal-icon">
        <Icon size={45} strokeWidth={2.2} />
      </span>
      <span className="goal-copy">
        <strong>{card.title}</strong>
        {card.desc.map((line) => (
          <small key={line}>{line}</small>
        ))}
      </span>
      <span className="selected-check">
        <Check size={14} />
      </span>
    </button>
  )
}

function IndustrialMap({ variant = "goal" }: { variant?: SlideKey }) {
  const isDiagnosis = variant === "diagnosis"
  return (
    <div className={`industrial-map ${isDiagnosis ? "diagnosis-map" : "goal-map"}`} aria-hidden="true">
      <div className="grid-plane" />
      <div className="data-card card-a">
        {isDiagnosis ? <LineChart size={26} /> : <Gauge size={26} />}
        <span />
        <span />
      </div>
      <div className="data-card card-b">
        {isDiagnosis ? <Network size={28} /> : <LineChart size={28} />}
        <span />
        <span />
      </div>
      {isDiagnosis ? (
        <>
          <div className="diagnosis-lens">
            <Gauge size={34} />
          </div>
          <div className="diagnosis-wave">
            <span />
            <span />
            <span />
          </div>
        </>
      ) : null}
      <div className="plant plant-a">
        <i />
        <b />
        <em />
      </div>
      <div className="plant plant-b">
        <i />
        <b />
        <em />
      </div>
      <div className="plant plant-c">
        <i />
        <b />
        <em />
      </div>
      <div className="pipe pipe-one" />
      <div className="pipe pipe-two" />
      <div className="pipe pipe-three" />
      <div className="node node-a">{isDiagnosis ? <LineChart size={30} /> : <Leaf size={30} />}</div>
      <div className="node node-b">{isDiagnosis ? <FlaskConical size={30} /> : <FlaskConical size={30} />}</div>
      <div className="node node-c">{isDiagnosis ? <Zap size={31} /> : <Zap size={31} />}</div>
      <div className="node node-d">{isDiagnosis ? <Network size={28} /> : <Settings size={28} />}</div>
      <div className="node node-e">{isDiagnosis ? <CircleHelp size={30} /> : <BadgeDollarSign size={30} />}</div>
      <div className="central-chip">
        <div className="brand-mark large">
          <div className="brand-core" />
        </div>
      </div>
    </div>
  )
}

function CapabilityPanorama() {
  return (
    <section className="capability" aria-labelledby="capability-title">
      <h2 id="capability-title">AI 能力全景，赋能工业改造全流程</h2>
      <div className="flow-row">
        {flowItems.map((item, index) => {
          const Icon = item.icon
          return (
            <article className="flow-card" key={item.title}>
              <Icon size={27} />
              <strong>{item.title}</strong>
              <p>{item.desc}</p>
              {index < flowItems.length - 1 ? <ArrowRight className="flow-arrow" size={28} /> : null}
            </article>
          )
        })}
      </div>
      <div className="support-row">
        {supportItems.map((item) => {
          const Icon = item.icon
          return (
            <div className="support-item" key={item.title}>
              <Icon size={24} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.desc}</small>
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ProjectLaunchTransition() {
  return (
    <section className="project-launch-transition" role="status" aria-live="polite" style={{ lineHeight: "normal" }}>
      <div className="launch-brand-mark">
        <div className="brand-mark">
          <div className="brand-core" />
        </div>
      </div>
      <div className="launch-copy">
        <span>AI for Redesign</span>
        <h2>正在理解改造目标</h2>
        <p>识别任务层级、目标理解与装置边界，准备生成首个执行阶段</p>
      </div>
      <div className="launch-progress" aria-hidden="true">
        <i />
      </div>
      <div className="launch-status-list">
        <span className="active">解析目标语义</span>
        <span>确认改造边界</span>
        <span>进入目标理解</span>
      </div>
    </section>
  )
}

/**
 * 原型首页（App.jsx activePage==='home' 分支）：双 slide 轮播 + 目标/问题卡片 + 目标输入区 + AI 能力全景。
 * 集成说明：ShellApp 统一提供 .workspace.workspace-page 容器（workspace-page 会清零内边距并隐藏装饰，
 * 原型首页依赖 .workspace 自身的 padding 与 ::before/::after），故此处按原型 DOM 再嵌套一层
 * <section className="workspace"> 还原原型布局环境；打开产品理念浮层为 navigateRedesign("concept")。
 * onStartTask：首页「启动任务/开始诊断」的真实回调（创建会话 + 发送目标 + 跳工作台，见 ConsoleHome）。
 */
export function HomePage({ onStartTask }: { onStartTask: (text: string) => Promise<void> }) {
  const route = useRedesignRoute()
  const isConceptOpen = route.page === "concept"
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [isCarouselPaused, setIsCarouselPaused] = useState(false)
  const [selectedCards, setSelectedCards] = useState<Record<SlideKey, string | null>>({
    goal: null,
    diagnosis: null,
  })
  const [entryInputs, setEntryInputs] = useState<Record<SlideKey, string>>({ goal: "", diagnosis: "" })
  const [entryAttachments, setEntryAttachments] = useState<Record<SlideKey, EntryAttachment[]>>({
    goal: [],
    diagnosis: [],
  })
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [pendingAttachmentType, setPendingAttachmentType] = useState<AttachmentAction>(attachmentActions[0]!)
  const [isCreating, setIsCreating] = useState(false)
  const [notice, setNotice] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeSlide = homeSlides[activeSlideIndex]!
  const activeEntryInput = entryInputs[activeSlide.key] || ""
  const activeAttachments = entryAttachments[activeSlide.key] || []

  useEffect(() => {
    if (isCarouselPaused || isCreating || isConceptOpen) return undefined
    const timer = window.setInterval(() => {
      setActiveSlideIndex((current) => (current + 1) % homeSlides.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [isCarouselPaused, isCreating, isConceptOpen])

  useEffect(() => {
    if (!isCreating) setNotice("")
    setIsAttachmentMenuOpen(false)
  }, [activeSlideIndex, isCreating])

  function setEntryInput(entryKey: SlideKey, value: string) {
    setEntryInputs((current) => ({
      ...current,
      [entryKey]: value,
    }))
  }

  function switchHomeSlide(targetIndex: number) {
    if (targetIndex === activeSlideIndex) return
    setActiveSlideIndex(targetIndex)
  }

  function openAttachmentPicker(action: AttachmentAction) {
    setPendingAttachmentType(action)
    setIsAttachmentMenuOpen(false)
    window.requestAnimationFrame(() => fileInputRef.current?.click())
  }

  function addEntryAttachments(entryKey: SlideKey, files: File[]) {
    if (!files.length) return
    const newAttachments = files.map((file) => ({
      id: `${entryKey}-${Date.now()}-${file.name}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      size: file.size,
      type: pendingAttachmentType.key,
      sourceLabel: pendingAttachmentType.label.replace("添加", ""),
    }))
    setEntryAttachments((current) => ({
      ...current,
      [entryKey]: [...(current[entryKey] || []), ...newAttachments],
    }))
    setNotice(`已添加 ${newAttachments.length} 个资料，可继续补充描述`)
  }

  function removeEntryAttachment(entryKey: SlideKey, attachmentId: string) {
    setEntryAttachments((current) => ({
      ...current,
      [entryKey]: (current[entryKey] || []).filter((item) => item.id !== attachmentId),
    }))
  }

  function formatAttachmentSize(size: number) {
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`
    return `${(size / 1024 / 1024).toFixed(1)}MB`
  }

  function selectHomeCard(card: HomeCard, slide: HomeSlide) {
    setSelectedCards((current) => ({
      ...current,
      [slide.key]: card.id,
    }))
    if (card.id === "custom") {
      inputRef.current?.focus()
      setNotice(slide.customNotice)
      return
    }
    setEntryInput(slide.key, card.prompt)
    setNotice(slide.appliedNotice.replace("{title}", card.title))
  }

  function startProject() {
    if (!activeEntryInput.trim()) {
      // 附件仅作本地展示（未接入上传），启动必须携带文字描述，
      // 否则会创建空会话并向 Agent 发送空消息
      setNotice(
        activeAttachments.length > 0
          ? "请补充任务描述后启动（当前附件暂不随任务上传）"
          : activeSlide.emptyNotice,
      )
      inputRef.current?.focus()
      return
    }
    setIsCreating(true)
    setNotice(
      activeSlide.key === "diagnosis"
        ? "正在启动诊断：AI 正在理解运行现象、定位瓶颈并准备进入执行流程"
        : "正在创建项目：AI 正在理解目标、拆解任务并准备进入执行流程",
    )
    void onStartTask(activeEntryInput.trim())
      .catch(() => {
        // 启动失败给出反馈，同时避免 unhandled rejection
        setNotice("任务启动失败，请确认后端服务已启动后重试")
      })
      .finally(() => setIsCreating(false))
  }

  return (
    <>
      {/* lineHeight: 宿主 antd reset 给 body 加了 line-height:1.5715 并继承下来，原型全部按 normal 排版；
          在页面根节点复位为 normal，保证与原型一致的计算行高（不影响原型 CSS 中显式 line-height 规则） */}
      <section className="workspace" style={{ lineHeight: "normal" }}>
        <TopActions onOpenConcept={() => navigateRedesign("concept")} onOpenHelp={() => navigateRedesign("help")} />
        <div
          className="home-carousel-region"
          onMouseEnter={() => setIsCarouselPaused(true)}
          onMouseLeave={() => setIsCarouselPaused(false)}
        >
          <div className="home-carousel-viewport">
            <div className="home-carousel-track">
              {[activeSlide].map((slide, slideIndex) => {
                const slideInput = entryInputs[slide.key] || ""
                const slideAttachments = entryAttachments[slide.key] || []
                const selectedCard = selectedCards[slide.key]
                const isActive = true
                const fieldId = `goal-input-${slide.key}-${slideIndex}`
                const titleId = `goal-title-${slide.key}-${slideIndex}`
                return (
                  <div
                    className="home-carousel-content"
                    key={`${slide.key}-${slideIndex}`}
                    aria-hidden={!isActive}
                  >
                    <section className="hero">
                      <div className="hero-copy">
                        <p className="eyebrow">{slide.eyebrow}</p>
                        <h1>{slide.title}</h1>
                        <p className="hero-subtitle">{slide.subtitle}</p>
                        <p className="hero-desc">{slide.description}</p>
                        <div className="carousel-dots" aria-label="首页入口切换">
                          {homeSlides.map((dotSlide, index) => (
                            <button
                              key={dotSlide.key}
                              type="button"
                              className={index === activeSlideIndex ? "active" : ""}
                              aria-label={`切换到第 ${index + 1} 页`}
                              aria-current={index === activeSlideIndex ? "true" : undefined}
                              onClick={() => switchHomeSlide(index)}
                            />
                          ))}
                        </div>
                      </div>
                      <IndustrialMap variant={slide.key} />
                    </section>

                    <section className="goal-section" aria-labelledby={titleId}>
                      <h2 id={titleId}>{slide.sectionTitle}</h2>
                      <div className="goal-grid">
                        {slide.cards.map((card) => (
                          <GoalCard
                            key={card.id}
                            card={card}
                            selected={selectedCard === card.id}
                            onSelect={() => selectHomeCard(card, slide)}
                          />
                        ))}
                      </div>
                    </section>

                    <section className="input-panel" aria-label={slide.inputLabel}>
                      <div className="input-area">
                        <label htmlFor={fieldId}>{slide.inputLabel}</label>
                        {slideAttachments.length > 0 ? (
                          <div className="attachment-chip-list" aria-label="已添加资料">
                            {slideAttachments.map((attachment) => (
                              <span className="attachment-chip" key={attachment.id}>
                                <FileStack size={15} />
                                <span>{attachment.name}</span>
                                <em>{formatAttachmentSize(attachment.size)}</em>
                                <button
                                  type="button"
                                  aria-label={`移除 ${attachment.name}`}
                                  onClick={() => removeEntryAttachment(slide.key, attachment.id)}
                                >
                                  <X size={13} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="input-control">
                          <div className="attachment-picker">
                            <button
                              className="attachment-add-button"
                              type="button"
                              aria-label="添加资料"
                              aria-expanded={isAttachmentMenuOpen}
                              onClick={() => setIsAttachmentMenuOpen((current) => !current)}
                            >
                              <Plus size={22} />
                            </button>
                            {isAttachmentMenuOpen ? (
                              <div className="attachment-menu" role="menu">
                                {attachmentActions.map((action) => {
                                  const ActionIcon = action.icon
                                  return (
                                    <button
                                      key={action.key}
                                      type="button"
                                      role="menuitem"
                                      onClick={() => openAttachmentPicker(action)}
                                    >
                                      <ActionIcon size={17} />
                                      <span>
                                        <strong>{action.label}</strong>
                                        <small>{action.hint}</small>
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            ) : null}
                          </div>
                          <input
                            id={fieldId}
                            ref={(node) => {
                              if (isActive) inputRef.current = node
                            }}
                            value={slideInput}
                            onChange={(event) => setEntryInput(slide.key, event.target.value)}
                            placeholder={slide.placeholder}
                            tabIndex={isActive ? 0 : -1}
                          />
                          <input
                            ref={fileInputRef}
                            className="attachment-file-input"
                            type="file"
                            multiple
                            accept={pendingAttachmentType.accept}
                            onChange={(event) => {
                              addEntryAttachments(slide.key, Array.from(event.target.files || []))
                              event.target.value = ""
                            }}
                            tabIndex={-1}
                          />
                        </div>
                      </div>
                      <button
                        className="start-button"
                        type="button"
                        onClick={startProject}
                        disabled={isCreating}
                        tabIndex={isActive ? 0 : -1}
                      >
                        <span>{isCreating && isActive ? slide.loadingText : slide.buttonText}</span>
                        {isCreating && isActive ? <span className="spinner" /> : <ArrowRight size={25} />}
                      </button>
                    </section>
                  </div>
                )
              })}
            </div>
          </div>
          <p className={`status-line ${notice ? "visible" : ""}`}>{notice}</p>
        </div>

        <CapabilityPanorama />
      </section>
      {isCreating ? <ProjectLaunchTransition /> : null}
    </>
  )
}
