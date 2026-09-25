import { theme, type ThemeConfig } from "antd"
import type { ThemeMode } from "./types"

const FONT_FAMILY =
  "'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, sans-serif"

/**
 * antd 主题 token（明暗双套）：与 index.css 的工业 AI 视觉语言 token 对齐
 * （design-lab/industrial-ai-console.html 原型 —— brand #0B8FA3·#36C5D8、
 * canvas/Surface 层级、信号语义色）。主按钮/链接等 antd 组件与自绘 UI 同色。
 */
export function antdThemeConfig(mode: ThemeMode): ThemeConfig {
  const dark = mode === "dark"
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      // 品牌色 = --brand（暗 #36C5D8 / 亮 #0B8FA3，与 CSS 角色化语义色一致）
      colorPrimary: dark ? "#36C5D8" : "#0B8FA3",
      colorInfo: dark ? "#36C5D8" : "#0B8FA3",
      // 语义状态色 = --ok / --warn / --err
      colorSuccess: dark ? "#3DCE88" : "#168A57",
      colorWarning: dark ? "#F2B84B" : "#B56A00",
      colorError: dark ? "#F27676" : "#C43D3D",
      // 表面层级 = --canvas / --s1 / --s2
      colorBgBase: dark ? "#11161B" : "#F4F6F8",
      colorBgContainer: dark ? "#182027" : "#ffffff",
      colorBgElevated: dark ? "#202A33" : "#ffffff",
      // 边框 = --border / --border-soft
      colorBorder: dark ? "#34424D" : "#CBD5DC",
      colorBorderSecondary: dark ? "#26313B" : "#DFE6EB",
      borderRadius: 8, // = --r-card（工业圆角 md8）
      fontFamily: FONT_FAMILY,
    },
  }
}
