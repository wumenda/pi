export interface IframeEventPayload {
	seq: number;
	direction?: "host→app" | "app→host";
	kind: "jsonrpc" | "lifecycle";
	method?: string;
	resourceUri?: string;
	toolCallId?: string;
	action?: string;
	group?: string;
	payload?: unknown;
	recordedAt: string;
}

export interface IframeEventReporterOptions {
	flushSize?: number;
	flushIntervalMs?: number;
	/** 单批最大重试次数（G8：超限丢弃该批并计 dropped；默认 3） */
	maxRetries?: number;
	/** 指数退避基数（ms），第 n 次重试延迟 = retryBaseMs * 2^(n-1)；默认 2000 */
	retryBaseMs?: number;
	/** 每会话队列上限（入队溢出丢最旧并计 dropped；默认 200） */
	maxQueue?: number;
}

/**
 * 会话级 iframe 事件队列 + 批量上报。
 * Task 8/G8：有界重试队列——flush 失败不直接丢弃，指数退避重试（maxRetries 上限），
 * 超限丢弃并累计 dropped（观测性）；入队超过 maxQueue 时丢最旧并计 dropped。
 * 注：unload 不使用 sendBeacon——事件端点受 API token header 保护（G1 禁止 token 入 URL），
 * beacon 无法携带 header；由短 interval + 重试队列缓解关闭瞬间丢失。
 */
export class IframeEventReporter {
	private queues = new Map<string, IframeEventPayload[]>();
	/** 待重试批（sessionId → 批 + 已重试次数），保证同一会话在途只有一批 */
	private retryBatches = new Map<string, { batch: IframeEventPayload[]; tries: number }>();
	// seq 时间基（B5）：页面启动时取 Date.now()，此后 ++seq 保持会话内严格递增；
	// 刷新后新基 = 当下时间戳，恒大于旧页面历史 seq，避免会话文件内 seq 交叠导致回放乱序。
	// 时钟回拨为可接受边缘（需回拨幅度超过两次页面加载间隔才可能交叠，概率极低）。
	// 数值上界：Date.now() ≈ 1.7e12，会话生命周期内递增远小于 2^53，JSON 安全。
	private seq = Date.now();
	private droppedCountValue = 0;
	private readonly flushSize: number;
	private readonly maxQueue: number;

	constructor(options: IframeEventReporterOptions = {}) {
		this.flushSize = options.flushSize ?? 20;
		this.maxQueue = options.maxQueue ?? 200;
		const interval = options.flushIntervalMs ?? 2_000;
		// 空队列 flush 为无操作，常驻 interval 无副作用
		setInterval(() => void this.flushAll(), interval);
	}

	/** 已丢弃事件总数（G8 观测门：可上报/展示） */
	get dropped(): number {
		return this.droppedCountValue;
	}

	/** 当前在途待重试的批数（测试/观测） */
	get pendingRetries(): number {
		return this.retryBatches.size;
	}

	enqueue(sessionId: string, event: Omit<IframeEventPayload, "seq">): void {
		const queue = this.queues.get(sessionId) ?? [];
		// 有界队列：超出上限丢最旧并计 dropped（防单会话无限膨胀）
		if (queue.length >= this.maxQueue) {
			queue.shift();
			this.droppedCountValue++;
		}
		queue.push({ ...event, seq: ++this.seq });
		this.queues.set(sessionId, queue);
		if (queue.length >= this.flushSize) void this.flush(sessionId);
	}

	async flushAll(): Promise<void> {
		for (const sessionId of [...this.queues.keys()]) await this.flush(sessionId);
	}

	private async flush(sessionId: string): Promise<void> {
		// 已有在途批：不叠加新批（等完成），防止乱序
		if (this.retryBatches.has(sessionId)) return;
		const queue = this.queues.get(sessionId);
		if (queue === undefined || queue.length === 0) return;
		this.queues.set(sessionId, []);
		// 发起前同步登记在途标记：post 是异步的，若等失败才登记，首次 post 在途期间
		// flushSize/interval 触发的新 flush 会并发发出第二批（后发先至 → 落库乱序）
		this.retryBatches.set(sessionId, { batch: queue, tries: 0 });
		void this.post(sessionId, queue, 0);
	}

	private async post(sessionId: string, batch: IframeEventPayload[], tries: number): Promise<void> {
		// pi 适配：后端无 iframe 事件审计端点，直接丢弃计数（观测语义保留；
		// 队列/去重结构保留，端点接入后恢复上报即可）
		void sessionId;
		void tries;
		this.droppedCountValue += batch.length;
		this.retryBatches.delete(sessionId);
	}
}

export const iframeEventReporter = new IframeEventReporter();
