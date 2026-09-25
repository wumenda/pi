import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** serverId 持久化文件名（位于 dataDir 下，随数据目录走）。 */
const SERVER_ID_FILE = "server-id";

/** 与前端连接配置的校验一致：小写 UUIDv4（ConnectionGate/Client 均按此校验）。 */
const SERVER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidServerId(value: string): boolean {
	return SERVER_ID_PATTERN.test(value);
}

/**
 * 解析 app-server 身份（前端 hello 握手按它校验，必须重启不变）：
 * 1. 显式覆盖（APP_SERVER_SERVER_ID）最高优先，命中即回写文件保持单一事实源；
 * 2. 其次读取 <dataDir>/server-id；
 * 3. 文件缺失/损坏 → 生成新 UUIDv4 并持久化。
 */
export async function resolvePersistedServerId(dataDir: string, override?: string): Promise<string> {
	if (override !== undefined) {
		if (!isValidServerId(override)) {
			throw new Error(`APP_SERVER_SERVER_ID must be a lowercase UUIDv4, got ${JSON.stringify(override)}`);
		}
		await persist(dataDir, override);
		return override;
	}
	const file = join(dataDir, SERVER_ID_FILE);
	try {
		const persisted = (await readFile(file, "utf8")).trim();
		if (isValidServerId(persisted)) return persisted;
	} catch {
		// 文件缺失 → 走生成路径
	}
	const generated = randomUUID();
	await persist(dataDir, generated);
	return generated;
}

async function persist(dataDir: string, serverId: string): Promise<void> {
	const file = join(dataDir, SERVER_ID_FILE);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${serverId}\n`, "utf8");
}
