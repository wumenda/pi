import { createRemoteServiceBinding, type RemoteServiceBinding } from "@earendil-works/chord";
import { type Client, createClientServiceTransport } from "@earendil-works/pi-client";
import {
	AgentController,
	McpHost,
	SessionDirectory,
	SessionManagement,
	Transcript,
} from "../src/services/contracts.ts";

/**
 * 测试用 chord 客户端绑定，镜像 packages/web/src/services/pi-services.ts 的真实用法：
 * server 通道 target 为 {serverId}，session 通道 target 为 client.attachment
 * （{serverId, sessionId, attachmentId}，由服务端 attach 推送）。
 */

/** Server 级服务（session-directory / session-management），target {serverId}。 */
export function bindServerServices(client: Client): RemoteServiceBinding {
	return createRemoteServiceBinding({
		services: [{ id: SessionDirectory.id }, { id: SessionManagement.id }],
		transport: createClientServiceTransport(client, () => ({ serverId: client.serverId })),
		bound: client.connected,
	});
}

/** 会话级服务（transcript / agent-controller / mcp-host），target = client.attachment。 */
export function bindSessionServices(client: Client): RemoteServiceBinding {
	return createRemoteServiceBinding({
		services: [{ id: Transcript.id }, { id: AgentController.id }, { id: McpHost.id }],
		transport: createClientServiceTransport(client, () => client.attachment),
		bound: client.attachment !== undefined && client.connected,
	});
}
