/** 权限审批适配层：pi 无独立权限审批面（工具直接执行），保持 no-op 保持调用方兼容 */

/** opencode 权限契约（UI 卡片类型签名保留） */
export type PermissionResponse = "once" | "always" | "reject";

/** 回复权限审批（no-op：pi 侧无挂起权限请求） */
export async function replyPermission(
	_sessionId: string,
	_permissionId: string,
	_response: PermissionResponse,
	_directory?: string,
): Promise<void> {
	void _sessionId;
	void _permissionId;
	void _response;
	void _directory;
}
