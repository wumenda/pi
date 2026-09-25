/**
 * 数据中心适配层：pi 后端无数据中心领域（任务/资料/成果注册表）。
 * 页面结构完整复刻，数据面返回空集合（渲染空态），写入操作本地 no-op。
 */

import type {
	CreateDataCenterTaskInput,
	DataCenterGraphDTO,
	DataCenterMaterialDTO,
	DataCenterOverviewDTO,
	DataCenterTaskDTO,
	UpdateDataCenterMaterialInput,
} from "@platform/shared";

/** 上传资料元数据输入 */
export interface UploadMaterialMetaInput {
	name?: string;
	type?: string;
	description?: string;
	remark?: string;
	/** 关联任务 id（逗号拼接字符串，query 参数形态） */
	taskIds?: string;
}

/** 数据中心聚合清单（空集合：页面渲染空态） */
export async function fetchDataCenterOverview(): Promise<DataCenterOverviewDTO> {
	return { tasks: [], materials: [], results: [] };
}

/** 创建任务（本地回显：pi 后端无持久化） */
export async function createDataCenterTask(input: CreateDataCenterTaskInput): Promise<DataCenterTaskDTO> {
	const now = new Date().toISOString();
	return {
		id: `local-${Date.now()}`,
		name: input.name,
		taskType: input.taskType,
		status: "未开始",
		createdAt: now,
		updatedAt: now,
	};
}

/** 上传资料（no-op：pi 后端无资料注册表） */
export async function uploadDataCenterMaterial(
	_file: File,
	_meta: UploadMaterialMetaInput,
): Promise<DataCenterMaterialDTO> {
	throw new Error("pi 后端尚未接入数据中心存储");
}

/** 编辑资料元数据（no-op） */
export async function updateDataCenterMaterial(
	id: string,
	_patch: UpdateDataCenterMaterialInput,
): Promise<DataCenterMaterialDTO> {
	throw new Error(`pi 后端尚未接入数据中心存储（id=${id}）`);
}

/** 任务资料关系图（空图） */
export async function fetchDataCenterGraph(taskId: string): Promise<DataCenterGraphDTO> {
	return { taskId, nodes: [], edges: [] };
}

/** 数据中心文件流地址（拼接，不发请求） */
export function dataCenterFileUrl(id: string, disposition: "inline" | "attachment"): string {
	return `/api/v1/data-center/files/${encodeURIComponent(id)}?disposition=${disposition}`;
}

/** 触发浏览器下载（pi 后端无文件流端点，抛错提示） */
export function downloadDataCenterFile(id: string, _name: string): void {
	void id;
	void _name;
	throw new Error("pi 后端尚未接入数据中心存储");
}

/** 下载成果包（no-op） */
export async function downloadResultPackage(taskId: string, ids: string[], _taskName: string): Promise<void> {
	void taskId;
	void ids;
	throw new Error("pi 后端尚未接入数据中心存储");
}
