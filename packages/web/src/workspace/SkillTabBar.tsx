import { Fragment, useEffect, useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import { SOLO_GROUP_KEY, useAppStore } from "../stores/app-store"

/**
 * 顶层分组 Tab 栏（通用技能分组数据源 + 任务步进器外观）：
 * - 数据完全通用：每个 Skill **实例**一个 Tab（skillInstances[]，同名 Skill 每次读取
 *   一条并追加序号）；存在不属于任何 Skill 实例声明的 tool iframe 时追加「单独调用」
 *   分组 Tab。工具归属由 SKILL.md tools 声明驱动，本组件不含任何业务特例。
 * - 外观复用原型 .task-stepper 步进器样式（编号圆点 + 标题 + 箭头连接 + active/done
 *   进度态，styles.css），副标题槽位留空（通用实例无此数据）。
 */
export function SkillTabBar() {
  const skillInstances = useAppStore((s) => s.skillInstances)
  const skillWhitelist = useAppStore((s) => s.skillWhitelist)
  const activeSkillName = useAppStore((s) => s.activeSkillName)
  const iframePool = useAppStore((s) => s.iframePool)
  const setActiveSkill = useAppStore((s) => s.setActiveSkill)
  // 会话标识作根节点 key：进入/切换会话时重挂载 Tab 栏，重放自上而下入场动画
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  // 点击该组件后激活，可用滚轮水平滚动 Tab（点击组件外部停用）
  const barRef = useRef<HTMLDivElement>(null)
  const [wheelActive, setWheelActive] = useState(false)
  useEffect(() => {
    if (!wheelActive) return
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setWheelActive(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [wheelActive])
  // 激活状态下把纵向滚轮增量转为水平滚动。
  // React 合成 onWheel 是 passive 监听，preventDefault 无效（页面同时纵向滚动），
  // 必须挂原生非 passive 监听
  useEffect(() => {
    if (!wheelActive) return
    const bar = barRef.current
    if (!bar) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      bar.scrollLeft += e.deltaY
    }
    bar.addEventListener("wheel", onWheel, { passive: false })
    return () => bar.removeEventListener("wheel", onWheel)
  }, [wheelActive])

  const soloCount = [...iframePool.values()].filter(
    (instance) => (instance.group ?? SOLO_GROUP_KEY) === SOLO_GROUP_KEY,
  ).length

  // 白名单过滤（渲染时，iframe-rendering.md 4.6）：空 = 全部允许（与现状一致）；
  // 非空 = 仅白名单声明的 skill 创建 Tab。白名单按 name 匹配——同一 skill 的
  // 所有实例 Tab 一视同仁（命中 → 全部实例 Tab 显示；未命中 → 全部隐藏）。
  // 归属判定不受影响（4.1，白名单外 skill 的 iframe 仍正确归属，只是无 Tab 入口）。
  const whitelistEnabled = skillWhitelist.length > 0
  const whitelistedNames = new Set(skillWhitelist.map((w) => w.name))
  const visibleInstances = whitelistEnabled
    ? skillInstances.filter((inst) => whitelistedNames.has(inst.name))
    : skillInstances

  // a11y（T9）：Tab 键序 = 可见实例 + 单独调用；方向键/Home/End 在 Tab 间漫游（循环），
  // roving tabindex 仅激活 Tab 可聚焦
  const tabKeys = [
    ...visibleInstances.map((inst) => `${inst.name}#${inst.instanceId}`),
    ...(soloCount > 0 ? [SOLO_GROUP_KEY] : []),
  ]
  const activeTabIndex = Math.max(0, tabKeys.indexOf(activeSkillName ?? ""))
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const right = e.key === "ArrowRight"
    const left = e.key === "ArrowLeft"
    if (!right && !left && e.key !== "Home" && e.key !== "End") return
    e.preventDefault()
    const n = tabKeys.length
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? n - 1
          : right
            ? (activeTabIndex + 1) % n
            : (activeTabIndex - 1 + n) % n
    const key = tabKeys[next]
    if (key === undefined) return
    setActiveSkill(key)
    tabRefs.current[next]?.focus()
  }

  if (skillInstances.length === 0 && soloCount === 0) return null

  return (
    <div className="session-center-top">
      <div
        className="task-stepper"
        key={currentSessionId ?? "none"}
        ref={barRef}
        role="tablist"
        aria-label="分组工作区"
        onClick={() => setWheelActive(true)}
      >
        {visibleInstances.map((inst, index) => {
          const instanceKey = `${inst.name}#${inst.instanceId}`
          // 同名实例追加序号（按 name 分组内出现序：设备管理、设备管理 (2)…，4.4）。
          // 以 skillInstances 全量数组定位自身序号，避免白名单过滤后 index 偏移
          const ownIndex = skillInstances.findIndex(
            (i) => i.instanceId === inst.instanceId,
          )
          const ordinal = skillInstances
            .slice(0, ownIndex + 1)
            .filter((i) => i.name === inst.name).length
          const label = `${inst.title ?? inst.name}${ordinal > 1 ? ` (${ordinal})` : ""}`
          const tabIndex = instanceKey === activeSkillName ? 0 : -1
          // 步进器进度态：激活 Tab 高亮，序号在其前的 Tab 记为已走过（done）
          const stateClass =
            instanceKey === activeSkillName ? "active" : index < activeTabIndex ? "done" : ""
          return (
            <Fragment key={instanceKey}>
              {index > 0 && <ArrowRight className="step-arrow" size={18} aria-hidden="true" />}
              <button
                type="button"
                ref={(el) => {
                  tabRefs.current[index] = el
                }}
                className={stateClass}
                role="tab"
                aria-selected={instanceKey === activeSkillName}
                aria-label={label}
                tabIndex={tabIndex}
                onClick={() => setActiveSkill(instanceKey)}
                onKeyDown={onTabKeyDown}
              >
                <span>{index + 1}</span>
                <strong>{label}</strong>
              </button>
            </Fragment>
          )
        })}
        {soloCount > 0 && (
          <>
            <ArrowRight className="step-arrow" size={18} aria-hidden="true" />
            <button
              type="button"
              ref={(el) => {
                tabRefs.current[visibleInstances.length] = el
              }}
              className={activeSkillName === SOLO_GROUP_KEY ? "active" : ""}
              role="tab"
              aria-selected={activeSkillName === SOLO_GROUP_KEY}
              aria-label="单独调用"
              tabIndex={activeSkillName === SOLO_GROUP_KEY ? 0 : -1}
              onClick={() => setActiveSkill(SOLO_GROUP_KEY)}
              onKeyDown={onTabKeyDown}
            >
              <span>{visibleInstances.length + 1}</span>
              <strong>单独调用</strong>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
