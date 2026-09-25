/**
 * 前端全局错误上报：
 * - window "error" + "unhandledrejection" → POST /api/v1/client-errors（按日 JSONL 落盘）；
 * - 原生 fetch 直连，不经 api/client.ts 的 axios（避开其拦截器副作用）；
 * - fire-and-forget：任何异常静默吞掉，上报绝不二次打断用户；
 * - 内存去重：同一天相同 message+stack（前 200 字符）只报 1 次，防错误风暴。
 */

interface ErrorReportPayload {
	message: string;
	stack?: string;
	url?: string;
	userAgent?: string;
}

/** 去重表（模块级内存态，页面刷新自然重置）：key = 日期 | message | stack 前 200 字符 */
const reported = new Set<string>();

function dedupKey(payload: ErrorReportPayload): string {
	const day = new Date().toISOString().slice(0, 10);
	return `${day}|${payload.message}|${(payload.stack ?? "").slice(0, 200)}`;
}

/** 上报单条错误（fire-and-forget；去重命中即静默跳过） */
export function reportError(payload: ErrorReportPayload): void {
	try {
		const key = dedupKey(payload);
		if (reported.has(key)) return;
		reported.add(key);
		void fetch("/api/v1/client-errors", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				message: payload.message,
				stack: payload.stack,
				url: payload.url ?? window.location.href,
				userAgent: payload.userAgent ?? navigator.userAgent,
			}),
		}).catch(() => {
			// 上报失败静默：遥测不产生用户可见噪音
		});
	} catch {
		// 上报器自身绝不抛错
	}
}

/** 安装全局监听（各入口渲染前调用一次） */
export function installGlobalErrorReporting(): void {
	window.addEventListener("error", (event) => {
		const err = event.error;
		reportError({
			message: event.message || err?.message || "window error",
			stack: err instanceof Error ? err.stack : undefined,
		});
	});
	window.addEventListener("unhandledrejection", (event) => {
		const reason = (event as PromiseRejectionEvent).reason;
		reportError({
			message: reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection"),
			stack: reason instanceof Error ? reason.stack : undefined,
		});
	});
}
