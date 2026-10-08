/**
 * 数据中心领域存储（host 级，每 host 一份）：
 * - 磁盘布局：<dataDir>/data-center/registry.json（任务/资料/成果全量元数据）
 *   + <dataDir>/data-center/files/<uuid>-<safeName>（资料与成果的实体文件）。
 *   dataDir 由 host 派生 → 多用户模式自动隔离到 users/<userId>/。
 * - registry 启动读入内存，写穿持久化（tmp+rename 原子写）；变更经 promise-chain
 *   串行防交错（模式同 tool-events）。
 * - MVP 语义：task.status 恒 "未开始"、material.aiStatus 恒 "未解析"、usageRecords 空、
 *   aiParseResult null（无生产者）；成果由 POST /data-center/results 显式登记，
 *   后续 agent 会话产出可调该端点落地。
 * - graph 硬约定：文件类节点 id 为 `g-<条目id>`（RelationGraphCanvas 焦点定位按此前缀匹配）。
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { createLogger } from "./logger.ts";

const log = createLogger("data-center");

// ---------------------------------------------------------------------------
// wire 类型（服务端真源；字段与 web @platform/shared DataCenter*DTO 1:1）
// ---------------------------------------------------------------------------

export interface DataCenterTaskDTO {
	id: string;
	name: string;
	taskType: string;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface DataCenterTaskRefDTO {
	taskId: string;
	taskName: string;
	usedIn: string[];
}

export interface DataCenterUsageRecord {
	taskId: string;
	taskName: string;
	stage: string;
	time: string;
	action: string;
}

export interface DataCenterParseResult {
	metrics: Array<{ label: string; value: string }>;
	notes?: string;
}

export interface DataCenterMaterialDTO {
	id: string;
	name: string;
	type: string;
	fileType: string;
	sizeBytes: number;
	uploader: string;
	uploadedAt: string;
	aiStatus: "未解析" | "解析中" | "已解析" | "需确认" | "解析异常";
	description: string;
	remark: string;
	relatedTasks: DataCenterTaskRefDTO[];
	usageRecords: DataCenterUsageRecord[];
	aiParseResult: DataCenterParseResult | null;
}

export interface DataCenterResultDTO {
	id: string;
	taskId: string;
	name: string;
	type: string;
	fileType: string;
	sizeBytes: number;
	generatedAt: string;
	sourceStage: string;
	version: string;
	versionStatus: "当前版本" | "历史版本";
	description: string;
	remark: string;
	relatedResults: string[];
	versions: Array<{ version: string; status: string; time: string }>;
}

export interface DataCenterGraphNode {
	id: string;
	refId?: string;
	label: string;
	type: "raw" | "stage" | "intermediate" | "final";
	x: number;
	y: number;
}

export interface DataCenterGraphDTO {
	taskId: string;
	nodes: DataCenterGraphNode[];
	edges: Array<{ from: string; to: string }>;
}

export interface DataCenterOverviewDTO {
	tasks: DataCenterTaskDTO[];
	materials: DataCenterMaterialDTO[];
	results: DataCenterResultDTO[];
}

export interface CreateDataCenterTaskInput {
	name: string;
	taskType: string;
}

export interface UpdateDataCenterMaterialInput {
	description?: string;
	remark?: string;
	type?: string;
	relatedTaskIds?: string[];
}

export interface UploadMaterialMeta {
	name?: string;
	type?: string;
	description?: string;
	remark?: string;
	taskIds?: string[];
}

export interface AddResultMeta {
	taskId: string;
	name?: string;
	type?: string;
	sourceStage?: string;
	description?: string;
	remark?: string;
}

/** 注册表内部条目：DTO + 实体文件相对路径（返回 DTO 时剔除） */
interface MaterialRecord extends DataCenterMaterialDTO {
	file: string;
}

interface ResultRecord extends DataCenterResultDTO {
	file: string;
}

interface Registry {
	tasks: DataCenterTaskDTO[];
	materials: MaterialRecord[];
	results: ResultRecord[];
}

