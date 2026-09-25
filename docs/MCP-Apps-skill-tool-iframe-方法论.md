# MCP Apps Skill-Tool-Iframe 创建与复用方法论

> 状态：方法论总结（基于 2026-09 当前实现，对应 iframe-rendering.md v2.10）
> 定位：提炼本项目 MCP Apps 方案中「Skill 实例 → Tool iframe」创建与复用机制背后的设计方法、判定链与接入方式。行为规格以 [`iframe-rendering.md`](./iframe-rendering.md) 为准，布局语义见 [`frontend-layout.md`](./frontend-layout.md)，术语定义见 [`项目概念词汇表.md`](./项目概念词汇表.md)。本文不新增行为约定，是方法论文档，不构成验收结论。
> 关键代码：`apps/web/src/mcp-iframe/`（pipeline / IframePool / MessageBridge / useIframePipeline）、`apps/web/src/stores/app-store.ts`（归属判定与状态）、`apps/web/src/features/workspace/useSkillLoader.ts`（Skill 实例建档）

---

## 1. 要解决的问题

MCP Apps 允许 tool 在描述中声明交互式 UI 资源（`_meta.ui.resourceUri`，`ui://` 前缀），调用后由宿主渲染。宿主（Web 工作台）必须回答四个问题：

1. **组织**：一次会话可能加载多个 Skill、执行几十个 tool，产生的 UI 放在哪、按什么分组，用户才能按「工作流程」回看？
2. **连续性**：同一 UI 被连续多次调用时，销毁重建会丢失应用内状态（筛选、滚动、已渲染图表）并产生闪烁；实时监控类应用的数据流会中断。
3. **隔离**：同一 UI 出现在不同流程（Skill 实例）、不同 MCP Server、并发执行下，状态不能互相污染。
4. **恢复**：刷新页面 / 切换会话后，哪些状态可恢复、哪些必须回收？

方案一句话：**以消息流为唯一事实源，用「Skill 实例分组 + iframe 复合键」做身份，用「池化复用 + 常驻挂载 + 追加式通知流」做连续性，用「创建时固化归属 + 会话级全量回收」做隔离边界。**

---

## 2. 核心模型：一条消息流，三个投影

整个机制只有一个事实源：**会话消息流（`MessageDTO[].parts`，含 SSE 增量合并）**。UI 侧的三个数据结构都是它的投影：

```text
消息流 parts（skill 读取 part / tool part，按时间顺序）
   │  useIframePipeline 顺序扫描
   ├─ 投影 1：skillInstances[]   —— 每次 skill 读取建一条实例（一级 Tab 数据源）
   ├─ 投影 2：iframePool          —— 带 UI 的 tool part 按复合键创建/复用 iframe（二级 Tab 数据源）
   └─ 投影 3：messageBridge 通知流 —— tool-input / tool-result / progress 追加推送到对应 iframe
```

方法要点：

- **扫描驱动 + 幂等去重**：`scanMessagesForIframes` 全量重扫消息缓存，用 `pushedRef`（partId → status）和 `progressRef`（partId → progress+uiEvent 指纹）保证同状态不重复推送。消息缓存因 SSE / 持久化恢复 / 清单刷新变化时 effect 重跑，投影自动收敛——不需要为每种数据源单独写同步逻辑。
- **投影可丢弃、可重建**：iframe 池、Skill 实例在会话切换时全量回收，重进会话后从消息流确定性重建（`part.id` 由后端持久化，实例键可恢复）。这把「恢复」问题简化成「重放」问题。
- **iframe 不跨会话恢复，tool 执行记录跨会话恢复**：UI 内存态不持久化，执行状态（input/progress/result）由后端 JSONL 落盘（`.data/tool-events/<sessionId>.jsonl`）并按 `toolCallId` 合并恢复进度条与历史摘要。

---

## 3. 身份设计：iframe 复合键

复用的前提是「什么算同一个 iframe」。本项目把身份建模为四元组复合键：

```text
[<serverId>|]<resourceUri>#<group>[#i<no>]
```

