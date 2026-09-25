/** 数据中心（三 Tab + 搜索/筛选 + 资料表格 + 任务成果）：数据来自 GET /api/v1/data-center */
import { useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  DatabaseZap,
  Download,
  Eye,
  Layers,
  Link2,
  Package,
  Search,
  Sparkles,
  Upload,
} from "lucide-react"
import type {
  DataCenterMaterialDTO,
  DataCenterOverviewDTO,
  DataCenterResultDTO,
  DataCenterTaskDTO,
} from "@platform/shared"
import { downloadDataCenterFile, fetchDataCenterOverview } from "../../../api/data-center"
import { fileTypeIcon, AiStatusBadge, formatBytes, formatDateTime, MATERIAL_TYPE_OPTIONS, AI_STATUS_OPTIONS, RESULT_TYPE_OPTIONS } from "./shared"
import type { FileData, OpenFileHandler, SelectedFile, ViewRelationHandler } from "./shared"
import { RelationGraphCanvas } from "./RelationGraphCanvas"
import { FileDetailDrawer } from "./FileDetailDrawer"
import { ResultPackageModal } from "./ResultPackageModal"
import { FilePreviewModal } from "./FilePreviewModal"
import { UploadMaterialDialog } from "./UploadMaterialDialog"
import { ThemeSelect } from "../../components/ThemeSelect"

type TabKey = "all" | "raw" | "result"

const TABS = [
  { key: "all", label: "全部资料" },
  { key: "raw", label: "原始资料" },
  { key: "result", label: "任务成果" },
] as const

interface AllMaterialRowBase {
  id: string
  name: string
  fileType: string
  type: string
  source: string
  relatedTasks: string
  updatedAt: string
  status: string
  sizeBytes: number
}

type AllMaterialRow =
  | (AllMaterialRowBase & { sourceKind: "raw"; raw: DataCenterMaterialDTO })
  | (AllMaterialRowBase & { sourceKind: "result"; raw: DataCenterResultDTO })

// 全部资料：合并原始资料 + 任务成果
function buildAllMaterials(overview: DataCenterOverviewDTO): AllMaterialRow[] {
  const raws: AllMaterialRow[] = overview.materials.map((m) => ({
    id: m.id,
    name: m.name,
    fileType: m.fileType,
    type: m.type,
    source: "用户上传",
    sourceKind: "raw",
    relatedTasks: m.relatedTasks.map((t) => t.taskName).join("、") || "-",
    updatedAt: formatDateTime(m.uploadedAt),
    status: m.aiStatus,
    sizeBytes: m.sizeBytes,
    raw: m,
  }))
  const results: AllMaterialRow[] = overview.results.map((r) => ({
    id: r.id,
    name: r.name,
    fileType: r.fileType,
    type: r.type,
    source: "任务生成",
    sourceKind: "result",
    relatedTasks: overview.tasks.find((t) => t.id === r.taskId)?.name || "-",
    updatedAt: formatDateTime(r.generatedAt),
    status: r.versionStatus,
    sizeBytes: r.sizeBytes,
    raw: r,
  }))
  return [...raws, ...results]
}

// 搜索匹配项的统一结构（全部资料行 / 原始资料行）
interface SearchableItem {
  name: string
  type: string
  status: string
  relatedTasks: string
  raw: FileData
}

