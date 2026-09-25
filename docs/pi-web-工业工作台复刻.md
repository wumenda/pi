# pi-web 工业工作台复刻（Agent_opencode_sdk/apps/web → packages/web）

## 问题

pi 原有 web 前端（React 19 + 手写 UI）只有基础对话与 MCP iframe 工作区，缺少产品化的页面结构。需求：`packages/web` 前端页面完全复刻 `Agent_opencode_sdk/apps/web`（工业 Agent 工作台：首页/项目中心/知识库/技能库/工具库/数据中心/会话工作台 + i18n + 亮暗主题），同时数据面必须接 pi 后端（否则页面不可用）。

## 设计

两端后端协议完全不同（opencode REST+SSE vs pi 的 chord WS + app-server REST），复刻采用「UI 原样照搬、API 层换底座」的分层适配：

- **原样复刻**（126 个非测试文件）：`redesign/`（页面+工业主题样式）、`shell/`、`workspace/`、`features/chat|workspace`、`mcp-iframe/`、`pages/`、`i18n/`、`stores/app-store.ts`、`theme*`、`index.css`。hash 路由、zustand store、React Query 缓存契约不变。
- **API 适配层**（`src/api/*` 16 个模块）：导出签名与目标项目一致，内部实现重写：
  - `sessions/messages`：chord `pi.session-directory` / `pi.session-management` / `pi.agent-controller`（prompt/abort），`fetchMessages` 幂等 attach 后读 transcript 快照；
  - `transcript.ts`（新增）：pi transcript wire JSON → opencode `MessageDTO[]` 投影。toolCall/toolResult 合并为内嵌结果的 tool part；`details.mcpUi` 注入 `state.metadata._meta.ui`（iframe 管线数据源）；user message 中的 `<skill>` 块合成 assistant skill tool part（驱动 useSkillLoader/iframe 分组）；skill-meta 声明进注册表缓存（`fetchSkills` 数据源，避免元数据降级阻断 iframe 门控）；ask_user 挂起检测；
  - `tools/tool-library`：app-server `GET /api/v1/mcp-tools` + chord `pi.mcp-host.callTool`（反向调用）；iframe src 走 `/api/v1/ui-resources`（两端同形）；
  - `files`：app-server 会话文件上传/下载；`settings`：`pi.mcp-host.statuses()` 投影；`questions`：`encodeAnswers` 的 string[][] → `answerAskUser` 结构化 answers；
  - `fs/projects/data-center/agents/oauth/system/permissions`：pi 无对应领域，返回空集合/固定根/no-op（页面渲染空态）；`projects` 返回固定"默认工作区"单项（顶部新建会话弹窗需选择项目/目录后才能创建，否则无可选项目成死路）。
- **pi 连接层**（`src/pi/`，旧 `state/pi-app.ts` zustand 化）：模块级单例 client/services + store 镜像，`getPiServices/requirePiServices` 供适配层同步访问；连接配置持久化 localStorage，`useAppBootstrap` 自动连接；`ConnectionGate`（复刻范围外新增）右下角徽标 + 连接配置弹窗。
- `@platform/shared` DTO 类型收敛为本地 `src/shared/index.ts`，经 tsconfig paths + vite alias 保持 `@platform/shared` import 不变。

已知取舍（MVP 边界）：
- 流式打字机（message.part.delta）降级为快照整段更新（pi transcript 无 delta 粒度）；
- 子会话聚合（subagent parentSessionID）、权限审批卡、iframe 事件审计上报无 pi 对应面，已移除/no-op；
- iframe 运行中 progress 实时推送退化（progress 随快照到达）。

## 验证

- `packages/web`：`npm run typecheck`（tsgo）、`npm test`（`test/transcript-projection.test.ts`，4 例：消息投影/ask_user 挂起/skill 合成与注册表/reasoning）、根仓库 `biome check --error-on-warnings packages/web`、`check:pinned-deps`/`check:runtime-deps`/`check:ts-imports`/`check:entry-graphs` 全通过。
- 浏览器（vite dev, 端口 8788；`/api` 代理到 app-server 8791）：`#/` 首页、`#/session/:id` 工作台（含后端未连错误态）、`#/skills`、`#/data-center` 渲染与目标一致，无 JS 运行时错误。
- 联调：启动 app-server（`APP_SERVER_WS_PORT=8790 APP_SERVER_HTTP_PORT=8791`），在右下角徽标弹窗填 WS 地址与 serverId（启动日志打印）后，会话创建/对话/ask_user 卡片/MCP App iframe 走 pi 后端。
- **端到端对话复现（mock LLM，可复现不烧 token）**：
  1. `node packages/app-server/.e2e-mock-llm.mjs`（OpenAI 流式兼容 mock，状态机：user → bash 工具调用；文本含"问题" → ask_user_question；tool 结果 → text 总结）；
  2. `AGENTPLAN_BASE_URL=http://127.0.0.1:8795/v1 AGENTPLAN_API_KEY=mock AGENTPLAN_MODEL=mock APP_SERVER_WS_PORT=8792 APP_SERVER_HTTP_PORT=8793 APP_SERVER_DATA_DIR=.data-e2e npm --prefix packages/app-server run start`；
  3. `PI_APP_SERVER_HTTP=http://127.0.0.1:8793 npm --prefix packages/web run dev`（proxy 对齐多实例端口）；
  4. 浏览器打开 dev 地址 → 右下角徽标填 `ws://127.0.0.1:8792` + serverId → 首页输入目标 → 启动任务。
- 已实测链路（2026-09-25，mock LLM）：首页创建会话 → bash 工具调用/结果转译（pi harness 在 Windows 下 bash cwd 解析失败属 pi 执行环境问题，error 态转译正确）→ assistant 总结引用 tool output → ask_user_question 挂起 → AskUserCard 渲染/必填校验 → 提交后 `replyQuestion` 适配层解出结构化 answers `{pageId:{fieldId:value}}` → `answerAskUser` 解除挂起 → 工具卡转"成功" → 最终总结。刷新后自动重连 + transcript 重放恢复对话流。
- **创建会话失败可见性（修复"点击创建会话没反应"）**：根因是错误被静默吞掉——`ConsoleHome.onStartTask` 无 catch、项目中心 create/remove/rename mutation 无 onError，任何失败（未连接/serverId 不匹配/WS 断开）都表现为无反馈。修复：`ConsoleHome` try/catch + `message.error("创建会话失败：...")`；项目中心三个 mutation 补 `onError`。E2E 验证（篡改 localStorage `pi-connection` 的 serverId 后刷新）：
  - 连接层：徽标转"未连接"并显示 serverId 不匹配原因，配置弹窗自动弹出预填错误配置；会话页消息区显示"消息加载失败，请重试"错误态（React Query）；
  - 创建路径：首页点"启动任务"→ 顶部 toast「创建会话失败：未连接 pi-server（请先在工作台连接）」（截图留证），不再静默；
  - 恢复：还原 serverId 刷新后徽标回"已连接"，正常路径（首页启动任务 / 项目中心新建会话弹窗选"默认工作区"→创建）复测通过。
  - 注意：首页"启动任务/开始诊断"是轮播双页（自动轮换），自动化测试点击前需先点"切换到第 1 页"再操作，否则会点到过渡态的旧按钮。
- 生产托管：`APP_SERVER_WEB_DIST=packages/web/dist` 时 app-server 静态托管 + SPA fallback（`packages/app-server/src/http.ts`）。
