import { Client } from "@earendil-works/pi-client";
import { createWsTransportFactory } from "@earendil-works/pi-client/ws";

export interface PiConnectionConfig {
	/** WebSocket endpoint exposed by pi-server, e.g. ws://127.0.0.1:8787. */
	url: string;
	/** Canonical UUIDv4 advertised by the target pi-server. */
	serverId: string;
	/** 访问令牌（app-server APP_SERVER_TOKEN）；缺省/空 = 匿名连接，url 不附带 */
	token?: string;
}

/** Creates a fresh Client wired to a pi-server over WebSocket. */
export function createPiClient(config: PiConnectionConfig): Client {
	const url = withTokenQuery(config.url, config.token);
	return new Client({
		serverId: config.serverId,
		transportFactory: createWsTransportFactory({ url }),
	});
}

/** url 追加 ?token=（已有 query 时用 &；空 token 原样返回） */
function withTokenQuery(url: string, token: string | undefined): string {
	if (token === undefined || token === "") return url;
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}token=${encodeURIComponent(token)}`;
}
