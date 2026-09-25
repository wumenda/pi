# HTTP 层采用 fastify：token 认证、按用户隔离的会话空间、ui-resources 端点

packages/server 只提供 WS 传输，而 ui:// 资源获取、文件上传/下载、mcp-tools 清单需要 HTTP 端点。决定：app-server 以 fastify 承载 HTTP 层，WS 与 HTTP 共用同一 token 认证；iframe src 无法携带自定义 header，token 经 query 参数传递。ui:// 资源改经 HTTP 端点获取（替代现有 WS RPC + srcdoc 注入），以便设置 CSP 响应头（与 `_meta.ui.csp` 求交）并利用浏览器缓存。多用户形态为 token→用户映射（静态配置起步），会话与工作区目录按用户隔离、互不可见。

## Consequences

引入 fastify 依赖（版本精确锁定，按锁文件安全规则安装）；token 出现在 iframe src 的 query 中有泄漏到日志/Referer 的风险，需在反代与日志层面规避，属已知边界。