export function DataCenterPage() {
  const [overview, setOverview] = useState<DataCenterOverviewDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>("all")
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("全部")
  const [statusFilter, setStatusFilter] = useState("全部")
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null) // {kind, data}
  const [previewFile, setPreviewFile] = useState<FileData | null>(null) // 文件预览弹窗
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [packageTask, setPackageTask] = useState<DataCenterTaskDTO | null>(null) // 任务成果包弹窗
  const [graphFocus, setGraphFocus] = useState<{ taskId: string; focusNodeId: string | null } | null>(null) // 进入关系图
  const [uploadOpen, setUploadOpen] = useState(false) // 上传资料对话框

  const tasks = overview?.tasks ?? []
  const materials = overview?.materials ?? []
  const results = overview?.results ?? []

  // 真实数据加载（重试入口：手动刷新 / 操作后 reload）
  const reload = (): void => {
    setLoading(true)
    setLoadError(null)
    fetchDataCenterOverview()
      .then((data) => {
        setOverview(data)
        setExpandedTask((cur) => cur ?? data.tasks[0]?.id ?? null)
        setLoading(false)
      })
      .catch(() => {
        setLoadError("数据中心加载失败，请确认后端服务已启动")
        setLoading(false)
      })
  }
  useEffect(reload, [])

  // 轻量操作反馈（几秒后自动消失）
  const showNotice = (message: string): void => {
    setNotice(message)
    window.setTimeout(() => setNotice((cur) => (cur === message ? null : cur)), 4000)
  }

  const allMaterials = useMemo(() => (overview ? buildAllMaterials(overview) : []), [overview])

  // 搜索匹配：文件名、文件说明、用户备注、资料类型、关联任务
  const matchSearch = (item: SearchableItem, term: string): boolean => {
    if (!term) return true
    const t = term.toLowerCase()
    const raw = item.raw
    const haystack = [item.name, raw.description || "", raw.remark || "", item.type, item.relatedTasks]
      .join(" ")
      .toLowerCase()
    return haystack.includes(t)
  }

  const matchType = (item: SearchableItem, t: string): boolean => t === "全部" || item.type === t
  const matchStatus = (item: SearchableItem, s: string): boolean => s === "全部" || item.status === s

  // 全部资料筛选
  const filteredAll = allMaterials.filter((m) =>
    matchSearch(m, search) && matchType(m, typeFilter) && matchStatus(m, statusFilter),
  )

  // 原始资料筛选
  const filteredRaw = materials.filter((m) => {
    const item: SearchableItem = {
      name: m.name,
      type: m.type,
      status: m.aiStatus,
      relatedTasks: m.relatedTasks.map((t) => t.taskName).join("、") || "-",
      raw: m,
    }
    return matchSearch(item, search) && matchType(item, typeFilter) && matchStatus(item, statusFilter)
  })

  // 成果筛选（与 TaskResultsList 列表展示共用同一口径，保证 footer 统计一致）
  const filteredResults = useMemo(() => filterResults(results, search), [results, search])

  const typeOptions = activeTab === "result" ? ["全部", ...RESULT_TYPE_OPTIONS] : ["全部", ...MATERIAL_TYPE_OPTIONS]
  const statusOptions =
    activeTab === "result" ? ["全部", "当前版本", "草稿", "已生成"] : ["全部", ...AI_STATUS_OPTIONS]

  const handleOpenFile: OpenFileHandler = (kind, data) =>
    setSelectedFile(kind === "raw" ? { kind, data: data as DataCenterMaterialDTO } : { kind, data: data as DataCenterResultDTO })
  const handlePreview = (data: FileData) => setPreviewFile(data)
  const handleDownload = (file: FileData): void => {
    downloadDataCenterFile(file.id, file.name)
  }
  const handleViewRelation: ViewRelationHandler = (taskId, focusNodeId) => {
    setGraphFocus({ taskId, focusNodeId })
  }

  // 关系图模式：必须放在所有 hooks 之后
  if (graphFocus) {
    return (
      <RelationGraphCanvas
        taskId={graphFocus.taskId}
        focusNodeId={graphFocus.focusNodeId}
        materials={materials}
        results={results}
        taskName={tasks.find((t) => t.id === graphFocus.taskId)?.name ?? graphFocus.taskId}
        onClose={() => setGraphFocus(null)}
      />
    )
  }

  return (
    <main className="dc-page">
      <header className="dc-page-header">
        <div className="dc-page-header-left">
          <div className="dc-page-icon">
            <DatabaseZap size={26} />
          </div>
          <div>
            <h1>数据中心</h1>
            <p>集中管理各项目改造任务的原始资料与成果文件，支持分类检索、关联图谱与在线预览。</p>
          </div>
        </div>
        {notice && <div className="dc-toast">{notice}</div>}
      </header>

      <div className="dc-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`dc-tab ${activeTab === t.key ? "active" : ""}`}
            onClick={() => {
              setActiveTab(t.key)
              setTypeFilter("全部")
              setStatusFilter("全部")
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="dc-toolbar">
        <div className="dc-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="搜索文件名、文件说明、备注、资料类型、关联任务"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="dc-filters">
          <label>
            资料类型
            <ThemeSelect value={typeFilter} onChange={setTypeFilter} options={typeOptions} ariaLabel="资料类型" />
          </label>
          {activeTab !== "result" && (
            <label>
              AI 处理状态
              <ThemeSelect value={statusFilter} onChange={setStatusFilter} options={statusOptions} ariaLabel="AI 处理状态" />
            </label>
          )}
          {activeTab === "raw" && (
            <button type="button" className="dc-btn dc-btn-primary" onClick={() => setUploadOpen(true)}>
              <Upload size={16} /> 上传资料
            </button>
          )}
        </div>
      </section>

      <section className="dc-content">
        {loading && <div className="dc-empty-row dc-loading">数据加载中…</div>}
        {!loading && loadError && (
          <div className="dc-empty-row dc-error-row">
            {loadError}
            <button type="button" className="dc-link-btn" onClick={reload}>
              重试
            </button>
          </div>
        )}
        {!loading && !loadError && (
          <>
            {activeTab === "all" && (
              <AllMaterialsTable
                rows={filteredAll}
                onOpenFile={handleOpenFile}
                onPreview={handlePreview}
                onDownload={handleDownload}
              />
            )}
            {activeTab === "raw" && (
              <RawMaterialsTable
                rows={filteredRaw}
                onOpenFile={handleOpenFile}
                onPreview={handlePreview}
                onDownload={handleDownload}
              />
            )}
            {activeTab === "result" && (
              <TaskResultsList
                tasks={tasks}
                results={results}
                expandedTask={expandedTask}
                setExpandedTask={setExpandedTask}
                onOpenFile={handleOpenFile}
                onPreview={handlePreview}
                onDownload={handleDownload}
                onViewRelation={handleViewRelation}
                onOpenPackage={setPackageTask}
                search={search}
              />
            )}
          </>
        )}
      </section>

      {/* 分页 */}
      {!loading && !loadError && (
        <footer className="dc-pagination">
          <span>
            共{" "}
            {activeTab === "all" ? filteredAll.length : activeTab === "raw" ? filteredRaw.length : filteredResults.length}{" "}
            条
          </span>
          <div className="dc-pagination-btns">
            <button type="button" disabled>
              上一页
            </button>
            <button type="button" className="active">
              1
            </button>
            <button type="button" disabled>
              下一页
            </button>
          </div>
        </footer>
      )}

      {/* 上传资料对话框 */}
      {uploadOpen && (
        <UploadMaterialDialog
          tasks={tasks}
          onDone={(message) => {
            setUploadOpen(false)
            showNotice(message)
            reload()
          }}
          onError={showNotice}
          onClose={() => setUploadOpen(false)}
        />
      )}

      {/* 文件详情抽屉 */}
      {selectedFile && (
        <FileDetailDrawer
          file={selectedFile}
          tasks={tasks}
          results={results}
          onClose={() => setSelectedFile(null)}
          onViewRelation={handleViewRelation}
          onSaved={(message) => {
            showNotice(message)
            reload()
          }}
        />
      )}

      {/* 任务成果包弹窗 */}
      {packageTask && (
        <ResultPackageModal
          task={packageTask}
          results={results.filter((r) => r.taskId === packageTask.id)}
          onClose={() => setPackageTask(null)}
        />
      )}

      {/* 文件预览弹窗 */}
      {previewFile && <FilePreviewModal data={previewFile} onClose={() => setPreviewFile(null)} />}
    </main>
  )
}

// ============ 全部资料表格 ============
function AllMaterialsTable({
  rows,
  onOpenFile,
  onPreview,
  onDownload,
}: {
  rows: AllMaterialRow[]
  onOpenFile: OpenFileHandler
  onPreview: (data: FileData) => void
  onDownload: (file: FileData) => void
}) {
  return (
    <div className="dc-table-wrap">
      <table className="dc-table">
        <thead>
          <tr>
            <th>文件名称</th>
            <th>资料类型</th>
            <th>来源</th>
            <th>关联任务</th>
            <th>更新时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const Icon = fileTypeIcon(row.fileType)
            return (
              <tr key={row.id} className="dc-row-clickable" onClick={() => onOpenFile(row.sourceKind, row.raw)}>
                <td>
                  <div className="dc-cell-file">
                    <Icon size={18} className="dc-file-icon" />
                    <div className="dc-tooltip-host">
                      <button
                        type="button"
                        className="dc-file-name-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenFile(row.sourceKind, row.raw)
                        }}
                      >
                        {row.name}
                      </button>
                      <div className="dc-tooltip">
                        <strong>{row.name}</strong>
                        <p>{row.raw.description}</p>
                        {row.raw.remark && <p className="dc-tooltip-remark">备注：{row.raw.remark}</p>}
                      </div>
                    </div>
                  </div>
                </td>
                <td>{row.type}</td>
                <td>
                  <div className="dc-source-cell">
                    <span className={`dc-source dc-source-${row.sourceKind}`} title={row.source}>
                      {row.sourceKind === "raw" ? <Upload size={13} /> : <Sparkles size={13} />}
                      <span className="dc-source-text">{row.source}</span>
                    </span>
                  </div>
                </td>
                <td className="dc-cell-task">{row.relatedTasks}</td>
                <td className="dc-cell-time">{row.updatedAt}</td>
                <td>
                  <AiStatusBadge status={row.status} />
                </td>
                <td>
                  <div className="dc-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => onPreview(row.raw)} title="文件预览">
                      <Eye size={16} />
                    </button>
                    <button type="button" title="下载" onClick={() => onDownload(row.raw)}>
                      <Download size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="dc-empty-row">
                没有匹配的资料
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ============ 原始资料表格 ============
function RawMaterialsTable({
  rows,
  onOpenFile,
  onPreview,
  onDownload,
}: {
  rows: DataCenterMaterialDTO[]
  onOpenFile: OpenFileHandler
  onPreview: (data: FileData) => void
  onDownload: (file: FileData) => void
}) {
  return (
    <div className="dc-table-wrap">
      <table className="dc-table">
        <thead>
          <tr>
            <th>文件名称</th>
            <th>资料类型</th>
            <th>文件大小</th>
            <th>关联任务</th>
            <th>上传时间</th>
            <th>AI 处理状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const Icon = fileTypeIcon(m.fileType)
            return (
              <tr key={m.id} className="dc-row-clickable" onClick={() => onOpenFile("raw", m)}>
                <td>
                  <div className="dc-cell-file">
                    <Icon size={18} className="dc-file-icon" />
                    <div className="dc-tooltip-host">
                      <button
                        type="button"
                        className="dc-file-name-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenFile("raw", m)
                        }}
                      >
                        {m.name}
                      </button>
                      <div className="dc-tooltip">
                        <strong>{m.name}</strong>
                        <p>{m.description}</p>
                        {m.remark && <p className="dc-tooltip-remark">备注：{m.remark}</p>}
                      </div>
                    </div>
                  </div>
                </td>
                <td>{m.type}</td>
                <td className="dc-cell-time">{formatBytes(m.sizeBytes)}</td>
                <td className="dc-cell-task">{m.relatedTasks.map((t) => t.taskName).join("、") || "-"}</td>
                <td className="dc-cell-time">{formatDateTime(m.uploadedAt)}</td>
                <td>
                  <AiStatusBadge status={m.aiStatus} />
                </td>
                <td>
                  <div className="dc-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => onPreview(m)} title="文件预览">
                      <Eye size={16} />
                    </button>
                    <button type="button" title="下载" onClick={() => onDownload(m)}>
                      <Download size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="dc-empty-row">
                没有匹配的原始资料
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ============ 任务成果（按任务聚合）============
/** 任务成果搜索过滤（footer 统计与列表展示共用，按名称/说明/备注/类型/来源阶段匹配） */
function filterResults(results: DataCenterResultDTO[], search: string): DataCenterResultDTO[] {
  if (!search) return results
  const t = search.toLowerCase()
  return results.filter((r) =>
    [r.name, r.description, r.remark, r.type, r.sourceStage].join(" ").toLowerCase().includes(t),
  )
}

function TaskResultsList({
  tasks,
  results,
  expandedTask,
  setExpandedTask,
  onOpenFile,
  onPreview,
  onDownload,
  onViewRelation,
  onOpenPackage,
  search,
}: {
  tasks: DataCenterTaskDTO[]
  results: DataCenterResultDTO[]
  expandedTask: string | null
  setExpandedTask: (taskId: string | null) => void
  onOpenFile: OpenFileHandler
  onPreview: (data: FileData) => void
  onDownload: (file: FileData) => void
  onViewRelation: ViewRelationHandler
  onOpenPackage: (task: DataCenterTaskDTO) => void
  search: string
}) {
  const filteredResults = useMemo(() => filterResults(results, search), [results, search])

  if (tasks.length === 0) {
    return (
      <div className="dc-empty-row" style={{ padding: "48px 0", textAlign: "center" }}>
        暂无数据中心任务。任务可由 agent 改造流程创建，或经 POST /api/v1/data-center/tasks 登记。
      </div>
    )
  }

  return (
    <div className="dc-task-list">
      {tasks.map((task) => {
        const taskResults = filteredResults.filter((r) => r.taskId === task.id)
        const isOpen = expandedTask === task.id
        return (
          <div className={`dc-task-card ${isOpen ? "expanded" : ""}`} key={task.id}>
            <div className="dc-task-card-head" onClick={() => setExpandedTask(isOpen ? null : task.id)}>
              <div className="dc-task-card-info">
                <div className="dc-task-card-title">
                  <Layers size={20} />
                  <h3>{task.name}</h3>
                  <span className="dc-task-type">{task.taskType}</span>
                </div>
                <div className="dc-task-card-meta">
                  <span>创建 {formatDateTime(task.createdAt)}</span>
                  <span>更新 {formatDateTime(task.updatedAt)}</span>
                  <span>成果 {taskResults.length} 项</span>
                  <span className="dc-task-status">{task.status}</span>
                </div>
              </div>
              <div className="dc-task-card-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => onViewRelation(task.id, null)}>
                  <Link2 size={15} /> 查看资料关系
                </button>
                <button type="button" className="dc-btn-primary-ghost" onClick={() => onOpenPackage(task)}>
                  <Package size={15} /> 生成成果包
                </button>
                <ChevronRight size={18} className={`dc-chevron ${isOpen ? "rotated" : ""}`} />
              </div>
            </div>
            {isOpen && (
              <div className="dc-task-card-body">
                <table className="dc-table dc-table-result">
                  <thead>
                    <tr>
                      <th>成果名称</th>
                      <th>成果类型</th>
                      <th>来源阶段</th>
                      <th>版本</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taskResults.map((r) => {
                      const Icon = fileTypeIcon(r.fileType)
                      return (
                        <tr key={r.id} className="dc-row-clickable" onClick={() => onOpenFile("result", r)}>
                          <td>
                            <div className="dc-cell-file">
                              <Icon size={18} className="dc-file-icon" />
                              <div className="dc-tooltip-host">
                                <button
                                  type="button"
                                  className="dc-file-name-btn"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onOpenFile("result", r)
                                  }}
                                >
                                  {r.name}
                                </button>
                                <div className="dc-tooltip">
                                  <strong>{r.name}</strong>
                                  <p>{r.description}</p>
                                  {r.remark && <p className="dc-tooltip-remark">备注：{r.remark}</p>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>{r.type}</td>
                          <td>{r.sourceStage}</td>
                          <td>
                            <span className="dc-version">{r.version}</span>
                            <span className="dc-version-status">{r.versionStatus === "当前版本" ? "当前版本" : ""}</span>
                          </td>
                          <td className="dc-cell-time">{formatDateTime(r.generatedAt)}</td>
                          <td>
                            <div className="dc-row-actions" onClick={(e) => e.stopPropagation()}>
                              <button type="button" onClick={() => onPreview(r)} title="文件预览">
                                <Eye size={16} />
                              </button>
                              <button type="button" title="下载" onClick={() => onDownload(r)}>
                                <Download size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {taskResults.length === 0 && (
                      <tr>
                        <td colSpan={6} className="dc-empty-row">
                          该任务暂无匹配的成果
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
