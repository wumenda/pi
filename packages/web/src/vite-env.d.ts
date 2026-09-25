/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** 挂起工具兜底阈值（ms）：running tool part 超过该时长仍无 output/progress 才判为挂起。
	 *  默认超大值（不误杀长耗时工具）；如 VITE_STUCK_MS=60000 恢复 60s 兜底。 */
	readonly VITE_STUCK_MS?: string;
	/** iframe 池容量：池内实例超过该数时按 LRU 淘汰最久未用的挂起实例。
	 *  默认 5；如 VITE_IFRAME_POOL_CAPACITY=8 提升到 8。非法值（<1/非数字）回退默认。 */
	readonly VITE_IFRAME_POOL_CAPACITY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
