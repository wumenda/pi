# pi-web 长会话渲染性能（P2-8 / P2-9）

## 问题

pi-web 工作台的会话流是"长会话 + 流式高频投递"负载：

- 单会话可达数千 transcript 条目；
- 流式期间每个 token 批次触发一次投递（chord replicated state → zustand → React Query → 渲染）。

改造前每次投递的渲染链全量重算：

- 投影：全量两遍扫描（O(条目 × parts)）；
- 锚点解析 / 上下文估算：每次投递全量重扫（O(总 parts) / O(总字符)）；
- DOM：一次挂载全部消息节点（数千行）；
- ChatInput：与消息列表共享缓存 key，每 token 整树重渲染。

症状：长会话流式掉帧、向上翻历史卡顿、大会话切换阻塞。

## 设计（演进顺序 = 实施顺序）

### P2-8 阶段一：投影记忆化

`api/transcript.ts` 按 entry 引用缓存单条投影（WeakMap）——chord 结构共享保证未变更条目引用跨快照稳定，流式期间仅末条重建。MessageList 侧 MessageBubble memo + anchors 引用稳定化 + 滚动 rAF 合帧。

### P2-8 阶段二：chord per-op 真增量投影

- chord：`ReplicatedStateDelivery` 透传 `ops`（update 投递携带本批 ops，hydrate 不带；wire 协议零改动）；
- web：`classifyTranscriptOps`（append / tail / fallback 三路径）+ `TranscriptProjectionWorkspace`（触碰集重投影，前缀引用校验为安全网，违约全量重建）；
- 扫描链游标化：contextEstimate（12 分制整数 token 统计按消息引用缓存，取整时机与全量位级一致）+ ask-anchors（每消息候选缓存，匹配规则不变）；
- `content-visibility: auto` + `contain-intrinsic-size`（视口外行跳过布局/绘制）；
- 条件窗口化：超 120 条只渲染尾部窗口，向上滚动扩窗（scrollHeight 差补偿视口位置）。

### P2-9：收口（基线设施 + 残留热点）

- 基线设施：`bench/long-session.bench.ts`（5000 条确定性合成 fixture；冷切换 / 流式投递 / 派生标量三项指标，p50/p95）；
- ChatInput 订阅收窄：select 派生原始标量——圆环权威值 `latestStepFinishTokens` 流式期间恒定（step-finish 在轮次结束才出现）→ 零通知；历史段 500 token 档粗化（`quantizeTokens`）仅跨档通知；
- 扩窗步长 60 → 20（单帧挂载量降 2/3，滚动补偿机制不变）；
- 上下文权威值接通：pi 无原生 step-finish part，投影层从 `AssistantMessage.usage` 合成
  opencode 兼容形状（`tokens.input + tokens.cache.read` = `usage.input + usage.cacheRead`），
  解锁整个上下文占用 UI（圆环 + 三段估算明细）；增量链路兼容（usage 写入为末条内部 set → tail）。

## 验证

### 自动化（vitest，常规 CI）

- `test/transcript-incremental.test.ts`：fuzz 1000 轮对拍——增量投影 ≡ 全量投影（深度相等 + 未变 DTO 引用稳定）；
- `test/chat-scan-cursor.test.ts`：游标化扫描 vs 全量基线对拍（contextEstimate 位级一致 + anchors 输出一致）；
- `test/chat-input-select.test.ts`：select 标量通知语义（流式期间权威值零通知 / 历史段跨档节流 / turnEnd 通知一次）+ 派生标量与三段聚合一致；
- `test/message-window.test.ts`：窗口切片边界 + 扩窗判定 + 有限步收敛（步长 20 上限 40 步）。

### 基线设施（bench，显式运行不进常规 CI）

```
node ../../node_modules/vitest/dist/cli.js --run bench/long-session.bench.ts
```

基线（本机相对指标，仅用于前后对比）：

| 指标 | p50 | p95 |
|---|---|---|
| coldRebuild（5000 条全量投影） | ~9.3ms | ~24.8ms |
| streamingApply（末条追加 ×100 全链） | ~0.27ms | ~0.57ms |
| derivedScalars（派生标量 ×100） | ~0.11ms | ~0.18ms |

门控结论：冷切换全量投影 p95 < 30ms → 渐进/异步投影不立项（DOM 已窗口化，投影计算为一次性可接受成本）；完整虚拟化库不引入（content-visibility + 条件窗口化已覆盖核心收益）。

### 手动验证清单（jsdom 无法覆盖）

验证环境（2026-10-08）：真实 app-server（agentplan/glm-5.3-flash，`npm --prefix packages/app-server run dev`）+ web dev（8788）+ Chrome CDP 自动化；长会话为 80 轮种子会话（160 条消息，全部 assistant 带 usage）。注意：种子数据由 faux provider 生成，会话内持久化了 `pi.lane.config = faux/faux-1`；在真实进程里继续对话会瞬时 `model_unavailable`（UI 目前不显示该失败），需先将该会话模型改回 agentplan 才能在长会话里跑真实流式轮次。注意：自动化窗口被系统最小化，rAF 与事件派发被节流到 ~1Hz，帧时长不可精确测量——验收以几何测量（scrollTop/scrollHeight/getBoundingClientRect，强制布局）与事件链、数值一致性为准，每步等待 700ms+。

1. 向上滚动长会话：滚动条是否跳动（content-visibility 占位）。**已验证通过**：同内容视口偏移偏差 ≤2px；content-visibility 实体化引起的 scrollHeight 漂移由浏览器原生 scroll anchoring 校正（实测最大校正 1482px，为防抖机制而非跳动）。静态防护已就位：原生 scroll anchoring（未设 `overflow-anchor: none`）+ `contain-intrinsic-size` 的 `auto` 关键字记忆真实尺寸 + 扩窗补偿。若仍抖动：按消息角色分档 `contain-intrinsic-size` 或窗口头部尺寸哨兵。
2. 长会话向上翻历史：扩窗是否平滑（步长 20 + 每步补偿）。**已验证通过**：160 条 DTO 仅渲染 60 行（尾部窗口）；向上滚动连续 5 次扩窗 60→80→100→120→140→160 全部触发；两次实测 scrollTop 增量与 scrollHeight 增量之差恒为 140px（内容锚定偏移无累计漂移），补偿公式 dTop = dH − 140 精确成立，视口无可见跳变。若仍卡顿：rAF 分帧渐进扩窗（每帧 +15 直至目标）。
3. 真实后端流式长会话：上下文圆环渐进更新、输入框无掉帧。**已验证通过**：真实 GLM 单轮流式 32 次 `message_update` 增量渲染，事件链 run_start→message_start→(update×32)→message_end→entry_added→usage→run_end 完整；轮次结束圆环出现，popover 权威总量 2,582 / 128,000 tokens（2%），与后端 JSONL 真值 `usage.input(2582)+cacheRead(0)` 位级一致（此前 pi 下恒 null，由投影层 step-finish 合成解锁）；流式期间输入框按设计禁用（显示停止按钮），run_end 后恢复可用并清空；控制台无应用错误。

## 已知边界

- bench 数值为相对指标（本机相关）；React 挂载与真实布局成本以手动清单为准。
