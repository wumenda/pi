import type { AgentLane, AskUserRegistry, OperationResultRecord, SuspendedRun } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createLogger, truncate } from "../logger.ts";
import type {
	AgentAskUserAnswerRequest,
	AgentController as AgentControllerService,
	AgentOperationError,
	AgentOperationResponse,
	AgentPromptRequest,
} from "./contracts.ts";

const log = createLogger("agent-controller");

/**
 * MVP：prompt/requestAbort/answerAskUser/resume 完整实现；
 * 队列与导航方法（steer/followUp/nextRun/cancelQueued/compact/navigate）显式不支持。
 *
 * 崩溃恢复（staleRunOperationId）：上一进程崩溃遗留的挂起 run 被 durable 化为 open 状态，
 * 新 runtime 无 drive 推进且 ask registry 为空——prompt 永远 LaneBusy、作答永远失败。
 * prompt 命中该 operationId 时自动 abort+resume 收敛为 aborted 终态（零 LLM 调用），
 * 再重试本次 prompt。用户发消息即视为确认恢复。
 */
export function createAgentController(
	lane: AgentLane,
	askUser: AskUserRegistry,
	staleRunOperationId?: string,
): AgentControllerService {
	const notSupported = () => {
		throw new Error("Not supported by app-server yet");
	};
	let staleRunSettled = false;
	return {
		async prompt(request: AgentPromptRequest, context): Promise<AgentOperationResponse> {
			log.info(`prompt: ${truncate(request.message)}`);
			const [message, images] = toTextPrompt(request);
			const result = await lane.prompt(message, images, context);
			if (result.ok) {
				log.info(`prompt: accepted (operationId=${result.value.operationId})`);
				return toOperationResponse(result.value);
			}
			if (
				!staleRunSettled &&
				staleRunOperationId !== undefined &&
				result.error._tag === "LaneBusy" &&
				result.error.operationId === staleRunOperationId
			) {
				staleRunSettled = true;
				log.info(`prompt: settling stale suspended run ${staleRunOperationId}, then retrying`);
				await lane.requestAbort(staleRunOperationId, context).catch(() => undefined);
				await lane.resume(context).catch(() => undefined);
				await lane.waitForIdle(context);
				const retry = await lane.prompt(message, images, context);
				if (retry.ok) {
					log.info(`prompt: accepted after stale run settle (operationId=${retry.value.operationId})`);
					return toOperationResponse(retry.value);
				}
				log.error(`prompt: rejected after settle (${retry.error._tag}): ${truncate(retry.error.message)}`);
				return { accepted: false, operationId: operationId(retry.error), error: toAgentError(retry.error) };
			}
			log.error(`prompt: rejected (${result.error._tag}): ${truncate(result.error.message)}`);
			return { accepted: false, operationId: operationId(result.error), error: toAgentError(result.error) };
		},
		async requestAbort(operationId, context) {
			log.info(`requestAbort: ${operationId}`);
			const result = await lane.requestAbort(operationId, context);
			if (!result.ok) {
				log.error(`requestAbort ${operationId} failed: ${truncate(result.error.message)}`);
				throw new Error(result.error.message);
			}
		},
		steer: notSupported as unknown as AgentControllerService["steer"],
		followUp: notSupported as unknown as AgentControllerService["followUp"],
		nextRun: notSupported as unknown as AgentControllerService["nextRun"],
		cancelQueued: notSupported as unknown as AgentControllerService["cancelQueued"],
		async resume(context) {
			log.info("resume");
			const result = await lane.resume(context);
			if (result.ok) {
				log.info(`resume: accepted (operationId=${result.value.operationId})`);
				return toOperationResponse(result.value);
			}
			log.error(`resume: rejected (${result.error._tag}): ${truncate(result.error.message)}`);
			return { accepted: false, operationId: null, error: toAgentError(result.error) };
		},
		compact: notSupported as unknown as AgentControllerService["compact"],
		navigate: notSupported as unknown as AgentControllerService["navigate"],
		async answerAskUser(request: AgentAskUserAnswerRequest) {
			log.info(
				`answerAskUser: toolCallId=${request.toolCallId} answers=${truncate(JSON.stringify(request.answers))}`,
			);
			if (typeof request.answers !== "object" || request.answers === null) {
				throw new Error("ask_user_question answers must be a JSON object");
			}
			if (!askUser.answer(request.toolCallId, request.answers)) {
				log.error(`answerAskUser: no pending ask for toolCallId=${request.toolCallId}`);
				throw new Error(
					`No pending ask_user_question for tool call ${request.toolCallId}. ` +
						"If the server restarted while this question was pending, the interrupted run was discarded; " +
						"send a new message to continue the session.",
				);
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
