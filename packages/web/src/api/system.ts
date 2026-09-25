/** 系统状态适配层：pi 后端生命周期由宿主管理，重启/状态接口保持 no-op */

/** 重启结果（no-op 兼容签名） */
export interface RestartOpencodeResult {
	baseUrl: string;
	restartedAt: string;
}

/** 重启内核（no-op：pi 后端无法从前端重启） */
export async function restartOpencode(): Promise<RestartOpencodeResult> {
	return { baseUrl: "/api/v1", restartedAt: new Date().toISOString() };
}

/** 内核连通指示（连接层状态即连通性） */
export async function fetchOpencodeStatus(): Promise<{ connected: boolean }> {
	return { connected: true };
}
