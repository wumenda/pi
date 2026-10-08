import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pi-app 的连接编排测试：mock 传输层（createPiClient / PiServices），
// 驱动 fake client 的连接状态事件，用真实 zustand store 断言状态转换。
// fake 均为普通实现（无 vi.fn），经由 vi.hoisted 规避 mock 工厂提升时序。

const VALID_SERVER_ID = "00000000-0000-4000-8000-000000000000";
const SESSION_ID = "0192f0a1-7b3a-7abc-9def-0123456789ab";

interface FakeClient {
	connected: boolean;
	connect: () => Promise<{ serverId: string; version: string }>;
	dispose: () => Promise<void>;
	onConnectionStateChange: (listener: (change: { state: string; error?: Error }) => void) => () => void;
	onAttachmentChange: () => () => void;
	emit: (state: "connecting" | "connected" | "disconnected", error?: Error) => void;
}

const clientFake = vi.hoisted(() => {
	const clients: Array<{
		connected: boolean;
		connect: () => Promise<{ serverId: string; version: string }>;
		dispose: () => Promise<void>;
		onConnectionStateChange: (listener: (change: { state: string; error?: Error }) => void) => () => void;
		onAttachmentChange: () => () => void;
		emit: (state: "connecting" | "connected" | "disconnected", error?: Error) => void;
	}> = [];
	return { clients };
});

const servicesFake = vi.hoisted(() => {
	interface Instance {
		attachCalls: unknown[][];
		failNextAttach: boolean;
	}
	const instances: Instance[] = [];
	class PiServices {
		readonly instance: Instance;
		constructor(_client?: unknown, _options?: unknown) {
			this.instance = { attachCalls: [], failNextAttach: false };
			instances.push(this.instance);
		}
		async ready(): Promise<void> {}
		get sessionManagement() {
			const instance = this.instance;
			return {
				async attach(sessionId: string): Promise<void> {
					instance.attachCalls.push([sessionId]);
					if (instance.failNextAttach) {
						instance.failNextAttach = false;
						throw new Error("server binding not ready yet");
					}
				},
			};
		}
		get sessionDirectory() {
			return { state: { subscribe: () => undefined } };
		}
		get transcript() {
			return { state: { subscribe: () => undefined } };
		}
		get agentController() {
			return {};
		}
		get mcpHost() {
			return {};
		}
		get toolEvents() {
			return { events: async () => [] };
		}
		async dispose(): Promise<void> {}
	}
	return { PiServices, instances };
});

function createFakeClient(): FakeClient {
	const listeners: Array<(change: { state: string; error?: Error }) => void> = [];
	const client: FakeClient = {
		connected: false,
		connect: async () => ({ serverId: VALID_SERVER_ID, version: "test" }),
		dispose: async () => {},
		onConnectionStateChange: (listener) => {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		onAttachmentChange: () => () => {},
		emit: (state, error) => {
			client.connected = state === "connected";
			for (const listener of [...listeners]) {
				listener(error === undefined ? { state } : { state, error });
			}
		},
	};
	clientFake.clients.push(client);
	return client;
}

vi.mock("../src/pi/pi-client", () => ({
	createPiClient: () => createFakeClient(),
}));

vi.mock("../src/pi/pi-services", () => ({
	PiServices: servicesFake.PiServices,
}));

import { usePiStore } from "../src/pi/pi-app";

// connect/attachSession/disconnect 是 store action（非模块具名导出），zustand creator 中引用稳定
const { connect, attachSession, disconnect } = usePiStore.getState();

const waitFor = async (condition: () => boolean, timeoutMs = 2000): Promise<void> => {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};

describe("pi-app 断线恢复编排", () => {
	beforeEach(() => {
		clientFake.clients.length = 0;
		servicesFake.instances.length = 0;
		disconnect();
	});

	afterEach(() => {
		disconnect();
	});

	it("keeps activeSessionId across a disconnect (restore memory)", async () => {
		connect({ url: "ws://127.0.0.1:8790", serverId: VALID_SERVER_ID });
		await waitFor(() => usePiStore.getState().phase === "ready");
		await attachSession(SESSION_ID);
		expect(usePiStore.getState().activeSessionId).toBe(SESSION_ID);

		// 模拟流式中间态：transcript 有值
		usePiStore.setState({ transcript: { snapshot: null, event: null } });

		clientFake.clients[0]!.emit("disconnected", new Error("socket hang up"));

		const state = usePiStore.getState();
		// 修复前这里被清成 undefined，重连后的快照会因会话匹配失败被静默丢弃
		expect(state.activeSessionId).toBe(SESSION_ID);
		expect(state.connectionState).toBe("disconnected");
		expect(state.transcript).toBeUndefined();
		expect(state.error).toBe("socket hang up");
	});

	it("re-attaches the remembered session and clears transcript on auto-reconnect", async () => {
		connect({ url: "ws://127.0.0.1:8790", serverId: VALID_SERVER_ID });
		await waitFor(() => usePiStore.getState().phase === "ready");
		await attachSession(SESSION_ID);
		const instance = servicesFake.instances[0]!;
		const initialAttachCalls = instance.attachCalls.length;

		clientFake.clients[0]!.emit("disconnected");
		clientFake.clients[0]!.emit("connected");

		// 重连编排：幂等 re-attach + 清 transcript（让快照引用比较失效触发重投影）
		await waitFor(() => instance.attachCalls.length > initialAttachCalls);
		expect(instance.attachCalls.at(-1)?.[0]).toBe(SESSION_ID);
		expect(usePiStore.getState().transcript).toBeUndefined();
		expect(usePiStore.getState().activeSessionId).toBe(SESSION_ID);
		expect(usePiStore.getState().connectionState).toBe("connected");
	});

	it("retries attach when the first attempt fails right after reconnect", async () => {
		connect({ url: "ws://127.0.0.1:8790", serverId: VALID_SERVER_ID });
		await waitFor(() => usePiStore.getState().phase === "ready");
		await attachSession(SESSION_ID);
		const instance = servicesFake.instances[0]!;
		const initialAttachCalls = instance.attachCalls.length;

		// 重连瞬间 server 通道重绑定未完成 → attach 短暂失败，应重试成功
		instance.failNextAttach = true;

		clientFake.clients[0]!.emit("disconnected");
		clientFake.clients[0]!.emit("connected");

		await waitFor(() => instance.attachCalls.length > initialAttachCalls + 1);
		expect(instance.attachCalls.at(-1)?.[0]).toBe(SESSION_ID);
		expect(usePiStore.getState().activeSessionId).toBe(SESSION_ID);
	});

	it("does not re-attach when the connection was replaced before recovery ran", async () => {
		connect({ url: "ws://127.0.0.1:8790", serverId: VALID_SERVER_ID });
		await waitFor(() => usePiStore.getState().phase === "ready");
		await attachSession(SESSION_ID);
		const instance = servicesFake.instances[0]!;
		const initialAttachCalls = instance.attachCalls.length;

		// 同步替换连接（connectSeq 递增）：过期代的恢复编排必须中止
		clientFake.clients[0]!.emit("connected");
		connect({ url: "ws://127.0.0.1:8791", serverId: VALID_SERVER_ID });

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(instance.attachCalls.length).toBe(initialAttachCalls);
		expect(usePiStore.getState().activeSessionId).toBeUndefined();
	});
});
