import type { Context, MutableReplicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type AgentLane,
	type HarnessEvent,
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	type LaneWatchEvent,
	reduceLaneSnapshot,
	type WatchHandle,
} from "@earendil-works/pi-agent-core";
import { createLogger } from "../logger.ts";
import type { Transcript, TranscriptState } from "./contracts.ts";

const log = createLogger("transcript");

export interface TranscriptRuntime {
	readonly service: Transcript;
	activate(): Promise<void>;
	dispose(): Promise<void>;
}

/** Replicates the main lane's coherent transcript to every attached client. */
export function createTranscriptService(
	lane: AgentLane,
	state: MutableReplicatedState<TranscriptState>,
): TranscriptRuntime {
	let watch: WatchHandle<LaneSnapshot> | undefined;
	let rebase: Promise<void> | undefined;
	let rebaseError: Error | undefined;

	const publishSnapshot = (next: LaneSnapshot, event: LaneWatchEvent | null, context: Context): void => {
		state.replace(context, { snapshot: next as LaneTranscriptSnapshot, event });
	};

	const scheduleRebase = (context: Context): void => {
		if (rebase !== undefined) return;
		const activeWatch = watch;
		if (activeWatch === undefined) return;
		const pending = (async () => {
			const refreshed = await activeWatch.resnapshot(context);
			publishSnapshot(refreshed, null, context);
		})();
		rebase = pending;
		void pending.then(
			() => {
				if (rebase === pending) rebase = undefined;
			},
			(error: unknown) => {
				rebaseError = error instanceof Error ? error : new Error(String(error));
				if (rebase === pending) rebase = undefined;
			},
		);
	};

	const onEvent = (event: HarnessEvent, context: Context): void => {
		if (rebaseError !== undefined) throw rebaseError;
		const forwarded = toLaneWatchEvent(event);
		if (forwarded === undefined) return;
		if (state.value.snapshot === null) throw new Error("Transcript service is not active");
		let needsRebase = false;
		state.change(context, (draft) => {
			needsRebase = reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event) === "rebase";
			draft.event = forwarded;
		});
		if (needsRebase) scheduleRebase(context);
	};

	return {
		service: { state },
		async activate() {
			if (watch !== undefined) throw new Error("Transcript service is already active");
			const opened = await lane.watch(BACKGROUND_CONTEXT);
			watch = opened;
			publishSnapshot(opened.snapshot, null, BACKGROUND_CONTEXT);
			opened.start(onEvent);
			log.info("transcript watch activated (initial snapshot published)");
		},
		async dispose() {
			log.info("transcript watch disposed");
			let failure: unknown;
			try {
				await rebase;
			} catch (error) {
				failure = error;
			}
			watch?.unsubscribe();
			watch = undefined;
			if (failure !== undefined) throw failure;
		},
	};
}

function toLaneWatchEvent(event: HarnessEvent): LaneWatchEvent | undefined {
	switch (event.type) {
		case "handler_error":
		case "turn_start":
		case "turn_end":
		case "value_update":
		case "lane_created":
			return undefined;
		case "config_update":
			if (event.property !== "model" && event.property !== "thinkingLevel" && event.property !== "activeTools") {
				return undefined;
			}
			return event as LaneWatchEvent;
		case "message_update": {
			if (event.message.role !== "assistant") {
				throw new TypeError("Harness message_update did not carry an assistant message");
			}
			const { event: _providerEvent, ...update } = event;
			return update as LaneWatchEvent;
		}
		default:
			return event as LaneWatchEvent;
	}
}
