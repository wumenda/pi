/**
 * data-center-store：注册表 CRUD + 文件落盘 + graph 布局（g- 焦点前缀）+
 * 成果包条目校验 + registry 持久化重读 + 损坏降级。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDataCenterStore, type DataCenterStoreHandle } from "../src/data-center-store.ts";

let dataDir = "";
let store: DataCenterStoreHandle;

beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "data-center-"));
	store = await createDataCenterStore(dataDir);
});

afterAll(async () => {
	if (dataDir.length > 0) await rm(dataDir, { recursive: true, force: true });
});

describe("data-center store", () => {
	it("creates tasks and lists them in overview", async () => {
		const task = await store.createTask({ name: "T201 扩产诊断", taskType: "工艺诊断" });
		expect(task).toMatchObject({ name: "T201 扩产诊断", taskType: "工艺诊断", status: "未开始" });
		const overview = await store.overview();
		expect(overview.tasks).toHaveLength(1);
		expect(overview.materials).toEqual([]);
		expect(overview.results).toEqual([]);
	});

	it("rejects empty task fields", async () => {
		await expect(store.createTask({ name: "  ", taskType: "x" })).rejects.toThrow("name is required");
		await expect(store.createTask({ name: "x", taskType: "" })).rejects.toThrow("taskType is required");
	});

	it("saves materials with file persistence and metadata", async () => {
		const [task] = (await store.overview()).tasks;
		const material = await store.saveMaterial("tester", "PFD-T201.pdf", Buffer.from("%PDF-1.4 test"), {
			name: "PFD-T201.pdf",
			type: "PFD",
			description: "T201 塔流程图",
			taskIds: [task!.id, "unknown-task"],
		});
		expect(material).toMatchObject({
			name: "PFD-T201.pdf",
			type: "PFD",
			fileType: "pdf",
			sizeBytes: 13,
			uploader: "tester",
			aiStatus: "未解析",
			description: "T201 塔流程图",
		});
		// 未知 task 被过滤；known task 解析成引用
		expect(material.relatedTasks).toEqual([{ taskId: task!.id, taskName: "T201 扩产诊断", usedIn: [] }]);
		const file = await store.findFile(material.id);
		expect(file).toMatchObject({ name: "PFD-T201.pdf", fileType: "pdf" });
		expect((await readFile(file!.absPath)).toString()).toContain("%PDF-1.4");
	});

	it("updates material metadata and returns null for unknown ids", async () => {
		const [material] = (await store.overview()).materials;
		const updated = await store.updateMaterial(material!.id, { description: "updated", remark: "r1" });
		expect(updated).toMatchObject({ description: "updated", remark: "r1" });
		await expect(store.updateMaterial("missing", { description: "x" })).resolves.toBeNull();
	});

	it("registers results with version metadata; unknown task returns null", async () => {
		const [task] = (await store.overview()).tasks;
		const result = await store.addResult("方案对比.xlsx", Buffer.from("xlsx-bytes"), {
			taskId: task!.id,
			sourceStage: "阶段 3·方案推荐",
		});
		expect(result).toMatchObject({
			taskId: task!.id,
			name: "方案对比.xlsx",
			fileType: "xlsx",
			sourceStage: "阶段 3·方案推荐",
			version: "v1",
			versionStatus: "当前版本",
		});
		expect(result!.versions).toEqual([{ version: "v1", status: "当前版本", time: result!.generatedAt }]);
		await expect(store.addResult("x.bin", Buffer.alloc(1), { taskId: "missing" })).resolves.toBeNull();
	});

	it("builds the relation graph with g- node ids and three-column edges", async () => {
		const [task] = (await store.overview()).tasks;
		const [material] = (await store.overview()).materials;
		const [result] = (await store.overview()).results;
		const graph = await store.graph(task!.id);
		expect(graph!.nodes.map((node) => node.id)).toEqual([`g-${material!.id}`, `t-${task!.id}`, `g-${result!.id}`]);
		expect(graph!.edges).toEqual([
			{ from: `g-${material!.id}`, to: `t-${task!.id}` },
			{ from: `t-${task!.id}`, to: `g-${result!.id}` },
		]);
		expect(graph!.nodes[0]).toMatchObject({ type: "raw", refId: material!.id, x: 80 });
		expect(graph!.nodes[1]).toMatchObject({ type: "stage", x: 400 });
		expect(graph!.nodes[2]).toMatchObject({ type: "final", refId: result!.id, x: 720 });
		await expect(store.graph("missing")).resolves.toBeNull();
	});

	it("packages result entries and validates ownership", async () => {
		const [task] = (await store.overview()).tasks;
		const [result] = (await store.overview()).results;
		const packaged = await store.packageEntries(task!.id, [result!.id]);
		expect(packaged!.taskName).toBe("T201 扩产诊断");
		expect(packaged!.entries).toEqual([{ name: "方案对比.xlsx", data: Buffer.from("xlsx-bytes") }]);
		await expect(store.packageEntries("missing", [])).resolves.toBeNull();
		await expect(store.packageEntries(task!.id, [result!.id, "other"])).rejects.toThrow(
			/results do not belong to task/,
		);
	});

	it("persists registry across store reopen", async () => {
		const reopened = await createDataCenterStore(dataDir);
		const overview = await reopened.overview();
		expect(overview.tasks).toHaveLength(1);
		expect(overview.materials).toHaveLength(1);
		expect(overview.results).toHaveLength(1);
		expect(overview.materials[0]).toMatchObject({ name: "PFD-T201.pdf", description: "updated" });
		// 实体文件仍可定位读回
		const file = await reopened.findFile(overview.materials[0]!.id);
		expect((await readFile(file!.absPath)).toString()).toContain("%PDF-1.4");
	});

	it("degrades to empty registry on corrupt json", async () => {
		const corruptDir = await mkdtemp(join(tmpdir(), "dc-corrupt-"));
		try {
			await mkdir(join(corruptDir, "data-center"), { recursive: true });
			await writeFile(join(corruptDir, "data-center", "registry.json"), "{ not json", "utf8");
			const degraded = await createDataCenterStore(corruptDir);
			const overview = await degraded.overview();
			expect(overview).toEqual({ tasks: [], materials: [], results: [] });
		} finally {
			await rm(corruptDir, { recursive: true, force: true });
		}
	});
});
