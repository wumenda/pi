/**
 * T2.8-6 条件窗口化纯函数测试：
 * - windowedSlice：未超阈值全量、超阈值尾部窗口、窗口大于总数、零窗口边界；
 * - shouldExpandWindow：阈值 / 窗口全开 / 滚动位置组合判定；
 * - 扩窗收敛：从 WINDOW_INIT 连续扩窗在有限步内覆盖全部消息。
 */

import { describe, expect, it } from "vitest";
import {
	EXPAND_SCROLL_MARGIN,
	shouldExpandWindow,
	WINDOW_INIT,
	WINDOW_STEP,
	WINDOW_THRESHOLD,
	windowedSlice,
} from "../src/features/chat/message-window";

describe("windowedSlice", () => {
	it("未超阈值返回等价副本（短会话零行为变化）", () => {
		const items = [1, 2, 3];
		const result = windowedSlice(items, WINDOW_INIT);
		expect(result).toEqual([1, 2, 3]);
		expect(result).not.toBe(items);
	});

	it("超阈值返回尾部窗口", () => {
		const items = Array.from({ length: WINDOW_THRESHOLD + 10 }, (_, i) => i);
		expect(windowedSlice(items, WINDOW_INIT)).toEqual(items.slice(-WINDOW_INIT));
	});

	it("窗口大于总数时返回全部", () => {
		const items = Array.from({ length: WINDOW_THRESHOLD + 5 }, (_, i) => i);
		expect(windowedSlice(items, 10_000)).toEqual(items);
	});

	it("窗口为 0 返回空", () => {
		const items = Array.from({ length: WINDOW_THRESHOLD + 1 }, (_, i) => i);
		expect(windowedSlice(items, 0)).toEqual([]);
	});
});

describe("shouldExpandWindow", () => {
	it("未超阈值不扩窗", () => {
		expect(shouldExpandWindow(0, WINDOW_INIT, WINDOW_THRESHOLD)).toBe(false);
	});

	it("窗口已全开不扩窗", () => {
		expect(shouldExpandWindow(0, WINDOW_THRESHOLD + 50, WINDOW_THRESHOLD + 50)).toBe(false);
	});

	it("远离顶部不扩窗", () => {
		expect(shouldExpandWindow(EXPAND_SCROLL_MARGIN, WINDOW_INIT, WINDOW_THRESHOLD + 50)).toBe(false);
	});

	it("超阈值且接近顶部且窗口未全开 → 扩窗", () => {
		expect(shouldExpandWindow(EXPAND_SCROLL_MARGIN - 1, WINDOW_INIT, WINDOW_THRESHOLD + 50)).toBe(true);
	});
});

describe("扩窗收敛", () => {
	it("从 WINDOW_INIT 连续扩窗在有限步内覆盖全部消息（步长 20 → 步数上限收紧）", () => {
		const totalCount = WINDOW_THRESHOLD + 500;
		let windowSize = WINDOW_INIT;
		let steps = 0;
		while (shouldExpandWindow(0, windowSize, totalCount)) {
			windowSize = Math.min(totalCount, windowSize + WINDOW_STEP);
			steps += 1;
			// 620 条 / 20 步长 ≈ 28 步：上限 40 保证步长回退时测试捕获收敛退化
			expect(steps).toBeLessThan(40);
		}
		expect(windowSize).toBe(totalCount);
	});
});
