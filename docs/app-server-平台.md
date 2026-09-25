# app-server 平台（真实后端 + 前端 + MCP Apps 协议）

本文是 packages/app-server + packages/web 平台化改造的技术文档：解决的问题、设计（含 ADR 决策）、验证方法。术语见 [CONTEXT.md](../CONTEXT.md)；交互规则唯一事实源见 [ask-user 7 类型](./ask-user-question-7种交互类型-功能描述.md)。

## 问题

1. **Windows 上没有可用的真实服务器**。pi 原有实验服务器（packages/coding-agent/src/experimental/server.ts）仅支持 Unix socket；session-worker 与 experimental services 不在 package.json exports 中，外部包无法 import（ADR-0001）。
2. **前端 MCP Apps 管线不完整**。web 既有管线（commit 7b38f055a）完成度约七成：终态重放型（iframe 只收最终结果），progress 实时推送、声明式归属、CSP/visibility 防护缺失；而示例服务器的进度推送、审核阻塞、增量 Tab 模式全部依赖 progress 通知（ADR-0002）。
3. **缺平台化形态**。ui:// 资源获取、文件上传/下载、多用户隔离、token 认证、前端静态托管均无 HTTP 层承载（ADR-0003）。

## 架构

### 总体形态

```
浏览器 ── 同源 http://127.0.0.1:8791 ── app-server (fastify)
   │  ├── WS（pi-server Server）：chord 服务 RPC + 会话流
   │  ├── /api/v1/*：ui-resources / mcp-tools / files / 静态资源
   │  └── 静态托管：packages/web/dist + SPA fallback（生产模式）
app-server ── AgentPlan（OpenAI 兼容，glm-5.3-flash）
app-server ── MCP servers（mcp.json，Streamable HTTP/SSE）
```

- **app-server**（packages/app-server）：自建精简 agent 运行时。AgentHarness + AgentLane 承载 agent loop；JsonlSessionRepo 承载 pi JSONL 会话（sessions/、tool-events/）；chord 提供五个 pi.* 服务（session-directory、session-management、transcript、agent-controller、mcp-host，外加会话级 tool-events），与 web 复用同一套契约。
- **web**（packages/web）：React 前端。开发模式走 vite（`npm run dev`，WS 连 8790）；生产模式由 app-server 托管 dist，WS/HTTP 同源。
- **MCP server**：外部进程，经 `mcp.json` 配置接入 McpServerManager。

### 关键设计决策（ADR）

| ADR | 决策 | 要点 |
|---|---|---|
| [ADR-0001](./adr/0001-app-server-on-pi-agent-core.md) | app-server 基于 pi-agent-core 自建，不依赖 pi-coding-agent | 仅依赖 pi-agent-core / pi-ai / pi-server + fastify；ask-user 装配、MCP 管理、会话持久化自建，换来自由设计且 Windows 可运行 |
| [ADR-0002](./adr/0002-realtime-event-stream-with-tool-events.md) | 工具执行采用实时事件流驱动，并以 tool-events 落盘 | MCP progress 通知（含 uiEvent 扩展字段）从 agent 到 iframe 实时推送；按会话落盘 tool-events JSONL（input/progress/result），重进时与消息流投影合并恢复，progress 按「数值 + uiEvent JSON」指纹去重；消息流仍是唯一事实源 |
| [ADR-0003](./adr/0003-fastify-http-token-multiuser.md) | fastify 承载 HTTP 层：token 认证、按用户隔离、ui-resources 端点 | WS 与 HTTP 共用 token；iframe src 无法带 header，token 经 query 传递；ui:// 资源改经 HTTP 端点（可设 CSP 响应头并利用浏览器缓存）；多用户 = token→用户映射，目录互不可见 |

### 核心机制

- **MCP Apps 渲染链**：工具 `_meta.ui.resourceUri` 声明 → web `mcp-tools` 清单端点发现 → `GET /api/v1/ui-resources?uri=...` 取 HTML（CSP 与 `_meta.ui.csp` 求交）→ iframe 以 HTTP src 加载（不再 srcdoc），池内按复合键 `[<serverId>|]<resourceUri>#<group>[#i<no>]` 复用。
- **归属判定**：tool 归入执行时刻之前最近一次 skill 读取建立的 Skill 实例分组；SKILL.md frontmatter `tools[]`/`title` 仅用于声明比对、就绪门控与展示名。app-only 的 MCP 工具（纯 UI）对模型隐藏。
- **ask_user_question**：七种页类型（list-single / list-multi / form / table / dropdown / file-collect / file-download）+ 三层校验（结构预设 → 通用校验：id 唯一 / defaultValue / constraints / rowOps / allowCustom / 未知字段，报错含「期望 vs 实际」）；AskUserRegistry 挂起 agent loop，前端交互卡片作答后恢复。
- **多用户隔离**：`APP_SERVER_USERS`（JSON token→userId）配置后，每个 userId 预建独立 `createAppServerHost` + `new Server(...)`；WS 连接按 upgrade 解析的 userId 路由到对应 Server（连接对象携带 userId，零侵入 pi-server）；HTTP 回调按 `request.userId` 路由。数据目录派生为 `<dataDir>/users/<userId>/`（sessions / sessions-workspace / tool-events 全隔离）。未配置 = 单用户模式，dataDir 原样。
- **静态托管**：`@fastify/static`（wildcard: false）+ `setNotFoundHandler`——`/api/` 前缀未知路径回 404 JSON 不被 fallback 吞，其余回 index.html（SPA 深链）。webDist 解析：`APP_SERVER_WEB_DIST` 显式 > main.ts 按 `import.meta.dirname` 找 monorepo 内 `packages/web/dist`（existsSync 守卫，未构建则不注册）。

