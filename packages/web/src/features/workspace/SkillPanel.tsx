import { Alert } from "antd"
import { toolTitleOf } from "../../types"
import { SOLO_GROUP_KEY, useAppStore } from "../../stores/app-store"
import { TechDiamondIcon } from "../../components/icons/TechDiamondIcon"
import { StateLoading } from "../../components/StateViews"
import { useTranslation } from "../../i18n"

/**
 * 「Skill 加载」Tab（布局文档 3.1/3.2）：
 * 无 Skill → 占位；加载中 → 动画（状态 2）；
 * 加载完成 → 名称/描述/版本 + tool 清单（状态 3）；
 * 降级 → 仅名称 + "元数据不可用"提示（3.2.2 步骤 6）。
 */
export function SkillPanel() {
  const { t } = useTranslation()
  const skills = useAppStore((s) => s.skills)
  const skillInstances = useAppStore((s) => s.skillInstances)
  const activeSkillName = useAppStore((s) => s.activeSkillName)
  const skillLoading = useAppStore((s) => s.skillLoading)
  // v2.7：activeSkillName 为分组键（skill 实例键 `<name>#<instanceId>` 或 __solo__）——
  // 取激活实例，再按其 name 查 skill 元数据缓存（实例键只做分组隔离，不查元数据）
  const activeInstance =
    activeSkillName === null || activeSkillName === SOLO_GROUP_KEY
      ? undefined
      : skillInstances.find((i) => `${i.name}#${i.instanceId}` === activeSkillName)
  const currentSkill = activeInstance
    ? (skills.find((s) => s.name === activeInstance.name) ?? null)
    : null

  if (skillLoading) {
    return (
      <StateLoading
        className="skill-loading"
        label={t("workspace.skillLoading")}
        description={t("workspace.skillLoadingDesc")}
      />
    )
  }

  if (!currentSkill) {
    return (
      <div className="center-placeholder">
        <TechDiamondIcon className="center-placeholder-icon tech-diamond" aria-hidden="true" />
        <div className="center-placeholder-sub">
          会话触发 Skill 加载后，将在此展示元数据与 tool 清单
        </div>
      </div>
    )
  }

  return (
    <div className="skill-panel" data-skill-name={currentSkill.name}>
      <div className="skill-header">
        {/* 中文名优先，缺省回退标识符（iframe-rendering.md 4.4.2） */}
        <span className="skill-name">{currentSkill.title ?? currentSkill.name}</span>
        {currentSkill.version && (
          <span className="skill-version">v{currentSkill.version}</span>
        )}
      </div>

      {currentSkill.metadataUnavailable ? (
        <Alert
          className="skill-unavailable"
          type="warning"
          showIcon
          title="元数据不可用"
          description="SKILL.md 缺失或解析失败，仅展示 Skill 名称。"
        />
      ) : (
        <>
          {currentSkill.description && (
            <div className="skill-description">{currentSkill.description}</div>
          )}
          <div className="skill-tools-label">Tool 清单</div>
          {currentSkill.tools.length === 0 ? (
            <div className="skill-tools-empty">该 Skill 未声明 tool</div>
          ) : (
            <ul className="skill-tools">
              {currentSkill.tools.map((tool, i) => (
                <li key={i} className="skill-tool-item">
                  {toolTitleOf(tool)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
