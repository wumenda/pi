/**
 * MessageBridge（iframe-rendering.md 第 6 节）：
 * 宿主与沙盒 iframe 之间唯一的通信通道，JSON-RPC 2.0 / MCP 方言 over postMessage。
 *
 * v2.7 通道寻址：attach/send/detach 的通道 key 为 **iframe 实例键（复合键
 * `<resourceUri>#<group>`，与 iframe 池 key 一致）**——同一 resourceUri 的多个实例
 * （不同 Skill 实例）各自拥有独立通道与独立通知队列，通知只发往归属实例，互不串扰。
 *
 * 来源校验：沙盒 iframe（sandbox 无 allow-same-origin）的 origin 是 opaque（"null"），
 * 按 origin 字符串匹配无意义；改为身份校验——event.source 必须是已 attach iframe 的
 * contentWindow（与同源宿主代理场景一致，仅接受已知来源）。
 */

export const TOOL_RESULT_METHOD = "ui/notifications/tool-result";
/** 宿主 → 应用：主题变更广播通知（setTheme 时向全部存活 iframe 下发） */
export const THEME_CHANGED_METHOD = "ui/notifications/theme-changed";

/**
 * B6 出站队列上限：iframe 永不握手（401/400/脚本崩溃，initialized 永不到达）时，
 * 未就绪入队的 send 与窗口缺失入队的 postRaw 会无界堆积直至会话切换。
 * 超限淘汰策略：优先牺牲最旧的 progress 类通知（时效性最强、可安全丢弃），
 * 无可淘汰的 progress 则淘汰队首最旧；每通道只告警一次防刷屏。
 */
export const MESSAGE_QUEUE_CAP = 500;

/** 出站消息是否为 progress 类通知（method 含 "progress"） */
function isProgressNotification(payload: unknown): boolean {
	const method = (payload as { method?: unknown } | null)?.method;
	return typeof method === "string" && method.includes("progress");
}

/** 宿主 → 应用的 JSON-RPC 通知 */
export interface HostNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

/** 应用 → 宿主的经校验消息（请求/通知或响应） */
export type JsonRpcIncoming =
	| { jsonrpc: "2.0"; method: string; params?: unknown; id?: string | number }
	| { jsonrpc: "2.0"; id: string | number; result?: unknown; error?: unknown };

export type IncomingHandler = (message: JsonRpcIncoming, resourceUri: string) => void;

/** 通道观测记录（D1：宿主↔应用 JSON-RPC 流落盘的数据源） */
export interface IframeObservation {
	direction: "host→app" | "app→host";
	resourceUri: string;
	kind: "jsonrpc";
	method?: string;
	payload?: unknown;
}

interface QueuedMessage {
	payload: unknown;
}

export class MessageBridge {
	/** resourceUri -> 当前 contentWindow（attach 时记录，同时用于来源身份反查） */
	private windows = new Map<string, Window>();
	/** 窗口未就绪（元素未挂载）时按 uri 排队的出站消息 */
	private queues = new Map<string, QueuedMessage[]>();
	/** 应用握手完成（已发 ui/notifications/initialized）的 uri */
	private readyUris = new Set<string>();
	private handlers = new Set<IncomingHandler>();
	private observers = new Set<(o: IframeObservation) => void>();
	/** 已告警过队列溢出的通道（B6 防刷屏：每通道只 warn 一次） */
	private overflowWarnedUris = new Set<string>();
	private listening = false;

	/** 订阅通道观测（实际发出的出站消息 + 校验通过的入站消息）；返回取消订阅函数 */
	onObserved(observer: (o: IframeObservation) => void): () => void {
		this.observers.add(observer);
		this.ensureListener();
		return () => {
			this.observers.delete(observer);
		};
	}

	private observe(observation: IframeObservation): void {
		for (const observer of this.observers) observer(observation);
	}

	/** iframe 挂载后接入通道：记录 contentWindow 并冲刷积压消息 */
	attach(resourceUri: string, element: HTMLIFrameElement): void {
		const win = element.contentWindow;
		if (!win) return;
		this.windows.set(resourceUri, win);
		this.flush(resourceUri);
	}

	detach(resourceUri: string): void {
		this.windows.delete(resourceUri);
		this.queues.delete(resourceUri);
		this.readyUris.delete(resourceUri);
		this.overflowWarnedUris.delete(resourceUri);
	}

	detachAll(): void {
		this.windows.clear();
		this.queues.clear();
		this.readyUris.clear();
		this.overflowWarnedUris.clear();
	}

	/**
	 * 应用握手完成后调用（宿主收到 ui/notifications/initialized）：
	 * 标记就绪并冲刷积压的通知。
	 *
	 * 通知下行必须等应用就绪——iframe 文档加载期间（HTML/JS 下载执行、listener
	 * 未注册）postMessage 会静默丢失，导致 tool-input/tool-result 永远不达
	 * （UI 停在"等待任务"）。initialized 从应用发出，此刻其 listener 必已注册。
	 */
	markReady(resourceUri: string): void {
		this.readyUris.add(resourceUri);
		this.flush(resourceUri);
	}

	/** 宿主 → 应用：发送 JSON-RPC 通知；未就绪或窗口未就绪时排队，markReady/attach 后送达 */
	send(resourceUri: string, method: string, params?: unknown): void {
		if (!this.readyUris.has(resourceUri)) {
			this.enqueue(resourceUri, { jsonrpc: "2.0", method, params } satisfies HostNotification);
			return;
		}
		this.postRaw(resourceUri, { jsonrpc: "2.0", method, params } satisfies HostNotification);
	}