// 每实例独立的空注册表：不可共享可变对象（否则多 store 实例互相污染内存数据）
function emptyRegistry(): Registry {
	return { tasks: [], materials: [], results: [] };
}

// ---------------------------------------------------------------------------
// store 句柄
// ---------------------------------------------------------------------------

export interface DataCenterStoreHandle {
	overview(): Promise<DataCenterOverviewDTO>;
	createTask(input: CreateDataCenterTaskInput): Promise<DataCenterTaskDTO>;
	saveMaterial(
		uploader: string,
		fileName: string,
		buffer: Buffer,
		meta: UploadMaterialMeta,
	): Promise<DataCenterMaterialDTO>;
	updateMaterial(id: string, patch: UpdateDataCenterMaterialInput): Promise<DataCenterMaterialDTO | null>;
	addResult(fileName: string, buffer: Buffer, meta: AddResultMeta): Promise<DataCenterResultDTO | null>;
	/** 文件实体定位（下载/预览）；id 为资料或成果 id，未知返回 null */
	findFile(id: string): Promise<{ absPath: string; name: string; fileType: string } | null>;
	/** 任务关系图；未知任务返回 null */
	graph(taskId: string): Promise<DataCenterGraphDTO | null>;
	/** 成果包条目（zip 打包输入）；未知任务返回 null，ids 不属于该任务成果时抛错 */
	packageEntries(
		taskId: string,
		ids: string[],
	): Promise<{ taskName: string; entries: Array<{ name: string; data: Buffer }> } | null>;
}

/** 存盘名剥路径分量并加 uuid 前缀，防同名覆盖与路径注入（与 sessions 上传同规则） */
function storedFileName(fileName: string): string {
	const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
	return `${randomUUID()}-${safeName}`;
}

function fileExtension(fileName: string): string {
	const ext = extname(fileName).replace(/^\./, "").toLowerCase();
	return ext.length > 0 ? ext : "bin";
}

function requireNonEmpty(value: string | undefined, field: string): string {
	const trimmed = value === undefined ? "" : value.trim();
	if (trimmed.length === 0) throw new Error(`${field} is required`);
	return trimmed;
}

function toMaterialDTO(record: MaterialRecord): DataCenterMaterialDTO {
	const { file: _file, ...dto } = record;
	return dto;
}

function toResultDTO(record: ResultRecord): DataCenterResultDTO {
	const { file: _file, ...dto } = record;
	return dto;
}

/**
 * 创建数据中心存储。registry 损坏/缺失降级空集合（error 日志，不阻塞启动）；
 * 变更操作经 promise-chain 串行后写穿（tmp+rename 原子替换）。
 */
