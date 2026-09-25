import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	AgentHarness,
	type AgentHarnessTool,
	type AgentLane,
	type AskUserRegistry,
	createAskUserQuestionTool,
	createAskUserRegistry,
	createBashTool,
	createReadTool,
	createWriteTool,
	type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import type { McpServerManager } from "@earendil-works/pi-agent-core/harness/mcp";
import type { JsonlSessionMetadata, Session } from "@earendil-works/pi-agent-core/harness/session";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { createLogger } from "./logger.ts";

const log = createLogger("runtime");

export interface SessionRuntimeOptions {
	session: Session<JsonlSessionMetadata>;
	models: Models;
	model: Model<Api>;
	workspaceDir: string;
	/** host 级共享 MCP manager：host 创建、连接并统一关闭，runtime 仅使用不回收。 */
	mcp: McpServerManager;
	/** 附加工具（host 注入 MCP 桥接工具）。 */
	extraTools?: AgentHarnessTool<ExecutionToolContext>[];
	/**
	 * 注册但不对模型开放的工具名（MCP Apps app-only 工具，`visibility=["app"]`）：
	 * 不进 activeToolNames（模型不可见、模型调用被拒），工具本身保持注册；
	 * MCP host 反向调用走 manager 直连，不受影响。
	 */
	hiddenFromLlm?: readonly string[];
}

export interface SessionRuntime {
	readonly harness: AgentHarness<ExecutionToolContext>;
	readonly lane: AgentLane;
	readonly askUser: AskUserRegistry;
	readonly mcp: McpServerManager;
	/**
	 * 崩溃恢复：runtime 创建时快照到的遗留挂起 run（上一进程崩溃时 durable 化的 open/aborting
	 * run）。该 run 无 drive 推进、ask registry 为空，会占住 lane（prompt 撞 LaneBusy）且永远
	 * 无人能应答——controller 收到命中该 id 的 LaneBusy 时自动 abort+resume 收敛为 aborted 终态。
	 */
	readonly staleRunOperationId: string | undefined;
	close(): Promise<void>;
}

export async function createSessionRuntime(options: SessionRuntimeOptions): Promise<SessionRuntime> {
	const askUser = createAskUserRegistry();
	const env = new NodeExecutionEnv({ cwd: options.workspaceDir });
	const tools: AgentHarnessTool<ExecutionToolContext>[] = [
		createReadTool(),
		createWriteTool(),
		createBashTool(),
		createAskUserQuestionTool(),
		...(options.extraTools ?? []),
	];
	const hidden = new Set(options.hiddenFromLlm ?? []);
	const { harness } = await AgentHarness.create<ExecutionToolContext>(
		{
			session: options.session,
			models: options.models,
			model: options.model,
			tools,
			activeToolNames: tools.map((tool) => tool.name).filter((name) => !hidden.has(name)),
			toolContext: { env, askUser },
			resources: {},
		},
		BACKGROUND_CONTEXT,
	);
	try {
		const lane = await harness.lane("main", BACKGROUND_CONTEXT);
		// runtime 刚建、本进程尚未启动任何 operation：current 必然是上一进程遗留的挂起操作
		const inspection = await lane.inspectExecution(BACKGROUND_CONTEXT);
		const current = inspection.current;
		const staleRunOperationId =
			current !== null && current.kind === "run" && current.status !== "running" ? current.id : undefined;
		if (staleRunOperationId !== undefined) {
			log.error(`stale suspended run from a previous process: ${staleRunOperationId}; will settle on next prompt`);
		}
		return {
			harness,
			lane,
			askUser,
			mcp: options.mcp,
			staleRunOperationId,
			close: async () => {
				await harness.close(BACKGROUND_CONTEXT);
			},
		};
	} catch (error) {
		await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
		throw error;
	}
}
