import {
	type Context,
	createRemoteServiceEndpoint,
	RemoteServiceProvider,
	replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { RoutedServerServiceAttachment, RoutedServerServiceHost } from "@earendil-works/pi-server";
import { createLogger } from "../logger.ts";
import {
	type SessionCreateOptions,
	SessionDirectory,
	type SessionDirectoryState,
	SessionManagement,
	type SessionSummary,
} from "./contracts.ts";

const log = createLogger("server-services");

export interface ServerServices {
	readonly host: RoutedServerServiceHost;
	refresh(context?: Context): Promise<void>;
	dispose(): Promise<void>;
}

/** Server 级服务装配：session-directory（共享 replicated state）+ session-management。 */
export async function createServerServices(options: {
	list(context: Context): Promise<SessionSummary[]>;
	create(createOptions: SessionCreateOptions, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
}): Promise<ServerServices> {
	let revision = 1;
	const directory = replicatedState<SessionDirectoryState>({
		revision,
		sessions: await options.list(BACKGROUND_CONTEXT),
	});
	const attachments = new Set<RoutedServerServiceAttachment>();
	let mutationTail = Promise.resolve();

	const refreshNow = async (context: Context): Promise<void> => {
		const sessions = await options.list(context);
		revision += 1;
		directory.change(context, (draft) => {
			draft.revision = revision;
			draft.sessions = sessions;
		});
	};
	const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = mutationTail.catch(() => {}).then(operation);
		mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};

	return {
		host: {
			attachClient(presentation) {
				log.info("server services attachment created for client");
				const provider = new RemoteServiceProvider([
					{ service: SessionDirectory, mode: "singleton" },
					{ service: SessionManagement, mode: "singleton" },
				]);
				provider.provide(SessionDirectory, { state: directory });
				provider.provide(SessionManagement, {
					create: (createOptions, context) =>
						serialize(async () => {
							const created = await options.create(createOptions, context);
							log.info(`session-management.create -> ${created.sessionId}`);
							await refreshNow(context);
							return created;
						}),
					remove: (sessionId, context) =>
						serialize(async () => {
							log.info(`session-management.remove -> ${sessionId}`);
							await options.remove(sessionId, context);
							await refreshNow(context);
						}),
					attach: (sessionId, context) => {
						log.info(`session-management.attach -> ${sessionId}`);
						return serialize(() => presentation.attachSession(sessionId, context));
					},
					detach: (context) => {
						log.info("session-management.detach");
						return serialize(() => presentation.detachSession(context));
					},
				});
				const attachment = createProviderAttachment(provider, () => attachments.delete(attachment));
				attachments.add(attachment);
				return attachment;
			},
		},
		refresh: (context = BACKGROUND_CONTEXT) => serialize(() => refreshNow(context)),
		async dispose() {
			const releases = await Promise.allSettled(
				[...attachments].map((attachment) => attachment.release(BACKGROUND_CONTEXT)),
			);
			attachments.clear();
			await mutationTail;
			const errors = releases.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, "Failed to release server service attachments");
		},
	};
}

function createProviderAttachment(
	provider: RemoteServiceProvider,
	onRelease: () => void,
): RoutedServerServiceAttachment {
	const endpoint = createRemoteServiceEndpoint(provider);
	let released = false;
	return {
		invokeService(call, publish, context) {
			if (released) return Promise.reject(new Error("Server service attachment is released"));
			return endpoint.invoke(call, publish, context);
		},
		release() {
			if (released) return;
			released = true;
			endpoint.dispose();
			provider.dispose();
			onRelease();
		},
	};
}
