/**
 * 会话 id 全链路格式校验（SessionManagement.create 边界、sessionFilesRoot 派生、
 * tool-events 落盘文件名共用同一原始 id）。
 *
 * 白名单只放行 URL 安全字符，拒绝路径分隔符（/ \）、点段（..）、盘符冒号与控制字符，
 * 封堵 `<dataDir>/sessions-workspace/<sessionId>` 的目录穿越。缺省生成的 id 为
 * UUIDv7（`[A-Za-z0-9-]`），天然通过；与 serverId 的 UUIDv4 严格校验（server-id.ts）风格一致。
 */

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isValidSessionId(value: string): boolean {
	return SESSION_ID_PATTERN.test(value);
}
