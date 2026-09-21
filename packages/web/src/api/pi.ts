import { Client } from "@earendil-works/pi-client";
import { createWsTransportFactory } from "@earendil-works/pi-client/ws";

export interface PiConnectionConfig {
	/** WebSocket endpoint exposed by pi-server, e.g. ws://127.0.0.1:8787. */
	url: string;
	/** Canonical UUIDv4 advertised by the target pi-server. */
	serverId: string;
}

/** Creates a fresh Client wired to a pi-server over WebSocket. */
export function createPiClient(config: PiConnectionConfig): Client {
	return new Client({
		serverId: config.serverId,
		transportFactory: createWsTransportFactory({ url: config.url }),
	});
}
