import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { App as AntdApp, Button, Input, Popover, Progress, Select, Tag } from "antd"
import { ArrowUpOutlined, PlusOutlined, CloseOutlined } from "@ant-design/icons"
import type { MessageDTO, ModelInfoDTO } from "@platform/shared"
import { abortSession, fetchMessages, sendPrompt } from "../../api/messages"
import { fetchAgents, fetchModels } from "../../api/agents"
import { fetchToolLibrary } from "../../api/tool-library"
import { uploadFileToWorkspace } from "../../api/files"
import { AssetSemanticModal } from "./AssetSemanticModal"
import { textPartsOf } from "../../api/events"
import { estimateContextSegments } from "./contextEstimate"
import { useAppStore, sessionDirectoryOf } from "../../stores/app-store"
import type { ReasoningEffort } from "../../types"

const REASONING_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
]

/** 模型下拉两级分组：第一层 provider，第二层模型；选中后仅显示模型名 */
function groupModelOptions(models: ModelInfoDTO[]) {
  const byProvider = new Map<string, ModelInfoDTO[]>()
  for (const m of models) {
    const list = byProvider.get(m.providerID)
    if (list) list.push(m)
    else byProvider.set(m.providerID, [m])
  }
  return [...byProvider.entries()].map(([provider, list]) => ({
    label: provider,
    title: provider,
    options: list.map((m) => ({
      value: `${m.providerID}/${m.modelID}`,
      label: m.name || m.modelID,
      title: `${m.providerID}/${m.modelID}`,
      searchText: `${m.name} ${m.modelID} ${m.providerID}`,
      contextWindow: m.contextWindow,
    })),
  }))
}

/**
 * 输入框（布局文档 4.2）：底部固定、多行自适应（max 8 行）、
 * Enter 发送 / Shift+Enter 换行 / 空输入 ↑ 回填上一条用户消息、
 * 会话切换后自动聚焦；发送中禁用 + 停止按钮。
 * 工具行提供 Agent 预设 / 模型 / 思考强度选择（随请求透传，全局记忆）。
 */
