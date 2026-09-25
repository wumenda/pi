/** 上传原始资料对话框：真实文件上传（POST /data-center/materials），含资料类型/说明/备注/关联任务 */
import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import type { DataCenterTaskDTO } from "@platform/shared"
import { uploadDataCenterMaterial } from "../../../api/data-center"
import { MATERIAL_TYPE_OPTIONS } from "./shared"
import { ThemeSelect } from "../../components/ThemeSelect"

interface UploadMaterialDialogProps {
  tasks: DataCenterTaskDTO[]
  onDone: (message: string) => void
  onError: (message: string) => void
  onClose: () => void
}

export function UploadMaterialDialog({ tasks, onDone, onError, onClose }: UploadMaterialDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [type, setType] = useState<string>("其他")
  const [description, setDescription] = useState("")
  const [remark, setRemark] = useState("")
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const toggleTask = (taskId: string): void => {
    setSelectedTaskIds((ids) =>
      ids.includes(taskId) ? ids.filter((id) => id !== taskId) : [...ids, taskId],
    )
  }

  const handleUpload = async (): Promise<void> => {
    if (!file || uploading) return
    setUploading(true)
    try {
      const material = await uploadDataCenterMaterial(file, {
        name: file.name,
        type,
        description: description || undefined,
        remark: remark || undefined,
        taskIds: selectedTaskIds.length > 0 ? selectedTaskIds.join(",") : undefined,
      })
      onDone(`资料「${material.name}」上传成功`)
    } catch (e) {
      onError(`上传失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="dc-modal-mask" onClick={uploading ? undefined : onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="dc-modal-head">
          <div>
            <h3>上传资料</h3>
            <p>文件将保存到平台数据中心（.data/data-center）</p>
          </div>
          <button type="button" onClick={onClose} className="dc-drawer-close" aria-label="关闭" disabled={uploading}>
            ✕
          </button>
        </header>
        <div className="dc-modal-body">
          <div
            className="dc-upload-drop"
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <Upload size={22} />
            <span>{file ? file.name : "点击选择文件"}</span>
            {file && <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>}
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <label className="dc-form-field">
            资料类型
            <ThemeSelect value={type} onChange={setType} options={[...MATERIAL_TYPE_OPTIONS]} ariaLabel="资料类型" />
          </label>

          <label className="dc-form-field">
            文件说明
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="一句话说明资料内容与用途"
            />
          </label>

          <label className="dc-form-field">
            用户备注
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="选填，例如：项目最终确认版、审核状态等"
            />
          </label>

          {tasks.length > 0 && (
            <div className="dc-form-field">
              关联任务
              <div className="dc-form-checks">
                {tasks.map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(t.id)}
                      onChange={() => toggleTask(t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="dc-modal-foot">
          <button type="button" onClick={onClose} disabled={uploading}>
            取消
          </button>
          <button
            type="button"
            className="dc-btn-primary-ghost"
            onClick={() => void handleUpload()}
            disabled={!file || uploading}
          >
            {uploading ? "上传中…" : "上传"}
          </button>
        </footer>
      </div>
    </div>
  )
}