	/**
	 * 宿主 → 全部存活应用：广播 JSON-RPC 通知（如主题变更）。
	 * 逐个按 uri 复用 send 的就绪门控与排队语义——未就绪（握手未完成）的应用排队，
	 * 待 markReady/attach 后送达；不破坏每个通道自身的消息顺序。
	 */
	broadcast(method: string, params?: unknown): void {
		for (const resourceUri of [...this.windows.keys()]) {
			this.send(resourceUri, method, params);
		}
	}

	/**
	 * 广播主题变更（ui/notifications/theme-changed，payload { theme }）。
	 * 由 store.setTheme 调用：宿主切白天/黑夜时，已挂载的 MCP App 实时换肤，
	 * 而非等 iframe 重建后握手快照才生效。旧插件不感知该通知、无害。
	 */
	broadcastTheme(theme: "light" | "dark"): void {
		this.broadcast(THEME_CHANGED_METHOD, { theme });
	}

	/** 推送 tool 调用结果与执行事件（追加式，iframe 自行消费） */
	sendToolResult(resourceUri: string, params: unknown): void {
		this.send(resourceUri, TOOL_RESULT_METHOD, params);
	}

	/** 宿主 → 应用：对应用请求的成功响应（如 ui/initialize 应答）。不受就绪门控：应用正在等待，须即时送达 */
	respond(resourceUri: string, id: string | number, result: unknown): void {
		this.postRaw(resourceUri, { jsonrpc: "2.0", id, result });
	}

	/** 宿主 → 应用：对应用请求的错误响应（如未实现的方法，避免应用挂起等待）。不受就绪门控 */
	respondError(resourceUri: string, id: string | number, code: number, message: string): void {
		this.postRaw(resourceUri, { jsonrpc: "2.0", id, error: { code, message } });
	}

	private enqueue(resourceUri: string, payload: unknown): void {
		const queue = this.queues.get(resourceUri) ?? [];
		queue.push({ payload });
		// B6：队列上限。iframe 永不握手（401/崩溃）时状态/progress 推送持续排队，
		// 超限优先淘汰最旧的 progress 类通知（时效性最强、可安全丢弃），无则淘汰队首最旧
		if (queue.length > MESSAGE_QUEUE_CAP) {
			const progressIndex = queue.findIndex((item) => isProgressNotification(item.payload));
			queue.splice(progressIndex >= 0 ? progressIndex : 0, 1);
			if (!this.overflowWarnedUris.has(resourceUri)) {
				this.overflowWarnedUris.add(resourceUri);
				console.warn(`[MessageBridge] 出站队列超过上限 ${MESSAGE_QUEUE_CAP}，已淘汰最旧通知：${resourceUri}`);
			}
		}
		this.queues.set(resourceUri, queue);
	}

	private postRaw(resourceUri: string, payload: unknown): void {
		const win = this.windows.get(resourceUri);
		if (!win) {
			this.enqueue(resourceUri, payload);
			return;
		}
		win.postMessage(payload, "*");
		const method = (payload as { method?: unknown }).method;
		this.observe({
			direction: "host→app",
			resourceUri,
			kind: "jsonrpc",
			...(typeof method === "string" ? { method } : {}),
			payload,
		});
	}

	/** 应用 → 宿主：订阅经校验的消息；返回取消订阅函数 */
	onMessage(handler: IncomingHandler): () => void {
		this.handlers.add(handler);
		this.ensureListener();
		return () => {
			this.handlers.delete(handler);
		};
	}

	private ensureListener(): void {
		if (this.listening) return;
		this.listening = true;
		window.addEventListener("message", this.handleEvent);
	}

	private handleEvent = (event: MessageEvent): void => {
		let fromUri: string | null = null;
		for (const [uri, win] of this.windows) {
			if (win === event.source) {
				fromUri = uri;
				break;
			}
		}
		if (fromUri === null) return;
		const message = validateJsonRpc(event.data);
		if (!message) return;
		this.observe({
			direction: "app→host",
			resourceUri: fromUri,
			kind: "jsonrpc",
			...("method" in message ? { method: message.method } : {}),
			payload: message,
		});
		for (const handler of this.handlers) {
			handler(message, fromUri);
		}
	};

	/** 冲刷积压通知：仅就绪应用可冲刷（未就绪时 attach 不得提前送达），窗口不可用时经 postRaw 重新入队 */
	private flush(resourceUri: string): void {
		if (!this.readyUris.has(resourceUri)) return;
		const queue = this.queues.get(resourceUri);
		if (!queue) return;
		this.queues.delete(resourceUri);
		for (const item of queue) {
			this.postRaw(resourceUri, item.payload);
		}
	}
}

/** JSON-RPC 2.0 形状校验：请求/通知（method，可带 id）或响应（id + result/error） */
function validateJsonRpc(data: unknown): JsonRpcIncoming | null {
	if (typeof data !== "object" || data === null) return null;
	const candidate = data as Record<string, unknown>;
	if (candidate.jsonrpc !== "2.0") return null;
	if (typeof candidate.method === "string") {
		const id = candidate.id;
		const hasId = typeof id === "string" || typeof id === "number";
		return hasId
			? { jsonrpc: "2.0", method: candidate.method, params: candidate.params, id }
			: { jsonrpc: "2.0", method: candidate.method, params: candidate.params };
	}
	if (
		(typeof candidate.id === "string" || typeof candidate.id === "number") &&
		("result" in candidate || "error" in candidate)
	) {
		return { jsonrpc: "2.0", id: candidate.id, result: candidate.result, error: candidate.error };
	}
	return null;
}

/** 全局唯一桥实例（store 回收时同步 detach） */
export const messageBridge = new MessageBridge();