### 配置（环境变量）

| 变量 | 缺省 | 说明 |
|---|---|---|
| `AGENTPLAN_BASE_URL` | `https://ark.cn-beijing.volces.com/api/plan/v3` | AgentPlan OpenAI 兼容端点 |
| `AGENTPLAN_MODEL` | `glm-5.3-flash` | 模型 ID |
| `AGENTPLAN_API_KEY` | 无 | API key，请求时经 envApiKeyAuth 读取，不落配置 |
| `APP_SERVER_WS_PORT` | `8790` | WS 监听端口 |
| `APP_SERVER_HTTP_PORT` | `8791` | HTTP 监听端口（含静态托管） |
| `APP_SERVER_DATA_DIR` | `.data` | 数据根目录（sessions/、tool-events/、mcp.json、users/） |
| `APP_SERVER_MCP_CONFIG` | `<dataDir>/mcp.json` | MCP 配置文件路径 |
| `APP_SERVER_TOKEN` | 缺省回环匿名 | 单用户 token（WS upgrade 与 /api/v1/* 共用；`?token=` 或 `Authorization: Bearer`） |
| `APP_SERVER_USERS` | 未配置 = 单用户 | 多用户映射 JSON `{"<token>":"<userId>"}`，配置后 token 必须命中映射 |
| `APP_SERVER_WEB_DIST` | 自动探测 | web 生产构建目录，显式覆盖缺省探测 |

已知边界（ADR-0003）：token 进 iframe src query 有日志/Referer 泄漏风险——fastify logger 关闭 query 记录、token-ws-listener 不打印 url，反代层面需另行规避。

## 验证方法

### 自动化测试（单测一律 faux provider，无真实 API/key）

```powershell
# app-server 全量（packages/app-server 下）
node ../../node_modules/vitest/dist/cli.js --run
# 单文件（packages/app-server 下）
node ..\..\node_modules\vitest\dist\cli.js --run test/<file>.test.ts
```

- `packages/app-server/test/`：boot / config / llm / sessions / runtime / services / mcp-config / mcp-host / tool-events / token / users / http-ui-resources / http-mcp-tools / http-files / http-static。
- `packages/web/test/`：mcp-progress（指纹去重与恢复）/ skill-declaration（声明归属与就绪门控）/ mcp-manifest（清单自愈）/ answers-file-download。
- `packages/agent/test/harness/`：ask-user-preset-validation（七类型结构预设）/ ask-user-file-download（路径安全）。

### 手动验收（真实 AgentPlan，`AGENTPLAN_API_KEY` 注入环境变量）

```powershell
# 开发模式（两个终端）
$env:AGENTPLAN_API_KEY="<key>"; npm --prefix packages/app-server run dev   # 记下 serverId / wsUrl
npm --prefix packages/web run dev                                          # http://localhost:8788

# 生产模式（单进程同源）
npm --prefix packages/web run build
npm --prefix packages/app-server run start
# 浏览器直接访问 http://127.0.0.1:8791
```

按阶段验收：

1. **Phase 1 骨架**：web 粘贴 serverId 连接 → 新建会话 → 发送「你好」→ GLM 回复流式渲染。
2. **Phase 2 MCP host**：mcp.json 配置示例服务器（`代码库/agent_opencode_sdk/mcps/mcp_apps_ui_server_example`，HTTP 8018）→ 调 simple_tool → 会话中渲染沙盒 iframe 并接收 tool-result。
3. **Phase 3 progress 事件流**：progress_tool 实时进度条；review_tool 阻塞待审 + iframe 内 submit_review 反向调用唤醒；category_scan_tool 增量 Tab；刷新重进后执行中状态恢复（tool-events 重放 + 指纹去重）。
4. **Phase 4 声明与防护**：同一 skill 连续读取归入同一实例、不同 skill 分组隔离；未就绪（声明的 tools 未全部注册）不显示入口；`_meta.ui.visibility` app-only 工具对模型隐藏；structuredContent 透传 iframe；违反 CSP 的资源被求交拦截；清单变化后 web 自愈（描述过期自动刷新）。
5. **Phase 5 ask-user 七类型**：逐类型验证——list-single/list-multi/dropdown/form 渲染与答案结构 `{"<pageId>":{"<fieldId>":value|value[]}}`；table 行编辑增删（rowOps 生效）+ 行数组答案；file-collect 真上传落盘 `<dataDir>/users/<userId>/sessions-workspace/`（单用户为 `<dataDir>/sessions-workspace/`）且答案含引用；file-download 勾选下载落文件且答案为相对路径数组；取消路径定格不 resolve；非法结构（如 list-single 带 3 字段）返回含「期望 vs 实际」的可行动报错，GLM 自纠重试。
6. **Phase 6 token / 多用户 / 托管**：
   - token：配置 `APP_SERVER_TOKEN` 后，无 token 的 WS 升级握手失败、`?token=正确` 通过；HTTP 无 token 401、query/header token 通过。
   - 多用户：配置 `APP_SERVER_USERS='{"tok-a":"user-a","tok-b":"user-b"}'` 后，两个 token 各自建会话只出现在各自列表；A 无法 resolve B 的会话（attach 双向 reject）；文件上传/下载目录隔离；WS 升级未映射 token 401。
   - 静态托管：web build 后 start，`/` 返回 index.html、`/assets/*` 200、SPA 深链（如 `/some/spa/route`）回 index.html、未知 `/api/v1/*` 回 404 JSON；未配置 webDist（未构建）时 `/` 与深链均 404（开发走 vite）。

### 提交前门禁

仓库根 `npm run check` 全过（类型 / biome / 依赖规则）。