| 维度 | 含义 | 解决的隔离问题 |
|---|---|---|
| `serverId` | tool 绑定 UI 的 MCP Server 身份 | 同一 `ui://` URI 由不同 server 提供 → 不同条目，互不复用（G4） |
| `resourceUri` | `ui://` UI 资源标识 | 不同 UI 应用天然不同条目 |
| `group` | Skill 实例键 `<skillName>#<skill 读取 part.id>` 或 `__solo__` | 同一 UI 在不同流程实例下各自独立（强流程，v2.7） |
| `#i<no>` | 并发派生实例序号 | 同资源同分组的并发有效执行各占一个实例，不串线（G5） |

方法要点：

- **键是身份，不是地址**。池内查找一律按实例字段（resourceUri/group/serverId）匹配，不解析 key 字符串；分隔符规则集中在 `iframeInstanceKey()` 单一实现（`IframePool.ts`）。
- **基实例 `instanceNo=0` 保持旧格式**（无 `#i0` 后缀），兼容历史 iframe-events 记录读取——键格式演进必须考虑已落盘数据的可读性。
- **执行 → 实例的映射独立维护**（`callToKey`）：同一 `toolCallId` 的所有状态变化和 progress 都回到它绑定的实例，即使并发下该执行被派生到 `#i1` 实例。

---

## 4. 创建：从 tool part 到 iframe 的判定链

`useIframePipeline` 扫描到 tool part 后，`ensureToolIframe` 按以下顺序判定（每一步都有明确的「不满足则不建」出口）：

```text
tool part（type === "tool"）
 1. UI 绑定判定（两级）
    a. part 自带 _meta.ui.resourceUri？
    b. 否 → 按 tool 名匹配 GET /api/v1/mcp-tools 清单（全等或 <server>_ 后缀匹配）
    均不命中 → 普通 tool，对话流 ToolCard 展示，不建 iframe
 2. serverId 守卫（B2）
    part 有 resourceUri 但清单未命中（serverId 未知）→ 跳过并触发清单按需刷新，
    清单到达后重扫补建（否则 iframe src 被服务端 400 → 空白且无自愈）
 3. 就绪门控
    groupContext 指向的 Skill 元数据 / 实例尚未建档（SKILL.md 异步拉取中）
    → 暂不创建，等 store 变化重扫——避免误归「单独调用」
 4. 归属判定（resolveIframeGroup）
    有 groupContext → 该 Skill 声明含此 tool（全等/后缀）→ group = <skillName>#<part.id>
    无 groupContext → 沿用池内同 resourceUri+serverId 最近使用实例的分组
    均无 → __solo__
 5. 首错不建（v2.10）
    isNew 且 status === "error" → 不创建（错误文本已在 ToolCard 可见，
    空载一个只显示错误的 iframe 无价值）；该键后续成功调用正常创建
 6. acquire（创建或复用）+ 按状态推送
    pending/running → ui/notifications/tool-input
    completed/error → ui/notifications/tool-result
    新建 iframe 的冷启动重放 → 先补 tool-input（过 App 的"等待任务"门）再推 tool-result
```

方法要点：

- **归属看上下文时序，不看静态声明**：tool 归入哪个分组取决于「执行时刻之前最近一次 skill 读取动作」，而不是「tool 名是否被某个已加载 Skill 声明」。单独执行的 tool 一律归「单独调用」，即使它被某个 Skill 声明过。这条规则是 v2.1「分组收编」（读取 Skill 后把 solo iframe 迁入分组）被废除后沉淀的——收编与「只有读取后执行的 tool 才归入该 Skill」的语义冲突。
- **归属与展示名解耦**：判定和匹配始终用 tool `name`（v2.5 起经 `matchMcpTool` 归一化为 MCP Server 侧原名，剥掉 opencode 的 `<server>_` 前缀）；Tab 文字走 `title ?? name` 回退链，中文名只影响展示。
- **创建时固化，不再迁移**：`group`、Tab `title` 在首个调用创建 iframe 时确定，后续复用不重算——避免 Skill 声明异步就绪导致同一 iframe 归属/标题闪变。

---

## 5. 复用：`IframePool.acquire` 的三条路径

```text
acquire(resourceUri, { boundToolCall, active, serverId, ... })
 1. 该执行已绑定实例（callToKey 命中）
    → 回原实例（状态变化/进度不换实例），更新占用与 LRU
 2. 存在可复用实例：同 serverId + resourceUri + group，且无 active 执行占用
    → 复用（element 引用不变），优先序号更小（更「基」）的实例
 3. 均无 → 新建：LRU 淘汰让位 → 创建沙盒 iframe → 派生 #i<no> 键入池
```

