// 主题状态：代理 app-store 的全局主题（唯一事实源，含持久化、<html data-theme> 同步与 iframe 广播）。
// CSS 侧由 styles/theme.generated.css 按 [data-theme="dark"] 切换变量；
// 画布等 JS 取色通过 useTheme/getTheme 读取当前主题。
import { useAppStore } from "../stores/app-store";
import type { ThemeMode } from "../types";

export type Theme = ThemeMode;

export function getTheme(): Theme {
	return useAppStore.getState().theme;
}

export function setTheme(theme: Theme) {
	useAppStore.getState().setTheme(theme);
}

export function toggleTheme() {
	useAppStore.getState().toggleTheme();
}

/** React 侧订阅：按钮图标等需要随主题重渲染的组件使用 */
export function useTheme(): [Theme, () => void] {
	const theme = useAppStore((s) => s.theme);
	return [theme, toggleTheme];
}
