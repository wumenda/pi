/** iframe 池与宿主管线共享的领域类型（自参考应用 types 叶子模块裁剪而来）。 */

/** tool 执行时最近一次读取的 Skill 实例（name + instanceId），用于按上下文时序解析归属 */
export interface SkillReadContext {
	name: string;
	instanceId: string;
}

/**
 * "单独调用"分组键：tool 不在任何 Skill 实例声明中时归属此组。
 * 定义于叶子模块，IframePool 与 store 共享，避免循环依赖。
 */
export const SOLO_GROUP_KEY = "__solo__";

/** 池内单个 MCP App iframe 实例 */
export interface IframeInstance {
	element: HTMLIFrameElement;
	/** 绑定的 ui:// 资源 URI（池查找按字段匹配，不解析复合键） */
	resourceUri: string;
	/** 归属 MCP server 标识（缺失 = 旧版无 server 场景） */
	serverId?: string;
	/**
	 * 当前绑定在该实例上的有效（running/pending）tool 执行标识。
	 * 有值 = 实例被占用（并发下同资源的其它执行会派生新实例）；执行完成后清空，
	 * 实例回到可复用（同资源下个执行复用基实例）。
	 */
	activeToolCallId?: string;
	/** 绑定到该 iframe 的 tool 调用 ID（追加式，去重） */
	boundToolCalls: string[];
	/** tool tab 展示名（首次创建时确定；缺省回退 tool 名） */
	title?: string;
	/**
	 * 归属分组（一级分组键）：skill 实例键 `<skillName>#<instanceId>` 或
	 * SOLO_GROUP_KEY"单独调用"。首次创建时按上下文时序判定，后续复用不变——
	 * 同名 Skill 的多个实例是不同分组，同 resourceUri 互不复用。
	 */
	group: string;
	createdAt: number;
	lastUsedAt: number;
}
