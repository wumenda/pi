/** 数据中心页面共享的类型与小组件（数据源 = @platform/shared DTO + GET /api/v1/data-center） */
import type { LucideIcon } from "lucide-react"
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  FileBox,
  FileEdit,
  FileSpreadsheet,
  FileText,
  FileImage,
  File as FileIcon,
  LoaderCircle,
} from "lucide-react"
import type { DataCenterMaterialDTO, DataCenterResultDTO } from "@platform/shared"

export type FileKind = "raw" | "result"
export type FileData = DataCenterMaterialDTO | DataCenterResultDTO
export type SelectedFile = { kind: "raw"; data: DataCenterMaterialDTO } | { kind: "result"; data: DataCenterResultDTO }
export type OpenFileHandler = (kind: FileKind, data: FileData) => void
export type ViewRelationHandler = (taskId: string, focusNodeId: string | null) => void

// 文件类型图标
export const fileTypeIcon = (fileType: string): LucideIcon => {
  switch (fileType) {
    case "pdf":
      return FileText
    case "xlsx":
    case "xls":
    case "csv":
      return FileSpreadsheet
    case "html":
      return FileBox
    case "dwg":
      return FileImage
    case "docx":
      return FileText
    default:
      return FileIcon
  }
}

// AI 状态徽标：图标展示，悬停气泡显示状态名 + 说明
const STATUS_META: Record<string, { icon: LucideIcon; cls: string; tip: string }> = {
  未解析: { icon: CircleDashed, cls: "pending", tip: "文件尚未进行 AI 解析" },
  解析中: { icon: LoaderCircle, cls: "running", tip: "AI 正在解析文件内容" },
  已解析: { icon: CircleCheck, cls: "done", tip: "AI 解析完成，可被任务使用" },
  需确认: { icon: CircleAlert, cls: "warn", tip: "解析结果存在待确认项，请查看详情" },
  解析异常: { icon: CircleX, cls: "error", tip: "AI 解析失败，请检查文件后重试" },
  当前版本: { icon: CircleCheck, cls: "done", tip: "当前生效的成果版本" },
  草稿: { icon: FileEdit, cls: "draft", tip: "草稿版本，尚未定稿" },
  已生成: { icon: CircleCheck, cls: "done", tip: "成果已生成" },
}

export function AiStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { icon: CircleDashed, cls: "pending", tip: status }
  const Icon = meta.icon
  return (
    <span className="dc-status-icon-host dc-tooltip-host" aria-label={status}>
      <Icon
        size={18}
        strokeWidth={2.2}
        className={`dc-status-icon dc-status-icon-${meta.cls}${status === "解析中" ? " dc-status-spin" : ""}`}
      />
      <span className="dc-tooltip dc-tooltip-status" role="tooltip">
        <strong>{status}</strong>
        <p>{meta.tip}</p>
      </span>
    </span>
  )
}

// ============ 展示格式化（DTO 为 ISO/字节，展示层转换） ============

/** ISO 8601 → "YYYY-MM-DD HH:mm"（本地时区） */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 字节数 → 展示串（B/KB/MB/GB，1 位小数） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = "B"
  for (const u of units) {
    if (value < 1024) break
    value /= 1024
    unit = u
  }
  return `${value.toFixed(1)} ${unit}`
}

// ============ 筛选选项（UI 配置常量，非业务数据） ============

export const MATERIAL_TYPE_OPTIONS = [
  "PFD", "P&ID", "设计资料", "设备资料", "运行数据", "物性数据", "标准规范", "技术资料", "其他",
] as const

export const RESULT_TYPE_OPTIONS = [
  "诊断报告", "推荐方案", "验证结果", "设备改造方案", "投资概算", "可研报告", "其他",
] as const

export const AI_STATUS_OPTIONS = ["未解析", "解析中", "已解析", "需确认", "解析异常"] as const
