import type { ExecutionEnv } from "../types.ts";
import type { AskUserRegistry } from "./ask-user.ts";

/** Filesystem and shell context required by the built-in execution tools. */
export interface ExecutionToolContext {
	env: ExecutionEnv;
	/** Registry of suspended ask_user_question calls; set when the ask tool is enabled. */
	askUser?: AskUserRegistry;
}
