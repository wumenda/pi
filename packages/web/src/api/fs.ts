/** 服务器目录清单适配层：pi 后端不提供服务器目录浏览（安全边界），返回固定空根 */

import type { DirectoryListDTO } from "@platform/shared";

/** 服务器目录清单（固定空根：目录选择器渲染空态） */
export async function fetchDirectories(_path?: string): Promise<DirectoryListDTO> {
	void _path;
	return { path: "/", parent: null, directories: [] };
}
