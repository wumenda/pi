import { useSyncExternalStore } from "react";

/**
 * 全站 hash 路由（原 redesign 复刻区路由提升为产品级 IA）：
 *   #/                    首页（目标输入，真实创建会话）
 *   #/projects            项目中心（项目 → 会话两级）
 *   #/session/:id         会话工作台（rail + Skill Tab + iframe 区 + 对话流）
 *   #/concept             产品理念浮层（叠加在首页上）
 *   #/help                帮助浮层（叠加在当前页上）
 *   #/knowledge           知识库
 *   #/skills[/id]         技能库（可带详情 id）
 *   #/tools[/id]          工具库（可带详情 id）
 *   #/data-center         数据中心
 *   #/messages            消息中心（插槽）
 */
export type RedesignRoute =
	| { page: "home" }
	| { page: "concept" }
	| { page: "help" }
	| { page: "knowledge" }
	| { page: "skills"; skillId: string | null }
	| { page: "tools"; toolId: string | null }
	| { page: "data-center" }
	| { page: "projects" }
	| { page: "messages" }
	| { page: "session"; sessionId: string };

export function parseRedesignHash(hash: string): RedesignRoute {
	const path = hash.replace(/^#/, "").replace(/^\/+/, "");
	const [seg, param] = path.split("/");
	switch (seg) {
		case "knowledge":
			return { page: "knowledge" };
		case "skills":
			return { page: "skills", skillId: param ? decodeURIComponent(param) : null };
		case "tools":
			return { page: "tools", toolId: param ? decodeURIComponent(param) : null };
		case "data-center":
			return { page: "data-center" };
		case "projects":
			return { page: "projects" };
		case "messages":
			return { page: "messages" };
		case "session":
			return param ? { page: "session", sessionId: decodeURIComponent(param) } : { page: "projects" };
		case "concept":
			return { page: "concept" };
		case "help":
			return { page: "help" };
		default:
			return { page: "home" };
	}
}

export function redesignHash(path = ""): string {
	return path ? `#/${path}` : "#/";
}

export function navigateRedesign(path = ""): void {
	window.location.hash = redesignHash(path);
}

/** 跳转到会话工作台 */
export function navigateSession(sessionId: string): void {
	navigateRedesign(`session/${encodeURIComponent(sessionId)}`);
}

function subscribeHash(cb: () => void): () => void {
	window.addEventListener("hashchange", cb);
	return () => window.removeEventListener("hashchange", cb);
}

export function useRedesignRoute(): RedesignRoute {
	const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
	return parseRedesignHash(hash);
}
