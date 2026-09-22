import type { ReactNode } from "react";
import type { IframeInstance } from "./types.ts";

export interface ToolTabBarProps {
	/** 池快照（key 为池复合键） */
	pool: ReadonlyMap<string, IframeInstance>;
	/** 当前激活实例的池键 */
	activeUri: string | null;
	/** 当前激活分组键（非 null 时仅显示该分组内的实例） */
	activeGroup: string | null;
	onActivate(key: string): void;
	onClose(key: string): void;
}

/** 关闭图标（内联 SVG，替代 antd CloseOutlined） */
function CloseIcon(): ReactNode {
	return (
		<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
			<path d="M18 6 6 18M6 6l12 12" />
		</svg>
	);
}

/**
 * 二级 tool Tab 栏（浏览器式标签，自参考应用 ToolTabBar 复刻）：
 * 仅显示当前一级分组内的 tool Tab；每个带 UI 的 tool 创建 iframe 即生成一个
 * Tab；点击切换激活，× 关闭并销毁。
 */
export function ToolTabBar({ pool, activeUri, activeGroup, onActivate, onClose }: ToolTabBarProps): ReactNode {
	const visible = [...pool.entries()].filter(
		([, instance]) => activeGroup === null || instance.group === activeGroup,
	);
	if (visible.length === 0) return null;

	return (
		<div className="tool-tabbar" data-active-uri={activeUri ?? ""}>
			<div className="tool-tabbar-tabs">
				{visible.map(([key, instance]) => (
					<div
						key={key}
						className={`tool-tab${key === activeUri ? " tool-tab-active" : ""}`}
						data-uri={key}
						role="tab"
						aria-selected={key === activeUri}
						tabIndex={0}
						title={instance.resourceUri}
						onClick={() => onActivate(key)}
						onKeyDown={(e) => {
							if (e.key === "Enter") onActivate(key);
						}}
					>
						<span className="tool-tab-label">{instance.title ?? instance.resourceUri}</span>
						<button
							type="button"
							className="tool-tab-close"
							aria-label={`关闭 ${instance.title ?? instance.resourceUri}`}
							onClick={(e) => {
								e.stopPropagation();
								onClose(key);
							}}
						>
							<CloseIcon />
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
