import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Client, ConnectionState } from "@earendil-works/pi-client";
import type { ServerHello } from "@earendil-works/pi-protocol";
import { isServerId } from "@earendil-works/pi-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPiClient } from "../api/pi.ts";
import { getToolEvents as fetchToolEvents } from "../api/tool-events.ts";
import { emitToolProgress, extractLiveToolFrame, extractProgressPayload } from "../features/mcp/progress.ts";
import type {
	McpHostToolCallResult,
	McpHostUiResource,
	SessionSummary,
	ToolExecutionEvent,
	TranscriptState,
} from "../services/contracts.ts";
import { PiServices } from "../services/pi-services.ts";

export type AppPhase = "idle" | "connecting" | "ready";

export interface PiAppState {
	readonly phase: AppPhase;
	readonly connectionState: ConnectionState;
	readonly error: string | undefined;
	readonly hello: ServerHello | undefined;
	readonly sessions: SessionSummary[] | undefined;
	readonly activeSessionId: string | undefined;
	readonly transcript: TranscriptState | undefined;
	readonly promptError: string | undefined;
}

export interface PiAppActions {
	readonly connect: (url: string, serverId: string, token?: string) => void;
	readonly disconnect: () => void;
	readonly createSession: () => Promise<void>;
	readonly attachSession: (sessionId: string) => Promise<void>;
	readonly detach: () => Promise<void>;
	readonly prompt: (message: string) => Promise<void>;
	readonly abort: () => Promise<void>;
	readonly answerAskUser: (toolCallId: string, answers: JsonValue) => Promise<void>;
	/** Reverse tools/call from MCP App iframes, routed through the pi.mcp-host service. */
	readonly callMcpTool: (
		serverId: string | null,
		name: string,
		args: JsonValue | null,
	) => Promise<McpHostToolCallResult>;
	/** Fetch an MCP Apps ui:// resource (iframe srcdoc payload) through the pi.mcp-host service. */
	readonly getMcpUiResource: (serverId: string, resourceUri: string) => Promise<McpHostUiResource>;
	/** Fetch recorded tool-execution events for the attached session (MCP Apps cold-start progress recovery). */
	readonly getToolEvents: () => Promise<ToolExecutionEvent[]>;
}

interface Session {
	client: Client;
	services: PiServices;
}

/** 排查日志：统一前缀便于浏览器控制台过滤；debug 级别需开启 verbose 才可见。 */
const logInfo = (message: string): void => {
	console.info(`[pi-app] ${message}`);
};
const logError = (message: string): void => {
	console.error(`[pi-app] ${message}`);
};
const logDebug = (message: string): void => {
	console.debug(`[pi-app] ${message}`);
};
const truncate = (text: string, max = 200): string =>
	text.length <= max ? text : `${text.slice(0, max)}…(${text.length} chars)`;

const initialState: PiAppState = {
	phase: "idle",
	connectionState: "disconnected",
	error: undefined,
	hello: undefined,
	sessions: undefined,
	activeSessionId: undefined,
	transcript: undefined,
	promptError: undefined,
};

