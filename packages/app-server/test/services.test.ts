import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { Client } from "@earendil-works/pi-client";
import { createWsTransportFactory } from "@earendil-works/pi-client/ws";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createAppServer } from "../src/index.ts";
import { AgentController, SessionManagement, Transcript } from "../src/services/contracts.ts";
import { createSessionStore } from "../src/sessions.ts";
import { createFauxLlm } from "./faux-llm.ts";
import { bindServerServices, bindSessionServices } from "./service-bindings.ts";

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "app-server-"));
	dirs.push(dir);
	return dir;
};
afterEach(async () => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("app-server services", () => {
	it("create → attach → prompt → transcript updates flow to the client", { timeout: 20_000 }, async () => {
		const root = tempDir();
		const config = loadConfig({});
		config.dataDir = join(root, "data");
		const workspaceDir = resolve(config.dataDir, "workspace");
		const faux = createFauxLlm();
		const handle = createAppServer({
			deps: {
				config,
				store: createSessionStore({ dataDir: config.dataDir, workspaceDir }),
				llm: { models: faux.models, model: faux.model },
			},
		});
		await handle.start();
		try {
			const client = new Client({
				serverId: handle.serverId,
				transportFactory: createWsTransportFactory({ url: `ws://127.0.0.1:${handle.wsPort}` }),
			});
			await client.connect();
			const serverBinding = bindServerServices(client);
			const created = await serverBinding.use(SessionManagement).create({}, BACKGROUND_CONTEXT);
			expect(created.sessionId).toBeTruthy();
			expect(created.serverId).toBe(handle.serverId);
			await serverBinding.use(SessionManagement).attach(created.sessionId, BACKGROUND_CONTEXT);
			await waitUntil(() => client.attachment !== undefined && client.attachment.sessionId === created.sessionId);
			const sessionBinding = bindSessionServices(client);
			await sessionBinding.ready(BACKGROUND_CONTEXT);
			faux.faux.setResponses([fauxAssistantMessage([fauxText("service hello")])]);
			const response = await sessionBinding
				.use(AgentController)
				.prompt({ message: "hi", images: null }, BACKGROUND_CONTEXT);
			expect(response.accepted).toBe(true);
			await waitUntil(() =>
				JSON.stringify(sessionBinding.use(Transcript).state.value?.snapshot ?? null).includes("service hello"),
			);
			await sessionBinding.dispose(BACKGROUND_CONTEXT);
			await serverBinding.dispose(BACKGROUND_CONTEXT);
			await client.dispose();
		} finally {
			await handle.close();
		}
	});
});

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) throw new Error("waitUntil timed out");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
