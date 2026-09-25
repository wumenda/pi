import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DownOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons"
import { Tabs } from "antd"
import type { DefaultMcpServerDTO, SettingsInfoDTO, SkillInfoDTO } from "@platform/shared"
import {
  connectMcpServer,
  disconnectMcpServer,
  fetchSettingsInfo,
  fetchSkills,
  testMcpEndpoint,
  type McpTestResult,
} from "../../api/settings"
import { fetchOAuthStatus, startOAuth } from "../../api/oauth"
import { toolTitleOf } from "../../types"

/** MCP 连接状态 → 展示徽标文案/样式（connected 绿，failed 红，其余灰/黄） */
function McpStatusBadge({ status }: { status: DefaultMcpServerDTO["status"] }) {
  const label: Record<DefaultMcpServerDTO["status"]["status"], string> = {
    connected: "已连接",
    disabled: "已禁用",
    failed: "连接失败",
    needs_auth: "待授权",
    needs_client_registration: "待注册",
  }
  // 非颜色状态提示（a11y/T9）：每种状态配独立图标，不依赖颜色传达语义
  const icon: Record<DefaultMcpServerDTO["status"]["status"], React.ReactNode> = {
    connected: <CheckCircleOutlined />,
    disabled: <MinusCircleOutlined />,
    failed: <CloseCircleOutlined />,
    needs_auth: <ClockCircleOutlined />,
    needs_client_registration: <ClockCircleOutlined />,
  }
  const className =
    status.status === "connected"
      ? "settings-status settings-status-ok"
      : status.status === "failed"
        ? "settings-status settings-status-error"
        : status.status === "needs_auth" || status.status === "needs_client_registration"
          ? "settings-status settings-status-warn"
          : "settings-status settings-status-muted"
  return (
    <span className={className} title={status.error ?? label[status.status]}>
      <span className="settings-status-icon" aria-hidden="true">
        {icon[status.status]}
      </span>
      {label[status.status]}
    </span>
  )
}

