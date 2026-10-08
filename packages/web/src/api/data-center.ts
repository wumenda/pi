/**
 * 数据中心适配层：app-server /api/v1/data-center/* 真实端点。
 * 后端 wire 形状与 @platform/shared DataCenter*DTO 1:1（data-center-store 为服务端真源）。
 */

import type {
	CreateDataCenterTaskInput,
	DataCenterGraphDTO,
	DataCenterMaterialDTO,
	DataCenterOverviewDTO,
	DataCenterTaskDTO,
	UpdateDataCenterMaterialInput,
} from "@platform/shared";
import { http, unwrap } from "./client";

/** 上传资料元数据输入（multipart 文本字段形态；taskIds 逗号拼接） */
export interface UploadMaterialMetaInput {
	name?: string;
	type?: string;
	description?: string;
	remark?: string;
	/** 关联任务 id（逗号拼接字符串，query 参数形态） */
	taskIds?: string;
}

/** 数据中心聚合清单 */
export async function fetchDataCenterOverview(): Promise<DataCenterOverviewDTO> {
	return unwrap(http.get<DataCenterOverviewDTO>("/data-center/overview"));
}

/** 创建任务 */
export async function createDataCenterTask(input: CreateDataCenterTaskInput): Promise<DataCenterTaskDTO> {
	return unwrap(http.post<DataCenterTaskDTO>("/data-center/tasks", input));
}

/** 上传资料（multipart：file + 元数据文本字段） */
export async function uploadDataCenterMaterial(
	file: File,
	meta: UploadMaterialMetaInput,
): Promise<DataCenterMaterialDTO> {
	const form = new FormData();
	form.append("file", file);
	for (const [key, value] of Object.entries(meta)) {
		if (value !== undefined) form.append(key, value);
	}
	return unwrap(http.post<DataCenterMaterialDTO>("/data-center/materials", form));
}

/** 编辑资料元数据 */
export async function updateDataCenterMaterial(
	id: string,
	patch: UpdateDataCenterMaterialInput,
): Promise<DataCenterMaterialDTO> {
	return unwrap(http.patch<DataCenterMaterialDTO>(`/data-center/materials/${encodeURIComponent(id)}`, patch));
}

/** 任务资料关系图 */
export async function fetchDataCenterGraph(taskId: string): Promise<DataCenterGraphDTO> {
	return unwrap(http.get<DataCenterGraphDTO>(`/data-center/graph/${encodeURIComponent(taskId)}`));
}

/** 数据中心文件流地址（预览 iframe/img 与下载共用；同源代理直达） */
export function dataCenterFileUrl(id: string, disposition: "inline" | "attachment"): string {
	return `/api/v1/data-center/files/${encodeURIComponent(id)}?disposition=${disposition}`;
}

/** 触发浏览器下载（同源端点，anchor download 即流式落盘） */
export function downloadDataCenterFile(id: string, _name: string): void {
	void _name; // 文件名由后端 content-disposition 提供
	const anchor = document.createElement("a");
	anchor.href = dataCenterFileUrl(id, "attachment");
	anchor.download = "";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
}

/** 下载成果包（POST 选中的成果 id 列表，zip blob 落盘） */
export async function downloadResultPackage(taskId: string, ids: string[], taskName: string): Promise<void> {
	const response = await http.post<Blob>(
		`/data-center/tasks/${encodeURIComponent(taskId)}/package`,
		{ ids },
		{ responseType: "blob" },
	);
	const url = URL.createObjectURL(response.data);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${taskName}-成果包.zip`;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
