/**
 * 设置 API 适配层：
 * - MCP 状态 → pi.mcp-host.statuses()（chord 服务真实连接状态）；
 * - skills → 转译层注册表缓存（transcript 中 skill-meta 声明）；
 * - 白名单 → 空数组（= 全部允许）；
 * - OAuth / 连通性测试 → no-op / 直连探测。
 */

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
	DefaultMcpServerDTO,
	McpStatusInfoDTO,
	SettingsInfoDTO,
	SkillDetailDTO,
	SkillInfoDTO,
	SkillWhitelistItem,
} from "@platform/shared";
import { requirePiServices } from "../pi/pi-app";
import { knownSkills } from "./transcript";

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

/** 磁盘扫描的 skill 清单（pi 侧 = transcript 中 skill-meta 声明注册表） */
export async function fetchSkills(): Promise<SkillInfoDTO[]> {
	return knownSkills();
}

/** 单 skill 详情（注册表命中时返回元数据；SKILL.md 原文 pi 侧不可读，body 恒空） */
export async function fetchSkillDetail(name: string): Promise<SkillDetailDTO> {
	const known = knownSkills().find((skill) => skill.name === name);
	if (known === undefined) {
		return {
			name,
			tools: [],
			directory: "",
			source: "global",
			metadataUnavailable: true,
			body: "",
		};
	}
	return { ...known, metadataUnavailable: false, body: "" };
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
