import { useEffect } from "react";
import { fetchServerId } from "../api/client";
import { fetchSessions } from "../api/sessions";
import { loadConnectionPrefs, saveConnectionPrefs, usePiStore, withDiscoveredServerId } from "../pi/pi-app";
import { useAppStore } from "../stores/app-store";

/**
 * 启动壳层职责（pi 适配版）：
 * - 自动连接：localStorage 已保存连接配置（serverId 非空）时启动即连；
 * - 零手填：serverId 为空时从 app-server HTTP 面自动发现（同源 /api 代理与静态
 *   托管均可达），发现成功才存档并连接；失败维持"未连接"，弹窗仍可手动配置；
 * - 会话清单：连接就绪后从 session-directory 拉取并写入 store。
 */
export function useAppBootstrap(): void {
	const setSessions = useAppStore((s) => s.setSessions);

	useEffect(() => {
		const prefs = loadConnectionPrefs();
		if (prefs.serverId.trim().length > 0) {
			usePiStore.getState().connect(prefs);
			return;
		}
		void fetchServerId(prefs.token)
			.then((discovered) => {
				const resolved = withDiscoveredServerId(prefs, discovered);
				if (resolved.serverId.trim().length === 0) return;
				saveConnectionPrefs(resolved);
				usePiStore.getState().connect(resolved);
			})
			.catch(() => undefined);
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
