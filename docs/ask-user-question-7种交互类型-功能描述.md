# ask_user_question 工具 7 种交互类型 — 功能描述文档

> 状态：需求/功能描述（不含实现）
> 参照契约：`Agent平台/ask_user`（mcp_server/schema.py、prompt.py）
> 改造对象：`packages/agent/src/harness/tools/ask-user.ts`

## 1. 背景与问题

pi agent loop 中的用户交互由内置工具 `ask_user_question` 实现：工具执行时经 `AskUserRegistry` 注册挂起 Promise，agent loop 暂停；前端渲染交互卡片，用户提交后经 `answer()` 送回答案，loop 恢复。

当前 pi 实现支持 6 种页级交互类型（list-single / list-multi / form / table / dropdown / file-collect），但存在以下问题：

1. **缺少 `file-download` 类型**：无法让用户从候选文件清单中勾选并触发下载。
2. **结构级预设校验缺失**：各类型对字段数、valueType/widget 组合、columns/fields 归属、rows 键的约束未在工具层强制，模型传入自相矛盾的参数（如 list-single 页带 3 个字段、form 页夹带 file 字段）会静默传给前端，渲染异常且答案结构不可预期。
3. **通用校验缺失**：id 唯一性（页/字段/选项）、defaultValue 与 valueType/options/constraints 自洽性、constraints 边界（min≤max 等）均未校验。
4. **表单类型过宽**：form 页允许任意 valueType/widget 组合，而标准契约仅允许 number 与 text。

## 2. 目标与非目标

**目标**

- `ask_user_question` 支持完整的 7 种页级交互类型，结构与答案契约与 `Agent平台/ask_user` 对齐。
- 工具层执行结构级预设校验，报错信息含"期望 vs 实际"，可指导模型自纠重试。
- 校验只覆盖影响渲染与答案回传的结构；呈现级细节（布局、样式）仍由前端负责。

**非目标**

- 不改动 agent loop 挂起/恢复机制（AskUserRegistry 逻辑保持不变）。
- 不做前端渲染实现；前端按既有卡片渲染体系适配新类型。
- 不引入 table 预设行中的文件对象（file 列仅交互时上传）。

## 3. 顶层契约（Question）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是 | 对话框主标题 |
| question | string \| null | 否 | 总问题说明 |
| allowCustom | boolean | 否，默认 false | 是否允许自定义答案；仅对枚举类字段生效（含 table 的枚举列） |
| pages | Page[] | 是，1..20 | 页容器数组，按顺序渲染；单页即长度 1 |

所有层级禁止夹带未知字段（extra="forbid"），渲染契约不允许未定义字段透传。

## 4. 7 种交互类型（Page.type，每页必填）

页公共字段：`type`（7 选 1）、`id`（页唯一标识，答案按页回传的顶层键）、`title`、`question`（页级问题）。非 table 类型禁止提供 table 专属字段（columns / rows / rowOps）。

### 4.1 list-single — 单选列表

- **用途**：从候选项中恰好选一个（如确认/拒绝、方案 A/B/C）。
- **结构预设**：恰好 1 个字段；`valueType=enum` + `widget=radio`；`options` 非空。
- **约束**：`constraints.maxCount` 缺省或 =1；`constraints.minCount` ≤1（如提供）。
- **答案形态**：`{"<pageId>": {"<fieldId>": "<optionId>"}}`。
- **allowCustom=true 时**：用户可提交自由文本替代枚举选项。

### 4.2 list-multi — 多选列表

- **用途**：从候选项中选多个（如勾选要执行的检查项）。
- **结构预设**：至少 1 个字段；`valueType=enum` + `widget=checkbox`；`options` 非空。
- **约束**：`constraints.minCount` ≥1（如提供）；minCount/maxCount 控制勾选数量边界。
- **答案形态**：`{"<pageId>": {"<fieldId>": ["<optionId>", ...]}}`（字符串数组）。

### 4.3 form — 表单

- **用途**：多字段结构化录入（数值、文本）。
- **结构预设**：至少 1 个字段；仅允许两种组合：
  - `valueType=number` + `widget=number`；
  - `valueType=text` + `widget=text` 或 `textarea`。
  其他 valueType（enum/file）在本类型中报错。
