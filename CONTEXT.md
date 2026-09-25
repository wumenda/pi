# pi 平台（app-server + web）

基于 pi monorepo 构建的前后端平台：packages/web 为前端，packages/app-server 为后端，原生支持 MCP Apps 协议与 ask_user_question 七种交互类型。

## Language

### 平台骨架

**app-server**:
新建的后端 package（packages/app-server），基于 pi-agent-core、pi-ai、pi-server 与 fastify 自建的精简 agent 运行时与服务端，不依赖 pi-coding-agent。
_Avoid_: platform-server、后端服务（泛称）

**宿主（Host）**:
渲染 MCP App 沙盒 iframe并代理其 JSON-RPC 通信的一方；在本项目中由 web 前端与 app-server 共同承担。
_Avoid_: 客户端

**示例服务器**:
位于 `代码库/agent_opencode_sdk/mcps/mcp_apps_ui_server_example` 的 Python FastMCP 服务器（HTTP 8018），提供快速返回、进度推送、审核阻塞、共享 UI、增量 Tab 五种工具模式与电商 skills，用作端到端验证。
_Avoid_: demo 服务器

**AgentPlan**:
LLM 接入使用的 OpenAI 兼容端点（模型 glm-5.3-flash），凭据经 `AGENTPLAN_API_KEY` 环境变量注入，不落任何仓库文件。

### MCP Apps

**ui:// 资源**:
MCP Server 提供的交互式 HTML 界面资源，由工具的 `_meta.ui.resourceUri` 声明，宿主获取后注入沙盒 iframe 渲染。
_Avoid_: UI 插件、App 页面

**Skill 实例**:
一次 skill 读取动作建立的分组容器（键 `<skillName>#<instanceId>`），是 iframe 分组与工作区一级 Tab 的单位；同一 skill 的每次读取产生独立实例。
_Avoid_: skill 会话

**单独调用（solo）**:
无前置 skill 读取上下文的工具调用所归入的分组（键 `__solo__`）。

**iframe 复合键**:
iframe 实例的身份四元组 `[<serverId>|]<resourceUri>#<group>[#i<no>]`，决定池内复用与隔离边界；键是身份不是地址，池内查找按实例字段匹配。

**归属判定**:
tool 归入哪个 Skill 实例分组的判定规则——以执行时刻之前最近一次 skill 读取为准，SKILL.md 声明仅用于比对与展示名，不改变归属。

**终态重放**:
宿主仅在工具调用结束后向 iframe 推送最终结果的运行形态（pi 现状）。
_Avoid_: 轮询

**实时事件流**:
执行中事件（tool-input / progress / tool-result）以追加式通知实时推送给 iframe 的运行形态，progress 可携带 uiEvent 扩展字段并以指纹去重。

**tool-events**:
工具执行事件的按会话 JSONL 落盘记录（input / progress / result，含 uiEvent），会话重进时与消息流投影合并恢复 iframe 状态；是消息流的执行细节补充投影，不是替代。

### 用户交互

**ask_user_question**:
agent 内置交互工具，执行时经 AskUserRegistry 挂起 agent loop，前端渲染交互卡片，用户提交答案或取消后 loop 恢复。
_Avoid_: 问答工具、表单工具

**页类型**:
ask_user_question 的七种交互页：list-single、list-multi、form、table、dropdown、file-collect、file-download。

**工作区（workspace）**:
会话关联的服务端文件目录，是文件上传/下载与 MCP 文件读写的安全边界。

### 访问与托管

**users 模式**:
`APP_SERVER_USERS`（JSON token→userId）配置后的多用户形态——每个 userId 预建独立 host/Server 实例，数据目录派生为 `<dataDir>/users/<userId>/`（sessions / sessions-workspace / tool-events 全隔离）。
_Avoid_: 多租户（无配额与计费维度）

**单用户模式**:
未配置 `APP_SERVER_USERS` 的缺省形态——dataDir 原样，token 校验退回 `APP_SERVER_TOKEN`（缺省开发回环匿名）。

**静态托管（webDist）**:
app-server 经 @fastify/static 托管 web 生产构建目录并 SPA fallback；未知 `/api/` 路径回 404 JSON 不走 fallback。缺省自动探测 monorepo 内 `packages/web/dist`。
