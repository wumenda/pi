# app-server 数据中心

## 问题

web 数据中心页面（三页签：全部资料/原始资料/任务成果；上传弹窗、文件预览、详情抽屉、关系图、成果包下载）此前是纯前端占位：适配层返回空集合/抛错，app-server 零 data-center 代码。UI 完整但无数据面。

## 设计

### 领域存储（`packages/app-server/src/data-center-store.ts`）

- 磁盘布局：`<dataDir>/data-center/registry.json`（任务/资料/成果全量元数据）+ `<dataDir>/data-center/files/<uuid>-<safeName>`（实体文件，safeName 规则同 sessions 上传）。dataDir 由 host 派生 → 多用户模式自动隔离到 `users/<userId>/`。
- registry 启动读入内存，写穿持久化（tmp+rename 原子写）；变更经 promise-chain 串行防交错（模式同 tool-events）。损坏/缺失降级空集合（error 日志，不阻塞启动）。空注册表必须每实例新建（共享可变对象会让多 store 实例互相污染）。
- MVP 语义（无生产者，恒定值）：task.status `"未开始"`、material.aiStatus `"未解析"`、usageRecords `[]`、aiParseResult `null`、result.version `"v1"`/`versionStatus `"当前版本"`。
- 成果来源：`POST /api/v1/data-center/results` 显式登记（multipart 上传 + taskId/sourceStage 元数据）；后续 agent 会话产出可调该端点落地。

### HTTP 端点（`packages/app-server/src/http.ts`）

认证/CORS 钩子自动覆盖；`@fastify/multipart` 全局 50MB 上限；CORS 预检 allow-methods 增补 PATCH。

| 端点 | 行为 |
| --- | --- |
| `GET /api/v1/data-center/overview` | 三集合清单；store 未装配 503 |
| `POST /api/v1/data-center/tasks` | JSON `{name, taskType}`；缺字段 400 |
| `POST /api/v1/data-center/materials` | multipart：file（首个）+ name/type/description/remark/taskIds（逗号串）；无文件 400 |
| `PATCH /api/v1/data-center/materials/:id` | 元数据编辑（description/remark/type/relatedTaskIds）；未知 404 |
| `POST /api/v1/data-center/results` | multipart 成果登记；taskId 必填，未知任务 404 |
| `GET /api/v1/data-center/files/:id?disposition=inline\|attachment` | content-type 按扩展名映射（pdf/html/图片/csv 真实类型，其余 octet-stream）；缺省 attachment |
| `GET /api/v1/data-center/graph/:taskId` | 关系图；未知 404 |
| `POST /api/v1/data-center/tasks/:id/package` | body `{ids}` → fflate `zipSync` 内存打包 → `application/zip` attachment（`<任务名>-成果包.zip`）；ids 须全属于该任务成果（400），未知任务 404 |

HttpDeps 只增 1 个方法 `dataCenterStore(userId)`（领域句柄一次路由取回，端点校验留在 handler）。

### 关系图硬约定

文件类节点 id 必须为 `g-<条目id>`——`RelationGraphCanvas` 焦点定位按 `g-${id}` 匹配节点 id。布局为确定性三列：raw 资料左列（x=80）→ stage 任务居中（x=400）→ final 成果右列（x=720）。

### web 适配层（`packages/web/src/api/data-center.ts`）

组件零改动；适配层从占位切真实端点：overview/建任务/上传（FormData）/编辑（PATCH）/关系图走 axios；单文件下载走 `<a download>` + 同源 URL（后端 content-disposition 提供文件名）；成果包走 POST + `responseType: "blob"` → objectURL 落盘。

### 依赖

`fflate 0.8.2`（pinned 精确版本，纯 JS 无 lifecycle scripts），仅 app-server（private 包）使用；lockfile 经 `npm install --package-lock-only --ignore-scripts` 刷新。

## 已知边界

- 成果包 zip 为内存打包：单文件上限 50MB，超大成果包需后续流式化。
- task status / aiStatus / usageRecords 无生产者（UI 徽标按恒定值渲染）。
- registry 为单文件全量写穿，条目数极大时需分片（当前规模无虞）。

## 验证

1. 单测（app-server 包根）：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/data-center-store.test.ts test/http-data-center.test.ts`；http 回归同法跑其余 `test/http-*.test.ts`、`token.test.ts`。
2. 真实环境：重启 app-server 后 curl 链路——建任务 → `curl -F file=@x.pdf .../materials` → `GET overview`；`GET files/<id> -I` 看 content-type/inline；`POST tasks/<id>/package` 落盘 zip 并解包校验；`POST .../results -F` 登记成果。
3. 浏览器：三页签真实数据；pdf 在线预览；详情抽屉编辑持久化；关系图渲染 + 焦点定位；上传弹窗；成果包下载；重启 app-server 后数据仍在。
