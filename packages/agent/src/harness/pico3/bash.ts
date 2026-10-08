import { spawn } from "node:child_process";
import { Type } from "typebox";
import type { ToolDeclaration, ToolResult } from "./types.ts";

const parameters = Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()) });

/** Run a shell command. Output is piped to the kernel; bounds come from `output`. */
export function bashTool(output: ToolDeclaration["output"] = {}): ToolDeclaration<typeof parameters> {
	return {
		name: "bash",
		description: "Run a shell command",
		parameters,
		replay: "unsafe",
		output,
		async execute({ command, cwd }, api, ctx): Promise<ToolResult> {
			const started = Date.now();
			const child = spawn("bash", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
			const onAbort = () => child.kill("SIGKILL");
			ctx.abortSignal?.addEventListener("abort", onAbort);
			child.stdout.on("data", (c: Uint8Array) => api.stream(c));
			child.stderr.on("data", (c: Uint8Array) => api.stream(c));
			try {
				// spawn 失败（bash 不存在 ENOENT、无效 cwd 等）只触发 error：无监听器时
				// Promise 永不 settle（工具挂死）且 Node 将其作为未捕获异常抛出
				const { code, signal } = await new Promise<{ code: number | null; signal: string | null }>(
					(resolve, reject) => {
						child.once("error", reject);
						child.once("close", (code, signal) => resolve({ code, signal }));
					},
				);
				return { isError: code !== 0, details: { exitCode: code, signal, ms: Date.now() - started } };
			} catch (error) {
				// 以错误 ToolResult 收尾而非抛出：错误也是结果，模型可见且可据此调整
				return {
					isError: true,
					details: { exitCode: null, signal: null, ms: Date.now() - started, error: String(error) },
				};
			} finally {
				ctx.abortSignal?.removeEventListener("abort", onAbort);
			}
		},
	};
}
