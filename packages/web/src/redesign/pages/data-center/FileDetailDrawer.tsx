/** 文件详情抽屉（原始资料 / 任务成果两种形态）：编辑说明/备注持久化到 PATCH /data-center/materials/:id */
import { useEffect, useState } from "react"
import { ChevronRight, Pencil, Sparkles } from "lucide-react"
import type { DataCenterResultDTO, DataCenterTaskDTO } from "@platform/shared"
import { updateDataCenterMaterial } from "../../../api/data-center"
import { fileTypeIcon, AiStatusBadge, formatBytes, formatDateTime } from "./shared"
import type { SelectedFile, ViewRelationHandler } from "./shared"

type FileDetailDrawerProps = {
  file: SelectedFile
  tasks: DataCenterTaskDTO[]
  results: DataCenterResultDTO[]
  onClose: () => void
  onViewRelation: ViewRelationHandler
  /** 编辑持久化成功后回调（父组件刷新数据） */
  onSaved: (message: string) => void
}

export function FileDetailDrawer({ file, tasks, results, onClose, onViewRelation, onSaved }: FileDetailDrawerProps) {
  const { kind, data } = file
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingRemark, setEditingRemark] = useState(false)
  const [desc, setDesc] = useState(data.description || "")
  const [remark, setRemark] = useState(data.remark || "")
  const [saving, setSaving] = useState(false)

  // 切换到另一个文件时同步编辑态
  useEffect(() => {
    setDesc(data.description || "")
    setRemark(data.remark || "")
    setEditingDesc(false)
    setEditingRemark(false)
  }, [data])

  const isRaw = kind === "raw"

  /** 持久化编辑（原始资料走 PATCH；成果仅本地展示，编辑入口为原始资料主链路） */
  const saveField = async (field: "description" | "remark"): Promise<void> => {
    if (kind !== "raw") return
    const value = field === "description" ? desc : remark
    setSaving(true)
    try {
      await updateDataCenterMaterial(data.id, { [field]: value })
      setEditingDesc(false)
      setEditingRemark(false)
      onSaved(`${data.name} ${field === "description" ? "文件说明" : "用户备注"}已保存`)
    } catch (e) {
      onSaved(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dc-drawer-mask" onClick={onClose}>
      <aside className="dc-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="dc-drawer-head">
          <div className="dc-drawer-title">
            {(() => {
              const Icon = fileTypeIcon(data.fileType)
              return <Icon size={22} className="dc-file-icon-lg" />
            })()}
            <div>
              <h3>{data.name}</h3>
              <span className="dc-drawer-sub">
                {isRaw ? "原始资料" : "任务成果"} · {formatBytes(data.sizeBytes)}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="dc-drawer-close" aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="dc-drawer-body">
          {/* 基本信息 */}
          <section className="dc-drawer-section">
            <h4>基本信息</h4>
            <dl className="dc-info-grid">
              <div>
                <dt>文件类型</dt>
                <dd>{data.type}</dd>
              </div>
              <div>
                <dt>文件大小</dt>
                <dd>{formatBytes(data.sizeBytes)}</dd>
              </div>
              <div>
                <dt>{isRaw ? "上传时间" : "生成时间"}</dt>
                <dd>{formatDateTime(isRaw ? data.uploadedAt : data.generatedAt)}</dd>
              </div>
              <div>
                <dt>{isRaw ? "上传人" : "当前版本"}</dt>
                <dd>{isRaw ? data.uploader : `${data.version} · ${data.versionStatus}`}</dd>
              </div>
              {isRaw && (
                <div>
                  <dt>AI 处理状态</dt>
                  <dd>
                    <AiStatusBadge status={data.aiStatus} />
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* 文件说明 */}
          <section className="dc-drawer-section">
            <div className="dc-drawer-section-head">
              <h4>文件说明</h4>
              {isRaw ? (
                <button
                  type="button"
                  className="dc-edit-btn"
                  disabled={saving}
                  onClick={() => {
                    if (editingDesc) void saveField("description")
                    else setEditingDesc(true)
                  }}
                >
                  <Pencil size={13} /> {editingDesc ? (saving ? "保存中…" : "完成") : "编辑"}
                </button>
              ) : (
                <span className="dc-ai-hint">
                  <Sparkles size={13} /> 任务生成
                </span>
              )}
            </div>
            {editingDesc ? (
              <textarea className="dc-edit-area" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
            ) : (
              <p className="dc-desc-text">{desc}</p>
            )}
          </section>

          {/* 用户备注 */}
          <section className="dc-drawer-section">
            <div className="dc-drawer-section-head">
              <h4>用户备注</h4>
              {isRaw && (
                <button
                  type="button"
                  className="dc-edit-btn"
                  disabled={saving}
                  onClick={() => {
                    if (editingRemark) void saveField("remark")
                    else setEditingRemark(true)
                  }}
                >
                  <Pencil size={13} /> {editingRemark ? (saving ? "保存中…" : "完成") : "编辑"}
                </button>
              )}
            </div>
            {editingRemark ? (
              <textarea
                className="dc-edit-area"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={2}
                placeholder="补充人工备注，例如：项目最终确认版、审核状态等"
              />
            ) : (
              <p className="dc-desc-text">{remark || <span className="dc-empty-text">暂无备注，点击编辑补充</span>}</p>
            )}
          </section>

          {/* 原始资料：AI 解析结果 */}
          {isRaw && data.aiParseResult && (
            <section className="dc-drawer-section">
              <h4>AI 解析结果</h4>
              <div className="dc-parse-metrics">
                {data.aiParseResult.metrics.map((m) => (
                  <div className="dc-parse-metric" key={m.label}>
                    <span className="dc-parse-value">{m.value}</span>
                    <span className="dc-parse-label">{m.label}</span>
                  </div>
                ))}
              </div>
              {data.aiParseResult.notes && <p className="dc-desc-text">{data.aiParseResult.notes}</p>}
            </section>
          )}

          {/* 关联任务 / 所属任务 */}
          <section className="dc-drawer-section">
            <h4>{isRaw ? "关联任务" : "所属任务"}</h4>
            {isRaw ? (
              data.relatedTasks.length > 0 ? (
                data.relatedTasks.map((t) => (
                  <div className="dc-related-task" key={t.taskId}>
                    <div>
                      <strong>{t.taskName}</strong>
                      {t.usedIn.length > 0 && <span>用于：{t.usedIn.join("、")}</span>}
                    </div>
                    <button
                      type="button"
                      className="dc-link-btn"
                      onClick={() => {
                        onClose()
                        onViewRelation(t.taskId, `g-${data.id}`)
                      }}
                    >
                      查看资料关系 <ChevronRight size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="dc-empty-text">未关联任务（上传时可选择关联）</p>
              )
            ) : (
              <div className="dc-related-task">
                <div>
                  <strong>{tasks.find((t) => t.id === data.taskId)?.name ?? data.taskId}</strong>
                  <span>来源阶段：{data.sourceStage}</span>
                </div>
                <button
                  type="button"
                  className="dc-link-btn"
                  onClick={() => {
                    onClose()
                    onViewRelation(data.taskId, `g-${data.id}`)
                  }}
                >
                  查看资料关系 <ChevronRight size={14} />
                </button>
              </div>
            )}
          </section>

          {/* 原始资料：使用记录 */}
          {isRaw && (
            <section className="dc-drawer-section">
              <h4>使用记录</h4>
              {data.usageRecords.length ? (
                <ul className="dc-usage-list">
                  {data.usageRecords.map((rec, i) => (
                    <li key={i}>
                      <span className="dc-usage-time">{formatDateTime(rec.time)}</span>
                      <span className="dc-usage-task">{rec.taskName}</span>
                      <span className="dc-usage-stage">{rec.stage}</span>
                      <span className="dc-usage-action">{rec.action}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dc-empty-text">暂未在任务中使用</p>
              )}
            </section>
          )}

          {/* 任务成果：关联成果 + 版本记录 */}
          {!isRaw && (
            <>
              {data.relatedResults.length > 0 && (
                <section className="dc-drawer-section">
                  <h4>关联成果</h4>
                  <div className="dc-related-results">
                    {data.relatedResults.map((rid) => {
                      const related = results.find((r) => r.id === rid)
                      if (!related) return null
                      const Icon = fileTypeIcon(related.fileType)
                      return (
                        <span className="dc-related-result-chip" key={rid}>
                          <Icon size={14} /> {related.name}
                        </span>
                      )
                    })}
                  </div>
                </section>
              )}
              <section className="dc-drawer-section">
                <h4>版本记录</h4>
                <ul className="dc-version-list">
                  {data.versions.map((v) => (
                    <li key={v.version} className={v.status === "当前版本" ? "current" : ""}>
                      <span className="dc-version-tag">{v.version}</span>
                      <span className="dc-version-status-text">{v.status}</span>
                      <span className="dc-version-time">{formatDateTime(v.time)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
