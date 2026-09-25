/** 智能滚动判定（布局文档 4.1）：距底小于阈值视为"位于底部附近" */
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, threshold = 100): boolean {
	return scrollHeight - scrollTop - clientHeight < threshold;
}
