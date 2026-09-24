import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionEvent } from "../services/contracts.ts";
import type { PiServices } from "../services/pi-services.ts";

/** Fetch all recorded tool-execution events for the currently attached session. */
export function getToolEvents(services: PiServices): Promise<ToolExecutionEvent[]> {
	return services.toolEvents.events(BACKGROUND_CONTEXT);
}
