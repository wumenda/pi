import { isToolPart } from "../api/events";

/** skill 加载信息（布局文档 3.2.2 步骤 2-3） */
export interface SkillPartInfo {
	name: string;
	directory: string;
	/** skill 读取 part.id（v2.7：Skill 实例标识，同名 Skill 每次读取区分） */
	instanceId: string;
}

/** v1 API：从 skill 工具 output 中解析基目录（布局文档 3.2.2 步骤 3） */
export function parseSkillDirectory(output: string): string | undefined {
	const match = /Base directory for this skill:\s*([^\r\n]+)/.exec(output);
	const directory = match?.[1]?.trim();
	return directory ? directory : undefined;
}

/**
 * 识别 skill 加载 tool part 并提取 name + directory + instanceId。
 * 非 skill 工具、尚无 output、解析失败、input.name 缺失或 part.id 缺失时返回 null。
 */
export function extractSkillInfo(part: unknown): SkillPartInfo | null {
	if (!isToolPart(part)) return null;
	if (part.tool !== "skill") return null;
	const output = part.state.output;
	if (typeof output !== "string") return null;
	const directory = parseSkillDirectory(output);
	if (!directory) return null;
	const name = part.state.input?.name;
	if (typeof name !== "string" || name.length === 0) return null;
	// v2.7：实例标识 = skill 读取 part.id（缺失则无法建档实例，返回 null）
	const instanceId = part.id;
	if (typeof instanceId !== "string" || instanceId.length === 0) return null;
	return { name, directory, instanceId };
}

interface PartCarrier {
	parts: unknown[];
}

/**
 * 找消息流中全部 skill 加载（按读取序全量返回、按实例去重）。
 * 会话重放/恢复用：useSkillLoader 据此重建全部 skill 实例 Tab——
 * v2.7 强流程：同名 Skill 每次读取都是独立实例（part.id 不同），
 * 按读取序全部返回（同一 part 只一条，防重复重扫）。
 */
export function findAllSkillInfos(messages: readonly PartCarrier[]): SkillPartInfo[] {
	const seen = new Set<string>();
	const result: SkillPartInfo[] = [];
	for (const message of messages) {
		for (const part of message.parts) {
			const info = extractSkillInfo(part);
			if (info && !seen.has(info.instanceId)) {
				seen.add(info.instanceId);
				result.push(info);
			}
		}
	}
	return result;
}

/** 消息流中是否存在非 skill 的 tool 调用（布局文档 3.1 状态 (3)→(4) 自动切 Tab 判定） */
export function hasNonSkillToolCall(messages: readonly PartCarrier[]): boolean {
	return messages.some((message) =>
		message.parts.some((part) => {
			if (!isToolPart(part)) return false;
			return part.tool !== "skill";
		}),
	);
}
