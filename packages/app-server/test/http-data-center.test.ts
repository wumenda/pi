/**
 * HTTP 数据中心面：overview/建任务/multipart 上传（资料+成果）/元数据编辑/
 * 文件流（content-type、inline|attachment）/关系图/成果包 zip（PK 魔数）。
 * store 用真实 createDataCenterStore（tmpdir），端点 handler 为被测单元。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataCenterStore, type DataCenterStoreHandle } from "../src/data-center-store.ts";
import { createHttpServer, type HttpDeps } from "../src/http.ts";

let dataDir = "";
let store: DataCenterStoreHandle;
let http: ReturnType<typeof createHttpServer>;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "dc-http-"));
	store = await createDataCenterStore(dataDir);
	const deps: HttpDeps = {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => [],
		listTools: async () => [],
		listSkills: async () => [],
		getSkillDetail: async () => null,
		sessionFilesRoot: async () => null,
		dataCenterStore: async () => store,
	};
	http = createHttpServer({ httpPort: 0 }, deps);
});

afterAll(async () => {
	if (dataDir.length > 0) await rm(dataDir, { recursive: true, force: true });
});

const BOUNDARY = "----dcfilesboundary";

/** multipart 构造：filename 有值为 file part，否则为文本字段 */
function multipartBody(parts: Array<{ name: string; filename?: string; content: string }>): Buffer {
	const body = parts
		.map((part) => {
			const disposition =
				part.filename !== undefined
					? `form-data; name="${part.name}"; filename="${part.filename}"`
					: `form-data; name="${part.name}"`;
			const contentType = part.filename !== undefined ? "Content-Type: application/octet-stream\r\n" : "";
			return `--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n${contentType}\r\n${part.content}\r\n`;
		})
		.join("");
	return Buffer.from(`${body}--${BOUNDARY}--\r\n`, "utf8");
}

function injectMultipart(url: string, parts: Array<{ name: string; filename?: string; content: string }>) {
	return http.inject({
		method: "POST",
		url,
		headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
		payload: multipartBody(parts),
	});
}

let taskId = "";

describe("GET /api/v1/data-center/overview", () => {
	it("returns empty collections for a fresh store", async () => {
		const response = await http.inject({ method: "GET", url: "/api/v1/data-center/overview" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ tasks: [], materials: [], results: [] });
	});
});

describe("POST /api/v1/data-center/tasks", () => {
	it("creates a task", async () => {
		const response = await http.inject({
			method: "POST",
			url: "/api/v1/data-center/tasks",
			headers: { "content-type": "application/json" },
			payload: { name: "常减压扩产", taskType: "工艺诊断" },
		});
		expect(response.statusCode).toBe(200);
		const task = response.json() as { id: string; name: string; status: string };
		expect(task.name).toBe("常减压扩产");
		expect(task.status).toBe("未开始");
		taskId = task.id;
	});

	it("rejects missing fields with 400", async () => {
		const response = await http.inject({
			method: "POST",
			url: "/api/v1/data-center/tasks",
			headers: { "content-type": "application/json" },
			payload: { name: "x" },
		});
		expect(response.statusCode).toBe(400);
	});
});

describe("POST /api/v1/data-center/materials", () => {
	it("stores the uploaded file and returns the material dto", async () => {
		const response = await injectMultipart("/api/v1/data-center/materials", [
			{ name: "file", filename: "PFD-常减压.pdf", content: "%PDF-1.4 body" },
			{ name: "type", content: "PFD" },
			{ name: "description", content: "常减压流程图" },
			{ name: "taskIds", content: `${taskId}, unknown` },
		]);
		expect(response.statusCode).toBe(200);
		const material = response.json() as {
			id: string;
			name: string;
			fileType: string;
			sizeBytes: number;
			uploader: string;
			relatedTasks: Array<{ taskId: string }>;
		};
		expect(material.name).toBe("PFD-常减压.pdf");
		expect(material.fileType).toBe("pdf");
		expect(material.sizeBytes).toBe(13);
		expect(material.uploader).toBe("local");
		expect(material.relatedTasks).toEqual([{ taskId, taskName: "常减压扩产", usedIn: [] }]);
	});

	it("rejects file-less submissions with 400", async () => {
		const response = await injectMultipart("/api/v1/data-center/materials", [{ name: "type", content: "PFD" }]);
		expect(response.statusCode).toBe(400);
	});
});

