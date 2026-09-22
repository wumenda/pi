import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Client, ConnectionState } from "@earendil-works/pi-client";
import type { ServerHello } from "@earendil-works/pi-protocol";
import { isServerId } from "@earendil-works/pi-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPiClient } from "../api/pi.ts";
import type {
	McpHostToolCallResult,
	McpHostUiResource,
	SessionSummary,
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
	readonly connect: (url: string, serverId: string) => void;
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
}

interface Session {
	client: Client;
	services: PiServices;
}

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

	const connect = useCallback((url: string, serverId: string) => {
		const trimmedServerId = serverId.trim();
		if (!isServerId(trimmedServerId)) {
			setState((previous) => ({ ...previous, error: "Server ID must be a canonical lowercase UUIDv4." }));
			return;
		}
		setState((previous) => ({
			...previous,
			phase: "connecting",
			error: undefined,
			hello: undefined,
			sessions: undefined,
			activeSessionId: undefined,
			transcript: undefined,
		}));

		const client = createPiClient({ url: url.trim(), serverId: trimmedServerId });
		const services = new PiServices(client, {
			onError: (error) => setState((previous) => ({ ...previous, error: error.message })),
		});
		const session: Session = { client, services };
		sessionRef.current = session;
		servicesRef.current = services;

		client.onConnectionStateChange((change) => {
			if (change.state === "disconnected") {
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
				setState((previous) => ({ ...previous, connectionState: change.state }));
			}
		});

		void (async () => {
			try {
				const hello = await client.connect();
				setState((previous) => ({ ...previous, hello }));
				await services.ready();
				setState((previous) => ({ ...previous, phase: "ready", connectionState: "connected", error: undefined }));

				const directory = services.sessionDirectory;
				directory.state.subscribe((value) => {
					if (value !== undefined) setState((previous) => ({ ...previous, sessions: value.sessions }));
				});
				const transcript = services.transcript;
				transcript.state.subscribe((value) => {
					setState((previous) => ({ ...previous, transcript: value }));
				});
			} catch (error) {
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
		const summary = await services.sessionManagement.create({}, BACKGROUND_CONTEXT);
		setState((previous) => ({ ...previous, activeSessionId: summary.sessionId, transcript: undefined }));
	}, []);

	const attachSession = useCallback(async (sessionId: string) => {
		const services = servicesRef.current;
		if (!services) return;
		await services.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
		setState((previous) => ({ ...previous, activeSessionId: sessionId, transcript: undefined }));
	}, []);

	const detach = useCallback(async () => {
		const services = servicesRef.current;
		if (!services) return;
		await services.sessionManagement.detach(BACKGROUND_CONTEXT);
		setState((previous) => ({ ...previous, activeSessionId: undefined, transcript: undefined }));
	}, []);

	const prompt = useCallback(async (message: string) => {
		const services = servicesRef.current;
		const trimmed = message.trim();
		if (!services || trimmed.length === 0) return;
		setState((previous) => ({ ...previous, promptError: undefined }));
		const response = await services.agentController.prompt({ message: trimmed, images: null }, BACKGROUND_CONTEXT);
		if (!response.accepted) {
			setState((previous) => ({ ...previous, promptError: response.error.message }));
		}
	}, []);

	const abort = useCallback(async () => {
		const services = servicesRef.current;
		if (!services) return;
		const operationId = services.transcript.state.value?.snapshot?.operation?.id;
		if (operationId === undefined) return;
		await services.agentController.requestAbort(operationId, BACKGROUND_CONTEXT);
	}, []);

	const answerAskUser = useCallback(async (toolCallId: string, answers: JsonValue) => {
		const services = servicesRef.current;
		if (!services) return;
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
	};
}
