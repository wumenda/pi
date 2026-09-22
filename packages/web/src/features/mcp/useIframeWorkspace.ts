/**
 * iframe 工作区 Hook（pi 侧替代参考应用 zustand store 的 iframe/skill 切片）：
 * - 扫描 transcript 条目流驱动 ensureToolIframe（按 toolCallId+status 去重）；
 * - iframePool 全局单例为真身，本 Hook 持有池快照驱动 React 渲染；
 * - 会话切换全量回收 iframe 并重置状态。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillPartInfo } from "../skills/skill-parse.ts";
import { iframePool } from "./IframePool.ts";
import { messageBridge } from "./MessageBridge.ts";
import { ensureToolIframe, startHostProtocol } from "./pipeline.ts";
import { scanTranscript, type TranscriptEntryView } from "./scan.ts";
import type { IframeInstance } from "./types.ts";

export interface IframeWorkspace {
	/** 池快照（key 为池复合键） */
	pool: ReadonlyMap<string, IframeInstance>;
	/** 当前激活实例的池键 */
	activeUri: string | null;
	/** 当前激活分组键（skill 实例键或 SOLO_GROUP_KEY） */
	activeGroup: string | null;
	skillInstances: SkillPartInfo[];
	/** 切换一级分组：组内有 iframe 则激活该组最近使用的实例 */
	setActiveGroup(group: string): void;
	/** 激活组内指定实例（二级 Tab 点击） */
	activateIframe(key: string): void;
	/** 关闭并销毁实例（二级 Tab ×） */
	releaseIframe(key: string): void;
}

/** 组内最近使用的实例键（无则 null） */
function latestInGroup(pool: ReadonlyMap<string, IframeInstance>, group: string): string | null {
	let best: { key: string; at: number } | null = null;
	for (const [key, instance] of pool) {
		if (instance.group !== group) continue;
		if (best === null || instance.lastUsedAt > best.at) best = { key, at: instance.lastUsedAt };
	}
	return best?.key ?? null;
}

export function useIframeWorkspace(
	entries: readonly TranscriptEntryView[] | undefined,
	sessionKey: string | null,
): IframeWorkspace {
	const [pool, setPool] = useState<ReadonlyMap<string, IframeInstance>>(() => iframePool.snapshot());
	const [activeUri, setActiveUri] = useState<string | null>(iframePool.activeResourceUri);
	const [activeGroup, setActiveGroupState] = useState<string | null>(null);
	const [skillInstances, setSkillInstances] = useState<SkillPartInfo[]>([]);
	const processedRef = useRef<Set<string>>(new Set());
	const lastSessionKeyRef = useRef<string | null>(null);

	// 池事件 → React 快照同步（唯一回写路径；释放/淘汰同步拆除桥通道）
	useEffect(() => {
		iframePool.onEvent = (event) => {
			if (event.action === "release" || event.action === "evict") {
				messageBridge.detach(event.resourceUri);
			}
			setPool(iframePool.snapshot());
			if (event.action === "destroyAll") {
				setActiveUri(null);
				setActiveGroupState(null);
				return;
			}
			const uri = iframePool.activeResourceUri;
			setActiveUri(uri);
			if (uri !== null) {
				const instance = iframePool.get(uri);
				if (instance !== undefined) setActiveGroupState(instance.group);
			}
		};
		return () => {
			iframePool.onEvent = undefined;
		};
	}, []);

	// 宿主侧协议（幂等）挂载启动
	useEffect(() => {
		startHostProtocol();
	}, []);

	// 会话切换：统一重置点——回收全部 iframe、清桥通道、清扫描去重集
	// （首挂载即同键，跳过空转；此后每次 sessionKey 变更执行一次全量回收）
	useEffect(() => {
		if (lastSessionKeyRef.current === sessionKey) return;
		lastSessionKeyRef.current = sessionKey;
		iframePool.destroyAll();
		messageBridge.detachAll();
		processedRef.current.clear();
		setPool(iframePool.snapshot());
		setActiveUri(null);
		setActiveGroupState(null);
		setSkillInstances([]);
	}, [sessionKey]);

	// transcript 扫描：skill 实例建档 + tool 调用推进（按 toolCallId:status 去重）
	useEffect(() => {
		if (entries === undefined) {
			setSkillInstances([]);
			return;
		}
		const result = scanTranscript(entries);
		setSkillInstances(result.skillInstances);
		const processed = processedRef.current;
		for (const call of result.calls) {
			const key = `${call.toolCallId}:${call.status}`;
			if (processed.has(key)) continue;
			processed.add(key);
			ensureToolIframe(call);
		}
	}, [entries]);

	const setActiveGroup = useCallback((group: string) => {
		const uri = latestInGroup(iframePool.snapshot(), group);
		if (uri !== null) {
			// 池事件同步激活态；分组本地立即置位（无事件路径也正确）
			iframePool.activate(uri);
		}
		setActiveGroupState(group);
		if (uri === null) setActiveUri(null);
	}, []);

	const activateIframe = useCallback((key: string) => {
		iframePool.activate(key);
	}, []);

	const releaseIframe = useCallback((key: string) => {
		const wasActive = iframePool.activeResourceUri === key;
		const group = iframePool.get(key)?.group ?? null;
		iframePool.release(key);
		if (wasActive && group !== null) {
			// 组内还有剩余实例则自动激活最近使用的；无则停在占位层
			const uri = latestInGroup(iframePool.snapshot(), group);
			if (uri !== null) iframePool.activate(uri);
		}
	}, []);

	return {
		pool,
		activeUri,
		activeGroup,
		skillInstances,
		setActiveGroup,
		activateIframe,
		releaseIframe,
	};
}
