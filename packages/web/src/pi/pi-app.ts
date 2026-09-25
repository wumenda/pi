import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Client, ConnectionState } from "@earendil-works/pi-client";
import type { ServerHello } from "@earendil-works/pi-protocol";
import { isServerId } from "@earendil-works/pi-protocol";
import { create } from "zustand";
import type {
	McpHostToolCallResult,
	McpHostUiResource,
	SessionSummary,
	ToolExecutionEvent,
	TranscriptState,
} from "./contracts.ts";
import { createPiClient } from "./pi-client.ts";
import { PiServices } from "./pi-services.ts";

/**
 * pi 连接层全局单例（zustand store）：
 * - client/services 持有在模块级变量（非响应式），state 镜像进 store 供组件订阅；
 * - src/api/* 适配层经 getPiServices() 同步访问服务（React Query queryFn 内使用）；
 * - 连接配置持久化 localStorage，useAppBootstrap 启动时自动连接。
 */

export type AppPhase = "idle" | "connecting" | "ready";

export interface PiConnectionPrefs {
	url: string;
	serverId: string;
	token?: string;
}

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

interface Session {
	client: Client;
	services: PiServices;
}

// ---- 模块级单例（非响应式） ----

let session: Session | undefined;
let services: PiServices | undefined;
/** 连接代数（connect 每次递增；过期连接的异步回调静默丢弃） */
let connectSeq = 0;

/** 供 api 适配层访问当前连接的 chord 服务；未连接返回 undefined */
export function getPiServices(): PiServices | undefined {
	return services;
}

/** 供 api 适配层等待服务就绪；未连接时抛错（queryFn 侧展示错误态） */
export function requirePiServices(): PiServices {
	if (services === undefined) {
		throw new Error("未连接 pi-server（请先在工作台连接）");
	}
	return services;
}

// ---- 连接偏好持久化 ----

const CONNECTION_KEY = "pi-connection";

export function loadConnectionPrefs(): PiConnectionPrefs {
	try {
		const raw = localStorage.getItem(CONNECTION_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<PiConnectionPrefs>;
			if (typeof parsed.url === "string" && parsed.url.length > 0) {
				return {
					url: parsed.url,
					serverId: typeof parsed.serverId === "string" ? parsed.serverId : "",
					...(typeof parsed.token === "string" && parsed.token.length > 0 ? { token: parsed.token } : {}),
				};
			}
		}
	} catch {
		// 损坏的本地数据按默认值处理
	}
	return { url: "ws://127.0.0.1:8790", serverId: "" };
}

export function saveConnectionPrefs(prefs: PiConnectionPrefs): void {
	try {
		localStorage.setItem(CONNECTION_KEY, JSON.stringify(prefs));
	} catch {
		// 持久化失败不影响本次使用
	}
}

/**
 * 零手填连接（合并规则）：仅当存档 serverId 为空时采纳自动发现的 id——
 * 非空存档可能是有意指向另一个 server，不覆盖；发现值必须是规范 UUIDv4，否则忽略。
 */
export function withDiscoveredServerId(prefs: PiConnectionPrefs, discovered: string | undefined): PiConnectionPrefs {
	if (prefs.serverId.trim().length > 0) return prefs;
	if (discovered === undefined || !isServerId(discovered)) return prefs;
	return { ...prefs, serverId: discovered };
}

// ---- 排查日志 ----

const logInfo = (message: string): void => {
	console.info(`[pi-app] ${message}`);
};
const logError = (message: string): void => {
	console.error(`[pi-app] ${message}`);
};
const truncate = (text: string, max = 200): string =>
	text.length <= max ? text : `${text.slice(0, max)}…(${text.length} chars)`;