配套规则：

- **占用语义（G5）**：`active: true`（running/pending）认领实例（`activeToolCallId`）；completed/error 释放回可复用。并发同资源执行 → 第二个执行派生新实例，互不串线；有活跃占用的实例不参与 LRU 淘汰。
- **容量与淘汰**：池上限 5（`IFRAME_POOL_CAPACITY`），超限按 LRU（单调递增 `lastUsedSeq`，避免墙钟并列）淘汰最久未使用的**挂起**实例；激活实例不淘汰。
- **复用期间的连续性**：不重建 DOM；新调用的 `toolCallId` 追加进 `boundToolCalls`（去重）；宿主经 postMessage **追加式**推送 input/result/progress，iframe 内应用自行决定增量消费（刷新图表、追加告警），宿主不强制重置。Tab 标题保持首次创建时的名字。
- **切走仅隐藏**：新复合键激活时旧 iframe `display:none` 挂起（保留实例与连接）；点回分组 Tab 激活组内最近使用者，状态连续。

场景示例（同一 Skill 实例内复用）：

| 步骤 | 事件 | 结果 |
|---|---|---|
| 1 | 读取 Skill `equipment`（part id=p1） | 实例建档，一级 Tab 出现（group=`equipment#p1`） |
| 2 | 执行 `query_equipment`（ui://equipment-dashboard） | 复合键未命中 → 创建 iframe ① |
| 3 | 紧接执行 `query_alarm`（同一 resourceUri） | 复合键命中 ① → **复用**，追加推送，无重载 |
| 4 | 再次读取 Skill `equipment`（part id=p3） | 新实例、新分组 → 同 resourceUri 也**不复用**，创建 ② |

第 4 步是强流程的关键：**复用条件是「serverId + resourceUri + group 相同」，Skill 的每次读取产生不同 group**——每个流程实例拥有独立的 iframe 与应用状态，同名实例 Tab 追加 `(2)`、`(3)` 区分。

---

## 6. 生命周期与回收

| 阶段 | 触发 | 行为 |
|---|---|---|
| 创建 | 复合键首次出现（同 resourceUri 不同 group/serverId 均视为未命中） | 建沙盒 iframe、判归属、入池激活 |
| 复用 | 复合键命中且无占用 | 不重建，追加推送 |
| 切换 | 新复合键 ≠ 当前激活 | 新者展示，旧者挂起 |
| 销毁 | ① 会话切换（唯一全量回收点）② 用户关 Tab ③ LRU 淘汰 | 移除 DOM、清池条目、`messageBridge.detach` 断通道 |

两条硬约束：

- **容器常驻挂载**：池非空期间 `ToolExecutionPanel` 及 iframe DOM 禁止条件渲染卸载，只做 `hidden`/`display` 可见性切换。这是缺陷修复沉淀的约束——曾因按 `centerView` 条件渲染导致切视图丢状态、重握手、UI 卡「等待任务」。
- **会话切换是最强回收**：无论 Skill 是否加载中，均 `destroyAllIframes` 并清空 `skillInstances`/`toolExecutions`/激活态；界面状态不允许跨会话残留。恢复靠重放消息流 + tool-events 持久化合并，不靠保活。

---

## 7. 鲁棒性设计（防呆清单）

创建/复用主链之外的边界处理，均有真实故障背景：

