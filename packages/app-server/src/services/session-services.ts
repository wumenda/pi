import {
	type Context,
	createRemoteServiceEndpoint,
	RemoteServiceProvider,
	replicatedState,
} from "@earendil-works/chord";
import type { RoutedSessionAttachment } from "@earendil-works/pi-server";
import { createLogger } from "../logger.ts";
import type { SessionRuntime } from "../runtime.ts";
import { createAgentController } from "./agent-controller.ts";
import { AgentController, McpHost, Transcript, type TranscriptState } from "./contracts.ts";
import { createTranscriptService } from "./transcript.ts";

const log = createLogger("session-services");

export interface SessionServiceRuntime {
	attachmentFactory(context: Context): RoutedSessionAttachment;
	dispose(): Promise<void>;
}

/** 每会话一份：transcript state 共享给所有 attach 的客户端。 */
export async function createSessionServices(runtime: SessionRuntime): Promise<SessionServiceRuntime> {
	const transcriptState = replicatedState<TranscriptState>({ snapshot: null, event: null });
	const transcript = createTranscriptService(runtime.lane, transcriptState);
	await transcript.activate();
	// Task 8 用真实 McpServerManager 替换此 stub。
	const mcpHostStub: McpHost = {
		callTool: async () => {
			throw new Error("MCP is not configured");
		},
		getUiResource: async () => {
			throw new Error("MCP is not configured");
		},
		statuses: async () => [],
	};
	return {
		attachmentFactory(_context) {
			log.info("session attachment created for client");
			const provider = new RemoteServiceProvider([
				{ service: Transcript, mode: "singleton" },
				{ service: AgentController, mode: "singleton" },
				{ service: McpHost, mode: "singleton" },
			]);
			provider.provide(Transcript, transcript.service);
			provider.provide(AgentController, createAgentController(runtime.lane, runtime.askUser));
			provider.provide(McpHost, mcpHostStub);
			const endpoint = createRemoteServiceEndpoint(provider);
			return {
				invokeService(call, publish, ctx) {
					return endpoint.invoke(call, publish, ctx);
				},
				release() {
					log.info("session attachment released");
					endpoint.dispose();
					provider.dispose();
				},
			};
		},
		async dispose() {
			await transcript.dispose();
		},
	};
}