- **字段辅助**：`unit`（单位后缀，如 "MPa"）、`hint`（输入提示）、`defaultValue` 必须与 valueType 匹配并落在 constraints 范围内。
- **答案形态**：`{"<pageId>": {"<fieldId>": <number|string>, ...}}`。

### 4.4 table — 可编辑表格

- **用途**：批量行数据录入/确认（如多台设备参数核对）。
- **结构预设**：
  - 必须提供非空 `columns`，且不提供 `fields`；
  - `rows`（可选预设行）每行的键必须是列 id，required 列必须存在且值非空字符串/空数组；
  - 单元格值按列 valueType 校验：number 只接受数值、text 只接受字符串、enum 接受字符串或字符串数组且取值在 options 内、**file 列不允许在预设行中提供文件对象**（文件仅交互时上传）；
  - 预设行数不得超过 `rowOps.maxRows`；`rowOps.allowAdd=false` 时预设行数必须 ≥ `rowOps.minRows`（用户无法补行）。
- **rowOps**：`{allowAdd（默认 true）, allowDelete（默认 true）, minRows（默认 1，≥1）, maxRows（缺省无上限，≥1 且 ≥minRows）}`。
- **答案形态**：`{"<pageId>": [ {<列id>: 值, ...}, ... ]}`（行对象数组，直接挂在页 id 下）。

### 4.5 dropdown — 下拉单选

- **用途**：候选项较多的单选场景（与 list-single 语义相同，控件为下拉）。
- **结构预设**：至少 1 个字段；`valueType=enum` + `widget=select`；`options` 非空。
- **约束**：`constraints.maxCount` 如提供必须 =1（单选）。
- **答案形态**：`{"<pageId>": {"<fieldId>": "<optionId>"}}`。

### 4.6 file-collect — 文件上传收集

- **用途**：用户上传文件（如现场照片、设备报表）。
- **结构预设**：至少 1 个字段；`valueType=file` + `widget=file`。
- **约束（constraints）**：
  - `accept`：扩展名白名单（如 `["pdf","png"]`）；**仅当用户明确要求限定类型时才声明**，缺省不限格式；
  - `maxSizeMB`：单文件大小上限（>0）；仅当用户明确要求时声明，缺省不限；
  - `minCount`/`maxCount`：文件数量边界。
- **限制**：file 字段不适用 `defaultValue`。
- **答案形态**：`{"<pageId>": {"<fieldId>": [文件引用...]}}`（引用由前端上传后生成）。

### 4.7 file-download — 文件下载（本次新增）

