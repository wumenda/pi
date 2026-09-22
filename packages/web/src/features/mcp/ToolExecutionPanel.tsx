import { useEffect, useRef, type ReactNode } from "react";
import { messageBridge } from "./MessageBridge.ts";
import type { IframeInstance } from "./types.ts";

export interface ToolExecutionPanelProps {
	/** 池快照（key 为池复合键） */
	pool: ReadonlyMap<string, IframeInstance>;
	/** 当前激活实例的池键 */
	activeUri: string | null;
	/** 当前激活分组键 */
	activeGroup: string | null;
}

/**
 * tool iframe 内容区（自参考应用 ToolExecutionPanel 复刻）：
 * 池内所有 iframe 持续挂载在容器中——属于当前激活分组且为激活者才展示，
 * 其余一律 display:none（保留浏览器上下文与应用状态，切回无重载）。
 * 当前分组无激活 iframe 时显示占位层。
 */
export function ToolExecutionPanel({ pool, activeUri, activeGroup }: ToolExecutionPanelProps): ReactNode {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		for (const [key, instance] of pool) {
			if (instance.element.parentElement !== container) {
				container.appendChild(instance.element);
			}
			// 分组隔离：仅当前激活分组内、且为激活者的 iframe 可见
			const visible = key === activeUri && instance.group === activeGroup;
			instance.element.style.display = visible ? "block" : "none";
			messageBridge.attach(key, instance.element);
		}
	}, [pool, activeUri, activeGroup]);

	const hasActiveInGroup =
		activeUri !== null && pool.get(activeUri) !== undefined && pool.get(activeUri)?.group === activeGroup;

	return (
		<div className="tool-exec-panel">
			<div ref={containerRef} className="tool-exec-container" />
			{!hasActiveInGroup && (
				<div className="tool-exec-placeholder">
					<div className="tool-exec-placeholder-title">MCP Apps 工作区</div>
					<div className="tool-exec-placeholder-sub">
						会话触发 Skill 加载或带 UI 的 tool 调用后，将在此展示应用界面
					</div>
				</div>
			)}
		</div>
	);
}
