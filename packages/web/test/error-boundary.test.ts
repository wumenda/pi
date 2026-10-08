import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ErrorBoundary 生命周期与双态渲染测试（node 环境无 DOM，用 SSR renderToString
// 渲染输出、直接驱动 class 生命周期方法；错误捕获语义本身由 React 保证）。

const reportError = vi.hoisted(() => vi.fn());

vi.mock("../src/utils/error-reporter", () => ({
	reportError,
}));

import { ErrorBoundary } from "../src/components/ErrorBoundary";

function createBoundary(label?: string): ErrorBoundary {
	const props =
		label === undefined
			? { children: createElement("div", null, "content") }
			: { children: createElement("div", null, "content"), label };
	return new ErrorBoundary(props);
}

beforeEach(() => {
	reportError.mockClear();
});

describe("ErrorBoundary", () => {
	it("starts clean and renders children", () => {
		const boundary = createBoundary();
		expect(boundary.state.error).toBeUndefined();
		const html = renderToString(boundary.render());
		expect(html).toContain("content");
		expect(html).not.toContain("重新加载");
	});

	it("maps a caught error into state", () => {
		const state = ErrorBoundary.getDerivedStateFromError(new Error("boom"));
		expect(state.error).toBeInstanceOf(Error);
		expect(state.error?.message).toBe("boom");
	});

	it("reports the error with component stack merged into the payload", () => {
		const boundary = createBoundary();
		const error = new Error("boom");
		boundary.componentDidCatch(error, { componentStack: "\n    at MessageList" });
		expect(reportError).toHaveBeenCalledTimes(1);
		const payload = reportError.mock.calls[0]?.[0] as { message: string; stack?: string };
		expect(payload.message).toBe("boom");
		expect(payload.stack).toContain("at MessageList");
	});

	it("renders the fallback with the error message and label in the error state", () => {
		const boundary = createBoundary("消息流渲染出错");
		boundary.state = { error: new Error("boom") };
		const html = renderToString(boundary.render());
		expect(html).toContain("消息流渲染出错");
		expect(html).toContain("boom");
		expect(html).toContain("重新加载");
		expect(html).toContain('role="alert"');
	});

	it("uses the generic label when none is provided", () => {
		const boundary = createBoundary();
		boundary.state = { error: new Error("boom") };
		const html = renderToString(boundary.render());
		expect(html).toContain("界面组件渲染出错");
	});
});