describe("PATCH /api/v1/data-center/materials/:id", () => {
	it("updates metadata and returns 404 for unknown ids", async () => {
		const overview = (await (await http.inject({ method: "GET", url: "/api/v1/data-center/overview" })).json()) as {
			materials: Array<{ id: string }>;
		};
		const id = overview.materials[0]!.id;
		const response = await http.inject({
			method: "PATCH",
			url: `/api/v1/data-center/materials/${id}`,
			headers: { "content-type": "application/json" },
			payload: { description: "改后描述", remark: "备注" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ description: "改后描述", remark: "备注" });
		const missing = await http.inject({
			method: "PATCH",
			url: "/api/v1/data-center/materials/missing",
			headers: { "content-type": "application/json" },
			payload: { description: "x" },
		});
		expect(missing.statusCode).toBe(404);
	});
});

describe("POST /api/v1/data-center/results", () => {
	it("registers a result against a task", async () => {
		const response = await injectMultipart("/api/v1/data-center/results", [
			{ name: "file", filename: "方案对比.xlsx", content: "xlsx-bytes" },
			{ name: "taskId", content: taskId },
			{ name: "sourceStage", content: "阶段 3·方案推荐" },
		]);
		expect(response.statusCode).toBe(200);
		const result = response.json() as { id: string; taskId: string; fileType: string; sourceStage: string };
		expect(result.taskId).toBe(taskId);
		expect(result.fileType).toBe("xlsx");
		expect(result.sourceStage).toBe("阶段 3·方案推荐");
	});

	it("returns 400 without taskId and 404 for unknown task", async () => {
		const noTask = await injectMultipart("/api/v1/data-center/results", [
			{ name: "file", filename: "x.bin", content: "x" },
		]);
		expect(noTask.statusCode).toBe(400);
		const unknown = await injectMultipart("/api/v1/data-center/results", [
			{ name: "file", filename: "x.bin", content: "x" },
			{ name: "taskId", content: "missing" },
		]);
		expect(unknown.statusCode).toBe(404);
	});
});

describe("GET /api/v1/data-center/files/:id", () => {
	it("serves inline preview with real content types", async () => {
		const overview = (await (await http.inject({ method: "GET", url: "/api/v1/data-center/overview" })).json()) as {
			materials: Array<{ id: string }>;
		};
		const response = await http.inject({
			method: "GET",
			url: `/api/v1/data-center/files/${overview.materials[0]!.id}?disposition=inline`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toBe("application/pdf");
		expect(response.headers["content-disposition"]).toContain("inline");
		expect(response.headers["content-disposition"]).toContain(encodeURIComponent("PFD-常减压.pdf"));
		expect(response.body).toBe("%PDF-1.4 body");
	});

	it("defaults to attachment for downloads and 404s unknown ids", async () => {
		const overview = (await (await http.inject({ method: "GET", url: "/api/v1/data-center/overview" })).json()) as {
			materials: Array<{ id: string }>;
		};
		const response = await http.inject({
			method: "GET",
			url: `/api/v1/data-center/files/${overview.materials[0]!.id}`,
		});
		expect(response.headers["content-disposition"]).toContain("attachment");
		const missing = await http.inject({ method: "GET", url: "/api/v1/data-center/files/missing" });
		expect(missing.statusCode).toBe(404);
	});
});

describe("GET /api/v1/data-center/graph/:taskId", () => {
	it("returns the task graph and 404s unknown tasks", async () => {
		const response = await http.inject({ method: "GET", url: `/api/v1/data-center/graph/${taskId}` });
		expect(response.statusCode).toBe(200);
		const graph = response.json() as {
			nodes: Array<{ id: string; type: string }>;
			edges: Array<{ from: string; to: string }>;
		};
		expect(graph.nodes).toHaveLength(3); // raw + stage + final
		expect(graph.nodes.map((node) => node.type).sort()).toEqual(["final", "raw", "stage"]);
		expect(graph.edges).toHaveLength(2);
		const missing = await http.inject({ method: "GET", url: "/api/v1/data-center/graph/missing" });
		expect(missing.statusCode).toBe(404);
	});
});

describe("POST /api/v1/data-center/tasks/:id/package", () => {
	it("zips the selected results (PK magic) with a download filename", async () => {
		const overview = (await (await http.inject({ method: "GET", url: "/api/v1/data-center/overview" })).json()) as {
			results: Array<{ id: string }>;
		};
		const response = await http.inject({
			method: "POST",
			url: `/api/v1/data-center/tasks/${taskId}/package`,
			headers: { "content-type": "application/json" },
			payload: { ids: overview.results.map((result) => result.id) },
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toBe("application/zip");
		expect(response.headers["content-disposition"]).toContain("attachment");
		expect(response.headers["content-disposition"]).toContain(encodeURIComponent("常减压扩产-成果包.zip"));
		const payload = response.rawPayload;
		expect([payload[0], payload[1], payload[2], payload[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
	});

	it("maps unknown tasks to 404 and foreign ids to 400", async () => {
		const missing = await http.inject({
			method: "POST",
			url: "/api/v1/data-center/tasks/missing/package",
			headers: { "content-type": "application/json" },
			payload: { ids: [] },
		});
		expect(missing.statusCode).toBe(404);
		const overview = (await (await http.inject({ method: "GET", url: "/api/v1/data-center/overview" })).json()) as {
			results: Array<{ id: string }>;
		};
		const invalid = await http.inject({
			method: "POST",
			url: `/api/v1/data-center/tasks/${taskId}/package`,
			headers: { "content-type": "application/json" },
			payload: { ids: [overview.results[0]!.id, "foreign"] },
		});
		expect(invalid.statusCode).toBe(400);
	});
});

describe("store unavailability", () => {
	it("responds 503 when no store is wired", async () => {
		const stubDeps: HttpDeps = {
			readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
			listMcpTools: async () => [],
			listTools: async () => [],
			listSkills: async () => [],
			getSkillDetail: async () => null,
			sessionFilesRoot: async () => null,
			dataCenterStore: async () => null,
		};
		const bare = createHttpServer({ httpPort: 0 }, stubDeps);
		const response = await bare.inject({ method: "GET", url: "/api/v1/data-center/overview" });
		expect(response.statusCode).toBe(503);
	});
});
