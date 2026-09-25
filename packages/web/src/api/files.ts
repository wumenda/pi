/**
 * 会话文件 API 适配层：pi app-server REST
 * - POST /api/v1/sessions/:sessionId/files（multipart，字段 files，单文件硬顶 50MB）
 * - GET  /api/v1/sessions/:sessionId/files?path=（附件下载）
 */

import type { FileContentDTO } from "@platform/shared";
import { http, unwrap } from "./client";

/** 上传结果（pi 返回 path 为会话根内相对路径） */
export interface UploadedFileRef {
	filename: string;
	path: string;
}

/** 上传单个文件到会话文件区（semantic 为平台元数据，pi 侧暂不消费） */
export async function uploadFileToWorkspace(
	sessionId: string,
	_directory: string | undefined,
	file: File,
	semantic: string,
): Promise<{ filename: string; bytes: number }> {
	void semantic;
	const form = new FormData();
	form.append("files", file);
	const saved = await unwrap<UploadedFileRef[]>(
		http.post(`/sessions/${encodeURIComponent(sessionId)}/files`, form, {
			headers: { "content-type": "multipart/form-data" },
			timeout: 600_000,
		}),
	);
	return { filename: saved[0]?.filename ?? file.name, bytes: file.size };
}

/** 下载会话文件（逐个触发浏览器保存；pi 不提供多文件 zip 打包） */
export async function downloadSessionFiles(
	sessionId: string,
	_directory: string | undefined,
	paths: string[],
	token?: string,
): Promise<void> {
	void _directory;
	for (const path of paths) {
		const params = new URLSearchParams({ path });
		if (token !== undefined && token.length > 0) params.set("token", token);
		const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/files?${params.toString()}`);
		if (!res.ok) throw new Error(`下载失败：${path}`);
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = path.split("/").pop() ?? "file";
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}
}

/** 读工作区文件：pi 后端不提供任意文件读取（安全边界），调用方需降级处理 */
export async function fetchFileContent(_path: string): Promise<FileContentDTO> {
	void _path;
	throw new Error("pi 后端不提供工作区文件读取");
}
