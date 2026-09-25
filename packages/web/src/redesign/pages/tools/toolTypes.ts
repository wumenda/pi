/**
 * 工具库页面共享模块：类型来自后端 ToolLibraryItem（GET /api/v1/tool-library），
 * 外加分类主题色与图标 key 映射（真实数据无 icon 字段，按分类推导展示样式）。
 */
import type { ToolLibraryItem } from "@platform/shared";

export type { ToolLibraryItem };

export interface ToolCategoryTheme {
	color: string;
	bg: string;
	chipBg: string;
	chipColor: string;
}

/** 分类主题色（已知分类沿用原设计色板；未声明分类走 fallbackTheme） */
const categoryThemes: Record<string, ToolCategoryTheme> = {
	图纸解析: { color: "#2d69ff", bg: "#edf5ff", chipBg: "#dbeafe", chipColor: "#1d4ed8" },
	数据处理: { color: "#16a34a", bg: "#f0fdf4", chipBg: "#dcfce7", chipColor: "#15803d" },
	专业分析: { color: "#7c3aed", bg: "#f5f3ff", chipBg: "#ede9fe", chipColor: "#6d28d9" },
	优化计算: { color: "#ea580c", bg: "#fff7ed", chipBg: "#ffedd5", chipColor: "#c2410c" },
	工程计算: { color: "#0891b2", bg: "#ecfeff", chipBg: "#cffafe", chipColor: "#0e7490" },
	模拟计算: { color: "#4338ca", bg: "#eef2ff", chipBg: "#e0e7ff", chipColor: "#4338ca" },
	文档处理: { color: "#7c6f9b", bg: "#f5f3ff", chipBg: "#ede9fe", chipColor: "#6b5b95" },
	通用能力: { color: "#475569", bg: "#f1f5f9", chipBg: "#e2e8f0", chipColor: "#334155" },
};

const fallbackTheme: ToolCategoryTheme = categoryThemes["通用能力" as keyof typeof categoryThemes]!;

/** 暗色主题分类色：浅底 → 低透明度同调底，文字提亮 */
const categoryThemesDark: Record<string, ToolCategoryTheme> = {
	图纸解析: {
		color: "#5b82ff",
		bg: "rgba(45, 105, 255, 0.14)",
		chipBg: "rgba(45, 105, 255, 0.16)",
		chipColor: "#9db4ff",
	},
	数据处理: {
		color: "#22c55e",
		bg: "rgba(34, 197, 94, 0.12)",
		chipBg: "rgba(34, 197, 94, 0.14)",
		chipColor: "#4ade80",
	},
	专业分析: {
		color: "#a78bfa",
		bg: "rgba(124, 58, 237, 0.14)",
		chipBg: "rgba(124, 58, 237, 0.16)",
		chipColor: "#c4b5fd",
	},
	优化计算: {
		color: "#fb923c",
		bg: "rgba(234, 88, 12, 0.13)",
		chipBg: "rgba(234, 88, 12, 0.15)",
		chipColor: "#fdba74",
	},
	工程计算: {
		color: "#22d3ee",
		bg: "rgba(8, 145, 178, 0.13)",
		chipBg: "rgba(8, 145, 178, 0.15)",
		chipColor: "#67e8f9",
	},
	模拟计算: {
		color: "#818cf8",
		bg: "rgba(67, 56, 202, 0.16)",
		chipBg: "rgba(67, 56, 202, 0.18)",
		chipColor: "#a5b4fc",
	},
	文档处理: {
		color: "#a5a0c4",
		bg: "rgba(124, 111, 155, 0.15)",
		chipBg: "rgba(124, 111, 155, 0.17)",
		chipColor: "#c5c0dd",
	},
	通用能力: {
		color: "#94a3b8",
		bg: "rgba(71, 85, 105, 0.16)",
		chipBg: "rgba(71, 85, 105, 0.18)",
		chipColor: "#cbd5e1",
	},
};

export function toolThemeOf(category: string, dark = false): ToolCategoryTheme {
	const map = dark ? categoryThemesDark : categoryThemes;
	return map[category] ?? (dark ? categoryThemesDark["通用能力" as keyof typeof categoryThemesDark]! : fallbackTheme);
}

/** 分类 → 图标 key（页面内映射到 lucide 图标；未知分类回退 Boxes） */
export function toolIconKeyOf(category: string): string {
	switch (category) {
		case "图纸解析":
			return "FileImage";
		case "数据处理":
			return "FileSpreadsheet";
		case "专业分析":
			return "FlaskConical";
		case "优化计算":
			return "Calculator";
		case "工程计算":
			return "Wrench";
		case "模拟计算":
			return "Layers";
		case "文档处理":
			return "FileText";
		default:
			return "Boxes";
	}
}

/** 工具详情路由 id：serverId:name（跨 server 同名工具不冲突） */
export function toolItemIdOf(item: Pick<ToolLibraryItem, "serverId" | "name">): string {
	return `${item.serverId}:${item.name}`;
}
