import "@testing-library/jest-dom/vitest";

// antd 组件依赖 ResizeObserver，jsdom 未实现
class ResizeObserverMock {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}
window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// antd 响应式断点依赖 matchMedia，jsdom 未实现
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}),
});
