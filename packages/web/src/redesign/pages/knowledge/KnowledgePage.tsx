/** 复刻：知识库页面，对应原型 components/KnowledgeBase/KnowledgeBasePage.jsx，基准截图 10/11 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import {
  Search,
  BookOpen,
  Lock,
  ArrowRight,
  ChevronRight,
  FlaskConical,
  Settings,
  Wrench,
  Droplets,
  ScrollText,
  FileStack,
  Users,
  Plus,
  Upload,
  X,
  Settings2,
  Trash2,
  FileText,
  Briefcase,
  Cog,
  Activity,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ThemeSelect } from "../../components/ThemeSelect"
import {
  platformKnowledgeCategories,
  platformSubCatalogs,
  getPlatformCategoryCount,
  getSubCatalogCount,
  getKnowledgeCategoryTotal,
  searchPlatformKnowledge,
  defaultEnterpriseCategories,
  enterpriseKnowledgeTypeCards,
  enterpriseKnowledgeItems,
  searchEnterpriseKnowledge,
  getEnterpriseCategoryCount,
} from "../../data/knowledge"
import { KnowledgeDetailDrawer } from "./KnowledgeDetailDrawer"

// ==================== 类型（data/knowledge.ts 结构） ====================

export interface PlatformCategory {
  id: string
  name: string
  description: string
  tags?: string[]
  locked?: boolean
  countOverride?: number
  unit?: string
  supplement?: string
  dataSource?: string
}

export interface SubCatalog {
  id: string
  name: string
}

export interface KnowledgeItem {
  id: string
  title: string
  category: string
  knowledgeCategory: string
  type: string
  description: string
  source: string
  status: string
  author?: string
  publisher?: string
  year?: string
  isbn?: string
  standardNo?: string
  standardLevel?: string
  keywords?: string[]
}

export interface EnterpriseCategory {
  id: string
  name: string
  description?: string
  isPreset: boolean
  enabled: boolean
  sortOrder: number
}

export interface EnterpriseTypeCard {
  id: string
  name: string
  description: string
  examples: string[]
}

export interface EnterpriseItem {
  id: string
  title: string
  categoryId: string
  categoryName: string
  description: string
  source?: string
  tags?: string[]
  fileName?: string
  status: string
  createdAt?: string
  updatedAt?: string
}

export interface NewKnowledgeData {
  title: string
  categoryId: string
  categoryName: string
  description: string
  source: string
  tags: string[]
  fileName: string
  status: string
  createdAt: string
  updatedAt: string
}

// 数据断言（原型数据文件为 @ts-nocheck 转置，此处补齐类型）
const categories = platformKnowledgeCategories as PlatformCategory[]
const subCatalogsMap = platformSubCatalogs as Record<string, SubCatalog[]>
const typeCards = enterpriseKnowledgeTypeCards as EnterpriseTypeCard[]

// 一级分类图标映射
const categoryIconMap: Record<string, LucideIcon> = {
  "process-design": FlaskConical,
  "equipment-design": Wrench,
  "utility": Droplets,
  "standards": ScrollText,
  "case-library": FileStack,
  "expert-experience": Users,
}

// 企业知识类型图标映射
const enterpriseTypeIconMap: Record<string, LucideIcon> = {
  "ent-std": Briefcase,
  "ent-design-rule": Cog,
  "ent-operation": Activity,
  "ent-engineering": FileStack,
}

// 资料图标（图书/标准）
function getKnowledgeItemIcon(item: KnowledgeItem): LucideIcon {
  if (item.standardNo || item.source === "标准" || item.source === "国际标准") {
    return ScrollText
  }
  return BookOpen
}

// 日期格式化（YYYY-MM-DD）
function getTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date())
}

// Drawer 通用行为：Escape 关闭 + 锁定背景滚动
export function useDrawerBehavior(onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onCloseRef.current()
    }
    document.addEventListener("keydown", handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [])
}

// ==================== 平台知识首页 ====================
function PlatformKnowledgeHome({
  onEnterCategory,
  globalSearch,
  setGlobalSearch,
}: {
  onEnterCategory: (categoryId: string) => void
  globalSearch: string
  setGlobalSearch: (value: string) => void
}) {
  return (
    <div className="kb-page-inner">
      {/* 全局搜索 */}
      <div className="kb-global-search">
        <div className="kb-search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="搜索知识库（支持资料名称、关键词、标准号等）"
            aria-label="搜索知识库"
            autoComplete="off"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
      </div>

      {/* 6 张知识卡片 */}
      <section className="kb-card-grid">
        {categories.map((cat) => {
          const Icon = categoryIconMap[cat.id] || BookOpen
          const count = getPlatformCategoryCount(cat.id) as number
          const unit = cat.unit || "份资料"

          if (cat.locked) {
            return (
              <article key={cat.id} className="kb-category-card locked">
                <div className="kb-card-header">
                  <div className="kb-card-icon"><Icon size={22} /></div>
                  <span className="kb-card-title">{cat.name}</span>
                  <Lock size={16} style={{ color: "#b88820", marginLeft: "auto" }} />
                </div>
                <div className="kb-card-count">
                  {count}
                  <span className="kb-card-count-unit">{unit}</span>
                </div>
                <p className="kb-card-desc">{cat.description}</p>
                {cat.supplement && (
                  <div className="kb-card-supplement">{cat.supplement}</div>
                )}
                {cat.dataSource && (
                  <div className="kb-card-supplement">数据来源：{cat.dataSource}</div>
                )}
                <div className="kb-card-locked-note">
                  <Lock size={12} />
                  系统内部知识 · 不支持直接查看
                </div>
              </article>
            )
          }

          return (
            <button
              type="button"
              key={cat.id}
              className="kb-category-card"
              onClick={() => onEnterCategory(cat.id)}
            >
              <div className="kb-card-header">
                <div className="kb-card-icon"><Icon size={22} /></div>
                <span className="kb-card-title">{cat.name}</span>
              </div>
              <div className="kb-card-count">
                {count}
                <span className="kb-card-count-unit">{unit}</span>
              </div>
              <p className="kb-card-desc">{cat.description}</p>
              <div className="kb-card-tags">
                {(cat.tags || []).map((tag) => (
                  <span key={tag} className="kb-card-tag">{tag}</span>
                ))}
              </div>
              <div className="kb-card-action">
                <span className="kb-card-enter">
                  进入浏览 <ArrowRight size={14} />
                </span>
              </div>
            </button>
          )
        })}
      </section>
    </div>
  )
}

