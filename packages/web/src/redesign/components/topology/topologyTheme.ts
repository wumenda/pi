export interface TopologyTheme {
	canvas: {
		width: number;
		height: number;
		legendWidth: number;
	};
	colors: {
		ink: string;
		muted: string;
		shell: string;
		equipmentStroke: string;
		equipmentFill: string;
		zoneFill: string;
		zoneStroke: string;
		main: string;
		methanolMakeup: string;
		methanolRecycle: string;
		waterWaste: string;
		byproduct: string;
		purge: string;
		product: string;
		scheme: string;
	};
}

export const topologyTheme: TopologyTheme = {
	canvas: {
		width: 1180,
		height: 560,
		legendWidth: 148,
	},
	colors: {
		ink: "#183456",
		muted: "#64748b",
		shell: "#ffffff",
		equipmentStroke: "#2f5f9f",
		equipmentFill: "#f8fbff",
		zoneFill: "rgba(232, 243, 255, 0.52)",
		zoneStroke: "#c9ddf5",
		main: "#1d3557",
		methanolMakeup: "#38bdf8",
		methanolRecycle: "#0891b2",
		waterWaste: "#7dd3fc",
		byproduct: "#64748b",
		purge: "#94a3b8",
		product: "#16a34a",
		scheme: "#dc2626",
	},
};

/** 暗色主题调色板：浅色填充/深色墨水反转，语义流色保持色相 */
const darkColors: TopologyTheme["colors"] = {
	ink: "#c9d6f0",
	muted: "#8fa3c8",
	shell: "#141c2f",
	equipmentStroke: "#5b85c9",
	equipmentFill: "#182238",
	zoneFill: "rgba(64, 104, 190, 0.16)",
	zoneStroke: "rgba(122, 158, 224, 0.38)",
	main: "#a8c2ee",
	methanolMakeup: "#38bdf8",
	methanolRecycle: "#22d3ee",
	waterWaste: "#7dd3fc",
	byproduct: "#94a3b8",
	purge: "#94a3b8",
	product: "#4ade80",
	scheme: "#f87171",
};

export function getTopologyTheme(dark: boolean): TopologyTheme {
	return dark ? { ...topologyTheme, colors: darkColors } : topologyTheme;
}