- **用途**：向用户展示候选文件清单，用户勾选后由前端下载（如导出分析报告、图纸）。
- **结构预设**：至少 1 个字段；`valueType=enum` + `widget=checkbox`（下载卡片本质是路径多选，valueType=file 是上传专用，不得用于本类型）；`options` 非空，**选项 id 为工作区相对路径**（`/` 分隔）。
- **路径安全（工具层第一道防线）**：选项 id 禁止
  - 绝对路径 / 盘符 / 以 `/` 或 `\` 开头；
  - 含反斜杠（必须用 `/`）；
  - 含 `..` 路径段（路径穿越）。
  权威校验在前端/Host 下载端点：resolve 后必须落在会话工作区内，拒绝越界与不存在的文件。
- **约束**：`constraints.minCount` ≥1（如提供）。
- **答案形态**：`{"<pageId>": {"<fieldId>": ["<相对路径>", ...]}}`。

## 5. 通用字段模型与校验

### 5.1 字段（Field）

| 字段 | 说明 |
|---|---|
| id | 字段唯一标识，Question 内全局唯一（含跨页、columns、页 id） |
| label | 显示名 |
| valueType | 值域：enum / number / text / file（与 widget 正交） |
| widget | 控件：radio / checkbox / select / number / text / textarea / file |
| description | 说明文案（≤500） |
| required | 是否必填，默认 false |
| defaultValue | 默认值；必须与 valueType 匹配且与 options/constraints 自洽；file 不适用 |
| unit | 单位后缀标签（number 常用，≤50） |
| hint | 输入提示（≤200） |
| options | enum 必填候选项数组（≤200），id 在同一字段内唯一 |
| constraints | 值约束，按值域取用 |

### 5.2 约束（Constraints）边界校验

- `min ≤ max`；`minCount ≤ maxCount`；`minCount/maxCount ≥ 0`；`maxSizeMB > 0`。

### 5.3 defaultValue 自洽校验

- number：必须为数值，且落在 min/max 内；
- text：必须为字符串；
- enum：字符串或字符串数组；取值必须都在 options 内；单选字段（widget=radio/select 或 maxCount=1）不能给多个默认值；数量须满足 minCount/maxCount；
- file：禁止 defaultValue。

### 5.4 id 唯一性校验

- 页 id、字段 id（含 columns）在 Question 内全局唯一；同一字段的选项 id 唯一。
- 目的：答案按 id 回传，重复 id 会导致歧义/覆盖。

## 6. 校验原则与报错形态

- **结构级预设校验在工具层执行**（字段数、valueType/widget 组合、columns/fields 归属、rows 键、路径安全），校验失败返回**可行动报错**：消息含页 id、期望规则、实际值与修正建议（"期望 vs 实际"），模型可据此自纠重试。
- **呈现级细节由前端校验**（布局、控件微调），工具层不介入。
- 每种类型的预设规则（单一事实来源，报错文案直接引用）：

| type | 预设规则 |
|---|---|
| list-single | 恰好 1 个字段（enum + radio + options 非空） |
| list-multi | 至少 1 个字段（enum + checkbox + options 非空） |
| form | 至少 1 个字段（number→number；text→text/textarea） |
| table | 非空 columns 且不提供 fields；rows 键必须是列 id |
| dropdown | 至少 1 个字段（enum + select + options 非空） |
| file-collect | 至少 1 个字段（file + file） |
| file-download | 至少 1 个字段（enum + checkbox + options 非空，id 为工作区相对路径） |

## 7. 答案回传总格式

```
{
  "<pageId>": {
    "<fieldId>": <value | value[]>
  }
}
```

- table 页例外：页 id 下直接是行对象数组。
- 用户取消：按"用户已取消本次问答"处理（既有 cancel 路径不变）。
- 工具不得编造或代替用户作答；loop 挂起语义与现状一致。

## 8. 与当前实现的差异（改造点清单）

| # | 改造点 | 现状 | 目标 |
|---|---|---|---|
| 1 | file-download 类型 | 无 | 新增页类型 + 路径安全校验 |
| 2 | 类型预设校验 | 仅类型名枚举，无结构校验 | 按第 6 节规则强制校验，可行动报错 |
| 3 | form 类型范围 | 允许任意 valueType/widget | 收窄为 number/text 两种组合 |
| 4 | id 唯一性 | 无校验 | 页/字段/选项 id 全局唯一 |
| 5 | defaultValue 自洽 | 无校验 | 按 5.3 校验 |
| 6 | constraints 边界 | 无校验 | 按 5.2 校验 |
| 7 | table 预设行 | 仅类型声明 | rows 键、required 列、单元格类型、行数上限校验 |
| 8 | rowOps 默认值 | 全可选、无默认 | allowAdd/allowDelete 默认 true、minRows 默认 1 |
| 9 | allowCustom | 无 | Question 级新增，默认 false，仅枚举类字段生效 |
| 10 | 未知字段 | 未显式禁止 | 契约各层禁止未知字段 |

## 9. 验证方式

1. **单测（工具层校验）**：对 7 种类型各覆盖合法用例 + 典型非法用例（字段数不符、valueType/widget 错配、rows 键非法、defaultValue 越界、路径穿越等），断言报错文案含"期望 vs 实际"。
2. **挂起/恢复回归**：确认 AskUserRegistry 注册/answer/cancel 行为不变，abort 触发 cancel。
3. **前端联调**：以 demo-ws-server + web UI 逐类型渲染验证，答案 JSON 结构与本文件第 7 节一致（file-download 需验证下载端点 resolve 到工作区内）。
4. **MVP 边界**：先落地 file-download 类型 + 预设校验（最小可验证增量），再补齐 5.2/5.3/5.4 通用校验。
