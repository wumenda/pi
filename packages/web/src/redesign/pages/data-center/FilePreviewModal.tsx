/** 文件预览弹窗：真实文件内容（inline 文件流）。pdf/html/图片内嵌预览；其余类型提示下载。 */
import type { ReactNode } from "react"
import { Download } from "lucide-react"
import { dataCenterFileUrl, downloadDataCenterFile } from "../../../api/data-center"
import { fileTypeIcon, formatBytes } from "./shared"
import type { FileData } from "./shared"

const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"])

// 根据文件扩展名选择真实预览方式
export function FilePreviewModal({ data, onClose }: { data: FileData; onClose: () => void }) {
  const Icon = fileTypeIcon(data.fileType)
  const inlineUrl = dataCenterFileUrl(data.id, "inline")

  return (
    <div className="dc-modal-mask dc-preview-mask" onClick={onClose}>
      <div className="dc-preview" onClick={(e) => e.stopPropagation()}>
        <header className="dc-preview-head">
          <div className="dc-preview-title">
            <Icon size={22} className="dc-file-icon" />
            <div>
              <h3>{data.name}</h3>
              <span>
                {data.type} · {formatBytes(data.sizeBytes)} · {data.fileType.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="dc-preview-actions">
            <button type="button" onClick={() => downloadDataCenterFile(data.id, data.name)} title="下载">
              <Download size={18} />
            </button>
            <button type="button" onClick={onClose} className="dc-drawer-close" aria-label="关闭">
              ✕
            </button>
          </div>
        </header>
        <div className="dc-preview-body">{renderPreview(data, inlineUrl)}</div>
      </div>
    </div>
  )
}

function renderPreview(data: FileData, inlineUrl: string): ReactNode {
  // pdf：浏览器原生内嵌预览
  if (data.fileType === "pdf") {
    return <iframe src={inlineUrl} title={data.name} className="dc-preview-frame" />
  }
  // html：沙箱内嵌（脚本可运行，隔离站点访问）
  if (data.fileType === "html" || data.fileType === "htm") {
    return <iframe src={inlineUrl} title={data.name} className="dc-preview-frame" sandbox="allow-same-origin" />
  }
  // 图片：直接内嵌
  if (IMAGE_TYPES.has(data.fileType)) {
    return <img src={inlineUrl} alt={data.name} className="dc-preview-image" />
  }
  // 其余类型（xlsx/dwg/docx 等浏览器无法内嵌渲染）：如实提示
  return (
    <div className="dc-doc-preview">
      <div className="dc-preview-doc-paper">
        <h2 className="dc-preview-doc-title">{data.name}</h2>
        <p className="dc-preview-doc-sub">
          {data.type} · {formatBytes(data.sizeBytes)}
        </p>
        <div className="dc-preview-doc-content">
          <p>
            {data.fileType.toUpperCase()} 格式暂不支持在线预览，请下载后使用本地工具查看。
            {data.description && <span> 文件说明：{data.description}</span>}
          </p>
        </div>
      </div>
    </div>
  )
}
