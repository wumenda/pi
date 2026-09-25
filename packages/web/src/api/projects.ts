/**
 * 项目中心适配层：pi 无项目（工作目录注册表）领域，会话 directory 恒为 "/"。
 * 提供一个固定的"默认工作区"项目，使顶部新建会话弹窗开箱可用
 * （弹窗需选择一个项目/目录后才能创建）。
 */

import type { ProjectDTO } from "@platform/shared";

/** 已注册项目清单（pi = 固定"默认工作区"单项，全部会话归入该分组） */
export async function fetchProjects(): Promise<ProjectDTO[]> {
	return [
		{
			id: "/",
			name: "默认工作区",
			directory: "/",
			// 固定时间戳：避免每次拉取产生新引用（React Query 缓存内稳定）
			createdAt: "1970-01-01T00:00:00.000Z",
		},
	];
}

/** 注册项目（no-op：pi 无注册表，返回默认工作区） */
export async function registerProject(_name: string, _directory: string): Promise<ProjectDTO> {
	void _name;
	void _directory;
	return {
		id: "/",
		name: "默认工作区",
		directory: "/",
		createdAt: "1970-01-01T00:00:00.000Z",
	};
}

/** 移除项目（no-op） */
export async function removeProject(_id: string): Promise<{ deleted: boolean }> {
	void _id;
	return { deleted: true };
}
