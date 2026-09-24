/**
 * app-server HTTP 面（Task 18）：
 * - GET /api/v1/ui-resources —— MCP Apps iframe 的加载端点。iframe 以 HTTP src
 *   （而非 srcdoc）加载应用文档，使逐应用 CSP 响应头生效（srcdoc 只能继承宿主页 CSP）。
 * - CSP 求交：应用声明的 CSP 只允许在平台默认之上收窄，不允许放宽（方法论 10.1）。
 */

import Fastify, { type FastifyInstance } from "fastify";

export interface UiResourcePayload {
	mimeType: string;
	html: string;
	/** 应用在 _meta.ui.csp 声明的 CSP；未声明为 null */
	declaredCsp: string | null;
}

export interface HttpDeps {
	readUiResource(request: { serverId: string; resourceUri: string }): Promise<UiResourcePayload>;
}

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

export function createHttpServer(_options: { httpPort: number }, deps: HttpDeps): FastifyInstance {
	const app = Fastify({ logger: false });
	app.get("/api/v1/ui-resources", async (request, reply) => {
		const { serverId, resourceUri } = request.query as Record<string, string | undefined>;
		if (serverId === undefined || serverId === "" || resourceUri === undefined || resourceUri === "") {
			return reply.code(400).send({ error: "serverId and resourceUri are required" });
		}
		try {
			const resource = await deps.readUiResource({ serverId, resourceUri });
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
	return app;
}
