import { type IframeInstance, type SkillReadContext, SOLO_GROUP_KEY } from "../types";

/** 池容量默认值（iframe-rendering.md 3.1：建议值，不强制） */
export const IFRAME_POOL_CAPACITY = 5;

/** 从 apps/web/.env 读取池容量（VITE_IFRAME_POOL_CAPACITY），非法值（非数字/<1）回退默认 */
export function resolveIframePoolCapacity(raw: string | undefined = import.meta.env.VITE_IFRAME_POOL_CAPACITY): number {
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : IFRAME_POOL_CAPACITY;
}

/**
 * iframe 池复合键（v2.7）：`<resourceUri>#<group>`
 * Task 4/G4：有 serverId 时前缀 `<serverId>|`——同一 resourceUri 归属不同 MCP server
 * （alpha/beta 同 URI 场景）是池内不同条目，互不复用、隔离契约。
 * Task 5/G5：`instanceNo > 0` 为该资源/分组下并发执行派生的独立实例，key 追加 `#i<no>`
 * （基实例 instanceNo=0 保持旧格式，兼容历史 iframe-events 记录的读取）。
 * 分隔符与解析规则集中此处（iframe-rendering.md 3.1/4.1）；查找一律按实例字段，
 * 不解析 key。
 */
export function iframeInstanceKey(resourceUri: string, group: string, serverId?: string, instanceNo = 0): string {
	const base = serverId ? `${serverId}|${resourceUri}#${group}` : `${resourceUri}#${group}`;
	return instanceNo === 0 ? base : `${base}#i${instanceNo}`;
}

/** ui:// 资源对应的代理端点 URL（后端按 serverId 路由获取 MCP Server 的 UI HTML，G4） */
export function uiResourceUrl(resourceUri: string, serverId?: string): string {
	const serverParam = serverId ? `serverId=${encodeURIComponent(serverId)}&` : "";
	return `/api/v1/ui-resources?${serverParam}resourceUri=${encodeURIComponent(resourceUri)}`;
}

/**
 * 创建沙盒 iframe DOM 元素（iframe-rendering.md 第 6 节）：
 * sandbox 禁同源（应用无法访问父页面 DOM/存储），仅保留脚本与表单；
 * _meta.ui.permissions → allow 特权声明。
 */
export function createSandboxIframe(
	resourceUri: string,
	permissions: readonly string[] = [],
	serverId?: string,
): HTMLIFrameElement {
	const element = document.createElement("iframe");
	element.className = "mcp-app-iframe";
	element.setAttribute("sandbox", "allow-scripts allow-forms");
	element.setAttribute("src", uiResourceUrl(resourceUri, serverId));
	if (permissions.length > 0) {
		element.setAttribute("allow", permissions.join("; "));
	}
	return element;
}

export interface IframeAcquireMeta {
	/** Task 4/G4：归属 MCP server 标识（取自 GET /mcp-tools DTO；决定池 key 与 ui:// 路由） */
	serverId?: string;
	/** 本次绑定到该 iframe 的 tool 调用 ID（追加记录，去重；执行→实例映射） */
	boundToolCall?: string;
	/**
	 * Task 5/G5：本次绑定是否为有效执行（running/pending）。
	 * true → 占用实例（activeToolCallId = boundToolCall，并发同资源执行派生新实例）；
	 * false → 完成/失败态，解除占用（可复用）。缺省 false。
	 */
	active?: boolean;
	/** _meta.ui.permissions 声明的特权（仅在首次创建时生效） */
	permissions?: readonly string[];
	/** tool tab 展示名（仅首次创建时生效；v2.3 起优先 tool 声明中文名，见 4.4） */
	title?: string;
	/**
	 * tool 标识符（归属判定用，v2.3 起与展示名 title 解耦；4.1/4.4）。
	 * opencode 加 `<server>_` 前缀时按全等或后缀匹配。
	 */
	toolName?: string;
	/** 归属分组（skill 实例键 `<name>#<instanceId>` 或 SOLO_GROUP_KEY；仅首次创建时生效） */
	group?: string;
	/**
	 * 归属判定的上下文（v2.2/v2.7）：tool 执行时最近一次读取的 Skill 实例
	 * （name + part.id）。store 层用它按「上下文时序」解析归属（resolveToolGroup），
	 * 不写入池实例；不属 IframePool 纯池逻辑，仅随 IframeAcquireMeta 透传到 store。
	 */
	groupContext?: SkillReadContext | null;
}

interface PoolEntry extends IframeInstance {
	/** 派生实例序号：0 = 基实例（旧格式 key），>0 = 并发派生实例（key 带 #i<no>） */
	instanceNo: number;
	/** LRU 序号（单调递增，避免墙钟相同导致顺序不定） */
	lastUsedSeq: number;
}

/** iframe 池生命周期事件（D2：上报钩子数据源） */
export interface IframePoolEvent {
	action: "acquire" | "activate" | "release" | "evict" | "destroyAll";
	/** 实例键（v2.7：复合键 `<resourceUri>#<group>`，审计口径） */
	resourceUri: string;
	group?: string;
	/** 事件后的池大小（destroyAll 恒为 0） */
	poolSizeAfter: number;
}

