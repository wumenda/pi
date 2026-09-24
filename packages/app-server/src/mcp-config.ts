import { readFile } from "node:fs/promises";
import type { McpServerConfig, McpServerConfigMap } from "@earendil-works/pi-agent-core/harness/mcp";
import { createLogger } from "./logger.ts";

const log = createLogger("mcp-config");

/** Loads an mcp.json server map; missing file, bad JSON, and invalid entries degrade to skips/empty. */
export async function loadMcpServerConfigs(configPath: string): Promise<McpServerConfigMap> {
	let raw: string;
	try {
		raw = await readFile(configPath, "utf8");
	} catch {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		log.error(
			`Ignoring invalid MCP config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		log.error(`Ignoring invalid MCP config at ${configPath}: expected a JSON object of server configs`);
		return {};
	}
	const servers: McpServerConfigMap = {};
	for (const [id, value] of Object.entries(parsed)) {
		const config = toMcpServerConfig(value);
		if (config === undefined) {
			log.error(`Ignoring invalid MCP server config ${JSON.stringify(id)} at ${configPath}`);
			continue;
		}
		servers[id] = config;
	}
	return servers;
}

function toMcpServerConfig(value: unknown): McpServerConfig | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	if (candidate.type === "stdio") {
		if (typeof candidate.command !== "string" || candidate.command.length === 0) return undefined;
		const args = candidate.args === undefined ? undefined : toStringList(candidate.args);
		if (candidate.args !== undefined && args === undefined) return undefined;
		const env = candidate.env === undefined ? undefined : toStringRecord(candidate.env);
		if (candidate.env !== undefined && env === undefined) return undefined;
		const cwd =
			candidate.cwd === undefined
				? undefined
				: typeof candidate.cwd === "string" && candidate.cwd.length > 0
					? candidate.cwd
					: undefined;
		if (candidate.cwd !== undefined && cwd === undefined) return undefined;
		return {
			type: "stdio",
			command: candidate.command,
			...(args === undefined ? {} : { args }),
			...(env === undefined ? {} : { env }),
			...(cwd === undefined ? {} : { cwd }),
		};
	}
	if (candidate.type === "http") {
		if (typeof candidate.url !== "string" || candidate.url.length === 0) return undefined;
		const headers = candidate.headers === undefined ? undefined : toStringRecord(candidate.headers);
		if (candidate.headers !== undefined && headers === undefined) return undefined;
		return { type: "http", url: candidate.url, ...(headers === undefined ? {} : { headers }) };
	}
	return undefined;
}

function toStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const list: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") return undefined;
		list.push(entry);
	}
	return list;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") return undefined;
		record[key] = entry;
	}
	return record;
}