/** Skill 列表项：名称 + 来源 + tool 数，点击展开该 skill 的 tool 清单明细 */
function SkillItem({ skill }: { skill: SkillInfoDTO }) {
  const [expanded, setExpanded] = useState(false)
  const hasTools = skill.tools.length > 0
  const canExpand = hasTools && !skill.metadataUnavailable

  return (
    <li className="settings-list-item settings-list-item-skill">
      <button
        type="button"
        className="settings-skill-row"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={expanded}
      >
        <span className="settings-skill-name" title={skill.directory}>
          {skill.title ?? skill.name}
        </span>
        <span
          className={`settings-source-badge${skill.source === "project" ? " settings-source-badge-project" : ""}`}
          title={skill.source === "project" ? "项目级" : "全局级"}
        >
          {skill.source === "project" ? "项目" : "全局"}
        </span>
        <span className="settings-item-meta">
          {skill.metadataUnavailable
            ? "元数据不可用"
            : `${skill.tools.length} tools`}
        </span>
        {canExpand ? (
          expanded ? (
            <DownOutlined className="settings-skill-caret" />
          ) : (
            <RightOutlined className="settings-skill-caret" />
          )
        ) : null}
      </button>
      {expanded && (
        <div className="settings-skill-tools">
          {skill.tools.map((tool, i) => (
            <span key={i} className="settings-tool-chip">
              {toolTitleOf(tool)}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}

/**
 * MCP server OAuth 授权（T9 MVP）：start 拿 authorize URL → 新窗口打开 → 轮询 status。
 * 成功/失败均有明确反馈（通过条件：授权 CTA 有成功/失败恢复）。
 */
const OAUTH_POLL_MS = 2_000
const OAUTH_POLL_TRIES = 30

/** 插件注册 MCP 列表项：prefix + 端点 + 「测试连通」/「OAuth 授权」按钮（仅 url 型可探测） */
function PluginMcpItem({ server }: { server: SettingsInfoDTO["pluginMcpServers"][number] }) {
  const [result, setResult] = useState<"idle" | "testing" | McpTestResult>("idle")
  const [oauth, setOauth] =
    useState<"idle" | "opening" | "polling" | { ok: boolean; error?: string }>("idle")
  const testMutation = useMutation({
    mutationFn: (url: string) => testMcpEndpoint(url),
    onSuccess: (r) => setResult(r),
    onError: (e) => setResult({ ok: false, error: String(e) }),
  })
  const url = server.url

  const authorize = async () => {
    if (url === undefined || oauth === "opening" || oauth === "polling") return
    setOauth("opening")
    try {
      const { authorizationUrl } = await startOAuth(server.prefix, url)
      window.open(authorizationUrl, "_blank", "noopener")
      setOauth("polling")
      for (let i = 0; i < OAUTH_POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, OAUTH_POLL_MS))
        const { authorized } = await fetchOAuthStatus(server.prefix)
        if (authorized) {
          setOauth({ ok: true })
          return
        }
      }
      setOauth({ ok: false, error: "授权超时，请确认已完成授权后重试" })
    } catch (e) {
      setOauth({ ok: false, error: String(e) })
    }
  }

  return (
    <li className="settings-list-item">
      <span className="settings-item-name">
        <span className="settings-prefix">{server.prefix}</span>
      </span>
      <span className="settings-item-meta settings-item-mono">
        {url ?? server.command ?? "—"}
      </span>
      {result !== "idle" && result !== "testing" && (
        <span
          className={`settings-mcp-test-result${result.ok ? " settings-mcp-test-result-ok" : ""}`}
          title={result.ok ? undefined : result.error}
        >
          {result.ok
            ? `可达（${result.latencyMs ?? 0}ms）`
            : `不可达：${result.error ?? "网络错误"}`}
        </span>
      )}
      {oauth !== "idle" && oauth !== "opening" && oauth !== "polling" && (
        <span
          className={`settings-mcp-test-result${oauth.ok ? " settings-mcp-test-result-ok" : ""}`}
          title={oauth.ok ? undefined : oauth.error}
        >
          {oauth.ok ? "OAuth 已授权" : `授权失败：${oauth.error ?? "未知错误"}`}
        </span>
      )}
      {url && (
        <>
          <button
            type="button"
            className="settings-mcp-action"
            aria-label={`测试连通 ${server.prefix}`}
            disabled={testMutation.isPending}
            onClick={() => {
              setResult("testing")
              testMutation.mutate(url)
            }}
          >
            {testMutation.isPending ? <LoadingOutlined /> : "测试连通"}
          </button>
          <button
            type="button"
            className="settings-mcp-action"
            aria-label={`OAuth 授权 ${server.prefix}`}
            disabled={oauth === "opening" || oauth === "polling"}
            onClick={() => void authorize()}
          >
            {oauth === "opening" || oauth === "polling" ? <LoadingOutlined /> : "OAuth 授权"}
          </button>
        </>
      )}
    </li>
  )
}

/** 默认 MCP 列表项：名称 + 端点 + 连接状态 + 连接/断开按钮 */
function DefaultMcpItem({
  server,
  onRefreshed,
}: {
  server: DefaultMcpServerDTO
  onRefreshed: () => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (action: "connect" | "disconnect") =>
      action === "connect"
        ? connectMcpServer(server.name)
        : disconnectMcpServer(server.name),
    onSuccess: () => {
      // 更新该 server 在缓存中的连接状态，避免整卡刷新闪烁
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
      onRefreshed()
    },
  })

  const connected = server.status.status === "connected"
  const actionable =
    server.status.status === "connected" ||
    server.status.status === "disabled" ||
    server.status.status === "failed"

  return (
    <li className="settings-list-item settings-list-item-mcp">
      <div className="settings-mcp-main">
        <span className="settings-item-name">{server.name}</span>
        <span className="settings-item-meta settings-item-mono">
          {server.type === "local" ? (server.command ?? []).join(" ") : server.url}
        </span>
      </div>
      <McpStatusBadge status={server.status} />
      {actionable && (
        <button
          type="button"
          className={`settings-mcp-action${connected ? " settings-mcp-action-disconnect" : ""}`}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(connected ? "disconnect" : "connect")}
        >
          {mutation.isPending ? <LoadingOutlined /> : connected ? "断开" : "连接"}
        </button>
      )}
    </li>
  )
}

/** Tab 1：Skill —— 磁盘扫描全部已注册 skill（全局 + 项目，可展开 tool 明细） */
function SkillsTab() {
  const { data: skills = [], isLoading, isError } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    staleTime: 5_000,
  })

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <ThunderboltOutlined className="settings-section-icon" />
        <span className="settings-section-title">Skill（已注册）</span>
        <span className="settings-section-count">{skills.length}</span>
      </div>
      {isLoading ? (
        <div className="settings-loading">
          <LoadingOutlined /> 加载中…
        </div>
      ) : isError ? (
        <div className="settings-empty">Skill 清单加载失败</div>
      ) : skills.length === 0 ? (
        <div className="settings-empty">未发现已注册 Skill</div>
      ) : (
        <ul className="settings-list">
          {skills.map((skill) => (
            <SkillItem key={skill.name} skill={skill} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Tab 2：MCP —— 插件注册 + 默认配置（含连接状态与连接/断开操作） */
function McpTab({
  pluginServers,
  defaultMcpServers,
  onRefreshed,
}: {
  pluginServers: SettingsInfoDTO["pluginMcpServers"]
  defaultMcpServers: SettingsInfoDTO["defaultMcpServers"]
  onRefreshed: () => void
}) {
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-head">
          <ExperimentOutlined className="settings-section-icon" />
          <span className="settings-section-title">MCP（mcp-progress 插件注册）</span>
          <span className="settings-section-count">{pluginServers.length}</span>
        </div>
        {pluginServers.length === 0 ? (
          <div className="settings-empty">未注册插件 MCP server</div>
        ) : (
          <ul className="settings-list">
            {pluginServers.map((s, i) => (
              <PluginMcpItem key={i} server={s} />
            ))}
          </ul>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-head">
          <ApiOutlined className="settings-section-icon" />
          <span className="settings-section-title">MCP（默认配置）</span>
          <span className="settings-section-count">{defaultMcpServers.length}</span>
        </div>
        {defaultMcpServers.length === 0 ? (
          <div className="settings-empty">未配置默认 MCP server</div>
        ) : (
          <ul className="settings-list">
            {defaultMcpServers.map((s) => (
              <DefaultMcpItem
                key={s.name}
                server={s}
                onRefreshed={onRefreshed}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** Tab 3：Tool —— 已注册工具清单（内置 + 插件 MCP 按前缀归类） */
function ToolsTab({
  isLoading,
  isError,
  builtinTools,
  pluginTools,
  toolIds,
}: {
  isLoading: boolean
  isError: boolean
  builtinTools: string[]
  pluginTools: { server: string; tool: string }[]
  toolIds: string[]
}) {
  if (isLoading) {
    return (
      <div className="settings-loading">
        <LoadingOutlined /> 加载中…
      </div>
    )
  }
  if (isError) {
    return <div className="settings-empty">Tool 清单加载失败</div>
  }
  return (
    <div className="settings-tools">
      {builtinTools.length > 0 && (
        <>
          <div className="settings-tools-group">内置</div>
          <div className="settings-tools-chips">
            {builtinTools.map((t) => (
              <span key={t} className="settings-tool-chip">
                {t}
              </span>
            ))}
          </div>
        </>
      )}
      {pluginTools.length > 0 && (
        <>
          <div className="settings-tools-group">插件 MCP</div>
          <div className="settings-tools-chips">
            {pluginTools.map(({ tool }) => (
              <span key={tool} className="settings-tool-chip settings-tool-chip-mcp">
                {tool}
              </span>
            ))}
          </div>
        </>
      )}
      {builtinTools.length === 0 && pluginTools.length === 0 && (
        <div className="settings-empty">暂无已注册 tool</div>
      )}
      <div className="settings-tools-total">共 {toolIds.length} 个 tool</div>
    </div>
  )
}

/** 设置卡片内容（数据源：opencode config + mcp.status + tool/ids；skill 为磁盘扫描清单） */
export function SettingsContent() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettingsInfo,
    staleTime: 5_000,
  })
  // skill 清单由 SkillsTab 拉取；此处仅取 count 供 tab 徽标（同一 queryKey 共享缓存）
  const { data: skills = [] } = useQuery({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    staleTime: 5_000,
  })

  const pluginServers = data?.pluginMcpServers ?? []
  const defaultMcpServers = data?.defaultMcpServers ?? []
  const toolIds = data?.toolIds ?? []

  // 按前缀归类 tool id（内置 tool 无前缀 → 归入"内置"）
  const pluginTools = pluginServers.flatMap((s) =>
    toolIds
      .filter((t) => t.startsWith(s.prefix))
      .map((t) => ({ server: s.prefix, tool: t })),
  )
  const builtinTools = toolIds.filter(
    (t) => !pluginServers.some((s) => t.startsWith(s.prefix)),
  )

  return (
    <div className="settings-content">
      <Tabs
        className="settings-tabs"
        defaultActiveKey="skill"
        items={[
          {
            key: "skill",
            label: (
              <span className="settings-tab-label">
                <ThunderboltOutlined /> Skill
                <span className="settings-tab-count">{skills.length}</span>
              </span>
            ),
            children: <SkillsTab />,
          },
          {
            key: "mcp",
            label: (
              <span className="settings-tab-label">
                <ExperimentOutlined /> MCP
                <span className="settings-tab-count">
                  {pluginServers.length + defaultMcpServers.length}
                </span>
              </span>
            ),
            children: (
              <McpTab
                pluginServers={pluginServers}
                defaultMcpServers={defaultMcpServers}
                onRefreshed={() => void refetch()}
              />
            ),
          },
          {
            key: "tool",
            label: (
              <span className="settings-tab-label">
                <SettingOutlined /> Tool
                <span className="settings-tab-count">{toolIds.length}</span>
              </span>
            ),
            children: (
              <ToolsTab
                isLoading={isLoading}
                isError={isError}
                builtinTools={builtinTools}
                pluginTools={pluginTools}
                toolIds={toolIds}
              />
            ),
          },
        ]}
      />

      <button type="button" className="settings-refresh" onClick={() => refetch()}>
        <ReloadOutlined /> 刷新
      </button>
    </div>
  )
}

/**
 * 设置卡片：顶栏/左栏设置按钮弹出，屏幕居中圆角矩形卡片，工作台虚化遮罩。
 * 内容按功能区以 Tab 分开：Skill（当前会话已加载）/ MCP（插件注册 + 默认配置，含连接/断开）/
 *       Tool（已注册工具清单）。
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  // onClose 供键盘监听使用（ref 持有，避免 inline 闭包变化导致监听反复重挂）
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // modal a11y（T9）：打开时焦点移入卡片、Escape 关闭、Tab 焦点圈闭、关闭/卸载后焦点恢复到触发元素。
  // 打开期间锁定背景滚动，关闭时恢复。
  useEffect(() => {
    if (!open) return
    const restoreTarget = document.activeElement as HTMLElement | null
    document.body.classList.add("settings-modal-open")

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab" || !cardRef.current) return
      // Tab 焦点圈闭：只在遍历到卡片边界时干预，不劫持正常顺序
      const focusables = [
        ...cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ]
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    // 焦点移入卡片（关闭按钮；卡片挂载后执行）
    cardRef.current?.querySelector<HTMLElement>(".settings-close")?.focus()

    return () => {
      document.body.classList.remove("settings-modal-open")
      document.removeEventListener("keydown", onKeyDown, true)
      restoreTarget?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-card" role="document" ref={cardRef}>
        <div className="settings-card-head">
          <span className="settings-card-title">设置</span>
          <button
            type="button"
            className="settings-close"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </div>
        <SettingsContent />
      </div>
    </div>
  )
}
