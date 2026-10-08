# app-server 技能清单扫描与 MCP 工具发现

## 问题

web 技能库/工具库此前没有真实数据源：

- 技能库数据来自浏览器内存中的 transcript skill 注册表——只有当前会话里实际触发过 `<skill>` 调用的技能才会出现，新会话恒为空；
- 工具库只有带 `ui://` 声明的 MCP Apps 工具（`GET /api/v1/mcp-tools`，为 iframe 自愈设计），非 ui:// 的普通 MCP 工具不可见；
- agent 侧 `resources: {}`，pi-agent-core 原生的技能机制（扫描/系统提示词注入/显式调用）没有数据，技能调用一律 `unknown_skill`。

底层能力原生齐全：`loadSkills`/`loadSourcedSkills`（磁盘扫描 + SKILL.md frontmatter + ignore 规则）、`AgentHarnessResources.skills` 注入、`formatSkillsForSystemPrompt`（`<available_skills>`）、`kind:"skill"` 调用链、`McpServerManager.tools()` 全量工具。缺口只在 app-server 装配层与 HTTP 面。

## 设计

### 技能扫描（host 级快照）

- 模块：`packages/app-server/src/skills-manifest.ts`。
- 目录约定与 pi coding-agent 一致：
  - `~/.pi/agent/skills` → `source: "global"`；
  - `<cwd>/.pi/skills` → `source: "project"`；
  - `APP_SERVER_SKILLS_DIRS`（`path.delimiter` 分隔，如 Windows `;`、POSIX `:`）追加目录，记 global。
- `createAppServerHost` 启动时扫描一次（与 MCP manager 同生命周期），诊断打 warn 日志不阻塞启动；**快照在启动时定格，改动技能文件需重启 app-server**。
- 产物一份两用：
  1. `createSessionRuntime({skills})` → `AgentHarness.create({resources: {skills}})`：模型系统提示词获得 `<available_skills>`（`disable-model-invocation` 的技能跳过），`kind:"skill"` 显式调用可用；
  2. HTTP 清单端点（web 技能库）。
- 同名去重：先扫到的优先（global 在 project 前）。
- agent 包 `Skill` 增加可选 `meta`/`version` frontmatter 透传（宿主 UI 展示用，不进模型）。

### MCP 工具发现

- `host.ts` 新增 `listAllTools()`：`mcp.tools()` 全量投影，不再过滤 ui://；条目含 `serverId/name/title/description/harnessName/visibility/inputSchema`，`resourceUri` 有值即 MCP Apps 工具。
- 既有 `GET /api/v1/mcp-tools`（ui:// 子集）保持不动——iframe 管线自愈依赖该语义。

### HTTP 端点

| 端点 | 返回 |
| --- | --- |
| `GET /api/v1/skills` | `SkillManifestEntry[]`（不含 body） |
| `GET /api/v1/skills/:name` | 条目 + `body`（SKILL.md 原文）；未知 404 |
| `GET /api/v1/tools` | `McpToolEntry[]`（全量工具） |

认证/CORS 由既有钩子自动覆盖（与 `/api/v1/mcp-tools` 同路径规则）。

### web 前端

- `api/settings.ts`：`fetchSkills`/`fetchSkillDetail` 改调 `/skills`、`/skills/:name`，投影为 `SkillInfoDTO`/`SkillDetailDTO`（`metadataUnavailable` 恒 false）。
- `api/tool-library.ts`：`fetchToolLibrary` 改调 `/tools`；`resourceUri` 有值标 `plugin`，否则 `native`；HTTP 不可达时回退既有 ui:// 清单。
- 删除 transcript skill 注册表（`skillRegistry`/`knownSkills`/`resetSkillRegistry`/`recordSkillDeclaration`）：`<skill>` 块解析保留（驱动 skill tool part 合成），仅移除注册表副作用。

## 验证

1. 单测（包根）：
   - `packages/app-server`：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/skills-manifest.test.ts test/http-skills.test.ts test/http-tools.test.ts`；
   - `packages/web`：`--run test/transcript-projection.test.ts test/transcript-incremental.test.ts`。
2. 真实环境：重启 app-server（需 `AGENTPLAN_API_KEY`），`curl http://127.0.0.1:8791/api/v1/skills` 应列出 `.pi/skills` 与 `~/.pi/agent/skills` 下的技能；`curl /api/v1/tools` 应列出已连 MCP server 的全部工具。
3. web 技能库显示真实磁盘技能，详情页 body 为 SKILL.md 原文；工具库显示 plugin/native 两类来源。
4. agent 注入：日志 `skills scanned: N entries`；发 prompt 后系统提示词含 `<available_skills>`，显式技能调用不再报 `unknown_skill`。
