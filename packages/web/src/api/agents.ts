/** Agent 预设与模型清单适配层：pi 由服务端配置决定（前端不可枚举），返回空清单 */

import type { AgentInfoDTO, ModelInfoDTO } from "@platform/shared";

/** 会话主 agent 预设（空清单：ChatInput 显示默认 agent） */
export async function fetchAgents(): Promise<AgentInfoDTO[]> {
	return [];
}

/** 可选模型清单（空清单：ChatInput 隐藏模型切换） */
export async function fetchModels(): Promise<ModelInfoDTO[]> {
	return [];
}