// ==================== 二级知识页面 ====================
function KnowledgeCategoryPage({
  categoryId,
  onBack,
  onOpenItem,
}: {
  categoryId: string
  onBack: () => void
  onOpenItem: (itemId: string) => void
}) {
  const category = categories.find((c) => c.id === categoryId)
  const subCatalogs = subCatalogsMap[categoryId] || []
  const [activeCatalog, setActiveCatalog] = useState(subCatalogs[0]?.id || "")
  const [search, setSearch] = useState("")

  const filteredItems = useMemo(() => {
    let result = searchPlatformKnowledge(search, categoryId) as KnowledgeItem[]
    if (activeCatalog && activeCatalog !== "all") {
      result = result.filter((item) => item.category === activeCatalog)
    }
    return result
  }, [search, activeCatalog, categoryId])

  if (!category) return null

  return (
    <div className="kb-secondary-page">
      {/* 面包屑 + 标题 + 搜索合并为紧凑头部块 */}
      <div className="kb-secondary-header-block">
        <nav className="kb-breadcrumb" aria-label="面包屑">
          <button type="button" className="kb-breadcrumb-link" onClick={onBack}>
            知识库
          </button>
          <ChevronRight size={14} className="kb-breadcrumb-sep" aria-hidden="true" />
          <span className="kb-breadcrumb-current">{category.name}</span>
        </nav>
        <header className="kb-secondary-header">
          <div className="kb-secondary-header-text">
            <h2 className="kb-secondary-title">{category.name}</h2>
            <p className="kb-secondary-desc">{category.description}</p>
          </div>
          <div className="kb-secondary-search-inline">
            <div className="kb-search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="搜索资料名称、关键词、标准号……"
                aria-label="搜索资料"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </header>
      </div>

      {/* 左侧目录 + 右侧列表 */}
      <div className="kb-secondary-body">
        <aside className="kb-catalog">
          <div className="kb-catalog-title">目录</div>
          <div className="kb-catalog-list">
            <button
              type="button"
              className={`kb-catalog-item ${activeCatalog === "all" ? "active" : ""}`}
              onClick={() => setActiveCatalog("all")}
            >
              <span className="kb-catalog-item-name">全部</span>
              <span className="kb-catalog-item-count">
                {getKnowledgeCategoryTotal(categoryId) as number}
              </span>
            </button>
            {subCatalogs.map((sub) => {
              const subCount = getSubCatalogCount(categoryId, sub.id) as number
              const isEmpty = subCount === 0
              return (
                <button
                  key={sub.id}
                  type="button"
                  className={`kb-catalog-item ${activeCatalog === sub.id ? "active" : ""} ${isEmpty ? "empty" : ""}`}
                  onClick={() => setActiveCatalog(sub.id)}
                >
                  <span className="kb-catalog-item-name">{sub.name}</span>
                  <span className="kb-catalog-item-count">{subCount}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="kb-list-area">
          <div className="kb-list-header">
            <div className="kb-list-count">
              共 <strong>{filteredItems.length}</strong> 份资料
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="kb-empty-list">
              <Search size={40} />
              <p>未找到匹配的资料</p>
              <span>尝试更换关键词或调整筛选条件</span>
            </div>
          ) : (
            <div className="kb-list">
              {filteredItems.map((item) => {
                const ItemIcon = getKnowledgeItemIcon(item)
                return (
                  <div key={item.id} className="kb-list-item">
                    <div className="kb-list-item-icon">
                      <ItemIcon size={20} />
                    </div>
                    <div className="kb-list-item-body">
                      <span className="kb-list-item-title">{item.title}</span>
                      <span className="kb-list-item-desc">{item.description}</span>
                    </div>
                    <div className="kb-list-item-meta">
                      <span className="kb-list-item-type">{item.type}</span>
                      <span className="kb-list-item-source">{item.source}</span>
                      <span className={`kb-list-item-status ${item.status === "已收录" || item.status === "现行" ? "published" : ""}`}>
                        {item.status}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="kb-list-item-action"
                      onClick={() => onOpenItem(item.id)}
                    >
                      进入查看 <ArrowRight size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== 企业知识页面 ====================
function EnterpriseKnowledgePage({
  items,
  categories: entCategories,
  onAddKnowledge,
  onManageCategories,
  onToggleStatus,
}: {
  items: EnterpriseItem[]
  categories: EnterpriseCategory[]
  onAddKnowledge: () => void
  onManageCategories: () => void
  onToggleStatus: (itemId: string) => void
}) {
  const [search, setSearch] = useState("")
  const [activeCat, setActiveCat] = useState("all")
  const [detailItemId, setDetailItemId] = useState<string | null>(null)

  const detailItem = detailItemId ? items.find((it) => it.id === detailItemId) : null

  const filteredItems = useMemo(() => {
    let result = searchEnterpriseKnowledge(search, items) as EnterpriseItem[]
    if (activeCat !== "all") {
      result = result.filter((item) => item.categoryId === activeCat)
    }
    return result
  }, [search, activeCat, items])

  const hasData = items.length > 0

  // 空状态
  if (!hasData) {
    return (
      <div className="kb-enterprise-page">
        <header className="kb-enterprise-header">
          <div className="kb-enterprise-header-left">
            <h2>企业知识</h2>
            <p>沉淀企业内部标准、设计规定、运行经验和工程经验，供智能分析与方案生成时参考。</p>
          </div>
          <button type="button" className="kb-add-btn" onClick={onAddKnowledge}>
            <Plus size={18} />
            添加知识
          </button>
        </header>

        <div className="kb-enterprise-empty">
          <div className="kb-empty-illustration">
            <BookOpen size={48} />
          </div>
          <h3 className="kb-empty-title">暂无企业知识</h3>
          <p className="kb-empty-desc">
            可添加企业内部标准、设计规定、运行经验和工程经验，建立企业专属知识库。
          </p>
          <button type="button" className="kb-empty-add-btn" onClick={onAddKnowledge}>
            <Plus size={20} />
            添加第一条知识
          </button>

          {/* 推荐知识类型 */}
          <div className="kb-recommend-section">
            <h3 className="kb-recommend-title">推荐知识类型</h3>
            <div className="kb-recommend-grid">
              {typeCards.map((card) => {
                const Icon = enterpriseTypeIconMap[card.id] || BookOpen
                return (
                  <div key={card.id} className="kb-recommend-card">
                    <div className="kb-recommend-icon"><Icon size={20} /></div>
                    <span className="kb-recommend-name">{card.name}</span>
                    <span className="kb-recommend-desc">{card.description}</span>
                    <div className="kb-recommend-examples">
                      {card.examples.map((ex) => (
                        <span key={ex} className="kb-recommend-example">
                          <ChevronRight size={12} />
                          {ex}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 有数据后的列表状态
  return (
    <div className="kb-enterprise-page">
      <header className="kb-enterprise-header">
        <div className="kb-enterprise-header-left">
          <h2>企业知识</h2>
          <p>沉淀企业内部标准、设计规定、运行经验和工程经验，供智能分析与方案生成时参考。</p>
        </div>
        <button type="button" className="kb-add-btn" onClick={onAddKnowledge}>
          <Plus size={18} />
          添加知识
        </button>
      </header>

      <div className="kb-enterprise-toolbar">
        <div className="kb-search-box kb-enterprise-search">
          <Search size={18} />
          <input
            type="text"
            placeholder="搜索企业知识……"
            aria-label="搜索企业知识"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="kb-category-manage-btn" onClick={onManageCategories}>
          <Settings2 size={16} />
          管理分类
        </button>
      </div>

      <div className="kb-enterprise-cats">
        <button
          type="button"
          className={`kb-cat-chip ${activeCat === "all" ? "active" : ""}`}
          onClick={() => setActiveCat("all")}
          title="显示所有分类的企业知识"
        >
          全部
          <span className="kb-cat-chip-count">{getEnterpriseCategoryCount("all", items) as number}</span>
        </button>
        {entCategories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`kb-cat-chip ${activeCat === cat.id ? "active" : ""}`}
            onClick={() => setActiveCat(cat.id)}
            title={cat.description || cat.name}
          >
            {cat.name}
            <span className="kb-cat-chip-count">{getEnterpriseCategoryCount(cat.id, items) as number}</span>
          </button>
        ))}
      </div>

      <div className="kb-enterprise-list">
        {filteredItems.length === 0 ? (
          <div className="kb-empty-list">
            <Search size={40} />
            <p>未找到匹配的知识</p>
            <span>尝试更换关键词或调整筛选条件</span>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div key={item.id} className="kb-list-item">
              <div className="kb-list-item-icon">
                <FileText size={20} />
              </div>
              <div className="kb-list-item-body">
                <span className="kb-list-item-title">{item.title}</span>
                <span className="kb-list-item-desc">{item.description}</span>
              </div>
              <div className="kb-list-item-meta">
                <span className="kb-list-item-type">{item.categoryName}</span>
                <span className="kb-list-item-source">{item.source}</span>
                <span className={`kb-list-item-status ${item.status}`}>
                  {item.status === "enabled" ? "已启用" : "已停用"}
                </span>
              </div>
              <button
                type="button"
                className="kb-list-item-action"
                onClick={() => setDetailItemId(item.id)}
              >
                查看 <ArrowRight size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* 企业知识详情 Drawer（复用平台知识样式） */}
      {detailItem && (
        <EnterpriseKnowledgeDetailDrawer
          item={detailItem}
          onClose={() => setDetailItemId(null)}
          onToggleStatus={onToggleStatus}
        />
      )}
    </div>
  )
}

// 企业知识详情 Drawer
function EnterpriseKnowledgeDetailDrawer({
  item,
  onClose,
  onToggleStatus,
}: {
  item: EnterpriseItem
  onClose: () => void
  onToggleStatus?: (itemId: string) => void
}) {
  useDrawerBehavior(onClose)
  const detailFields = [
    { label: "知识名称", value: item.title },
    { label: "知识类型", value: item.categoryName },
    { label: "来源", value: item.source || "-" },
    { label: "上传文件", value: item.fileName || "-" },
    { label: "创建时间", value: item.createdAt || "-" },
    { label: "更新时间", value: item.updatedAt || "-" },
  ]

  return (
    <div className="kb-drawer-overlay" onClick={onClose}>
      <aside className="kb-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="kb-drawer-header">
          <div className="kb-drawer-icon">
            <FileText size={24} />
          </div>
          <div className="kb-drawer-title-area">
            <h2 className="kb-drawer-title">{item.title}</h2>
            <p className="kb-drawer-desc">{item.description || "-"}</p>
          </div>
          <button type="button" className="kb-drawer-close" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        <div className="kb-drawer-body">
          <section className="kb-detail-section">
            <h3 className="kb-detail-section-title">基本信息</h3>
            <div className="kb-detail-grid">
              {detailFields.map((field) => (
                <div className="kb-detail-field" key={field.label}>
                  <span className="kb-detail-field-label">{field.label}</span>
                  <span className={`kb-detail-field-value ${field.value === "-" ? "empty" : ""}`}>
                    {field.value}
                  </span>
                </div>
              ))}
              {/* 状态字段使用内联开关 */}
              <div className="kb-detail-field">
                <span className="kb-detail-field-label">状态</span>
                <div className="kb-status-switch-row">
                  {onToggleStatus ? (
                    <button
                      type="button"
                      className={`kb-status-toggle ${item.status === "enabled" ? "on" : "off"}`}
                      onClick={() => onToggleStatus(item.id)}
                      aria-label={item.status === "enabled" ? "停用" : "启用"}
                    >
                      <span className="kb-status-toggle-track" />
                      <span className="kb-status-toggle-thumb" />
                    </button>
                  ) : null}
                  <span className={`kb-status-label ${item.status}`}>
                    {item.status === "enabled" ? "已启用" : "已停用"}
                  </span>
                </div>
              </div>
            </div>
          </section>
          {item.tags && item.tags.length > 0 && (
            <section className="kb-detail-section">
              <h3 className="kb-detail-section-title">标签</h3>
              <div className="kb-detail-keywords">
                {item.tags.map((kw) => (
                  <span key={kw} className="kb-detail-keyword">{kw}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}

// ==================== 添加知识 Drawer ====================
function AddKnowledgeDrawer({
  categories: entCategories,
  onClose,
  onSubmit,
}: {
  categories: EnterpriseCategory[]
  onClose: () => void
  onSubmit: (data: NewKnowledgeData) => void
}) {
  useDrawerBehavior(onClose)
  const [title, setTitle] = useState("")
  const [categoryId, setCategoryId] = useState(entCategories[0]?.id || "")
  const [description, setDescription] = useState("")
  const [source, setSource] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [fileName, setFileName] = useState("")
  const [toast, setToast] = useState("")

  function showToast(message: string): void {
    setToast(message)
    setTimeout(() => setToast(""), 2500)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) setFileName(file.name)
  }

  function addTag(): void {
    const val = tagInput.trim()
    if (val && !tags.includes(val)) {
      setTags([...tags, val])
    }
    setTagInput("")
  }

  function removeTag(tag: string): void {
    setTags(tags.filter((t) => t !== tag))
  }

  function handleSubmit(): void {
    if (!title.trim()) {
      showToast("请填写知识名称")
      return
    }
    if (!categoryId) {
      showToast("请选择知识类型")
      return
    }
    onSubmit({
      title: title.trim(),
      categoryId,
      categoryName: entCategories.find((c) => c.id === categoryId)?.name || "",
      description: description.trim(),
      source: source.trim(),
      tags,
      fileName,
      status: "enabled",
      createdAt: getTodayStr(),
      updatedAt: getTodayStr(),
    })
  }

  return (
    <div className="kb-drawer-overlay" onClick={onClose}>
      <aside className="kb-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="kb-drawer-header">
          <div className="kb-drawer-icon">
            <Plus size={24} />
          </div>
          <div className="kb-drawer-title-area">
            <h2 className="kb-drawer-title">添加知识</h2>
            <p className="kb-drawer-desc">添加企业内部标准、设计规定、运行经验或工程经验</p>
          </div>
          <button type="button" className="kb-drawer-close" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        <div className="kb-drawer-body">
          {/* 知识名称 */}
          <div className="kb-form-group">
            <label className="kb-form-label" htmlFor="kb-add-title">
              知识名称 <span className="kb-form-required" aria-hidden="true">*</span>
            </label>
            <input
              id="kb-add-title"
              type="text"
              className="kb-form-input"
              placeholder="请输入知识名称"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* 知识类型 */}
          <div className="kb-form-group">
            <label className="kb-form-label" htmlFor="kb-add-type">
              知识类型 <span className="kb-form-required" aria-hidden="true">*</span>
            </label>
            <ThemeSelect
              id="kb-add-type"
              value={categoryId}
              onChange={setCategoryId}
              options={entCategories.map((cat) => ({ value: cat.id, label: cat.name }))}
              ariaLabel="知识类型"
            />
          </div>

          {/* 上传文件 */}
          <div className="kb-form-group">
            <label className="kb-form-label" htmlFor="kb-add-file">
              上传文件 <span className="kb-form-required" aria-hidden="true">*</span>
            </label>
            <label className="kb-form-upload">
              <input
                id="kb-add-file"
                type="file"
                className="kb-visually-hidden"
                onChange={handleFileChange}
              />
              <div className="kb-form-upload-icon"><Upload size={32} /></div>
              <div className="kb-form-upload-text">
                {fileName || "点击上传文件"}
              </div>
              <div className="kb-form-upload-hint">支持 PDF、Word、Excel 等格式</div>
            </label>
          </div>

          {/* 简单说明 */}
          <div className="kb-form-group">
            <label className="kb-form-label" htmlFor="kb-add-desc">简单说明</label>
            <textarea
              id="kb-add-desc"
              className="kb-form-textarea"
              placeholder="请简要描述该知识的内容与用途"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* 来源 */}
          <div className="kb-form-group">
            <label className="kb-form-label" htmlFor="kb-add-source">来源</label>
            <input
              id="kb-add-source"
              type="text"
              className="kb-form-input"
              placeholder="如：工艺设计部、设备专家、运行车间等"
              autoComplete="off"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          {/* 标签 */}
          <div className="kb-form-group">
            <label className="kb-form-label" htmlFor="kb-add-tag-input">标签</label>
            <div className="kb-form-tags">
              {tags.map((tag) => (
                <span key={tag} className="kb-form-tag">
                  {tag}
                  <button
                    type="button"
                    className="kb-form-tag-remove"
                    onClick={() => removeTag(tag)}
                    aria-label={`移除标签 ${tag}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                id="kb-add-tag-input"
                type="text"
                className="kb-form-tag-input"
                placeholder="输入标签后回车"
                aria-label="输入标签"
                autoComplete="off"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTag() }
                }}
              />
            </div>
          </div>

          {/* 操作 */}
          <div className="kb-form-actions">
            <button type="button" className="kb-btn kb-btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="kb-btn kb-btn-primary" onClick={handleSubmit}>
              确认添加
            </button>
          </div>
        </div>

        {toast && <div className="kb-toast" role="status" aria-live="polite">{toast}</div>}
      </aside>
    </div>
  )
}

// ==================== 分类管理 Drawer ====================
function CategoryManageDrawer({
  categories: entCategories,
  onClose,
  onAddCategory,
  onToggleCategory,
  onDeleteCategory,
}: {
  categories: EnterpriseCategory[]
  onClose: () => void
  onAddCategory: (data: { name: string; description: string }) => void
  onToggleCategory: (categoryId: string) => void
  onDeleteCategory: (categoryId: string) => void
}) {
  useDrawerBehavior(onClose)
  const [newCatName, setNewCatName] = useState("")
  const [newCatDesc, setNewCatDesc] = useState("")
  const [toast, setToast] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function showToast(message: string): void {
    setToast(message)
    setTimeout(() => setToast(""), 2500)
  }

  function handleAdd(): void {
    if (!newCatName.trim()) {
      showToast("请输入分类名称")
      return
    }
    onAddCategory({
      name: newCatName.trim(),
      description: newCatDesc.trim(),
    })
    setNewCatName("")
    setNewCatDesc("")
    showToast("分类已添加")
  }

  function handleDeleteClick(catId: string): void {
    if (confirmDeleteId === catId) {
      onDeleteCategory(catId)
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(catId)
    }
  }

  return (
    <div className="kb-drawer-overlay" onClick={onClose}>
      <aside className="kb-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="kb-drawer-header">
          <div className="kb-drawer-icon">
            <Settings2 size={24} />
          </div>
          <div className="kb-drawer-title-area">
            <h2 className="kb-drawer-title">管理分类</h2>
            <p className="kb-drawer-desc">新增、停用或删除企业知识分类</p>
          </div>
          <button type="button" className="kb-drawer-close" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        <div className="kb-drawer-body">
          {/* 新增分类 */}
          <section className="kb-detail-section">
            <h3 className="kb-detail-section-title">新增自定义分类</h3>
            <div className="kb-form-group">
              <label className="kb-form-label" htmlFor="kb-cat-name">分类名称</label>
              <input
                id="kb-cat-name"
                type="text"
                className="kb-form-input"
                placeholder="如：安全管理规定、检维修经验等"
                autoComplete="off"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
            </div>
            <div className="kb-form-group">
              <label className="kb-form-label" htmlFor="kb-cat-desc">分类说明</label>
              <textarea
                id="kb-cat-desc"
                className="kb-form-textarea"
                placeholder="简要描述该分类的用途"
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
              />
            </div>
            <button type="button" className="kb-btn kb-btn-primary" onClick={handleAdd}>
              <Plus size={16} />
              新增分类
            </button>
          </section>

          {/* 已有分类列表 */}
          <section className="kb-detail-section">
            <h3 className="kb-detail-section-title">已有分类</h3>
            <div className="kb-cat-manage-list">
              {entCategories.map((cat) => (
                <div key={cat.id} className={`kb-cat-manage-item ${cat.enabled ? "" : "disabled"}`}>
                  <div className="kb-cat-manage-item-body">
                    <div className="kb-cat-manage-item-name">
                      {cat.name}
                      {cat.isPreset && <span className="kb-cat-manage-preset-badge">预设</span>}
                    </div>
                    {cat.description && (
                      <div className="kb-cat-manage-item-desc">{cat.description}</div>
                    )}
                  </div>
                  <div className="kb-cat-manage-actions">
                    <button
                      type="button"
                      className="kb-cat-manage-btn"
                      title={cat.enabled ? "停用" : "启用"}
                      aria-label={cat.enabled ? `停用分类 ${cat.name}` : `启用分类 ${cat.name}`}
                      onClick={() => onToggleCategory(cat.id)}
                    >
                      {cat.enabled ? <Activity size={16} /> : <Settings size={16} />}
                    </button>
                    {!cat.isPreset && (
                      confirmDeleteId === cat.id ? (
                        <button
                          type="button"
                          className="kb-cat-manage-btn confirm"
                          onClick={() => handleDeleteClick(cat.id)}
                        >
                          确认删除
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="kb-cat-manage-btn danger"
                          title="删除"
                          aria-label={`删除分类 ${cat.name}`}
                          onClick={() => handleDeleteClick(cat.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {toast && <div className="kb-toast" role="status" aria-live="polite">{toast}</div>}
      </aside>
    </div>
  )
}

// ==================== 主组件 ====================
export function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<"platform" | "enterprise">("platform")
  const [activeSubPage, setActiveSubPage] = useState<string | null>(null)
  const [globalSearch, setGlobalSearch] = useState("")
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [showAddDrawer, setShowAddDrawer] = useState(false)
  const [showCatManage, setShowCatManage] = useState(false)

  // 企业知识状态
  const [entItems, setEntItems] = useState<EnterpriseItem[]>(enterpriseKnowledgeItems as EnterpriseItem[])
  const [entCats, setEntCats] = useState<EnterpriseCategory[]>(defaultEnterpriseCategories as EnterpriseCategory[])

  function handleEnterCategory(catId: string): void {
    setActiveSubPage(catId)
    setGlobalSearch("")
  }

  function handleBackToHome(): void {
    setActiveSubPage(null)
  }

  function handleOpenItem(itemId: string): void {
    setActiveItemId(itemId)
  }

  function handleAddKnowledge(data: NewKnowledgeData): void {
    const newId = `ek-${String(entItems.length + 1).padStart(3, "0")}`
    setEntItems([...entItems, { id: newId, ...data }])
    setShowAddDrawer(false)
  }

  function handleAddCategory(data: { name: string; description: string }): void {
    const newId = `ent-custom-${Date.now()}`
    setEntCats([
      ...entCats,
      {
        id: newId,
        name: data.name,
        description: data.description,
        isPreset: false,
        enabled: true,
        sortOrder: entCats.length + 1,
      },
    ])
  }

  function handleToggleCategory(catId: string): void {
    setEntCats(entCats.map((c) =>
      c.id === catId ? { ...c, enabled: !c.enabled } : c
    ))
  }

  function handleDeleteCategory(catId: string): void {
    setEntCats(entCats.filter((c) => c.id !== catId))
  }

  function handleToggleStatus(itemId: string): void {
    setEntItems(entItems.map((item) =>
      item.id === itemId
        ? { ...item, status: item.status === "enabled" ? "disabled" : "enabled", updatedAt: getTodayStr() }
        : item
    ))
  }

  return (
    <main className="kb-page">
      {/* 页面头 */}
      <header className="kb-page-header">
        <div className="kb-page-header-left">
          <div className="kb-page-icon"><BookOpen size={26} /></div>
          <div>
            <h1>知识库</h1>
            <p>汇集工艺设计、设备设计、公用工程、标准规范等专业知识，为智能改造分析与方案生成提供专业依据。</p>
          </div>
        </div>
      </header>

      {/* 顶部 Tab */}
      <div className="kb-top-tabs">
        <button
          type="button"
          className={`kb-top-tab ${activeTab === "platform" ? "active" : ""}`}
          onClick={() => { setActiveTab("platform"); setActiveSubPage(null) }}
        >
          平台知识
        </button>
        <button
          type="button"
          className={`kb-top-tab ${activeTab === "enterprise" ? "active" : ""}`}
          onClick={() => { setActiveTab("enterprise"); setActiveSubPage(null) }}
        >
          企业知识
        </button>
      </div>

      {/* 内容区 */}
      {activeTab === "platform" && (
        activeSubPage ? (
          <KnowledgeCategoryPage
            categoryId={activeSubPage}
            onBack={handleBackToHome}
            onOpenItem={handleOpenItem}
          />
        ) : (
          <PlatformKnowledgeHome
            onEnterCategory={handleEnterCategory}
            globalSearch={globalSearch}
            setGlobalSearch={setGlobalSearch}
          />
        )
      )}

      {activeTab === "enterprise" && (
        <EnterpriseKnowledgePage
          items={entItems}
          categories={entCats.filter((c) => c.enabled)}
          onAddKnowledge={() => setShowAddDrawer(true)}
          onManageCategories={() => setShowCatManage(true)}
          onToggleStatus={handleToggleStatus}
        />
      )}

      {/* 资料详情 Drawer */}
      {activeItemId && (
        <KnowledgeDetailDrawer
          itemId={activeItemId}
          onClose={() => setActiveItemId(null)}
        />
      )}

      {/* 添加知识 Drawer */}
      {showAddDrawer && (
        <AddKnowledgeDrawer
          categories={entCats.filter((c) => c.enabled)}
          onClose={() => setShowAddDrawer(false)}
          onSubmit={handleAddKnowledge}
        />
      )}

      {/* 分类管理 Drawer */}
      {showCatManage && (
        <CategoryManageDrawer
          categories={entCats}
          onClose={() => setShowCatManage(false)}
          onAddCategory={handleAddCategory}
          onToggleCategory={handleToggleCategory}
          onDeleteCategory={handleDeleteCategory}
        />
      )}
    </main>
  )
}
