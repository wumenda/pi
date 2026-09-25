/** 任务成果包弹窗：勾选成果 → POST /data-center/tasks/:id/package 打真实 zip 下载 */
import { useState } from "react"
import { Download } from "lucide-react"
import type { DataCenterResultDTO, DataCenterTaskDTO } from "@platform/shared"
import { downloadResultPackage } from "../../../api/data-center"
import { fileTypeIcon } from "./shared"

interface ResultPackageModalProps {
  task: DataCenterTaskDTO
  /** 该任务的全部成果（父组件已过滤） */
  results: DataCenterResultDTO[]
  onClose: () => void
}

export function ResultPackageModal({ task, results, onClose }: ResultPackageModalProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    results.reduce<Record<string, boolean>>((acc, r) => {
      acc[r.id] = true
      return acc
    }, {}),
  )
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkedIds = results.filter((r) => checked[r.id]).map((r) => r.id)
  const checkedCount = checkedIds.length

  const toggle = (id: string): void => setChecked((c) => ({ ...c, [id]: !c[id] }))

  const handleExport = async (): Promise<void> => {
    if (exporting || checkedCount === 0) return
    setExporting(true)
    setError(null)
    try {
      await downloadResultPackage(task.id, checkedIds, task.name)
    } catch (e) {
      setError(`成果包导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dc-modal-mask" onClick={exporting ? undefined : onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="dc-modal-head">
          <div>
            <h3>生成成果包</h3>
            <p>{task.name} · 选择需要导出的成果</p>
          </div>
          <button type="button" onClick={onClose} className="dc-drawer-close" aria-label="关闭" disabled={exporting}>
            ✕
          </button>
        </header>
        <div className="dc-modal-body">
          {results.length === 0 ? (
            <p className="dc-empty-text">该任务暂无成果可打包</p>
          ) : (
            <ul className="dc-package-list">
              {results.map((r) => {
                const Icon = fileTypeIcon(r.fileType)
                return (
                  <li key={r.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked[r.id] ?? false}
                        onChange={() => toggle(r.id)}
                        disabled={exporting}
                      />
                      <Icon size={16} />
                      <span className="dc-package-name">{r.name}</span>
                      <span className="dc-package-version">{r.version}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {error && <p className="dc-empty-text">{error}</p>}
        </div>
        <footer className="dc-modal-foot">
          <button type="button" onClick={onClose} disabled={exporting}>
            取消
          </button>
          <button
            type="button"
            className="dc-btn-primary-ghost"
            onClick={() => void handleExport()}
            disabled={exporting || checkedCount === 0}
          >
            {exporting ? (
              "打包中…"
            ) : (
              <>
                <Download size={15} /> 导出并下载 zip（{checkedCount} 项）
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
