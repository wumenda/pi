/**
 * 设置 API 适配层：
 * - MCP 状态 → pi.mcp-host.statuses()（chord 服务真实连接状态）；
 * - skills → app-server GET /api/v1/skills（host 启动时磁盘扫描快照）；
 * - 白名单 → 空数组（= 全部允许）；
 * - OAuth / 连通性测试 → no-op / 直连探测。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
	DefaultMcpServerDTO,
	McpStatusInfoDTO,
	SettingsInfoDTO,
	SharedToolMeta,
	SkillDetailDTO,
	SkillInfoDTO,
	SkillWhitelistItem,
} from "@platform/shared";
import { requirePiServices } from "../pi/pi-app";
import { http, unwrap } from "./client";

/** pi GET /api/v1/skills 清单条目（wire） */
interface PiSkillManifestEntry {
	name: string;
	description: string;
	directory: string;
	source: "global" | "project";
	disableModelInvocation: boolean;
	title?: string;
	meta?: string;
	version?: string;
	tools: SharedToolMeta[];
}

function toSkillInfo(entry: PiSkillManifestEntry): SkillInfoDTO {
	return {
		name: entry.name,
		...(entry.title !== undefined ? { title: entry.title } : {}),
		...(entry.description !== undefined ? { description: entry.description } : {}),
		...(entry.version !== undefined ? { version: entry.version } : {}),
		...(entry.meta !== undefined ? { meta: entry.meta } : {}),
		tools: entry.tools,
		directory: entry.directory,
		source: entry.source,
		metadataUnavailable: false,
	};
}

/** 设置聚合（MCP 连接状态为 pi 真实数据；插件注册清单 pi 侧无对应概念） */
export async function fetchSettingsInfo(): Promise<SettingsInfoDTO> {
	const services = requirePiServices();
	const statuses = await services.mcpHost.statuses(BACKGROUND_CONTEXT);
	return {
		pluginMcpServers: [],
		defaultMcpServers: statuses.map(
			(status): DefaultMcpServerDTO => ({
				name: status.id,
				type: "remote",
				enabled: status.state !== "disconnected",
				status: toMcpStatus(status.state, status.error),
			}),
		),
		toolIds: statuses.map((status) => `${status.id} (${status.toolCount} tools)`),
	};
}

function toMcpStatus(state: string, error: string | null): McpStatusInfoDTO {
	switch (state) {
		case "ready":
			return { status: "connected" };
		case "connecting":
			return { status: "disabled" };
		case "error":
			return { status: "failed", ...(error !== null && error.length > 0 ? { error } : {}) };
		default:
			return { status: "disabled" };
	}
}

/** 磁盘扫描的 skill 清单（app-server host 启动时扫描 ~/.pi/agent/skills + .pi/skills 的快照） */
export async function fetchSkills(): Promise<SkillInfoDTO[]> {
	const entries = await unwrap<PiSkillManifestEntry[]>(http.get<PiSkillManifestEntry[]>("/skills"));
	return entries.map(toSkillInfo);
}

/** 单 skill 详情（SKILL.md 原文由 /skills/:name 提供） */
export async function fetchSkillDetail(name: string): Promise<SkillDetailDTO> {
	const entry = await unwrap<PiSkillManifestEntry & { body: string; metadataUnavailable: boolean }>(
		http.get(`/skills/${encodeURIComponent(name)}`),
	);
	return { ...toSkillInfo(entry), body: entry.body, metadataUnavailable: entry.metadataUnavailable };
}

/** skill tab 白名单（空数组 = 全部允许） */
export async function fetchSkillWhitelist(): Promise<SkillWhitelistItem[]> {
	return [];
}

/** 连接默认 MCP（no-op：pi 由 app-server 配置管理连接，返回当前状态） */
export async function connectMcpServer(name: string): Promise<McpStatusInfoDTO> {
	const services = requirePiServices();
	const status = (await services.mcpHost.statuses(BACKGROUND_CONTEXT)).find((s) => s.id === name);
	return status === undefined ? { status: "disabled" } : toMcpStatus(status.state, status.error);
}

/** 断开默认 MCP（no-op：pi 由 app-server 配置管理连接） */
export async function disconnectMcpServer(name: string): Promise<McpStatusInfoDTO> {
	return connectMcpServer(name);
}

/** 连通性测试结果 */
export interface McpTestResult {
	ok: boolean;
	latencyMs?: number;
	error?: string;
}

/** 探测 MCP 端点可达性（直连 HTTP GET，3s 超时） */
export async function testMcpEndpoint(url: string): Promise<McpTestResult> {
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = window.setTimeout(() => controller.abort(), 3000);
	try {
		const res = await fetch(url, { signal: controller.signal, mode: "cors" });
		return { ok: true, latencyMs: Date.now() - startedAt, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		window.clearTimeout(timer);
	}
}