/** Owns the pi client and remote services for the app and mirrors their state into React. */
export function usePiApp(): PiAppState & PiAppActions {
	const [state, setState] = useState<PiAppState>(initialState);
	const sessionRef = useRef<Session | undefined>(undefined);
	const servicesRef = useRef<PiServices | undefined>(undefined);

	useEffect(() => {
		return () => {
			const session = sessionRef.current;
			sessionRef.current = undefined;
			servicesRef.current = undefined;
			void session?.services.dispose().finally(() => session.client.dispose());
		};
	}, []);

	const connect = useCallback((url: string, serverId: string, token?: string) => {
		const trimmedServerId = serverId.trim();
		if (!isServerId(trimmedServerId)) {
			setState((previous) => ({ ...previous, error: "Server ID must be a canonical lowercase UUIDv4." }));
			return;
		}
		const trimmedToken = token?.trim();
		setState((previous) => ({
			...previous,
			phase: "connecting",
			error: undefined,
			hello: undefined,
			sessions: undefined,
			activeSessionId: undefined,
			transcript: undefined,
		}));

		const client = createPiClient({
			url: url.trim(),
			serverId: trimmedServerId,
			...(trimmedToken === undefined || trimmedToken === "" ? {} : { token: trimmedToken }),
		});
		const services = new PiServices(client, {
			onError: (error) => setState((previous) => ({ ...previous, error: error.message })),
		});
		const session: Session = { client, services };
		sessionRef.current = session;
		servicesRef.current = services;

		client.onConnectionStateChange((change) => {
			if (change.state === "disconnected") {
				logError(`connection lost: ${change.error?.message ?? "no error detail"}`);
				setState((previous) => ({
					...previous,
					connectionState: change.state,
					hello: undefined,
					sessions: undefined,
					activeSessionId: undefined,
					transcript: undefined,
					error: change.error?.message,
				}));
			} else {
				logInfo(`connection state: ${change.state}`);
				setState((previous) => ({ ...previous, connectionState: change.state }));
			}
		});

		void (async () => {
			try {
				logInfo(`connecting to ${url.trim()} (serverId=${trimmedServerId})`);
				const hello = await client.connect();
				logInfo(`hello received: serverId=${hello.serverId} version=${hello.version}`);
				setState((previous) => ({ ...previous, hello }));
				await services.ready();
				logInfo("server services ready (session-directory / session-management bound)");
				setState((previous) => ({ ...previous, phase: "ready", connectionState: "connected", error: undefined }));

				const directory = services.sessionDirectory;
				directory.state.subscribe((value) => {
					if (value !== undefined) setState((previous) => ({ ...previous, sessions: value.sessions }));
				});
				logInfo("session-directory subscribed");
				const transcript = services.transcript;
				transcript.state.subscribe((value) => {
					if (value === undefined) return;
					if (value.snapshot !== undefined && value.snapshot !== null) {
						logDebug(`transcript snapshot received (operation=${value.snapshot.operation?.id ?? "none"})`);
					}
					const eventType = value.event?.type;
					if (eventType !== undefined) logDebug(`transcript event: ${eventType}`);
					// MCP Apps progress 实时转发：tool_update 携带 details.progress 时
					// 投递给注册的监听器（工作区注册，经 pipeline 去重后按执行寻址 iframe；
					// frame 携带 details.mcpUi，供工作区在执行期引导创建 iframe）
					if (value.event?.type === "tool_update") {
						const details = value.event.partialResult.details;
						const payload = extractProgressPayload(details);
						if (payload !== null) {
							const frame = extractLiveToolFrame(details, value.event.toolName);
							emitToolProgress(value.event.toolCallId, payload, frame);
						}
					}
					setState((previous) => ({ ...previous, transcript: value }));
				});
				logInfo("transcript subscribed (awaiting attach)");
			} catch (error) {
				logError(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
				sessionRef.current = undefined;
				servicesRef.current = undefined;
				void services.dispose().finally(() => client.dispose());
				setState((previous) => ({
					...previous,
					phase: "idle",
					connectionState: "disconnected",
					error: error instanceof Error ? error.message : String(error),
				}));
			}
		})();
	}, []);

	const disconnect = useCallback(() => {
		const session = sessionRef.current;
		if (!session) return;
		logInfo("disconnecting");
		sessionRef.current = undefined;
		servicesRef.current = undefined;
		void session.services
			.dispose()
			.catch(() => undefined)
			.finally(() => session.client.dispose());
		setState((previous) => ({
			...previous,
			phase: "idle",
			connectionState: "disconnected",
			hello: undefined,
			sessions: undefined,
			activeSessionId: undefined,
			transcript: undefined,
		}));
	}, []);

	const createSession = useCallback(async () => {
		const services = servicesRef.current;
		if (!services) return;
		logInfo("createSession: calling session-management.create");
		const summary = await services.sessionManagement.create({}, BACKGROUND_CONTEXT);
		logInfo(`createSession: created ${summary.sessionId}, attaching`);
		await services.sessionManagement.attach(summary.sessionId, BACKGROUND_CONTEXT);
		logInfo(`createSession: attached ${summary.sessionId} (session services bound)`);
		setState((previous) => ({ ...previous, activeSessionId: summary.sessionId, transcript: undefined }));
	}, []);

	const attachSession = useCallback(async (sessionId: string) => {
		const services = servicesRef.current;
		if (!services) return;
		logInfo(`attachSession: ${sessionId}`);
		await services.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
		logInfo(`attachSession: ${sessionId} attached (session services bound)`);
		setState((previous) => ({ ...previous, activeSessionId: sessionId, transcript: undefined }));
	}, []);

	const detach = useCallback(async () => {
		const services = servicesRef.current;
		if (!services) return;
		logInfo("detach");
		await services.sessionManagement.detach(BACKGROUND_CONTEXT);
		setState((previous) => ({ ...previous, activeSessionId: undefined, transcript: undefined }));
	}, []);

	const prompt = useCallback(async (message: string) => {
		const services = servicesRef.current;
		const trimmed = message.trim();
		if (!services || trimmed.length === 0) return;
		logInfo(`prompt: ${truncate(trimmed)}`);
		setState((previous) => ({ ...previous, promptError: undefined }));
		const response = await services.agentController.prompt({ message: trimmed, images: null }, BACKGROUND_CONTEXT);
		if (response.accepted) {
			logInfo(`prompt: accepted (operationId=${response.operationId})`);
		} else {
			logError(`prompt: rejected (${response.error.code}): ${response.error.message}`);
			setState((previous) => ({ ...previous, promptError: response.error.message }));
		}
	}, []);

	const abort = useCallback(async () => {
		const services = servicesRef.current;
		if (!services) return;
		const operationId = services.transcript.state.value?.snapshot?.operation?.id;
		if (operationId === undefined) {
			logInfo("abort: no active operation");
			return;
		}
		logInfo(`abort: requesting abort for ${operationId}`);
		await services.agentController.requestAbort(operationId, BACKGROUND_CONTEXT);
	}, []);

	const answerAskUser = useCallback(async (toolCallId: string, answers: JsonValue) => {
		const services = servicesRef.current;
		if (!services) return;
		logInfo(`answerAskUser: toolCallId=${toolCallId} answers=${truncate(JSON.stringify(answers))}`);
		await services.agentController.answerAskUser({ toolCallId, answers }, BACKGROUND_CONTEXT);
	}, []);

	const callMcpTool = useCallback(
		async (serverId: string | null, name: string, args: JsonValue | null): Promise<McpHostToolCallResult> => {
			const services = servicesRef.current;
			if (!services) throw new Error("Not connected to a pi server");
			return services.mcpHost.callTool({ serverId, name, args }, BACKGROUND_CONTEXT);
		},
		[],
	);

	const getMcpUiResource = useCallback(async (serverId: string, resourceUri: string): Promise<McpHostUiResource> => {
		const services = servicesRef.current;
		if (!services) throw new Error("Not connected to a pi server");
		return services.mcpHost.getUiResource({ serverId, resourceUri }, BACKGROUND_CONTEXT);
	}, []);

	const getToolEvents = useCallback((): Promise<ToolExecutionEvent[]> => {
		const services = servicesRef.current;
		if (!services) return Promise.resolve([]);
		return fetchToolEvents(services);
	}, []);

	return {
		...state,
		connect,
		disconnect,
		createSession,
		attachSession,
		detach,
		prompt,
		abort,
		answerAskUser,
		callMcpTool,
		getMcpUiResource,
		getToolEvents,
	};
}
