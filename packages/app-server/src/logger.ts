/** 轻量日志：ISO 时间戳 + 组件前缀，输出到 stderr（不污染 stdout 的启动信息）。 */
export interface Logger {
	info(message: string): void;
	error(message: string): void;
}

export function createLogger(component: string): Logger {
	const write = (level: string, message: string): void => {
		process.stderr.write(`[${new Date().toISOString()}] [${level}] [${component}] ${message}\n`);
	};
	return {
		info: (message) => write("info", message),
		error: (message) => write("error", message),
	};
}

/** 日志消息截断：长文本（prompt/answers）只保留可辨识的头部。 */
export function truncate(text: string, max = 200): string {
	return text.length <= max ? text : `${text.slice(0, max)}…(${text.length} chars)`;
}
