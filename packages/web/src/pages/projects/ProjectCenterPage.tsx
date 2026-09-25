import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, ChevronDown, FolderOpen, Pencil, Plus } from "lucide-react"
import { useState } from "react"
import { Button, Input, Modal, App as AntdApp } from "antd"
import { FolderOpenOutlined } from "@ant-design/icons"
import { fetchProjects } from "../../api/projects"
import {
  createSession,
  deleteSession,
  fetchSessions,
  renameSession,
} from "../../api/sessions"
import { DirectoryPicker } from "../../features/session/DirectoryPicker"
import { navigateSession } from "../../redesign/routes"
import { useAppStore } from "../../stores/app-store"
import "./projectCenter.css"

function directoryLabel(directory: string): string {
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

/** ISO 8601 → 本地 "YYYY-MM-DD HH:mm"；无效值返回空串 */
function formatCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 项目中心：项目（工作目录）→ 会话两级；进入会话即进入工作台 */
export function ProjectCenterPage() {
  const qc = useQueryClient()
  const upsertSession = useAppStore((s) => s.upsertSession)
  const setCurrentSession = useAppStore((s) => s.setCurrentSession)
  const { message } = AntdApp.useApp()
  // 已折叠的项目目录集合；默认全部展开
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // 顶部「新建会话」弹窗：选择已注册项目或浏览服务器目录
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // 重命名弹窗：目标会话与输入中的新标题
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string; directory: string } | null>(null)
  const [renameTitle, setRenameTitle] = useState("")

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: fetchProjects })
  const sessionsQuery = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions })

  const create = useMutation({
    mutationFn: (directory?: string) => createSession(undefined, directory || undefined),
    onSuccess: async (created) => {
      upsertSession(created)
      setCurrentSession(created.id)
      navigateSession(created.id)
      setCreateOpen(false)
      setSelectedDir(null)
      await qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    // pi 适配：失败必须可见（未连接/serverId 不匹配时否则表现为"点了没反应"）
    onError: (e) => message.error(`创建会话失败：${e instanceof Error ? e.message : String(e)}`),
  })

  const remove = useMutation({
    mutationFn: ({ id, directory }: { id: string; directory?: string }) =>
      deleteSession(id, directory),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (e) => message.error(`删除会话失败：${e instanceof Error ? e.message : String(e)}`),
  })

  const rename = useMutation({
    mutationFn: ({ id, title, directory }: { id: string; title: string; directory?: string }) =>
      renameSession(id, title, directory),
    onSuccess: async (updated) => {
      upsertSession(updated)
      setRenameTarget(null)
      await qc.invalidateQueries({ queryKey: ["sessions"] })
    },
    onError: (e) => message.error(`重命名失败：${e instanceof Error ? e.message : String(e)}`),
  })

  const projects = projectsQuery.data ?? []
  const sessions = sessionsQuery.data ?? []

  const projectName = (directory: string) =>
    projects.find((p) => p.directory === directory)?.name ?? directoryLabel(directory)

  const toggleCollapsed = (directory: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(directory)) next.delete(directory)
      else next.add(directory)
      return next
    })
  }

  const closeCreate = () => {
    setCreateOpen(false)
    setSelectedDir(null)
  }

  // 按目录分组（含未注册目录的历史残留会话）
  const groups = new Map<string, typeof sessions>()
  for (const s of sessions) {
    const list = groups.get(s.directory)
    if (list) list.push(s)
    else groups.set(s.directory, [s])
  }
  const knownDirs = new Set(projects.map((p) => p.directory))
  const unknownDirs = [...groups.keys()].filter((d) => !knownDirs.has(d))

  return (
    <div className="workspace-page-body project-center">
      <header className="project-center-head">
        <div className="sk-page-header-left">
          <div className="sk-page-icon">
            <FolderOpen size={26} />
          </div>
          <div>
            <h1>项目中心</h1>
            <p>按项目查看改造会话，进入会话即进入该任务的工作台</p>
          </div>
        </div>
        <button
          type="button"
          className="project-new-btn"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={16} /> 新建会话
        </button>
      </header>
      {[...projects.map((p) => p.directory), ...unknownDirs].map((directory) => {
        const list = groups.get(directory) ?? []
        const isCollapsed = collapsed.has(directory)
        return (
          <section key={directory} className="project-card">
            <header
              className="project-card-head"
              onClick={() => toggleCollapsed(directory)}
            >
              <button
                type="button"
                className="project-collapse-btn"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "展开" : "折叠"}项目 ${projectName(directory)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleCollapsed(directory)
                }}
              >
                <ChevronDown
                  size={16}
                  className={`project-collapse-icon${isCollapsed ? " is-collapsed" : ""}`}
                />
              </button>
              <FolderOpen size={18} />
              <strong>{projectName(directory)}</strong>
              <span className="project-card-count">{list.length} 个会话</span>
              <span className="project-card-dir" title={directory}>
                {directory}
              </span>
              <button
                type="button"
                className="project-create-btn"
                disabled={create.isPending}
                onClick={(e) => {
                  e.stopPropagation()
                  create.mutate(directory)
                }}
              >
                <Plus size={16} /> 新建会话
              </button>
            </header>
            {!isCollapsed &&
              (list.length === 0 ? (
                <p className="project-empty">该项目暂无会话，点击「新建会话」开始改造任务</p>
              ) : (
                <ul className="session-rows">
                  {list.map((s) => (
                    <li key={s.id} className="session-row">
                      <button
                        type="button"
                        className="session-open"
                        onClick={() => {
                          upsertSession(s)
                          setCurrentSession(s.id)
                          navigateSession(s.id)
                        }}
                      >
                        <span className="session-title">{s.title || "未命名会话"}</span>
                        <span className="session-open-meta">
                          {/* 任务类型（装置级/设备级/全厂级）暂为占位，待接入存储 */}
                          <span className="session-type-tag">未分类</span>
                          <span className="session-meta">{formatCreatedAt(s.createdAt)}</span>
                          <ArrowRight size={16} />
                        </span>
                      </button>
                      <span className="session-actions">
                        <button
                          type="button"
                          className="session-rename"
                          onClick={() => {
                            setRenameTarget({ id: s.id, title: s.title, directory })
                            setRenameTitle(s.title)
                          }}
                          aria-label={`重命名会话 ${s.title || s.id}`}
                          title="重命名"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="session-delete"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: s.id, directory })}
                          aria-label={`删除会话 ${s.title || s.id}`}
                        >
                          删除
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        )
      })}
      {projects.length === 0 && unknownDirs.length === 0 && !projectsQuery.isLoading && (
        <p className="project-empty">还没有项目：在后端注册工作目录后在此显示</p>
      )}

      <Modal
        title="新建会话"
        open={createOpen}
        onCancel={closeCreate}
        width={520}
        footer={[
          <Button key="cancel" onClick={closeCreate}>
            取消
          </Button>,
          <Button
            key="create"
            type="primary"
            disabled={!selectedDir || create.isPending}
            onClick={() => selectedDir && create.mutate(selectedDir)}
          >
            创建会话
          </Button>,
        ]}
      >
        <p className="project-modal-hint">选择项目文件夹，在新会话中开始改造任务</p>
        <ul className="project-modal-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`project-modal-item${selectedDir === p.directory ? " is-selected" : ""}`}
                onClick={() => setSelectedDir(p.directory)}
              >
                <FolderOpen size={16} />
                <span className="project-modal-name">{p.name}</span>
                <span className="project-modal-dir" title={p.directory}>
                  {p.directory}
                </span>
              </button>
            </li>
          ))}
          {projects.length === 0 && (
            <li className="project-empty">暂无注册项目，可浏览服务器目录选择文件夹</li>
          )}
        </ul>
        <div className="project-modal-browse">
          <Button
            icon={<FolderOpenOutlined />}
            onClick={() => setPickerOpen(true)}
          >
            浏览服务器目录…
          </Button>
          {selectedDir && (
            <span className="project-modal-selected" title={selectedDir}>
              {selectedDir}
            </span>
          )}
        </div>
      </Modal>

      <Modal
        title="重命名会话"
        open={renameTarget !== null}
        onCancel={() => setRenameTarget(null)}
        footer={[
          <Button key="cancel" onClick={() => setRenameTarget(null)}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            disabled={!renameTitle.trim() || rename.isPending}
            onClick={() => {
              if (renameTarget && renameTitle.trim()) {
                rename.mutate({ id: renameTarget.id, title: renameTitle.trim(), directory: renameTarget.directory })
              }
            }}
          >
            保存
          </Button>,
        ]}
      >
        <Input
          value={renameTitle}
          maxLength={200}
          placeholder="输入新的会话名称"
          onChange={(e) => setRenameTitle(e.target.value)}
          autoFocus
        />
      </Modal>

      <DirectoryPicker
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onSelect={(dir) => {
          setSelectedDir(dir)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
