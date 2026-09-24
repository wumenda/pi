import { resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";
import {
	type JsonlSessionMetadata,
	JsonlSessionRepo,
	type Session,
} from "@earendil-works/pi-agent-core/harness/session";

export interface SessionStoreOptions {
	dataDir: string;
	/** 所有会话共享的工作区目录（JSONL 按 cwd 分组；文件读写的安全边界）。 */
	workspaceDir: string;
}

export interface SessionStore {
	create(id?: string): Promise<JsonlSessionMetadata>;
	list(): Promise<JsonlSessionMetadata[]>;
	resolve(sessionId: string): Promise<JsonlSessionMetadata>;
	open(metadata: JsonlSessionMetadata): Promise<Session<JsonlSessionMetadata>>;
	delete(sessionId: string): Promise<void>;
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
	const dataDir = resolve(options.dataDir);
	const workspaceDir = resolve(options.workspaceDir);
	const env = new NodeExecutionEnv({ cwd: dataDir });
	const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: "sessions" });
	const assertMetadata = (value: unknown): JsonlSessionMetadata => {
		if (value === null || typeof value !== "object" || !("id" in value)) {
			throw new Error("Invalid session metadata");
		}
		return value as JsonlSessionMetadata;
	};
	return {
		// repo.create 返回已登记为 open 的 Session；本 store 只产出 metadata，
		// 返回前必须关闭句柄，否则后续 open 会命中 "Session is already open"。
		create: (id) =>
			repo
				.create({ cwd: workspaceDir, ...(id === undefined ? {} : { id }) }, BACKGROUND_CONTEXT)
				.then(async (session) => {
					await session.close(BACKGROUND_CONTEXT);
					return session.metadata;
				}),
		// repo.list(undefined) 列出所有 cwd 的会话（packages/agent/.../jsonl/repo.ts list()），
		// 这里按本 store 的 workspaceDir 过滤。
		list: () => repo.list(undefined, BACKGROUND_CONTEXT).then((all) => all.filter((m) => m.cwd === workspaceDir)),
		async resolve(sessionId) {
			const all = await this.list();
			const found = all.find((m) => m.id === sessionId);
			if (found === undefined) throw new Error(`Session not found: ${sessionId}`);
			return assertMetadata(found);
		},
		open: (metadata) => repo.open(assertMetadata(metadata), BACKGROUND_CONTEXT),
		async delete(sessionId) {
			const metadata = await this.resolve(sessionId);
			await repo.delete(metadata, BACKGROUND_CONTEXT);
		},
	};
}
