/**
 * Atomic file replacement for the edit/write tools: write to a temp file in the
 * same directory, fsync, then rename over the target.
 *
 * Why: a plain `writeFile` overwrite leaves the target truncated/half-written if
 * the process dies mid-write (Ctrl+C force quit, crash, ENOSPC), destroying the
 * previous content of a user file. Same-directory temp + rename turns the
 * visible state transition into "old content or new content, never in between".
 *
 * Failure semantics: any step that throws cleans up the temp file and rethrows;
 * the target keeps its original content. Windows note: rename over a target
 * held open exclusively by another process fails (EBUSY/EPERM) — the failure is
 * clean (original intact) and retryable, which is strictly better than a torn
 * write.
 */

import { randomUUID } from "crypto";
import { open, rename, rm } from "fs/promises";
import { basename, dirname, join } from "path";

export async function writeFileAtomic(absolutePath: string, content: string): Promise<void> {
	const tmp = join(dirname(absolutePath), `.${basename(absolutePath)}.pi-tmp-${randomUUID()}`);
	try {
		const handle = await open(tmp, "w");
		try {
			await handle.writeFile(content, "utf-8");
			// fsync before rename: after a crash, the renamed file must not be empty/truncated
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(tmp, absolutePath);
	} catch (error) {
		// Cleanup failure must not mask the original error
		await rm(tmp, { force: true }).catch(() => undefined);
		throw error;
	}
}
