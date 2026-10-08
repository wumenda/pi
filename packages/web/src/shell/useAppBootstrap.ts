import { useEffect } from "react";
import { fetchServerId } from "../api/client";
import { fetchSessions } from "../api/sessions";
import { loadConnectionPrefs, saveConnectionPrefs, usePiStore, withDiscoveredServerId } from "../pi/pi-app";
import { useAppStore } from "../stores/app-store";

/**
 * 启动壳层职责（pi 适配版）：
 * - 零手填：启动总是先从 app-server HTTP 面发现 serverId（同源 /api 代理与静态
 *   托管均可达）——发现值优先，自愈 localStorage 里指向旧 server 的陈旧存档；
 *   发现成功才存档并连接；
 * - 兜底：发现失败（app-server 未起）回退存档直连（存档为空则维持"未连接"，
 *   弹窗仍可手动配置）；
 * - 会话清单：连接就绪后从 session-directory 拉取并写入 store。
 */
export function useAppBootstrap(): void {
	const setSessions = useAppStore((s) => s.setSessions);

	useEffect(() => {
		const prefs = loadConnectionPrefs();
		void fetchServerId(prefs.token)
			.then((discovered) => {
				const resolved = withDiscoveredServerId(prefs, discovered);
				if (resolved.serverId.trim().length === 0) return;
				saveConnectionPrefs(resolved);
				usePiStore.getState().connect(resolved);
			})
			.catch(() => {
				if (prefs.serverId.trim().length === 0) return;
				usePiStore.getState().connect(prefs);
			});
	}, []);

	useEffect(() => {
		let cancelled = false;
		// 连接就绪后拉取一次会话清单（后续新会话由 ConsoleHome/项目中心 upsert 维护）
		const unsubscribe = usePiStore.subscribe((state) => {
			if (state.phase !== "ready") return;
			fetchSessions()
				.then((list) => {
					if (!cancelled) setSessions(list);
				})
				.catch(() => undefined);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [setSessions]);
}
