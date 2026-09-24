/**
 * 会话文件上传/下载客户端（app-server POST/GET /api/v1/sessions/:sessionId/files）：
 * - uploadSessionFiles：multipart 上传，返回 {filename, path} 引用（file-collect 作答用）；
 * - downloadSessionFile：拉取文件内容并以浏览器下载方式落盘（file-download 勾选后触发）。
 */

export interface UploadedFileRef {
	filename: string;
	/** 会话文件根内相对路径（uploads/<uuid>-<name>），下载与作答引用共用 */
	path: string;
}

/** 上传文件到会话工作区；失败抛错（HTTP 状态 + 服务端 error 文案）；token 非空时追加 ?token= */
export async function uploadSessionFiles(
	httpBase: string,
	sessionId: string,
	files: File[],
	token?: string,
): Promise<UploadedFileRef[]> {
	const body = new FormData();
	for (const file of files) body.append("files", file, file.name);
	const suffix = token === undefined || token === "" ? "" : `?token=${encodeURIComponent(token)}`;
	const response = await fetch(`${httpBase}/api/v1/sessions/${sessionId}/files${suffix}`, { method: "POST", body });
	const payload: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			typeof payload === "object" && payload !== null && "error" in payload
				? String((payload as { error?: unknown }).error)
				: `HTTP ${response.status}`;
		throw new Error(`文件上传失败：${message}`);
	}
	return payload as UploadedFileRef[];
}

/** 下载会话文件（路径须为会话文件根内相对路径）；以 <a download> 触发浏览器落盘；token 非空时追加 &token= */
export async function downloadSessionFile(
	httpBase: string,
	sessionId: string,
	path: string,
	token?: string,
): Promise<void> {
	const suffix = token === undefined || token === "" ? "" : `&token=${encodeURIComponent(token)}`;
	const response = await fetch(
		`${httpBase}/api/v1/sessions/${sessionId}/files?path=${encodeURIComponent(path)}${suffix}`,
	);
	if (!response.ok) {
		const payload: unknown = await response.json().catch(() => undefined);
		const message =
			typeof payload === "object" && payload !== null && "error" in payload
				? String((payload as { error?: unknown }).error)
				: `HTTP ${response.status}`;
		throw new Error(`文件下载失败：${message}`);
	}
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = path.split("/").pop() ?? "file";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
