/** 复刻：资料详情抽屉，对应原型 components/KnowledgeBase/KnowledgeDetailDrawer.jsx */
import { useEffect, useRef, useState } from "react"
import {
  X,
  BookOpen,
  FileText,
  Building2,
  Calendar,
  Hash,
  Tag,
  FolderTree,
  Type,
  CheckCircle2,
  ExternalLink,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { getPlatformKnowledgeItemById } from "../../data/knowledge"
import { useDrawerBehavior } from "./KnowledgePage"
import type { KnowledgeItem } from "./KnowledgePage"

const fieldIcons: Record<string, LucideIcon> = {
  author: Building2,
  publisher: FileText,
  year: Calendar,
  isbn: Hash,
  standardNo: Hash,
  category: FolderTree,
  type: Type,
  status: CheckCircle2,
  keywords: Tag,
}

function formatValue(value: string | undefined | null): string {
  if (value == null || value === "") return "-"
  return value
}

interface DetailField {
  key: string
  label: string
  value: string
}

export function KnowledgeDetailDrawer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  useDrawerBehavior(onClose)
  const [toast, setToast] = useState("")

  const item = getPlatformKnowledgeItemById(itemId) as KnowledgeItem | undefined

  // 切换资料时重置 toast 计时器引用的依赖（保持与原型一致的简单实现）
  const toastTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  if (!item) return null

  const keywords = item.keywords || []

  function handleViewOriginal(): void {
    setToast("原文预览即将开放，敬请期待")
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(""), 2500)
  }

  const detailFields: DetailField[] = [
    { key: "author", label: "作者 / 编制单位", value: formatValue(item.author) },
    { key: "publisher", label: "出版社 / 发布机构", value: formatValue(item.publisher) },
    { key: "year", label: "年份", value: formatValue(item.year) },
    { key: "isbn", label: "ISBN / 标准号", value: formatValue(item.standardNo || item.isbn) },
    { key: "type", label: "资料类型", value: formatValue(item.type) },
    { key: "source", label: "来源", value: formatValue(item.source) },
    { key: "status", label: "状态", value: formatValue(item.status) },
    { key: "category", label: "所属分类", value: formatValue(item.knowledgeCategory) },
  ]

  return (
    <div className="kb-drawer-overlay" onClick={onClose}>
      <aside className="kb-drawer" onClick={(e) => e.stopPropagation()}>
        {/* 抽屉头 */}
        <header className="kb-drawer-header">
          <div className="kb-drawer-icon">
            <BookOpen size={24} />
          </div>
          <div className="kb-drawer-title-area">
            <h2 className="kb-drawer-title">{item.title}</h2>
            <p className="kb-drawer-desc">{item.description}</p>
          </div>
          <button type="button" className="kb-drawer-close" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        {/* 抽屉内容 */}
        <div className="kb-drawer-body">
          {/* 基本信息字段 */}
          <section className="kb-detail-section">
            <h3 className="kb-detail-section-title">基本信息</h3>
            <div className="kb-detail-grid">
              {detailFields.map((field) => {
                const Icon = fieldIcons[field.key] || FileText
                const isEmpty = field.value === "-"
                return (
                  <div className="kb-detail-field" key={field.key}>
                    <span className="kb-detail-field-label">
                      <Icon size={14} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
                      {field.label}
                    </span>
                    <span className={`kb-detail-field-value ${isEmpty ? "empty" : ""}`}>
                      {field.value}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 关键词 */}
          {keywords.length > 0 && (
            <section className="kb-detail-section">
              <h3 className="kb-detail-section-title">关键词</h3>
              <div className="kb-detail-keywords">
                {keywords.map((kw) => (
                  <span key={kw} className="kb-detail-keyword">{kw}</span>
                ))}
              </div>
            </section>
          )}

          {/* 操作 */}
          <div className="kb-detail-actions">
            <button type="button" className="kb-btn kb-btn-primary" onClick={handleViewOriginal}>
              <ExternalLink size={16} />
              查看原文
            </button>
          </div>
        </div>

        {toast && <div className="kb-toast" role="status" aria-live="polite">{toast}</div>}
      </aside>
    </div>
  )
}