/**
 * iframe 池（iframe-rendering.md 3.1，独立类；DOM 与池策略不进组件）：
 * - key = 复合键 `<ui.resourceUri>#<group>`（v2.7，由 iframeInstanceKey 生成）——
 *   同一 resourceUri 在不同分组（Skill 实例 / 单独调用）下是独立条目，互不复用；
 *   同一时刻只有一个激活实例（activeResourceUri，复合键）；
 * - acquire 未命中创建、命中复用（element 引用不变）；
 * - 容量超限时按 LRU 淘汰最久未使用的挂起实例（激活实例不参与淘汰）。
 */
export class IframePool {
	private entries = new Map<string, PoolEntry>();
	private activeUri: string | null = null;
	private seq = 0;
	/** Task 5/G5：tool 执行标识 → 其绑定的实例 key（同一执行的所有状态变化/进度回原实例） */
	private callToKey = new Map<string, string>();
	private readonly capacity: number;

	/** 生命周期事件回调（store 层接线到 iframe-event-reporter；本模块保持无 store 依赖） */
	onEvent?: (event: IframePoolEvent) => void;

	constructor(capacity: number = resolveIframePoolCapacity()) {
		this.capacity = capacity;
	}

	private emit(action: IframePoolEvent["action"], key: string, group?: string): void {
		this.onEvent?.({
			action,
			resourceUri: key,
			...(group !== undefined ? { group } : {}),
			poolSizeAfter: this.entries.size,
		});
	}

	get size(): number {
		return this.entries.size;
	}

	get activeResourceUri(): string | null {
		return this.activeUri;
	}

	/** key 为复合键 `<resourceUri>#<group>`（G5 派生实例带 `#i<no>` 后缀） */
	has(key: string): boolean {
		return this.entries.has(key);
	}

	get(key: string): IframeInstance | undefined {
		return this.entries.get(key);
	}

	/** 池内全部实例的浅拷贝快照（供响应式状态同步；key 为复合键） */
	snapshot(): Map<string, IframeInstance> {
		return new Map(this.entries);
	}

	/**
	 * Task 5/G5：返回执行已绑定的实例 key（未绑定 undefined）。
	 * progress 等按执行寻址的通知用它把消息发往执行所属实例（并发下不串到其它实例）。
	 */
	keyForExecution(callId: string): string | undefined {
		return this.callToKey.get(callId);
	}

	/** 是否存在可复用实例（同 server/uri/group、无 active 执行，与 acquire 步骤2 的复用条件一致）。
	 *  pipeline 在 acquire 前据此预判「本次是否新建实例」，决定冷启动补推（A-审计 B1）。 */
	hasReusable(resourceUri: string, group?: string, serverId?: string): boolean {
		const g = group ?? SOLO_GROUP_KEY;
		for (const entry of this.entries.values()) {
			if (entry.resourceUri !== resourceUri || entry.group !== g) continue;
			if (entry.serverId !== serverId) continue;
			if (entry.activeToolCallId !== undefined) continue;
			return true;
		}
		return false;
	}

