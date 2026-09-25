/** 工具库适配层：pi GET /api/v1/mcp-tools 清单 → ToolLibraryItem 投影 */

import type { ToolLibraryItem } from "@platform/shared";
import { http, unwrap } from "./client";
import { fetchMcpTools } from "./tools";

/** pi 清单条目（HTTP 面） */
interface PiMcpToolManifestEntry {
	serverId: string;
	name: string;
	resourceUri: string;
}

/** 工具库清单（pi 侧来源 = 带 ui:// 声明的 MCP Apps 工具；无 schema/描述元数据） */
export async function fetchToolLibrary(): Promise<ToolLibraryItem[]> {
	let entries: PiMcpToolManifestEntry[];
	try {
		entries = await unwrap<PiMcpToolManifestEntry[]>(http.get<PiMcpToolManifestEntry[]>("/mcp-tools"));
	} catch {
		// HTTP 面不可达时回退 chord 清单（同数据源）
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
		category: "通用能力",
		serverId: entry.serverId,
		source: "plugin" as const,
	}));
}