export async function createDataCenterStore(dataDir: string): Promise<DataCenterStoreHandle> {
	const root = resolve(dataDir, "data-center");
	const filesRoot = join(root, "files");
	const registryPath = join(root, "registry.json");
	await mkdir(filesRoot, { recursive: true });

	let registry: Registry = emptyRegistry();
	try {
		const raw = await readFile(registryPath, "utf8");
		const parsed = JSON.parse(raw) as Registry;
		if (Array.isArray(parsed.tasks) && Array.isArray(parsed.materials) && Array.isArray(parsed.results)) {
			registry = parsed;
		} else {
			log.error("registry.json shape invalid; starting with empty registry");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			log.error(`registry.json load failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// 变更串行：后到的写穿等待先前的落盘完成，避免 read-modify-write 交错
	let writeChain: Promise<unknown> = Promise.resolve();
	async function persist(): Promise<void> {
		const tmpPath = `${registryPath}.${randomUUID()}.tmp`;
		await writeFile(tmpPath, JSON.stringify(registry, null, "\t"), "utf8");
		await rename(tmpPath, registryPath);
	}
	function mutate<T>(operation: () => Promise<T> | T): Promise<T> {
		const next = writeChain.then(operation, operation);
		writeChain = next.catch(() => undefined);
		return next;
	}

	/** 写文件实体到 files 根；返回 registry 内的相对路径 */
	async function saveFile(fileName: string, buffer: Buffer): Promise<string> {
		const storedName = storedFileName(fileName);
		const target = join(filesRoot, storedName);
		// 防御：存盘名由服务端生成，此处仍校验 resolve 后不逃出 files 根
		const resolvedTarget = resolve(target);
		if (!resolvedTarget.startsWith(filesRoot + sep) && resolvedTarget !== filesRoot) {
			throw new Error("stored file escapes data-center files root");
		}
		await writeFile(resolvedTarget, buffer);
		return `files/${storedName}`;
	}

	async function findFileRecord(id: string): Promise<MaterialRecord | ResultRecord | null> {
		const material = registry.materials.find((entry) => entry.id === id);
		if (material !== undefined) return material;
		return registry.results.find((entry) => entry.id === id) ?? null;
	}

	const overview = async (): Promise<DataCenterOverviewDTO> => ({
		tasks: registry.tasks,
		materials: registry.materials.map(toMaterialDTO),
		results: registry.results.map(toResultDTO),
	});

	const createTask = (input: CreateDataCenterTaskInput): Promise<DataCenterTaskDTO> =>
		mutate(async () => {
			const name = requireNonEmpty(input.name, "name");
			const taskType = requireNonEmpty(input.taskType, "taskType");
			const now = new Date().toISOString();
			const task: DataCenterTaskDTO = {
				id: randomUUID(),
				name,
				taskType,
				status: "未开始",
				createdAt: now,
				updatedAt: now,
			};
			registry.tasks.push(task);
			await persist();
			return task;
		});

	const saveMaterial = (
		uploader: string,
		fileName: string,
		buffer: Buffer,
		meta: UploadMaterialMeta,
	): Promise<DataCenterMaterialDTO> =>
		mutate(async () => {
			const name = meta.name !== undefined && meta.name.trim() !== "" ? meta.name.trim() : basename(fileName);
			const file = await saveFile(fileName, buffer);
			const now = new Date().toISOString();
			const relatedTasks = (meta.taskIds ?? [])
				.map((taskId) => registry.tasks.find((task) => task.id === taskId))
				.filter((task): task is DataCenterTaskDTO => task !== undefined)
				.map((task) => ({ taskId: task.id, taskName: task.name, usedIn: [] as string[] }));
			const record: MaterialRecord = {
				id: randomUUID(),
				name,
				type: meta.type ?? "其他",
				fileType: fileExtension(fileName),
				sizeBytes: buffer.byteLength,
				uploader: uploader.length > 0 ? uploader : "local",
				uploadedAt: now,
				aiStatus: "未解析",
				description: meta.description ?? "",
				remark: meta.remark ?? "",
				relatedTasks,
				usageRecords: [],
				aiParseResult: null,
				file,
			};
			registry.materials.push(record);
			await persist();
			return toMaterialDTO(record);
		});

	const updateMaterial = (id: string, patch: UpdateDataCenterMaterialInput): Promise<DataCenterMaterialDTO | null> =>
		mutate(async () => {
			const record = registry.materials.find((entry) => entry.id === id);
			if (record === undefined) return null;
			if (patch.description !== undefined) record.description = patch.description;
			if (patch.remark !== undefined) record.remark = patch.remark;
			if (patch.type !== undefined) record.type = patch.type;
			if (patch.relatedTaskIds !== undefined) {
				record.relatedTasks = patch.relatedTaskIds
					.map((taskId) => registry.tasks.find((task) => task.id === taskId))
					.filter((task): task is DataCenterTaskDTO => task !== undefined)
					.map((task) => ({ taskId: task.id, taskName: task.name, usedIn: [] as string[] }));
			}
			await persist();
			return toMaterialDTO(record);
		});

	const addResult = (fileName: string, buffer: Buffer, meta: AddResultMeta): Promise<DataCenterResultDTO | null> =>
		mutate(async () => {
			const task = registry.tasks.find((entry) => entry.id === meta.taskId);
			if (task === undefined) return null;
			const name = meta.name !== undefined && meta.name.trim() !== "" ? meta.name.trim() : basename(fileName);
			const file = await saveFile(fileName, buffer);
			const now = new Date().toISOString();
			const record: ResultRecord = {
				id: randomUUID(),
				taskId: task.id,
				name,
				type: meta.type ?? "其他",
				fileType: fileExtension(fileName),
				sizeBytes: buffer.byteLength,
				generatedAt: now,
				sourceStage: meta.sourceStage ?? "",
				version: "v1",
				versionStatus: "当前版本",
				description: meta.description ?? "",
				remark: meta.remark ?? "",
				relatedResults: [],
				versions: [{ version: "v1", status: "当前版本", time: now }],
				file,
			};
			registry.results.push(record);
			await persist();
			return toResultDTO(record);
		});

	const findFile = async (id: string): Promise<{ absPath: string; name: string; fileType: string } | null> => {
		const record = await findFileRecord(id);
		if (record === null) return null;
		const absPath = resolve(root, record.file);
		if (!absPath.startsWith(root + sep)) return null;
		return { absPath, name: record.name, fileType: record.fileType };
	};

	const graph = (taskId: string): Promise<DataCenterGraphDTO | null> =>
		mutate(async () => {
			const task = registry.tasks.find((entry) => entry.id === taskId);
			if (task === undefined) return null;
			const materials = registry.materials.filter((entry) =>
				entry.relatedTasks.some((ref) => ref.taskId === taskId),
			);
			const results = registry.results.filter((entry) => entry.taskId === taskId);
			const nodes: DataCenterGraphNode[] = [];
			const edges: Array<{ from: string; to: string }> = [];
			// 确定性三列布局：raw 左列、stage 居中、final 右列；`g-` 前缀满足前端焦点契约
			const taskNodeId = `t-${task.id}`;
			const rawCount = materials.length;
			const finalCount = results.length;
			const centerY = 360;
			materials.forEach((material, index) => {
				const nodeId = `g-${material.id}`;
				nodes.push({
					id: nodeId,
					refId: material.id,
					label: material.name,
					type: "raw",
					x: 80,
					y: rawCount === 1 ? centerY : 120 + (index * (2 * centerY - 120)) / (rawCount - 1),
				});
				edges.push({ from: nodeId, to: taskNodeId });
			});
			nodes.push({ id: taskNodeId, label: task.name, type: "stage", x: 400, y: centerY });
			results.forEach((result, index) => {
				const nodeId = `g-${result.id}`;
				nodes.push({
					id: nodeId,
					refId: result.id,
					label: result.name,
					type: "final",
					x: 720,
					y: finalCount === 1 ? centerY : 120 + (index * (2 * centerY - 120)) / (finalCount - 1),
				});
				edges.push({ from: taskNodeId, to: nodeId });
			});
			return { taskId, nodes, edges };
		});

	const packageEntries = (
		taskId: string,
		ids: string[],
	): Promise<{ taskName: string; entries: Array<{ name: string; data: Buffer }> } | null> =>
		mutate(async () => {
			const task = registry.tasks.find((entry) => entry.id === taskId);
			if (task === undefined) return null;
			const invalid = ids.filter(
				(id) => !registry.results.some((entry) => entry.id === id && entry.taskId === taskId),
			);
			if (invalid.length > 0) {
				throw new Error(`results do not belong to task ${taskId}: ${invalid.join(", ")}`);
			}
			const entries: Array<{ name: string; data: Buffer }> = [];
			for (const id of ids) {
				const record = registry.results.find((entry) => entry.id === id);
				if (record === undefined) continue; // mutate 串行下不会发生，防御
				const absPath = resolve(root, record.file);
				if (!absPath.startsWith(root + sep)) continue;
				const data = await readFile(absPath).catch(() => null);
				if (data === null) continue;
				// name 已带扩展名（上传原名）时不重复追加
				const entryName = record.name.toLowerCase().endsWith(`.${record.fileType}`)
					? record.name
					: `${record.name}.${record.fileType}`;
				entries.push({ name: entryName, data });
			}
			return { taskName: task.name, entries };
		});

	return {
		overview,
		createTask,
		saveMaterial,
		updateMaterial,
		addResult,
		findFile,
		graph,
		packageEntries,
	};
}
