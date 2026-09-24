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

export interface SessionRuntimeOptions {
	session: Session<JsonlSessionMetadata>;
	models: Models;
	model: Model<Api>;
	workspaceDir: string;
	/** 会话专属 MCP manager：host 创建并 connectAll 后传入，close 时随 runtime 关闭。 */
	mcp: McpServerManager;
	/** 附加工具（host 注入 MCP 桥接工具）。 */
	extraTools?: AgentHarnessTool<ExecutionToolContext>[];
}

export interface SessionRuntime {
	readonly harness: AgentHarness<ExecutionToolContext>;
	readonly lane: AgentLane;
	readonly askUser: AskUserRegistry;
	readonly mcp: McpServerManager;
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
	const { harness } = await AgentHarness.create<ExecutionToolContext>(
		{
			session: options.session,
			models: options.models,
			model: options.model,
			tools,
			activeToolNames: tools.map((tool) => tool.name),
			toolContext: { env, askUser },
			resources: {},
		},
		BACKGROUND_CONTEXT,
	);
	try {
		const lane = await harness.lane("main", BACKGROUND_CONTEXT);
		return {
			harness,
			lane,
			askUser,
			mcp: options.mcp,
			close: async () => {
				await harness.close(BACKGROUND_CONTEXT);
				await options.mcp.close();
			},
		};
	} catch (error) {
		await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
		throw error;
	}
}
