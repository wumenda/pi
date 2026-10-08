import type { JsonValue, ReplicatedStateDelivery } from "@earendil-works/chord";
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
	/** transcript 最近一次投递（update 携带 ops，供增量投影；与 transcript 同批更新） */
	readonly lastDelivery: ReplicatedStateDelivery | undefined;
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
 * 零手填连接（合并规则）：规范 UUIDv4 的发现值始终优先——serverId 是 server 身份
 * 而非用户偏好，app-server 重启换数据目录/重生 id 后存档必然过期（hello 校验
 * "does not match"），以 HTTP 面（同源静态托管/开发代理）发现值为准可自愈陈旧
 * 存档；发现值缺失/不合法时回退存档。
 */
export function withDiscoveredServerId(prefs: PiConnectionPrefs, discovered: string | undefined): PiConnectionPrefs {
	if (discovered !== undefined && isServerId(discovered)) return { ...prefs, serverId: discovered };
	return prefs;
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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const REATTACH_RETRY_MS = 100;
const REATTACH_MAX_ATTEMPTS = 50;

/**
 * 断线恢复编排：重连后幂等 re-attach 记住的会话，并清空 transcript。
 *
 * 为什么需要：断线时服务端丢弃 attachment，会话级 chord 服务（transcript 等）
 * 全部解绑；客户端自动重连成功只恢复 server 通道，会话仍处于未 attach 态——
 * 不主动恢复的话，transcript 快照被 useSessionEvents 的会话匹配静默丢弃，
 * UI 冻结在断线前内容。清空 transcript 让快照引用比较失效，新快照到达后
 * 必然触发重投影。
 *
 * attach 依赖 server 通道重绑定完成（异步），刚重连时可能尚未就绪，
 * 按固定间隔重试，有界不无限；isCurrent 失真（连接被替换/释放）立即中止。
 */
async function reattachAfterReconnect(
	services: PiServices,
	sessionId: string,
	isCurrent: () => boolean,
): Promise<boolean> {
	for (let attempt = 1; attempt <= REATTACH_MAX_ATTEMPTS; attempt++) {
		if (!isCurrent()) return false;
		try {
			await services.ready();
			if (!isCurrent()) return false;
			await services.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
			if (!isCurrent()) return false;
			usePiStore.setState({ transcript: undefined, lastDelivery: undefined });
			logInfo(`reattachAfterReconnect: ${sessionId} attached after reconnect (attempt ${attempt})`);
			return true;
		} catch (error) {
			logError(
				`reattachAfterReconnect: attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			await sleep(REATTACH_RETRY_MS);
		}
	}
	logError(`reattachAfterReconnect: gave up on ${sessionId} after ${REATTACH_MAX_ATTEMPTS} attempts`);
	return false;
}

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
	lastDelivery: undefined,
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
				// 保留 activeSessionId 作为断线恢复记忆：自动重连成功后由
				// reattachAfterReconnect 幂等 re-attach。手动 connect()/disconnect()
				// 仍经 initialState 清空（新连接上下文，无需恢复旧会话）。
				set({
					connectionState: change.state,
					hello: undefined,
					sessions: undefined,
					transcript: undefined,
					lastDelivery: undefined,
					error: change.error?.message,
				});
			} else {
				logInfo(`connection state: ${change.state}`);
				set({ connectionState: change.state });
				// 自动重连成功：恢复断线前 attach 的会话（初次连接时 activeSessionId
				// 尚为 undefined，自然跳过）。attach 是幂等的，重复 attach 安全。
				const remembered = usePiStore.getState().activeSessionId;
				if (remembered !== undefined) {
					void reattachAfterReconnect(nextServices, remembered, () => seq === connectSeq);
				}
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
				nextServices.transcript.state.subscribe((value, _context, delivery) => {
					if (value === undefined) return;
					const eventType = value.event?.type;
					if (eventType !== undefined) logDebug(`transcript event: ${eventType}`);
					set({ transcript: value, lastDelivery: delivery });
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
		set({ activeSessionId: summary.sessionId, transcript: undefined, lastDelivery: undefined });
		return summary.sessionId;
	},

	attachSession: async (sessionId) => {
		const s = requirePiServices();
		logInfo(`attachSession: ${sessionId}`);
		await s.sessionManagement.attach(sessionId, BACKGROUND_CONTEXT);
		logInfo(`attachSession: ${sessionId} attached (session services bound)`);
		set({ activeSessionId: sessionId, transcript: undefined, lastDelivery: undefined });
	},

	detach: async () => {
		const s = getPiServices();
		if (s === undefined) return;
		logInfo("detach");
		await s.sessionManagement.detach(BACKGROUND_CONTEXT);
		set({ activeSessionId: undefined, transcript: undefined, lastDelivery: undefined });
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
