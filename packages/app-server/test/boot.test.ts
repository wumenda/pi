import { Client } from "@earendil-works/pi-client";
import { createWsTransportFactory } from "@earendil-works/pi-client/ws";
import { describe, expect, it } from "vitest";
import { createAppServer } from "../src/index.ts";

describe("app-server bootstrap", () => {
	it("completes the hello handshake over WebSocket", async () => {
		const handle = createAppServer();
		await handle.start();
		try {
			const client = new Client({
				serverId: handle.serverId,
				transportFactory: createWsTransportFactory({ url: `ws://127.0.0.1:${handle.wsPort}` }),
			});
			const hello = await client.connect();
			expect(hello.serverId).toBe(handle.serverId);
			await client.dispose();
		} finally {
			await handle.close();
		}
	});
});
