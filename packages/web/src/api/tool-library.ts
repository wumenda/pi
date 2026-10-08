/** 工具库适配层：pi GET /api/v1/tools 全量清单 → ToolLibraryItem 投影 */

import type { ToolLibraryItem } from "@platform/shared";
import { http, unwrap } from "./client";
import { fetchMcpTools } from "./tools";

/** pi 全量工具清单条目（HTTP 面） */
interface PiToolEntry {
	serverId: string;
	name: string;
	title?: string;
	description?: string;
	/** 有值 = 带 ui:// 声明的 MCP Apps 工具 */
	resourceUri?: string;
	inputSchema?: unknown;
}

/** 工具库清单（pi 侧来源 = 已连 MCP server 的全部工具；ui:// 标 plugin，其余 native） */
export async function fetchToolLibrary(): Promise<ToolLibraryItem[]> {
	let entries: PiToolEntry[];
	try {
		entries = await unwrap<PiToolEntry[]>(http.get<PiToolEntry[]>("/tools"));
	} catch {
		// HTTP 面不可达时回退 ui:// chord 清单（同数据源子集）
		const tools = await fetchMcpTools();
		return tools.map((tool) => ({
			name: tool.name,
			category: "通用能力",
			serverId: tool.serverId,
			source: "plugin" as const,
		}));
	}
	return entries.map((entry) => ({
		name: entry.name,
		...(entry.description !== undefined ? { description: entry.description } : {}),
		category: "通用能力",
		serverId: entry.serverId,
		source: entry.resourceUri === undefined ? ("native" as const) : ("plugin" as const),
	}));
}