	/**
	 * 取得（或创建）resourceUri 在 group 下的 iframe 实例（v2.7 复合键 + G5 实例隔离）：
	 * - 同一执行（boundToolCall 已绑定）→ 回原实例（状态变化不换实例）；
	 * - 同 server/uri/group 存在无 active 执行的实例 → 复用（优先序号更小者）；
	 * - 否则新建实例：派生 `#i<no>` 键（并发有效执行时互不串线；基实例保持旧格式）。
	 * active=true（running/pending）占用实例；完成后 active=false 释放回可复用。
	 */
	acquire(resourceUri: string, meta: IframeAcquireMeta = {}): IframeInstance {
		const group = meta.group ?? SOLO_GROUP_KEY;
		const serverId = meta.serverId;
		const callId = meta.boundToolCall;

		// 1) 该执行已绑定实例（后续状态变化/进度）：回原实例
		if (callId !== undefined) {
			const boundKey = this.callToKey.get(callId);
			const bound = boundKey !== undefined ? this.entries.get(boundKey) : undefined;
			if (bound !== undefined && boundKey !== undefined) {
				this.updateActive(bound, callId, meta.active);
				bound.lastUsedAt = Date.now();
				bound.lastUsedSeq = ++this.seq;
				this.activeUri = boundKey;
				this.emit("activate", boundKey, bound.group);
				return bound;
			}
		}

		// 2) 找可复用实例（同 server/uri/group、无 active 执行，优先序号更小即更「基」的实例）
		let target: { key: string; entry: PoolEntry } | null = null;
		for (const [key, entry] of this.entries) {
			if (entry.resourceUri !== resourceUri || entry.group !== group) continue;
			if (entry.serverId !== serverId) continue;
			if (entry.activeToolCallId !== undefined) continue;
			if (target === null || entry.instanceNo < target.entry.instanceNo) {
				target = { key, entry };
			}
		}

		let isNew = false;
		if (target === null) {
			isNew = true;
			this.evictIfNeeded();
			const entry: PoolEntry = {
				resourceUri,
				instanceNo: this.nextInstanceNo(resourceUri, group, serverId),
				element: createSandboxIframe(resourceUri, meta.permissions, serverId),
				boundToolCalls: [],
				...(meta.title !== undefined ? { title: meta.title } : {}),
				...(serverId !== undefined ? { serverId } : {}),
				group,
				createdAt: Date.now(),
				lastUsedAt: Date.now(),
				lastUsedSeq: ++this.seq,
			};
			const key = iframeInstanceKey(resourceUri, group, serverId, entry.instanceNo);
			this.entries.set(key, entry);
			target = { key, entry };
		} else {
			target.entry.lastUsedAt = Date.now();
			target.entry.lastUsedSeq = ++this.seq;
		}

		// 3) 绑定执行、更新 active 占用与执行→实例映射
		this.updateActive(target.entry, callId, meta.active);
		if (callId !== undefined && !target.entry.boundToolCalls.includes(callId)) {
			target.entry.boundToolCalls.push(callId);
		}
		if (callId !== undefined) {
			this.callToKey.set(callId, target.key);
		}
		// 聚焦语义（既有行为）：每次 acquire 都激活目标实例（completed 也聚焦——恢复查看）；
		// 并发隔离不依赖聚焦，由「执行→实例」通道隔离保证（A/B 各发各键）。
		this.activeUri = target.key;
		// 仅真正新建上报 acquire；复用（池命中）上报 activate，便于审计区分创建/复用
		// （docs/mcp-apps-ui-待处理问题执行步骤.md 3-P2-2）
		this.emit(isNew ? "acquire" : "activate", target.key, target.entry.group);
		return target.entry;
	}

	/** 更新实例的 active 占用：active=true 认领；false 且当前占用者是本执行 → 释放 */
	private updateActive(entry: PoolEntry, callId: string | undefined, active: boolean | undefined): void {
		if (callId === undefined) return;
		if (active === true) {
			entry.activeToolCallId = callId;
		} else if (entry.activeToolCallId === callId) {
			entry.activeToolCallId = undefined;
		}
	}

	/** 该资源/分组/server 下派生实例序号（现存最大 + 1；首建基实例恒为 0，无后缀 key） */
	private nextInstanceNo(resourceUri: string, group: string, serverId?: string): number {
		let maxNo = -1;
		for (const entry of this.entries.values()) {
			if (entry.resourceUri !== resourceUri || entry.group !== group) continue;
			if (entry.serverId !== serverId) continue;
			if (entry.instanceNo > maxNo) maxNo = entry.instanceNo;
		}
		return maxNo + 1;
	}

	/** 激活池内已有实例；key（复合键）不在池内时为 no-op 并返回 false */
	activate(key: string): boolean {
		const entry = this.entries.get(key);
		if (!entry) return false;
		entry.lastUsedAt = Date.now();
		entry.lastUsedSeq = ++this.seq;
		this.activeUri = key;
		this.emit("activate", key, entry.group);
		return true;
	}

	/** 销毁指定实例：移除 DOM、清池条目；若为激活实例则重置为无激活 */
	release(key: string): void {
		this.removeEntry(key, "release");
	}

	/** 全量回收：移除全部 DOM、清空池、执行映射与激活态（会话切换/Skill 卸载） */
	destroyAll(): void {
		for (const entry of this.entries.values()) {
			entry.element.remove();
		}
		this.entries.clear();
		this.callToKey.clear();
		this.activeUri = null;
		this.emit("destroyAll", "*");
	}

	/** 容量已满时淘汰最久未使用的挂起实例；激活实例与有 active 执行的实例不参与淘汰 */
	private evictIfNeeded(): void {
		if (this.entries.size < this.capacity) return;
		let victimKey: string | null = null;
		let victimSeq = Number.POSITIVE_INFINITY;
		for (const [key, entry] of this.entries) {
			if (key === this.activeUri) continue;
			// G5：不淘汰有有效执行的实例（会杀掉进行中的执行 UI）
			if (entry.activeToolCallId !== undefined) continue;
			if (entry.lastUsedSeq < victimSeq) {
				victimKey = key;
				victimSeq = entry.lastUsedSeq;
			}
		}
		if (victimKey !== null) {
			this.removeEntry(victimKey, "evict");
		}
	}

	private removeEntry(key: string, action: "release" | "evict"): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		entry.element.remove();
		this.entries.delete(key);
		// 清理指向该实例的执行→实例映射（重放/重绑定由下次 acquire 重建）
		for (const [callId, boundKey] of [...this.callToKey]) {
			if (boundKey === key) this.callToKey.delete(callId);
		}
		if (this.activeUri === key) {
			this.activeUri = null;
		}
		this.emit(action, key, entry.group);
	}
}

/** 全局唯一池实例（store 与渲染管线共享） */
export const iframePool = new IframePool();
