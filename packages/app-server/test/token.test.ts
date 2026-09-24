/**
 * Task 26：token 认证（WS upgrade + /api/v1/* HTTP 面）。
 * - 配置 token 后：无/错 token 的 WS 升级被拒（401），?token=正确 通过；
 * - HTTP：无 token 401、query token 与 Authorization: Bearer 均通过；
 * - CORS 预检豁免（浏览器预检不携带 token），401 响应仍带 ACAO；
 * - 未配置 token（缺省）：开发回环匿名，行为与既有测试一致。
 */

import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createHttpServer, type HttpDeps } from "../src/http.ts";
import { createTokenWsListener } from "../src/token-ws-listener.ts";

const TOKEN = "t0k3n";

function deps(): HttpDeps {
	return {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => [],
		sessionFilesRoot: async () => null,
	};
}

describe("HTTP token auth", () => {
	it("rejects missing/wrong tokens with 401 and accepts query/bearer tokens", async () => {
		const app = createHttpServer({ httpPort: 0, token: TOKEN }, deps());
		try {
			const anonymous = await app.inject({ method: "GET", url: "/api/v1/mcp-tools" });
			expect(anonymous.statusCode).toBe(401);
			const wrong = await app.inject({ method: "GET", url: "/api/v1/mcp-tools?token=nope" });
			expect(wrong.statusCode).toBe(401);
			const viaQuery = await app.inject({ method: "GET", url: `/api/v1/mcp-tools?token=${TOKEN}` });
			expect(viaQuery.statusCode).toBe(200);
			const viaBearer = await app.inject({
				method: "GET",
				url: "/api/v1/mcp-tools",
				headers: { authorization: `Bearer ${TOKEN}` },
			});
			expect(viaBearer.statusCode).toBe(200);
		} finally {
			await app.close();
		}
	});

	it("keeps CORS preflight exempt and marks denied responses shareable", async () => {
		const app = createHttpServer({ httpPort: 0, token: TOKEN }, deps());
		try {
			const preflight = await app.inject({
				method: "OPTIONS",
				url: "/api/v1/mcp-tools",
				headers: { origin: "http://localhost:8788", "access-control-request-method": "GET" },
			});
			expect(preflight.statusCode).toBe(204);
			const denied = await app.inject({ method: "GET", url: "/api/v1/mcp-tools" });
			expect(denied.statusCode).toBe(401);
			expect(denied.headers["access-control-allow-origin"]).toBe("*");
		} finally {
			await app.close();
		}
	});

	it("stays open when no token is configured (development loopback default)", async () => {
		const app = createHttpServer({ httpPort: 0 }, deps());
		try {
			const response = await app.inject({ method: "GET", url: "/api/v1/mcp-tools" });
			expect(response.statusCode).toBe(200);
		} finally {
			await app.close();
		}
	});
});

describe("WS token auth", () => {
	/** 非 101 升级响应的 HTTP 状态码（ws 客户端 unexpected-response 事件） */
	function upgradeStatus(url: string): Promise<number> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.once("unexpected-response", (_request: unknown, response: { statusCode: number }) => {
				resolve(response.statusCode);
			});
			socket.once("open", () => {
				socket.close();
				reject(new Error("WebSocket upgrade should have been rejected"));
			});
			socket.once("error", (error) => reject(error));
		});
	}

	function openSocket(url: string): Promise<WebSocket> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.once("open", () => resolve(socket));
			socket.once("error", (error) => reject(error));
		});
	}

	it("rejects upgrades without/with a wrong token and accepts the matching token", async () => {
		const listener = createTokenWsListener({ port: 0, token: TOKEN });
		await listener.start(() => ({ onData() {}, onError() {}, onClose() {} }));
		try {
			const address = listener.address;
			if (address === undefined) throw new Error("listener did not report its address");
			const base = `ws://127.0.0.1:${address.port}`;
			await expect(upgradeStatus(base)).resolves.toBe(401);
			await expect(upgradeStatus(`${base}/?token=nope`)).resolves.toBe(401);
			const socket = await openSocket(`${base}/?token=${TOKEN}`);
			expect(socket.readyState).toBe(WebSocket.OPEN);
			socket.close();
		} finally {
			await listener.close();
		}
	});

	it("accepts anonymous upgrades when no token is configured", async () => {
		const listener = createTokenWsListener({ port: 0 });
		await listener.start(() => ({ onData() {}, onError() {}, onClose() {} }));
		try {
			const address = listener.address;
			if (address === undefined) throw new Error("listener did not report its address");
			const socket = await openSocket(`ws://127.0.0.1:${address.port}`);
			expect(socket.readyState).toBe(WebSocket.OPEN);
			socket.close();
		} finally {
			await listener.close();
		}
	});
});

afterAll(() => {
	// ws 客户端句柄随各 listener/socket 关闭回收；此处仅保证 vitest 干净退出。
});