export function ChatInput({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState("")
  // antd TextArea 的 ref 是 TextAreaRef 包装类型，原生 textarea 经 nativeElement 访问
  const inputRef = useRef<ComponentRef<typeof Input.TextArea>>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedFiles, setUploadedFiles] = useState<{ filename: string; bytes: number }[]>([])
  const [uploading, setUploading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [semanticOpen, setSemanticOpen] = useState(false)
  const queryClient = useQueryClient()
  const streaming = useAppStore((s) => s.streamingSessionId === sessionId)
  const setStreamingSession = useAppStore((s) => s.setStreamingSession)
  const markSessionPrompt = useAppStore((s) => s.markSessionPrompt)
  const promptPrefs = useAppStore((s) => s.promptPrefs)
  const setPromptPrefs = useAppStore((s) => s.setPromptPrefs)
  const { message } = AntdApp.useApp()

  // Agent 预设与模型清单（选择器数据源；失败降级为仅占位）
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
    staleTime: 5 * 60_000,
  })
  const { data: models = [] } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
    staleTime: 5 * 60_000,
  })
  const modelOptions = useMemo(() => groupModelOptions(models), [models])

  // 新建/切换会话后自动聚焦输入框，清空已上传文件列表
  useEffect(() => {
    inputRef.current?.focus()
    setUploadedFiles([])
  }, [sessionId])

  // 选文件 → 弹语义框（语义由用户指定，服务端写入 .assets-uploads.md）
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setPendingFiles(Array.from(files))
    setSemanticOpen(true)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSemanticConfirm = async (semantic: string) => {
    try {
      setUploading(true)
      for (const file of pendingFiles) {
        const result = await uploadFileToWorkspace(sessionId, sessionDirectoryOf(sessionId), file, semantic)
        setUploadedFiles((prev) => [...prev, result])
      }
      message.success(`已上传 ${pendingFiles.length} 个文件至工作目录`)
      setSemanticOpen(false)
      setPendingFiles([])
    } catch (err) {
      message.error(`文件上传失败：${String(err)}`)
    } finally {
      setUploading(false)
    }
  }

  // 模型清单加载后：若持久化的 promptPrefs.model 已失效（不在当前已连接 provider
  // 清单内，如 provider 掉线/重配），自动清除并提示，避免每次发送都携带失效模型
  // 被服务端 400 拒绝（见 docs/diagnosis-incognito-send-failure.md）。
  useEffect(() => {
    if (models.length === 0) return
    const valid = modelOptions.flatMap((g) => g.options).map((o) => o.value)
    if (promptPrefs.model && !valid.includes(promptPrefs.model)) {
      setPromptPrefs({ model: undefined })
      message.warning(`已选模型 ${promptPrefs.model} 已失效，已自动切换为默认模型`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, modelOptions])

  // Agent 预设清单加载后：若持久化的 promptPrefs.agent 已失效（不在当前 opencode
  // 可作主 agent 的清单内，如某 agent 被移除/换实例/仅存在于旧实例），自动清除并提示。
  // 失效 agent 若不清理会随请求透传，opencode 侧异步报 "Agent not found"（HTTP 仍 202），
  // 前端表现为"文字消失、对话流无任何内容"（无用户消息也无回复）——普通/无痕浏览器
  // 差异即来自此残留（见 diagnosis-incognito-send-failure.md）。
  useEffect(() => {
    if (agents.length === 0) return
    if (promptPrefs.agent && !agents.some((a) => a.name === promptPrefs.agent)) {
      setPromptPrefs({ agent: undefined })
      message.warning(`已选 Agent 预设 ${promptPrefs.agent} 已失效，已自动切换为默认预设`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents])

  // 当前会话消息（共享 MessageList 同 key 缓存；staleTime: Infinity 避免覆盖已有缓存，
  // 仅由 SSE setQueryData 驱动更新，供上下文占用圆环取数）
  const { data: messages = [] } = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => fetchMessages(sessionId, sessionDirectoryOf(sessionId)),
    staleTime: Infinity,
  })

  // 工具库（三段估算的工具定义数据源；含 inputSchema，5 分钟缓存足够）
  const { data: tools = [] } = useQuery({
    queryKey: ["tool-library"],
    queryFn: fetchToolLibrary,
    staleTime: 5 * 60_000,
  })

  // 三段估算（系统提示/工具定义/历史消息，全部为启发式估算值）。
  // 单个 useMemo 聚合，避免 SSE 高频更新时重复遍历消息。
  const contextSegments = useMemo(
    () =>
      estimateContextSegments({
        messages,
        agents,
        agentName: promptPrefs.agent,
        tools,
      }),
    [messages, agents, promptPrefs.agent, tools],
  )

  // 上下文占用：最新 step-finish part 的 input token（含缓存读），反映模型看到的上下文量
  const contextTokens = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const parts = messages[i]?.parts ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j] as
          | { type?: string; tokens?: { input?: number; cache?: { read?: number } } }
          | undefined
        if (p?.type === "step-finish" && p.tokens) {
          return (p.tokens.input ?? 0) + (p.tokens.cache?.read ?? 0)
        }
      }
    }
    return null
  }, [messages])

  // 当前选中模型（provider.list 透传的 contextWindow/reasoning），供圆环分母与思考强度选择器复用
  const activeModel = useMemo(() => {
    if (!promptPrefs.model) return null
    const [providerID, modelID] = promptPrefs.model.split("/")
    return (
      models.find((m) => m.providerID === providerID && m.modelID === modelID) ??
      null
    )
  }, [models, promptPrefs.model])

  // 上下文占用圆环分母：按当前选中模型的真实 context window（provider.list 透传），
  // 未知（未连接/清单未加载/无 limit）时回退默认 128k，避免进度比例失真（chat-input-context-ring）。
  const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000
  const contextWindowTokens =
    activeModel?.contextWindow && activeModel.contextWindow > 0
      ? activeModel.contextWindow
      : FALLBACK_CONTEXT_WINDOW_TOKENS

  const contextPercent =
    contextTokens === null
      ? 0
      : Math.min(100, Math.round((contextTokens / contextWindowTokens) * 100))
  const contextColor =
    contextPercent >= 90 ? "#ef4444" : contextPercent >= 70 ? "#f59e0b" : "var(--ind-primary)"

  // 当前模型是否支持推理（reasoning 能力来自 provider.list 透传）。
  // 非推理模型无"思考强度"可设：禁用选择器并提示（思考强度由模型决定）。
  const modelSupportsReasoning = activeModel?.reasoning !== false

  // P2-8：受理请求在途守卫——202 返回前 streaming 尚未置位，此窗口内重复
  // Enter/点击会把同一文本发送两次（服务端无幂等键，opencode 会受理两条）
  const sendingRef = useRef(false)

  const send = async () => {
    const value = text.trim()
    if (value.length === 0 || streaming || sendingRef.current) return
    sendingRef.current = true
    const sentAt = Date.now()
    // F2：发送发起时间记账——挂载期 status 查询的陈旧 running=false 结果据此不误清 streaming
    markSessionPrompt(sessionId, sentAt)
    try {
      await sendPrompt(sessionId, value, promptPrefs, sessionDirectoryOf(sessionId))
      setText("")
      // A3 修复：idle/error 事件可能先于 202 经 SSE 到达（秒级失败场景）。
      // 发送发起后该会话已收到终态事件 → 会话实际已结束，不再置位 streaming，
      // 否则 streamingSessionId 置位后无人复位，输入框永久禁用。
      const terminalAt = useAppStore.getState().sessionTerminalAt[sessionId]
      if (terminalAt === undefined || terminalAt < sentAt) {
        setStreamingSession(sessionId)
      }
    } catch (e) {
      const msg = String(e)
      // 模型失效类错误（服务端 assertModelConnected 的 BAD_REQUEST）：清掉失效偏好，
      // 给出可行动提示；其余错误保留输入便于重试，给出可见反馈。
      if (msg.includes("未连接") || msg.includes("模型")) {
        setPromptPrefs({ model: undefined })
        message.error(`${msg}\n已切换为默认模型，可重新选择后再发送`)
      } else {
        message.error(`发送失败：${msg}`)
      }
    } finally {
      sendingRef.current = false
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault()
      void send()
      return
    }
    // Shift+Enter：默认换行行为，不拦截
    // ↑ 键在空输入时回填上一条用户消息（快速追问/复述）
    if (e.key === "ArrowUp" && text.length === 0 && !streaming) {
      const messages =
        queryClient.getQueryData<MessageDTO[]>(["messages", sessionId]) ?? []
      const lastUser = [...messages]
        .reverse()
        .find(
          (m) => m.role === "user" && textPartsOf(m.parts).trim().length > 0,
        )
      if (lastUser) {
        e.preventDefault()
        const value = textPartsOf(lastUser.parts)
        setText(value)
        // 受控替换后光标停在原位（0）：移到末尾便于续写
        const len = value.length
        setTimeout(() => {
          const el = inputRef.current?.nativeElement
          const textarea =
            el instanceof HTMLTextAreaElement ? el : el?.querySelector("textarea")
          textarea?.setSelectionRange(len, len)
        }, 0)
      }
    }
  }

  return (
    <div className="chat-input">
      <div className="chat-input-box">
        <div className="chat-input-attachments">
          <Button
            aria-label="上传文件"
            shape="circle"
            size="small"
            type="text"
            icon={<PlusOutlined />}
            loading={uploading}
            disabled={streaming}
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void handleFileUpload(e)}
          />
          <AssetSemanticModal
            open={semanticOpen}
            fileNames={pendingFiles.map((f) => f.name)}
            confirmLoading={uploading}
            onCancel={() => {
              setSemanticOpen(false)
              setPendingFiles([])
            }}
            onConfirm={(semantic) => void handleSemanticConfirm(semantic)}
          />
          {uploadedFiles.map((f, i) => (
            <Tag
              key={`${f.filename}-${i}`}
              closable
              closeIcon={<CloseOutlined style={{ fontSize: 10 }} />}
              onClose={() => setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i))}
            >
              {f.filename}
            </Tag>
          ))}
        </div>
        <Input.TextArea
          className="chat-input-textarea"
          aria-label="消息输入框"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题或指令..."
          autoSize={{ minRows: 2, maxRows: 8 }}
          disabled={streaming}
          variant="borderless"
        />
        <div className="chat-input-toolbar">
          <Select
            className="input-pref-select input-pref-agent"
            aria-label="Agent 预设选择"
            size="small"
            variant="borderless"
            showSearch={false}
            popupMatchSelectWidth={false}
            value={promptPrefs.agent}
            placeholder="Agent 预设"
            disabled={streaming}
            options={agents.map((a) => ({
              value: a.name,
              label: a.name,
              title: a.description,
            }))}
            onChange={(value) => setPromptPrefs({ agent: value ?? undefined })}
          />
          <Select
            className="input-pref-select input-pref-model"
            aria-label="模型选择"
            size="small"
            variant="borderless"
            showSearch={false}
            popupMatchSelectWidth={false}
            value={promptPrefs.model}
            placeholder="默认模型"
            disabled={streaming}
            options={modelOptions}
            onChange={(value) => setPromptPrefs({ model: value ?? undefined })}
          />
          <Select
            className="input-pref-select input-pref-reasoning"
            aria-label="思考强度选择"
            size="small"
            variant="borderless"
            showSearch={false}
            popupMatchSelectWidth={false}
            value={promptPrefs.reasoning}
            disabled={streaming || !modelSupportsReasoning}
            title={
              modelSupportsReasoning
                ? "思考强度（关闭=off→opencode none）"
                : "当前模型不支持推理，思考强度由模型决定"
            }
            options={REASONING_OPTIONS}
            onChange={(value) => setPromptPrefs({ reasoning: value })}
          />
          <div className="chat-input-toolbar-spacer" />
          {contextTokens !== null && (
            <Popover
              trigger="hover"
              placement="topRight"
              content={
                <div className="ctx-est">
                  <div className="ctx-est-header">
                    权威总量 {contextTokens.toLocaleString()} /{" "}
                    {contextWindowTokens.toLocaleString()} tokens（{contextPercent}%）
                  </div>
                  {(
                    [
                      { label: "系统提示", value: contextSegments.systemTokens },
                      { label: "工具定义", value: contextSegments.toolsTokens },
                      { label: "历史消息", value: contextSegments.historyTokens },
                    ] as const
                  ).map(({ label, value }) => (
                    <div className="ctx-est-row" key={label}>
                      <div className="ctx-est-row-head">
                        <span>
                          {label}
                          <span className="ctx-est-tag">估算值</span>
                        </span>
                        <span className="ctx-est-num">{value.toLocaleString()} tokens</span>
                      </div>
                      <div className="ctx-est-bar">
                        <span
                          style={{
                            width: `${
                              contextSegments.segmentTotal > 0
                                ? Math.round((value / contextSegments.segmentTotal) * 100)
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="ctx-est-footnote">
                    估算值仅供参考：分词器差异、内置工具与系统提示为兜底常量、可能不含图片与内部格式；各段之和 ≠ 权威总量。
                  </div>
                </div>
              }
            >
              <Progress
                type="circle"
                size={24}
                percent={contextPercent}
                strokeWidth={6}
                strokeColor={contextColor}
                railColor="var(--ind-border)"
                showInfo={false}
                className="chat-input-context-ring"
              />
            </Popover>
          )}
          {streaming ? (
            <Button
              aria-label="停止"
              shape="circle"
              className="chat-send-btn chat-send-btn-stop"
              icon={<span className="chat-stop-square" />}
              onClick={async () => {
                setStreamingSession(null)
                await abortSession(sessionId, sessionDirectoryOf(sessionId)).catch(() => undefined)
              }}
            />
          ) : (
            <Button
              aria-label="发送"
              type="primary"
              shape="circle"
              className="chat-send-btn"
              icon={<ArrowUpOutlined />}
              disabled={text.trim().length === 0}
              onClick={() => void send()}
            />
          )}
        </div>
      </div>
      <div className="chat-input-hint">
        按 <kbd>Enter</kbd> 发送，<kbd>Shift+Enter</kbd> 换行，<kbd>↑</kbd> 上一条
      </div>
    </div>
  )
}