interface PiStoreState extends PiAppState {
	connect: (prefs: PiConnectionPrefs) => void;
	disconnect: () => void;
	createSession: () => Promise<string>;
	attachSession: (sessionId: string) => Promise<void>;
	detach: () => Promise<void>;
	prompt: (message: string) => Promise<boolean>;
	abort: () => Promise<void>;
	answerAskUser: (toolCallId: string, answers: JsonValue) => Promise<void>;
	callMcpTool: (serverId: string | null, name: string, args: JsonValue | null) => Promise<McpHostToolCallResult>;
	getMcpUiResource: (serverId: string, resourceUri: string) => Promise<McpHostUiResource>;
	getToolEvents: () => Promise<ToolExecutionEvent[]>;
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

export const usePiStore = create<PiStoreState>()((set) => ({
	...initialState,

	connect: (prefs) => {
		const trimmedServerId = prefs.serverId.trim();
		if (!isServerId(trimmedServerId)) {
			set({ error: "Server ID 必须是规范的小写 UUIDv4。" });
			return;
		}
		const trimmedToken = prefs.token?.trim();
		// 先释放旧连接（重复连接/切换配置时防泄漏）
		releaseSession();
		set({ ...initialState, phase: "connecting" });
		// 连接代数：StrictMode 下 effect 双执行 / 快速重连时，旧连接的异步流程
		// （connect/ready）会被 releaseSession 打断并 reject——过期代数的错误与
		// 状态更新一律静默丢弃，不覆盖新连接的状态，也不误弹连接配置。
		const seq = ++connectSeq;

		const client = createPiClient({
			url: prefs.url.trim(),
			serverId: trimmedServerId,
			...(trimmedToken === undefined || trimmedToken === "" ? {} : { token: trimmedToken }),
		});
		const nextServices = new PiServices(client, {
			onError: (error) => {
				if (seq === connectSeq) set({ error: error.message });
			},
		});
		session = { client, services: nextServices };
		services = nextServices;

		client.onConnectionStateChange((change) => {
			if (seq !== connectSeq) return;
			if (change.state === "disconnected") {
				logError(`connection lost: ${change.error?.message ?? "no error detail"}`);
				set({
					connectionState: change.state,
					hello: undefined,
					sessions: undefined,
					activeSessionId: undefined,
					transcript: undefined,
					error: change.error?.message,
				});
			} else {
				logInfo(`connection state: ${change.state}`);
				set({ connectionState: change.state });
			}
		});

		void (async () => {
			try {
				logInfo(`connecting to ${prefs.url.trim()} (serverId=${trimmedServerId})`);
				const hello = await client.connect();
				if (seq !== connectSeq) return;
				logInfo(`hello received: serverId=${hello.serverId} version=${hello.version}`);
				set({ hello });
				await nextServices.ready();
				if (seq !== connectSeq) return;
				logInfo("server services ready (session-directory / session-management bound)");
				set({ phase: "ready", connectionState: "connected", error: undefined });

				nextServices.sessionDirectory.state.subscribe((value) => {
					if (value !== undefined) set({ sessions: value.sessions });
				});
				logInfo("session-directory subscribed");
				nextServices.transcript.state.subscribe((value) => {
					if (value === undefined) return;
					const eventType = value.event?.type;
					if (eventType !== undefined) logDebug(`transcript event: ${eventType}`);
					set({ transcript: value });
				});
				logInfo("transcript subscribed (awaiting attach)");
			} catch (error) {
				logError(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
				if (seq !== connectSeq) return;
				releaseSession();
				set({
					phase: "idle",
					connectionState: "disconnected",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	},

	disconnect: () => {
		releaseSession();
		set({ ...initialState });
	},

	createSession: async () => {
		const s = requirePiServices();
		logInfo("createSession: calling session-management.create");
		const summary = await s.sessionManagement.create({}, BACKGROUND_CONTEXT);
		logInfo(`createSession: created ${summary.sessionId}, attaching`);
		await s.sessionManagement.attach(summary.sessionId, BACKGROUND_CONTEXT);
		logInfo(`createSession: attached ${summary.sessionId} (session services bound)`);
		set({ activeSessionId: summary.sessionId, transcript: undefined });
		return summary.sessionId;
	},

	attachSession: async (sessionId) => {
		const s = requirePiServices();
		logInfo(`attachSession: ${sessionId}`);
		await s.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
		logInfo(`attachSession: ${sessionId} attached (session services bound)`);
		set({ activeSessionId: sessionId, transcript: undefined });
	},

	detach: async () => {
		const s = getPiServices();
		if (s === undefined) return;
		logInfo("detach");
		await s.sessionManagement.detach(BACKGROUND_CONTEXT);
		set({ activeSessionId: undefined, transcript: undefined });
	},

	prompt: async (message) => {
		const s = requirePiServices();
		const trimmed = message.trim();
		if (trimmed.length === 0) return false;
		logInfo(`prompt: ${truncate(trimmed)}`);
		set({ promptError: undefined });
		const response = await s.agentController.prompt({ message: trimmed, images: null }, BACKGROUND_CONTEXT);
		if (response.accepted) {
			logInfo(`prompt: accepted (operationId=${response.operationId})`);
			return true;
		}
		logError(`prompt: rejected (${response.error.code}): ${response.error.message}`);
		set({ promptError: response.error.message });
		return false;
	},

	abort: async () => {
		const s = requirePiServices();
		const operationId = s.transcript.state.value?.snapshot?.operation?.id;
		if (operationId === undefined) {
			logInfo("abort: no active operation");
			return;
		}
		logInfo(`abort: requesting abort for ${operationId}`);
		await s.agentController.requestAbort(operationId, BACKGROUND_CONTEXT);
	},

	answerAskUser: async (toolCallId, answers) => {
		const s = requirePiServices();
		logInfo(`answerAskUser: toolCallId=${toolCallId} answers=${truncate(JSON.stringify(answers))}`);
		await s.agentController.answerAskUser({ toolCallId, answers }, BACKGROUND_CONTEXT);
	},

	callMcpTool: async (serverId, name, args) => {
		const s = requirePiServices();
		return s.mcpHost.callTool({ serverId, name, args }, BACKGROUND_CONTEXT);
	},

	getMcpUiResource: async (serverId, resourceUri) => {
		const s = requirePiServices();
		return s.mcpHost.getUiResource({ serverId, resourceUri }, BACKGROUND_CONTEXT);
	},

	getToolEvents: async () => {
		const s = getPiServices();
		if (s === undefined) return [];
		return s.toolEvents.events(BACKGROUND_CONTEXT);
	},
}));

const logDebug = (message: string): void => {
	console.debug(`[pi-app] ${message}`);
};

function releaseSession(): void {
	const current = session;
	session = undefined;
	services = undefined;
	if (current !== undefined) {
		void current.services
			.dispose()
			.catch(() => undefined)
			.finally(() => current.client.dispose());
	}
}

/** SessionSummary 契约（contracts.ts）的运行时引用占位：保持类型依赖显式 */
export type { SessionSummary } from "./contracts.ts";

/** usePiApp：组件订阅 pi 连接状态与动作的 hook 形态 */
export function usePiApp(): PiStoreState {
	return usePiStore();
}
