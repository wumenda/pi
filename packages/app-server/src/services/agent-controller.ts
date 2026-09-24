import type { AgentLane, AskUserRegistry, OperationResultRecord, SuspendedRun } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
	AgentAskUserAnswerRequest,
	AgentController as AgentControllerService,
	AgentOperationError,
	AgentOperationResponse,
	AgentPromptRequest,
} from "./contracts.ts";

/**
 * MVP：prompt/requestAbort/answerAskUser/resume 完整实现；
 * 队列与导航方法（steer/followUp/nextRun/cancelQueued/compact/navigate）显式不支持。
 */
export function createAgentController(lane: AgentLane, askUser: AskUserRegistry): AgentControllerService {
	const notSupported = () => {
		throw new Error("Not supported by app-server yet");
	};
	return {
		async prompt(request: AgentPromptRequest, context): Promise<AgentOperationResponse> {
			const [message, images] = toTextPrompt(request);
			const result = await lane.prompt(message, images, context);
			return result.ok
				? toOperationResponse(result.value)
				: { accepted: false, operationId: operationId(result.error), error: toAgentError(result.error) };
		},
		async requestAbort(operationId, context) {
			const result = await lane.requestAbort(operationId, context);
			if (!result.ok) throw new Error(result.error.message);
		},
		steer: notSupported as unknown as AgentControllerService["steer"],
		followUp: notSupported as unknown as AgentControllerService["followUp"],
		nextRun: notSupported as unknown as AgentControllerService["nextRun"],
		cancelQueued: notSupported as unknown as AgentControllerService["cancelQueued"],
		async resume(context) {
			const result = await lane.resume(context);
			return result.ok
				? toOperationResponse(result.value)
				: { accepted: false, operationId: null, error: toAgentError(result.error) };
		},
		compact: notSupported as unknown as AgentControllerService["compact"],
		navigate: notSupported as unknown as AgentControllerService["navigate"],
		async answerAskUser(request: AgentAskUserAnswerRequest) {
			if (typeof request.answers !== "object" || request.answers === null) {
				throw new Error("ask_user_question answers must be a JSON object");
			}
			if (!askUser.answer(request.toolCallId, request.answers)) {
				throw new Error(`No pending ask_user_question for tool call ${request.toolCallId}`);
			}
		},
	};
}

function toOperationResponse(value: OperationResultRecord | SuspendedRun): AgentOperationResponse {
	return {
		accepted: true,
		operationId: value.operationId,
		error:
			"status" in value && value.status === "failed" && value.error !== undefined
				? { code: value.error.code, message: value.error.message }
				: null,
	};
}

function operationId(error: { readonly _tag: string }): string | null {
	return "operationId" in error && typeof error.operationId === "string" ? error.operationId : null;
}

function toAgentError(error: { readonly _tag: string; readonly message: string }): AgentOperationError {
	const code =
		{
			LaneBusy: "lane_busy",
			InvalidMessage: "invalid_message",
			UnknownSkill: "unknown_skill",
			UnknownTemplate: "unknown_template",
			NothingToCompact: "nothing_to_compact",
			NothingToResume: "nothing_to_resume",
			InvalidNavigation: "invalid_navigation",
			UnknownTarget: "unknown_target",
			Closed: "closed",
		}[error._tag] ?? "operation_failed";
	return { code, message: error.message };
}

function toTextPrompt(request: AgentPromptRequest): [message: string, images: ImageContent[] | undefined] {
	return [request.message, request.images ?? undefined];
}
