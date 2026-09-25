import axios from "axios";

/**
 * 前端唯一 HTTP 客户端：对接 pi app-server 的 REST 面
 * （ui-resources / mcp-tools / sessions/:id/files）。
 * pi 后端无统一响应外壳，unwrap 保留为兼容签名（直通）。
 */
export const http = axios.create({
	baseURL: "/api/v1",
	timeout: 30_000,
});

/** 兼容签名：pi 后端直接返回数据本体，无 envelope 解包 */
export async function unwrap<T>(promise: Promise<{ data: T }>): Promise<T> {
	const { data } = await promise;
	return data;
}

/**
 * GET /api/v1/server-id：连接零手填的数据源（前端启动时自动发现 serverId）。
 * token 模式经 Authorization 头受认证钩子保护；同源（静态托管/开发代理）均可达。
 */
export async function fetchServerId(token?: string): Promise<string | undefined> {
	const response = await unwrap(
		http.get<{ serverId: string | null }>("/server-id", {
			headers: token === undefined ? undefined : { authorization: `Bearer ${token}` },
		}),
	);
	return response.serverId ?? undefined;
}