| 机制 | 问题场景 | 处理 |
|---|---|---|
| 就绪门控 | SKILL.md 异步拉取未完成时 tool 先到 → 误归「单独调用」 | groupContext 未就绪则跳过该 part（不推进 pushedRef），store 变化后重扫 |
| 清单自愈（B2/方案 A） | 插件新工具不在（可能已冻结的）`/mcp-tools` 清单 → serverId 未知或 toolName 无法归一化 | 按需 refetch 清单（同一 tool 防抖一次），到达后重扫补建 |
| isNew 判定含派生路径（B1） | 基键存在但被并发占用 → acquire 实际新建 `#i<no>`，按基键判 isNew 会漏冷启动补推 | `isNew = !alreadyBound && !hasReusable(...)`，按「是否真会新建」判定 |
| 首错不建（v2.10） | 首次调用即 error：无法区分成因，error 结果无 structuredContent | 不建 iframe；已有 iframe 的 error 推送照常 |
| 冷启动补推 | 会话重进后 completed 工具重建 iframe，App 冷启动 `!toolInput` 卡「等待任务」门 | 新建实例先推 tool-input 再推 tool-result；复用路径只推当前状态 |
| progress 指纹去重 | 同一 progress 数值可携带不同 uiEvent（如 review_pending），仅按数值判重会吞掉扩展字段 | 指纹 = progress 值 + uiEvent JSON |
| progress 时序 | progress 先于 tool-input 到达会被 App 的 input handler 清空 | 状态推送先于 progress 发送 |
| 通道按执行寻址 | 并发下 progress 发到基键会串到别的实例 | `keyForExecution(callId) ?? 基键` |

---

## 8. 接入指南：让一个新的 MCP App 进场

这是「复用方案」的应用侧：按以下三层接入，即可获得分组、复用、通知流、持久化恢复的全部机制，无需改动宿主代码。

### 8.1 MCP Server 侧

1. tool 定义中声明 `_meta.ui`：

```python
@mcp.tool(...)
async def query_equipment(...) -> ...:
    ...
# tool 元数据（FastMCP 等按各自机制注入）：
# _meta.ui.resourceUri = "ui://equipment-dashboard"   # 必填，ui:// 前缀
# _meta.ui.csp       = "..."                            # 可选，外部资源来源
# _meta.ui.permissions = [...]                          # 可选，麦克风/摄像头等特权
```

2. server 提供 `ui://equipment-dashboard` 对应的 HTML 资源（自包含或按 CSP 加载外部脚本）。
3. server 需在平台注册，使 `GET /api/v1/mcp-tools` 清单携带 `serverId`——iframe src 与反向 `tools/call` 都按 serverId 路由（`/api/v1/ui-resources?serverId=...&resourceUri=...`）。
4. 仅供 UI 使用的工具（如 `read_image`、`submit_review`）声明 `_meta.ui.visibility=["app"]`：插件层（`isVisibleToLlm`）会把它们排除出模型可见清单，但 UI 可经宿主代理的 `tools/call` 调用。

### 8.2 Skill 侧（可选，但推荐）

SKILL.md frontmatter 声明工具清单与展示名：

```yaml
---
name: equipment                    # 标识符：归属判定、分组键用它
title: 设备管理                    # 展示名：一级 Tab 文字（可选，缺失回退 name）
description: ...
version: 1.0.0
tools:
  - name: query_equipment          # 标识符：必须与 tool 真名一致（全等或 <server>_ 后缀匹配）
    title: 查询设备                # 展示名：二级 Tab 文字（可选）
  - name: query_alarm
    title: 查询告警
---
```

- `tools` 兼容纯字符串数组的旧写法；对象形式可加 `title`。
- 放入全局或项目 skills 根目录即可被扫描；需要控制一级 Tab 展示时配置 `.data/skill-whitelist.json`（只过滤展示，不影响归属判定；空/缺失 = 全部允许）。
- **声明不等于归属**：只有「读取该 Skill 之后执行」的 tool 才归入其实例分组——SKILL.md 的 `tools[]` 用于声明比对、徽标计数与展示名解析。

### 8.3 App 侧（iframe 内 HTML）

1. 用 `@modelcontextprotocol/ext-apps` 的 `App` 类或裸 postMessage 实现 MCP Apps 方言。
2. 握手：`ui/initialize` 携带 `protocolVersion: "2025-06-18"`（宿主唯一支持版本，不兼容会被明确拒绝）；宿主应答含 `theme` 与 `capabilities`（tool-input / tool-result / progress / theme-changed 通知 + `tools.call` 反向调用）。
3. 消费通知：`ui/notifications/tool-input`（进入 processing；`args` 含宿主 `_embed: true` 标记，据此隐藏自带外壳）、`ui/notifications/tool-result`（`structuredContent` 为工具 JSON 输出；`toolName` 为**Server 侧原名**——共享一份 UI 的多工具场景按它归位场景 Tab）、`notifications/progress`（含可选 `uiEvent` 扩展字段）、主题变更（实时换肤，无需重建）。
4. 反向调用：`tools/call { name, arguments }` → 宿主代理转发到该 iframe 归属的 MCP Server（自动携带当前会话的 workspace capability）。
5. **设计为幂等消费**：宿主推送是追加式的，App 收到新 tool-input 应清空旧场景状态再消费；冷启动重放会先收 input 再收 result，顺序有保证。

