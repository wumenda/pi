/**
 * app-server HTTP 面（Task 18/19/24）：
 * - GET /api/v1/ui-resources —— MCP Apps iframe 的加载端点。iframe 以 HTTP src
 *   （而非 srcdoc）加载应用文档，使逐应用 CSP 响应头生效（srcdoc 只能继承宿主页 CSP）。
 * - CSP 求交：应用声明的 CSP 只允许在平台默认之上收窄，不允许放宽（方法论 10.1）。
 * - GET /api/v1/mcp-tools —— MCP Apps 工具清单（带 ui:// 声明的工具），
 *   web 侧用于描述符缺 serverId 的历史条目自愈。
 * - POST/GET /api/v1/sessions/:sessionId/files —— 会话文件上传/下载
 *   （ask_user file-collect / file-download）；resolve 后必须落在会话文件根内。
 */

import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { resolveIdentity } from "./config.ts";

export interface UiResourcePayload {
	mimeType: string;
	html: string;
	/** 应用在 _meta.ui.csp 声明的 CSP；未声明为 null */
	declaredCsp: string | null;
}

/** GET /api/v1/mcp-tools 条目：带 ui:// 声明的工具 + 受众可见性 */
export interface McpToolManifestEntry {
	serverId: string;
	name: string;
	resourceUri: string;
	/** 受众可见性声明（_meta.ui.visibility）；未声明时缺省（默认模型可见） */
	visibility?: string[];
}

export interface HttpDeps {
	/** ui:// 资源读取；userId 标识请求方用户（单用户模式 undefined），由装配层按用户路由 */
	readUiResource(
		userId: string | undefined,
		request: { serverId: string; resourceUri: string },
	): Promise<UiResourcePayload>;
	listMcpTools(userId: string | undefined): Promise<McpToolManifestEntry[]>;
	/** 会话文件根目录（uploads/downloads 安全边界）；未知会话返回 null */
	sessionFilesRoot(userId: string | undefined, sessionId: string): Promise<string | null>;
}

/** users 模式下经身份解析后的请求用户（单用户模式 undefined）。 */
interface AuthenticatedRequest extends FastifyRequest {
	userId?: string;
}

function requestUserId(request: FastifyRequest): string | undefined {
	return (request as AuthenticatedRequest).userId;
}

/** 单文件大小上限（服务端硬顶；字段级 maxSizeMB 约束由模型/前端另行限制） */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const PLATFORM_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'";

function parseDirectives(header: string): Array<[string, string[]]> {
	return header
		.split(";")
		.map((directive) => directive.trim())
		.filter((directive) => directive.length > 0)
		.map((directive) => {
			const [name, ...values] = directive.split(/\s+/);
			return [name ?? "", values] as [string, string[]];
		});
}

/**
 * CSP 求交：声明的指令族只保留平台允许集内的值（子集收窄）；
 * 未知指令族整体丢弃（不允许引入平台未授予的能力）；
 * 声明缺失的平台指令族补平台默认值（保住平台底线）。
 */
export function intersectCsp(declared: string | null): string {
	if (declared === null || declared.trim() === "") return PLATFORM_CSP;
	const platformDirectives = new Map(parseDirectives(PLATFORM_CSP).map(([name, values]) => [name, new Set(values)]));
	const merged: Array<[string, string[]]> = [];
	for (const [name, values] of parseDirectives(declared)) {
		const allowed = platformDirectives.get(name);
		if (allowed === undefined) continue;
		// 收窄后无有效值 → 丢弃该条目，让平台默认值兜底（避免裸指令的歧义语义）
		const kept = values.filter((value) => allowed.has(value));
		if (kept.length > 0) merged.push([name, kept]);
	}
	for (const [name, values] of platformDirectives) {
		if (!merged.some(([mergedName]) => mergedName === name)) merged.push([name, [...values]]);
	}
	return merged.map(([name, values]) => [name, ...values].join(" ")).join("; ");
}

