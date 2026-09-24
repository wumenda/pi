/**
 * mcp-tools 清单客户端（GET <httpBase>/api/v1/mcp-tools）：
 * 描述符缺 serverId 的历史 transcript 条目（details.mcpUi 无 serverId）由此自愈——
 * 模块级缓存 + 按工具名防抖拉取（同一 tool 一次），清单变更时通知订阅者重扫。
 */

import { namespacedMcpToolName } from "../features/mcp/naming.ts";

/** GET /api/v1/mcp-tools 条目（app-server http.ts 同形状） */
export interface McpToolManifestEntry {
	serverId: string;
	name: string;
	resourceUri: string;
	/** 受众可见性声明（_meta.ui.visibility）；未声明时缺省 */
	visibility?: string[];
}

let cache: McpToolManifestEntry[] | null = null;
const inFlight = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();

/** 订阅清单变更（内容变化时通知；返回退订函数） */
export function subscribeMcpTools(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** 当前缓存清单（未拉取过为 null） */
export function getCachedMcpTools(): readonly McpToolManifestEntry[] | null {
	return cache;
}

/** 直接写缓存（测试用；生产路径走 requestMcpToolManifest） */
export function setCachedMcpTools(list: McpToolManifestEntry[] | null): void {
	cache = list;
}

/**
 * serverId 归一化解析：harness 工具名按全等（原始名）或
 * `mcp__<sanitize(serverId)>__<sanitize(name)>` 前缀归一化命中清单条目。
 */
export function resolveServerId(manifest: readonly McpToolManifestEntry[], toolName: string): string | null {
	for (const item of manifest) {
		if (toolName === item.name) return item.serverId;
		if (toolName === namespacedMcpToolName(item.serverId, item.name)) return item.serverId;
	}
	return null;
}

/** 校验清单条目形状，丢弃无效项 */
function parseManifest(value: unknown): McpToolManifestEntry[] {
	if (!Array.isArray(value)) throw new Error("manifest is not an array");
	const entries: McpToolManifestEntry[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const record = item as Record<string, unknown>;
		const serverId = record.serverId;
		const name = record.name;
		const resourceUri = record.resourceUri;
		if (typeof serverId !== "string" || serverId.length === 0) continue;
		if (typeof name !== "string" || name.length === 0) continue;
		if (typeof resourceUri !== "string" || !resourceUri.startsWith("ui://")) continue;
		const entry: McpToolManifestEntry = { serverId, name, resourceUri };
		const visibility = record.visibility;
		if (Array.isArray(visibility)) {
			const list = visibility.filter((v): v is string => typeof v === "string");
			if (list.length > 0) entry.visibility = list;
		}
		entries.push(entry);
	}
	return entries;
}

/**
 * 按工具名防抖拉取清单：同一 toolName 的并发请求合并为一次 fetch。
 * 返回本次是否改变了缓存（变更时已通知订阅者）；失败静默吞掉（返回 false）。
 */
export async function requestMcpToolManifest(httpBase: string, toolName: string): Promise<boolean> {
	const pending = inFlight.get(toolName);
	if (pending !== undefined) return pending;
	const promise = (async () => {
		try {
			const response = await fetch(`${httpBase}/api/v1/mcp-tools`, { cache: "no-store" });
			if (!response.ok) return false;
			const next = parseManifest(await response.json());
			const changed = JSON.stringify(next) !== JSON.stringify(cache);
			cache = next;
			if (changed) {
				for (const listener of listeners) listener();
			}
			return changed;
		} catch {
			return false;
		} finally {
			inFlight.delete(toolName);
		}
	})();
	inFlight.set(toolName, promise);
	return promise;
}
