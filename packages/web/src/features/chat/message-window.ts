/**
 * T2.8-6 条件窗口化（长会话渲染条数上限）：
 * 长会话一次性渲染全部 DOM 节点（含 content-visibility 也仍要创建元素）成本高——
 * 超过阈值时只渲染尾部窗口，向上滚动到顶时按步扩窗（视口位置用 scrollHeight 差补偿）。
 * 独立纯函数模块：无组件/store 副作用（可单测）。
 */

/** 窗口化阈值：过滤后消息数 ≤ 阈值时全量渲染（短会话零行为变化） */
export const WINDOW_THRESHOLD = 120;
/** 窗口初始条数 */
export const WINDOW_INIT = 60;
/** 每次扩窗步长（T2.9-2 档一：60 → 20，单帧挂载量降 2/3；补偿机制不变） */
export const WINDOW_STEP = 20;
/** 触发扩窗的"接近顶部"滚动距离（px） */
export const EXPAND_SCROLL_MARGIN = 400;

/** 条件窗口切片：未超阈值返回等价副本；超阈值返回尾部 windowSize 条 */
export function windowedSlice<T>(items: readonly T[], windowSize: number, threshold = WINDOW_THRESHOLD): T[] {
	if (items.length <= threshold) return [...items];
	return items.slice(Math.max(0, items.length - windowSize));
}

/** 是否应在当前滚动位置扩窗（窗口未全开且接近顶部） */
export function shouldExpandWindow(
	scrollTop: number,
	windowSize: number,
	totalCount: number,
	threshold = WINDOW_THRESHOLD,
): boolean {
	return totalCount > threshold && windowSize < totalCount && scrollTop < EXPAND_SCROLL_MARGIN;
}