### 8.4 不写 Skill 直接用

tool 带 `_meta.ui.resourceUri` 且无前置 skill 读取时，iframe 归「单独调用」分组照常创建与复用——UI 工具可以零 Skill 接入，Skill 只是组织手段。

---

## 9. 边界与已知限制

- **池容量 5**：强流程复合键粒度更细，条目可能增多；超出按 LRU 淘汰挂起实例（激活与执行中实例豁免）。
- **iframe 不跨会话/刷新恢复**：只有 tool 执行记录（JSONL）恢复；UI 内容由 App 重建后自行拉取。
- **postMessage 出站 targetOrigin 为 `"*"`**：sandbox iframe origin 为 opaque 的平台限制，非代码缺陷；风险由 sandbox 属性 + `/ui-resources` 代理审核 + CSP 求交三层缓解（详见 iframe-rendering.md 10.1）。
- **首错不建**：首次即失败的调用没有 iframe；错误信息只在对话流 ToolCard。
- **清单依赖**：`serverId` 与 toolName 归一化依赖 `/mcp-tools` 清单命中，清单滞后时有按需刷新自愈，但存在一个扫描周期的延迟。
- **stage-sop 特例**：redesign 阶段技能（`isStageSopSkill`）的读取不作为归属上下文，其阶段工具按「单独调用」建 iframe（阶段工作区由 StageStepper 承载）。
- **本地单用户假设**：`/ui-resources` 在未配置 `API_TOKEN` 的开发回环态匿名可达；iframe src 导航无法自定义 header，配置 token 后直载受限属已知边界。

---

## 10. 验证方法

- **台账**：iframe 生命周期事件（acquire/activate/release/evict/destroyAll）与 JSON-RPC 消息有 `api/iframe-events.md` 台账；tool 执行记录有 `tool-events` JSONL 与 `GET /sessions/:id/tool-events`。
- **单测**：`apps/web/src/mcp-iframe/pipeline.test.ts`（tools/call 转发成功/失败、未知方法 -32601）。
- **场景走查**：以 iframe-rendering.md 3.6 的两张场景表为准——基础场景（同实例复用、solo 归组、切回状态连续、占位不串组）与强流程场景（同名 Skill 二次读取不复用、并发派生不串线）。新改动至少覆盖：同键复用无重载、跨实例/跨 server 不复用、会话切换全量回收、冷启动重放先 input 后 result。

---

## 11. 代码索引

| 主题 | 文件 |
|---|---|
| 扫描管线（绑定判定、就绪门控、游标维护、去重） | `apps/web/src/mcp-iframe/useIframePipeline.ts` |
| 创建/复用入口 + 通知映射 + 宿主协议 | `apps/web/src/mcp-iframe/pipeline.ts` |
| 复合键、沙盒 iframe 创建、池策略（acquire/LRU/占用/派生） | `apps/web/src/mcp-iframe/IframePool.ts` |
| postMessage 通道（按实例键 attach/send/detach、身份校验） | `apps/web/src/mcp-iframe/MessageBridge.ts` |
| 归属判定 `resolveIframeGroup` / 展示名 `resolveToolTitle` / 全局状态 | `apps/web/src/stores/app-store.ts` |
| Skill 实例建档（name:directory:instanceId 去重） | `apps/web/src/features/workspace/useSkillLoader.ts` |
| tool 执行落盘与恢复 | `apps/server/src/mcp/tool-event-recorder.ts`、`apps/server/src/storage/tool-events.ts`、`apps/web/src/api/tool-events.ts` |
| UI 资源代理 / MCP 工具清单 / 反向调用 | `apps/server/src/routes/ui-resources.ts`、`apps/server/src/routes/mcp-tools.ts` |
| 行为规格（权威） | `docs/iframe-rendering.md` |
