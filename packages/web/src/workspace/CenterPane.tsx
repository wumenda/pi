import { useAppStore } from "../stores/app-store"
import { SkillPanel } from "../features/workspace/SkillPanel"
import { ToolExecutionPanel } from "../mcp-iframe/ToolExecutionPanel"
import { ToolTabBar } from "../mcp-iframe/ToolTabBar"
import { TechDiamondIcon } from "../components/icons/TechDiamondIcon"
import { SkillTabBar } from "./SkillTabBar"

/** 中间主区占位（布局文档 1.3：不渲染任何 iframe） */
function CenterPlaceholder({ sub }: { sub: string }) {
  return (
    <div className="center-placeholder">
      <TechDiamondIcon className="center-placeholder-icon tech-diamond" aria-hidden="true" />
      <div className="center-placeholder-sub">{sub}</div>
    </div>
  )
}

export function CenterPane() {
  const centerView = useAppStore((s) => s.centerView)
  const hasIframe = useAppStore((s) => s.iframePool.size > 0)

  return (
    <main className="center-pane">
      <SkillTabBar />
      <ToolTabBar />
      <div className="center-content">
        {/*
          iframe 容器层常驻挂载（切视图不卸载）：卸载会把池内 iframe 移出文档，
          MCP 应用状态丢失，切回后重载 src 重新握手，UI 卡在"等待任务…"。
          池非空期间仅以 hidden 切换可见性，iframe 全程保持挂载。
        */}
        {hasIframe ? (
          <div className="center-content-layer" hidden={centerView !== "iframe"}>
            <ToolExecutionPanel />
          </div>
        ) : (
          <div className="center-content-layer" hidden={centerView !== "iframe"}>
            <CenterPlaceholder sub="执行带界面的工具后将在此展示" />
          </div>
        )}
        <div className="center-content-layer" hidden={centerView !== "skill"}>
          <SkillPanel />
        </div>
      </div>
    </main>
  )
}
