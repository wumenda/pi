# app-server 基于 pi-agent-core 自建，不依赖 pi-coding-agent

pi 的真实实验服务器（packages/coding-agent/src/experimental/server.ts）仅支持 Unix socket，Windows 上不可用；其 session-worker 与 experimental services 也不在 package.json 的 exports 中，外部 package 无法直接 import。决定：新建 packages/app-server，仅依赖 pi-agent-core（agent loop 原语）、pi-ai（LLM provider）、pi-server（WS 传输）与 fastify（HTTP 层），自建精简 agent 运行时、会话管理与 MCP host 服务。

## Considered Options

- 给 pi-coding-agent 增加 exports 条目复用其 services：被拒——应用包耦合深、上游结构易变，且 Windows 传输缺失仍需自行补齐。
- 复制 services 源码到新 package：被拒——形成双份维护负担。

## Consequences

ask-user registry 装配、MCP server 管理、会话持久化需在 app-server 内重写；换来服务形态可从 MCP Apps 协议与多用户需求出发自由设计，不背负 CLI 应用的历史约束。