export function createHttpServer(
	options: { httpPort: number; token?: string; users?: Record<string, string>; webDist?: string },
	deps: HttpDeps,
): FastifyInstance {
	const app = Fastify({ logger: false });
	app.register(fastifyMultipart, { limits: { fileSize: MAX_FILE_SIZE } });
	// 静态托管（Task 28，webDist 配置后启用）：packages/web/dist 生产构建面。
	// SPA fallback：未匹配路由的非 /api/ 路径回落 index.html（深链）；
	// 未知 /api/ 路径保持 404 JSON，不被 fallback 吞掉。
	if (options.webDist !== undefined && options.webDist !== "") {
		app.register(fastifyStatic, { root: resolve(options.webDist), wildcard: false });
		app.setNotFoundHandler((request, reply) => {
			if (request.raw.url?.startsWith("/api/")) {
				return reply.code(404).send({ error: "not found" });
			}
			return reply.sendFile("index.html");
		});
	}
	// CORS：web 前端（vite 8788）跨源访问 HTTP 面（上传/下载/ui-resources）。
	// 回环开发面不带凭据，通配 origin 即可；token 认证（Task 26）接入后仍适用。
	// 预检 OPTIONS 在 token 校验之前放行（浏览器预检不携带自定义凭据）。
	app.addHook("onRequest", async (request, reply) => {
		if (request.method === "OPTIONS") {
			return reply
				.code(204)
				.header("access-control-allow-origin", "*")
				.header("access-control-allow-methods", "GET, POST, OPTIONS")
				.header("access-control-allow-headers", "content-type, authorization")
				.header("access-control-max-age", "600")
				.send();
		}
	});
	app.addHook("onSend", async (_request, reply, payload) => {
		reply.header("access-control-allow-origin", "*");
		return payload;
	});
	// 认证与身份解析（query ?token= 优先，其次 Authorization: Bearer）：
	// - users 模式（Task 27）：token 必须命中映射，解析出的 userId 挂在 request 上供路由；
	// - 单用户模式（APP_SERVER_TOKEN 配置后启用）：仅校验 token；
	// 401 响应经 onSend 钩子带 ACAO，浏览器可读到错误文案。query 传 token 属 ADR-0003 已知权衡
	// （日志泄漏风险）：fastify logger 关闭，不记录 query。
	const authToken = options.token;
	const users = options.users;
	if (users !== undefined || (authToken !== undefined && authToken !== "")) {
		app.addHook("onRequest", async (request, reply) => {
			const query = request.query as Record<string, unknown>;
			const queryToken = typeof query.token === "string" && query.token.length > 0 ? query.token : undefined;
			const header = request.headers.authorization;
			const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
			const token = queryToken ?? bearer;
			if (users !== undefined) {
				const identity = resolveIdentity(users, token);
				if (identity.kind === "reject") return reply.code(401).send({ error: "unauthorized" });
				(request as AuthenticatedRequest).userId = identity.kind === "user" ? identity.userId : undefined;
				return;
			}
			if (token !== authToken) {
				return reply.code(401).send({ error: "unauthorized" });
			}
		});
	}
	app.get("/api/v1/ui-resources", async (request, reply) => {
		const { serverId, resourceUri } = request.query as Record<string, string | undefined>;
		if (serverId === undefined || serverId === "" || resourceUri === undefined || resourceUri === "") {
			return reply.code(400).send({ error: "serverId and resourceUri are required" });
		}
		try {
			const resource = await deps.readUiResource(requestUserId(request), { serverId, resourceUri });
			return reply
				.code(200)
				.header("content-type", `${resource.mimeType}; charset=utf-8`)
				.header("content-security-policy", intersectCsp(resource.declaredCsp))
				.header("cache-control", "no-store")
				.send(resource.html);
		} catch (error) {
			request.log.error(error);
			return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
		}
	});
	app.get("/api/v1/mcp-tools", async (request, reply) => {
		const tools = await deps.listMcpTools(requestUserId(request));
		return reply.code(200).header("cache-control", "no-store").send(tools);
	});

	/** 解析会话文件根内相对路径；越界（resolve 后逃出根）返回 undefined */
	function resolveWithin(root: string, relativePath: string): string | undefined {
		const resolvedPath = resolve(root, relativePath);
		return resolvedPath === root || resolvedPath.startsWith(root + sep) ? resolvedPath : undefined;
	}

	app.post("/api/v1/sessions/:sessionId/files", async (request, reply) => {
		const { sessionId } = request.params as { sessionId: string };
		const root = await deps.sessionFilesRoot(requestUserId(request), sessionId);
		if (root === null) return reply.code(404).send({ error: `unknown session: ${sessionId}` });
		const saved: Array<{ filename: string; path: string }> = [];
		try {
			for await (const part of request.parts()) {
				if (part.type !== "file") continue; // 忽略非文件字段
				const originalName = part.filename ?? "file";
				// 存盘名剥路径分量并加 uuid 前缀，防同名覆盖与路径注入
				const safeName = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
				const storedName = `${randomUUID()}-${safeName}`;
				const buffer = await part.toBuffer(); // 超过 fileSize 上限时抛错 → 400
				const relativePath = `uploads/${storedName}`;
				const target = resolveWithin(root, relativePath);
				if (target === undefined) return reply.code(400).send({ error: "path escapes session root" });
				await mkdir(resolve(target, ".."), { recursive: true });
				await writeFile(target, buffer);
				saved.push({ filename: originalName, path: relativePath });
			}
		} catch (error) {
			request.log.error(error);
			return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
		}
		return reply.code(200).send(saved);
	});

	app.get("/api/v1/sessions/:sessionId/files", async (request, reply) => {
		const { sessionId } = request.params as { sessionId: string };
		const { path: relativePath } = request.query as Record<string, string | undefined>;
		if (relativePath === undefined || relativePath === "") {
			return reply.code(400).send({ error: "path is required" });
		}
		const root = await deps.sessionFilesRoot(requestUserId(request), sessionId);
		if (root === null) return reply.code(404).send({ error: `unknown session: ${sessionId}` });
		const resolvedPath = resolveWithin(root, relativePath);
		if (resolvedPath === undefined) return reply.code(400).send({ error: "path escapes session root" });
		// 双保险：realpath 消解符号链接后复查仍须落在根内
		let realPath: string;
		try {
			realPath = await realpath(resolvedPath);
		} catch {
			return reply.code(404).send({ error: `file not found: ${relativePath}` });
		}
		if (realPath !== root && !realPath.startsWith(root + sep)) {
			return reply.code(400).send({ error: "path escapes session root" });
		}
		const content = await readFile(realPath).catch(() => undefined);
		if (content === undefined) return reply.code(404).send({ error: `file not found: ${relativePath}` });
		const filename = basename(realPath);
		return reply
			.code(200)
			.header("content-type", "application/octet-stream")
			.header(
				"content-disposition",
				`attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
			)
			.send(realPath === resolvedPath ? createReadStream(realPath) : content);
	});
	return app;
}
