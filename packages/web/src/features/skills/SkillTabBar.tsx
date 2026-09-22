import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { type IframeInstance, SOLO_GROUP_KEY } from "../mcp/types.ts";

/** 顶层分组 Tab 的 skill 实例信息（来自 skill-parse 的 SkillPartInfo + 可选展示名） */
export interface SkillTabInstance {
	name: string;
	instanceId: string;
	title?: string;
}

export interface SkillTabBarProps {
	/** skill 实例列表（按条目流顺序， findAllSkillReads 产出） */
	instances: readonly SkillTabInstance[];
	/** iframe 池快照（徽标计数与"单独调用"Tab 判定数据源） */
	iframePool: ReadonlyMap<string, IframeInstance>;
	/** 当前激活分组键（skill 实例键 `<name>#<instanceId>` 或 SOLO_GROUP_KEY） */
	activeGroup: string | null;
	/** 切换激活分组 */
	onActivate: (group: string) => void;
	/** 会话标识作根节点 key：进入/切换会话时重挂载 Tab 栏，重放自上而下入场动画 */
	sessionKey: string | null;
}

/** 闪电图标（内联 SVG，替代 antd ThunderboltOutlined） */
function BoltIcon(): ReactNode {
	return (
		<svg
			className="skill-tab-icon"
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
		</svg>
	);
}

/**
 * 顶层分组 Tab 栏（自参考应用 skill-tabs 复刻并适配 pi）：
 * 每个 Skill **实例**一个 Tab（数据源 transcript 条目流解析出的 skill 读取实例，
 * 同名 Skill 每次读取一条，同名实例追加序号；徽标为该分组下 iframe 实例数）；
 * 存在不属于任何 Skill 实例的 tool iframe 时追加"单独调用"分组 Tab
 * （徽标为该组 iframe 数），点击进入该组视图。
 */
export function SkillTabBar({ instances, iframePool, activeGroup, onActivate, sessionKey }: SkillTabBarProps) {
	// 点击该组件后激活，可用滚轮水平滚动 Tab（点击组件外部停用）
	const barRef = useRef<HTMLDivElement>(null);
	const [wheelActive, setWheelActive] = useState(false);
	useEffect(() => {
		if (!wheelActive) return;
		const onPointerDown = (e: PointerEvent) => {
			if (barRef.current && !barRef.current.contains(e.target as Node)) {
				setWheelActive(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [wheelActive]);
	// 激活状态下把纵向滚轮增量转为水平滚动。
	// React 合成 onWheel 是 passive 监听，preventDefault 无效（页面同时纵向滚动），
	// 必须挂原生非 passive 监听
	useEffect(() => {
		if (!wheelActive) return;
		const bar = barRef.current;
		if (!bar) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			bar.scrollLeft += e.deltaY;
		};
		bar.addEventListener("wheel", onWheel, { passive: false });
		return () => bar.removeEventListener("wheel", onWheel);
	}, [wheelActive]);

	// 分组下 iframe 计数：按实例 group 字段匹配（不解析复合键）
	const countGroup = (group: string): number => {
		let count = 0;
		for (const instance of iframePool.values()) {
			if (instance.group === group) count += 1;
		}
		return count;
	};
	const soloCount = countGroup(SOLO_GROUP_KEY);

	// a11y（T9）：Tab 键序 = 可见实例 + 单独调用；方向键/Home/End 在 Tab 间漫游（循环），
	// roving tabindex 仅激活 Tab 可聚焦
	const tabKeys = [
		...instances.map((inst) => `${inst.name}#${inst.instanceId}`),
		...(soloCount > 0 ? [SOLO_GROUP_KEY] : []),
	];
	const activeTabIndex = Math.max(0, tabKeys.indexOf(activeGroup ?? ""));
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		const right = e.key === "ArrowRight";
		const left = e.key === "ArrowLeft";
		if (!right && !left && e.key !== "Home" && e.key !== "End") return;
		e.preventDefault();
		const n = tabKeys.length;
		const next =
			e.key === "Home" ? 0 : e.key === "End" ? n - 1 : right ? (activeTabIndex + 1) % n : (activeTabIndex - 1 + n) % n;
		const key = tabKeys[next];
		if (key === undefined) return;
		onActivate(key);
		tabRefs.current[next]?.focus();
	};

	if (instances.length === 0 && soloCount === 0) return null;

	return (
		<div
			className="skill-tabbar"
			key={sessionKey ?? "none"}
			ref={barRef}
			role="tablist"
			aria-label="分组工作区"
			onClick={() => setWheelActive(true)}
		>
			{instances.map((inst, index) => {
				const instanceKey = `${inst.name}#${inst.instanceId}`;
				// 同名实例追加序号（按 name 分组内出现序：设备管理、设备管理 (2)…，4.4）。
				// 以 instances 全量数组定位自身序号
				const ordinal = instances
					.slice(0, index + 1)
					.filter((i) => i.name === inst.name).length;
				const label = `${inst.title ?? inst.name}${ordinal > 1 ? ` (${ordinal})` : ""}`;
				// 徽标：该实例分组下绑定的 iframe 实例数（pi 的 SKILL.md 无 tools 声明，
				// 以实际挂载的 MCP App iframe 数表达工作量）
				const badge = countGroup(instanceKey);
				// 相邻 Skill 实例之间渲染带箭头的连接线，表达执行顺序（不接「单独调用」分组）
				return (
					<Fragment key={instanceKey}>
						{index > 0 && (
							<span className="skill-tab-connector" aria-hidden="true">
								<span className="skill-tab-connector-line" />
								<span className="skill-tab-connector-head" />
							</span>
						)}
						<button
							type="button"
							ref={(el) => {
								tabRefs.current[index] = el;
							}}
							className={`skill-tab${instanceKey === activeGroup ? " skill-tab-active" : ""}`}
							role="tab"
							aria-selected={instanceKey === activeGroup}
							aria-label={label}
							tabIndex={instanceKey === activeGroup ? 0 : -1}
							onClick={() => onActivate(instanceKey)}
							onKeyDown={onTabKeyDown}
						>
							<BoltIcon />
							<span className="skill-tab-label">{label}</span>
							<span className="skill-tab-badge">{badge}</span>
						</button>
					</Fragment>
				);
			})}
			{soloCount > 0 && (
				<button
					type="button"
					ref={(el) => {
						tabRefs.current[instances.length] = el;
					}}
					className={`skill-tab${activeGroup === SOLO_GROUP_KEY ? " skill-tab-active" : ""}`}
					role="tab"
					aria-selected={activeGroup === SOLO_GROUP_KEY}
					aria-label="单独调用"
					tabIndex={activeGroup === SOLO_GROUP_KEY ? 0 : -1}
					onClick={() => onActivate(SOLO_GROUP_KEY)}
					onKeyDown={onTabKeyDown}
				>
					<BoltIcon />
					<span className="skill-tab-label">单独调用</span>
					<span className="skill-tab-badge">{soloCount}</span>
				</button>
			)}
		</div>
	);
}
