import {
	type Context,
	createRemoteServiceBinding,
	type RemoteServiceBinding,
	type RemoteServiceTransport,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type Client, createClientServiceTransport } from "@earendil-works/pi-client";
import { AgentController, McpHost, SessionDirectory, SessionManagement, Transcript } from "./contracts.ts";

/**
 * Remote service bindings for one connected pi-server.
 *
 * Singleton services (session directory) route at the server target while
 * session-scoped services (transcript, agent controller, session management)
 * route at the current attachment. Both bindings rebind automatically as the
 * connection and attachment change.
 */
export class PiServices {
	readonly #client: Client;
	readonly #serverTransport: RemoteServiceTransport;
	readonly #sessionTransport: RemoteServiceTransport;
	readonly #serverBinding: RemoteServiceBinding;
	readonly #sessionBinding: RemoteServiceBinding;
	readonly #removeConnectionListener: () => void;
	readonly #removeAttachmentListener: () => void;
	readonly #onError: (error: Error) => void;
	#transitions = Promise.resolve();
	#disposed = false;

	constructor(client: Client, options: { onError?: (error: Error) => void } = {}) {
		this.#client = client;
		this.#onError = options.onError ?? (() => {});
		this.#serverTransport = createClientServiceTransport(client, () => ({ serverId: client.serverId }));
		this.#sessionTransport = createClientServiceTransport(client, () => client.attachment);
		this.#serverBinding = createRemoteServiceBinding({
			services: [{ id: SessionDirectory.id }, { id: SessionManagement.id }],
			transport: this.#serverTransport,
			bound: client.connected,
			onError: this.#onError,
		});
		this.#sessionBinding = createRemoteServiceBinding({
			services: [{ id: Transcript.id }, { id: AgentController.id }, { id: McpHost.id }],
			transport: this.#sessionTransport,
			bound: client.attachment !== undefined && client.connected,
			onError: this.#onError,
		});
		this.#removeConnectionListener = client.onConnectionStateChange(() => this.#scheduleRebind());
		this.#removeAttachmentListener = client.onAttachmentChange(() => this.#scheduleRebind());
	}

	get sessionDirectory(): SessionDirectory {
		return this.#serverBinding.use(SessionDirectory);
	}

	get transcript(): Transcript {
		return this.#sessionBinding.use(Transcript);
	}

	get agentController(): AgentController {
		return this.#sessionBinding.use(AgentController);
	}

	get sessionManagement(): SessionManagement {
		return this.#serverBinding.use(SessionManagement);
	}

	get mcpHost(): McpHost {
		return this.#sessionBinding.use(McpHost);
	}

	/** Wait until every acquired service has installed its initial snapshot. */
	ready(context: Context = BACKGROUND_CONTEXT): Promise<void> {
		return Promise.all([this.#serverBinding.ready(context), this.#sessionBinding.ready(context)]).then(
			() => undefined,
		);
	}

	async dispose(context: Context = BACKGROUND_CONTEXT): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#removeConnectionListener();
		this.#removeAttachmentListener();
		await this.#transitions;
		const results = await Promise.allSettled([
			this.#serverBinding.dispose(context),
			this.#sessionBinding.dispose(context),
		]);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "Failed to dispose pi services");
	}

	#scheduleRebind(): void {
		this.#transitions = this.#transitions
			.then(() => this.#rebind())
			.catch((error: unknown) => this.#onError(error instanceof Error ? error : new Error(String(error))));
	}

	async #rebind(): Promise<void> {
		const connected = this.#client.connected;
		const results = await Promise.allSettled([
			this.#serverBinding.rebind(connected, BACKGROUND_CONTEXT),
			this.#sessionBinding.rebind(connected && this.#client.attachment !== undefined, BACKGROUND_CONTEXT),
		]);
		const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length > 0) throw new AggregateError(failures, "Failed to rebind pi services");
	}
}
