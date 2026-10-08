# pi web 运行失败提示（输入区红色 pill）

## 问题

运行失败此前在 UI 上没有任何反馈：轮次在服务端瞬时失败（模型不可用、网络、配额等），
用户侧只看到输入框清空、对话流里一条没有回复的用户消息，表现为"发送消息没反应"。
真实案例：种子会话持久化了 `pi.lane.config = faux/faux-1`，在真实 app-server 进程里每轮
9ms 内以 `model_unavailable` 失败，用户完全无从察觉。

## 设计

- **数据源**：transcript 快照的 `lastResult`——服务端 reducer（`packages/agent/src/harness/runtime/reducer.ts`）
  在 `run_end` 时写入 `{kind, status, error{code,message}}`；随初始快照与增量 ops 同步，
  刷新页面后可恢复（不依赖一次性事件）。
- **派生**：`packages/web/src/features/chat/run-error.ts` 纯函数 `runFailureMessage`
  （运行中 operation 非空 → null 屏蔽上一次失败；仅 `kind==="run" && status==="failed"` 返回
  `error.message`；completed/aborted/compaction 不展示；wire 缺 message 返回空串）。
- **渲染**：`ChatInput.tsx` 在输入框上方渲染红色 pill（`chat-run-error-pill`，
  `role="status"`，超长文案单行省略、悬停 title 看全文）。
  订阅经 zustand selector 返回字符串标量：仅失败态出现与消失时通知重渲染，
  流式期间零通知（与 T2.9-1 订阅收窄同思路）。
- **隐藏路径**：新轮次开始（operation 非空）隐藏；成功后 `lastResult.status=completed` 隐藏；
  用户主动停止（aborted）不展示。

## 涉及文件

- `packages/web/src/features/chat/run-error.ts`（新增，派生纯函数）
- `packages/web/src/features/chat/ChatInput.tsx`（pill 渲染 + selector）
- `packages/web/src/index.css`（`.chat-run-error-pill` 样式）
- `packages/web/test/run-error.test.ts`（7 用例）
- `packages/web/test/run-error-delivery.test.ts`（投递边界回归，真实 chord replica 端到端）

## 验证

- 单元测试：`npm --prefix packages/web run test`（12 文件 54 用例全绿，含 run-error 7 例 + 投递边界 1 例）。
- 投递边界回归（run-error-delivery.test.ts）：服务端 `replicatedState` + 真实 reducer（`reduceLaneSnapshot`，
  与 app-server transcript service 同路径），客户端 `createRemoteServiceBinding` 经 loopback 订阅
  `transcript.state`（生产同款 `ReplicatedStateReplica`，applyImmutable 整批应用后才通知）。
  验证：每次 `state.change`（一个原子事务）恰好产生一个投递边界；边界读数序列为
  `[上轮失败可见 → 运行中屏蔽 → 本轮失败 → 再次运行中 → 成功隐藏]`；run_end 批必须
  同批携带 `operation` 清理与 `lastResult` 写入。负向对照：手工制造「先清 operation、后写 lastResult」
  的分裂写入 → 出现多余投递边界，测试立即失败（证明对中间态投递有真实检出力）。
- 真实环境（2026-10-08）：faux 配置会话发送 prompt → 前端 pill 显示
  "运行失败：The configured model is unavailable in this process"（文案 = 后端 `error.message`，截图取证）；
  成功终态的种子长会话打开后无 pill；web 全量测试与 `npm run check` 通过。