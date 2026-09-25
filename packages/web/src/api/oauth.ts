/** OAuth 适配层：pi 侧 MCP server 认证由 app-server 配置管理，授权码流程 no-op */

/** 发起授权结果 */
export interface OAuthStartResult {
	authorizationUrl: string;
}

/** 发起授权码流程（no-op：返回 javascript: 占位，SettingsModal 打开无效窗口前应先探测状态） */
export async function startOAuth(_serverId: string, _url: string): Promise<OAuthStartResult> {
	void _serverId;
	void _url;
	return { authorizationUrl: "about:blank" };
}

/** 授权状态轮询（no-op：恒未授权） */
export async function fetchOAuthStatus(_serverId: string): Promise<{ authorized: boolean }> {
	void _serverId;
	return { authorized: false };
}
