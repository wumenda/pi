import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JsonValue } from "@earendil-works/chord";
import { isServerId } from "@earendil-works/pi-protocol";
import { AskUserCard } from "./features/chat/cards/AskUserCard.tsx";
import { isAskUserTool, parseAskUserInput } from "./features/chat/cards/answers.ts";
import type { AskUserInput, CardAnswers } from "./features/chat/cards/types.ts";
import { setHostContext } from "./features/mcp/pipeline.ts";
import { ToolExecutionPanel } from "./features/mcp/ToolExecutionPanel.tsx";
import { ToolTabBar } from "./features/mcp/ToolTabBar.tsx";
import { useIframeWorkspace } from "./features/mcp/useIframeWorkspace.ts";
import { SkillTabBar } from "./features/skills/SkillTabBar.tsx";
import { parseSkillBlockText, userMessageText } from "./features/skills/skill-parse.ts";
import { usePiApp } from "./state/pi-app.ts";

// ---------------------------------------------------------------------------
// Transcript wire-JSON 视图与聊天行模型
// ---------------------------------------------------------------------------

/** transcript 条目的最小结构视图（wire JSON；pi 侧 Entry 为 type 判别联合） */
interface TranscriptEntryLike {
	readonly id: string;
	readonly type: string;
	/** MessageEntry：AgentMessage wire JSON */
	readonly message?: unknown;
	/** compaction / branch_summary 条目的摘要文本 */
	readonly summary?: unknown;
}

/** 稳定的空 transcript，避免每次渲染产生新引用触发 effect 重跑 */
const EMPTY_ENTRIES: readonly TranscriptEntryLike[] = [];

type ToolCallStatus = "running" | "completed" | "error";

type ChatRow =
	| { kind: "user"; key: string; text: string; skill: { name: string; directory: string } | null }
	| { kind: "assistant"; key: string; text: string }
	| { kind: "thinking"; key: string; text: string }
	| { kind: "system"; key: string; text: string }
	| {
			kind: "tool-call";
			key: string;
			callId: string;
			name: string;
			args: unknown;
			status: ToolCallStatus;
			askInput: AskUserInput | undefined;
	  }
	| { kind: "tool-result"; key: string; toolName: string; text: string; isError: boolean };

function hasRole(message: unknown, role: string): boolean {
	return typeof message === "object" && message !== null && (message as { role?: unknown }).role === role;
}

function textPartsText(content: unknown, separator: string): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text")
		.map((part) => {
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.join(separator);
}

function toolResultInfo(message: unknown): { toolCallId: string; toolName: string; text: string; isError: boolean } | null {
	if (!hasRole(message, "toolResult")) return null;
	const raw = message as { toolCallId?: unknown; toolName?: unknown; isError?: unknown; content?: unknown };
	return {
		toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : "",
		toolName: typeof raw.toolName === "string" ? raw.toolName : "",
		text: textPartsText(raw.content, "\n"),
		isError: raw.isError === true,
	};
}

function buildChatRows(entries: readonly TranscriptEntryLike[]): ChatRow[] {
	const results = new Map<string, { text: string; isError: boolean }>();
	for (const entry of entries) {
		const info = toolResultInfo(entry.message);
		if (info !== null && info.toolCallId.length > 0) {
			results.set(info.toolCallId, { text: info.text, isError: info.isError });
		}
	}

	const rows: ChatRow[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") {
			const summary = entry.summary;
			if (
				(entry.type === "compaction" || entry.type === "branch_summary") &&
				typeof summary === "string" &&
				summary.length > 0
			) {
				rows.push({ kind: "system", key: `s${entry.id}`, text: summary });
			}
			continue;
		}
		const message = entry.message;
		if (hasRole(message, "user")) {
			const text = userMessageText(message);
			if (text.length === 0) continue;
			const skill = parseSkillBlockText(text);
			rows.push({ kind: "user", key: `u${entry.id}`, text, skill });
			continue;
		}
		if (hasRole(message, "assistant")) {
			const content = (message as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			content.forEach((part, index) => {
				const type = (part as { type?: unknown } | null)?.type;
				if (type === "text") {
					const text = (part as { text?: unknown }).text;
					if (typeof text === "string" && text.trim().length > 0) {
						rows.push({ kind: "assistant", key: `a${entry.id}:${index}`, text });
					}
				} else if (type === "thinking") {
					const thinking = (part as { thinking?: unknown }).thinking;
					if (typeof thinking === "string" && thinking.trim().length > 0) {
						rows.push({ kind: "thinking", key: `t${entry.id}:${index}`, text: thinking });
					}
				} else if (type === "toolCall") {
					const raw = part as { id?: unknown; name?: unknown; arguments?: unknown };
					const callId = typeof raw.id === "string" ? raw.id : `${entry.id}:${index}`;
					const name = typeof raw.name === "string" ? raw.name : "";
					const result = results.get(callId);
					const askInput = isAskUserTool(name) ? parseAskUserInput(raw.arguments) : undefined;
					rows.push({
						kind: "tool-call",
						key: `c${entry.id}:${index}`,
						callId,
						name,
						args: raw.arguments,
						status: result === undefined ? "running" : result.isError ? "error" : "completed",
						askInput,
					});
				}
			});
			continue;
		}
		const info = toolResultInfo(message);
		if (info === null) continue;
		rows.push({ kind: "tool-result", key: `r${entry.id}`, toolName: info.toolName, text: info.text, isError: info.isError });
	}
	return rows;
}

// ---------------------------------------------------------------------------
// 聊天行渲染组件（顶层定义，避免重挂载）
// ---------------------------------------------------------------------------

type ToolCallRow = Extract<ChatRow, { kind: "tool-call" }>;

function ToolCallChip({ row }: { row: ToolCallRow }): ReactNode {
	const [open, setOpen] = useState(false);
	return (
		<div className={`tool-call-chip tool-call-${row.status}`}>
			<span className="tool-call-dot" aria-hidden="true" />
			<span className="tool-call-name">{row.name.length > 0 ? row.name : "tool"}</span>
			<button type="button" className="tool-call-toggle" onClick={() => setOpen((previous) => !previous)}>
				{open ? "收起" : "详情"}
			</button>
			{open && <pre className="tool-call-args">{JSON.stringify(row.args, null, 2)}</pre>}
		</div>
	);
}

function ChatRowView({
	row,
	onAnswerAsk,
}: {
	row: ChatRow;
	onAnswerAsk: (toolCallId: string, answers: CardAnswers) => Promise<void>;
}): ReactNode {
	if (row.kind === "user") {
		if (row.skill !== null) {
			return (
				<div className="message-row message-row-skill" title={row.skill.directory}>
					<span className="skill-chip">⚡ {row.skill.name}</span>
				</div>
			);
		}
		return (
			<div className="message-row message-row-user">
				<div className="message-bubble">
					<div className="message-text">{row.text}</div>
				</div>
			</div>
		);
	}
	if (row.kind === "system") {
		return (
			<div className="message-row message-row-system">
				<div className="system-text">{row.text}</div>
			</div>
		);
	}
	if (row.kind === "assistant") {
		return (
			<div className="message-row">
				<div className="message-bubble">
					<div className="message-text">{row.text}</div>
				</div>
			</div>
		);
	}
	if (row.kind === "thinking") {
		return (
			<details className="thinking-row">
				<summary>思考过程</summary>
				<div className="thinking-text">{row.text}</div>
			</details>
		);
	}
	if (row.kind === "tool-call") {
		if (row.askInput !== undefined) {
			return (
				<div className="message-row">
					<AskUserCard
						input={row.askInput}
						resolved={row.status !== "running"}
						onSubmit={(answers) => onAnswerAsk(row.callId, answers)}
					/>
				</div>
			);
		}
		return <ToolCallChip row={row} />;
	}
	return (
		<details className={`tool-result${row.isError ? " tool-result-error" : ""}`}>
			<summary>{row.toolName.length > 0 ? row.toolName : "tool"} 返回</summary>
			<pre className="tool-result-text">{row.text}</pre>
		</details>
	);
}

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App(): ReactNode {
	const pi = usePiApp();
	const [theme, setTheme] = useState<"light" | "dark">("light");
	const [sessionsOpen, setSessionsOpen] = useState(false);
	const [mobileView, setMobileView] = useState<"workspace" | "chat">("chat");
	const [url, setUrl] = useState("ws://127.0.0.1:8787");
	const [httpBase, setHttpBase] = useState("http://127.0.0.1:8791");
	const [serverId, setServerId] = useState("");
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

	// 主题：写 data-theme，宿主 getTheme 与 iframe 内样式共用
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	// MCP Apps 宿主上下文：反向 tools/call 与 ui:// 资源读取经 pi.mcp-host chord 服务路由；
	// getHttpBase 供 iframe 以 HTTP src 加载 ui-resources 端点文档
	useEffect(() => {
		setHostContext({
			getTheme: () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
			getSessionId: () => pi.activeSessionId,
			getHttpBase: () => httpBase,
			callTool: (name, args, sid) => pi.callMcpTool(sid ?? null, name, args),
			getUiResource: (sid, resourceUri) => pi.getMcpUiResource(sid, resourceUri),
			getToolEvents: () => pi.getToolEvents(),
		});
	}, [pi.activeSessionId, pi.callMcpTool, pi.getMcpUiResource, pi.getToolEvents, httpBase]);

	const entries: readonly TranscriptEntryLike[] = pi.transcript?.snapshot?.transcript ?? EMPTY_ENTRIES;
	const workspace = useIframeWorkspace(entries, pi.activeSessionId ?? null);
	const rows = useMemo(() => buildChatRows(entries), [entries]);

	useEffect(() => {
		const list = listRef.current;
		if (list !== null) list.scrollTop = list.scrollHeight;
	}, [rows.length, pi.activeSessionId]);

	const send = async (payload: string): Promise<void> => {
		setSending(true);
		try {
			await pi.prompt(payload);
		} finally {
			setSending(false);
		}
	};

	const answerAsk = useCallback(
		async (toolCallId: string, answers: CardAnswers): Promise<void> => {
			await pi.answerAskUser(toolCallId, answers as JsonValue);
		},
		[pi.answerAskUser],
	);

	const submitDraft = (): void => {
		const text = draft.trim();
		if (text.length === 0 || sending) return;
		setDraft("");
		void send(text);
	};

	if (pi.phase !== "ready") {
		const serverIdValid = isServerId(serverId.trim());
		return (
			<div className="state-view">
				<div className="state-view-card">
					<div className="state-view-icon">π</div>
					<h1 className="state-view-title">Pi Web</h1>
					<p className="state-view-sub">
						{pi.phase === "connecting" ? "正在连接 pi-server…" : "连接 pi-server 以开始对话"}
					</p>
					<form
						className="state-view-form"
						onSubmit={(event) => {
							event.preventDefault();
							pi.connect(url, serverId);
						}}
					>
						<label className="state-view-field">
							Endpoint
							<input
								className="state-view-input"
								value={url}
								onChange={(event) => setUrl(event.target.value)}
								spellCheck={false}
							/>
						</label>
						<label className="state-view-field">
							HTTP Base
							<input
								className="state-view-input"
								value={httpBase}
								onChange={(event) => setHttpBase(event.target.value)}
								placeholder="http://127.0.0.1:8791"
								spellCheck={false}
							/>
						</label>
						<label className="state-view-field">
							Server ID
							<input
								className="state-view-input"
								value={serverId}
								onChange={(event) => setServerId(event.target.value)}
								placeholder="00000000-0000-4000-8000-000000000000"
								spellCheck={false}
							/>
						</label>
						{pi.error !== undefined && <p className="state-view-error">{pi.error}</p>}
						<button
							type="submit"
							className="ask-btn ask-btn-primary ask-btn-block"
							disabled={pi.phase === "connecting" || !serverIdValid}
						>
							{pi.phase === "connecting" ? "连接中…" : "连接"}
						</button>
					</form>
				</div>
			</div>
		);
	}

	const running = typeof pi.transcript?.snapshot?.operation?.id === "string";

	return (
		<div className={`app-layout view-${mobileView}${sessionsOpen ? " sessions-open" : ""}`}>
			<header className="mobile-bar">
				<button type="button" className="chat-menu-btn" aria-label="打开会话列表" onClick={() => setSessionsOpen(true)}>
					☰
				</button>
				<nav className="mobile-tabs">
					<button
						type="button"
						className={`mobile-tab${mobileView === "workspace" ? " mobile-tab-active" : ""}`}
						onClick={() => setMobileView("workspace")}
					>
						工作区
					</button>
					<button
						type="button"
						className={`mobile-tab${mobileView === "chat" ? " mobile-tab-active" : ""}`}
						onClick={() => setMobileView("chat")}
					>
						对话
					</button>
				</nav>
				<button
					type="button"
					className="theme-toggle"
					aria-label="切换主题"
					onClick={() => setTheme((previous) => (previous === "light" ? "dark" : "light"))}
				>
					{theme === "light" ? "☾" : "☀"}
				</button>
			</header>
			<aside className="left-pane">
				<div className="sidebar-header">
					<span className="sidebar-title">会话</span>
					<button
						type="button"
						className="sidebar-new-btn"
						onClick={() => {
							void pi.createSession();
							setSessionsOpen(false);
						}}
					>
						+ 新建
					</button>
				</div>
				<div className="session-list">
					{(pi.sessions ?? []).map((session) => {
						const active = session.sessionId === pi.activeSessionId;
						return (
							<button
								type="button"
								key={session.sessionId}
								className={`session-item${active ? " session-item-active" : ""}`}
								onClick={() => {
									void pi.attachSession(session.sessionId);
									setSessionsOpen(false);
								}}
							>
								<span className="session-title">{session.sessionId.slice(0, 8)}</span>
								<span className="session-time">{formatTime(session.createdAt)}</span>
							</button>
						);
					})}
					{(pi.sessions ?? []).length === 0 && <div className="sidebar-empty">暂无会话，点击新建开始</div>}
				</div>
				<div className="sidebar-footer">
					<span
						className={`status-dot ${pi.connectionState === "connected" ? "status-dot-on" : "status-dot-off"}`}
						aria-hidden="true"
					/>
					<span className="sidebar-status">
						{pi.connectionState === "connected" ? "已连接" : pi.connectionState}
					</span>
					<button type="button" className="ask-btn ask-btn-text" onClick={() => pi.disconnect()}>
						断开
					</button>
				</div>
			</aside>

			<section className="center-pane">
				<SkillTabBar
					instances={workspace.skillInstances}
					iframePool={workspace.pool}
					activeGroup={workspace.activeGroup}
					onActivate={workspace.setActiveGroup}
					sessionKey={pi.activeSessionId ?? null}
				/>
				<ToolTabBar
					pool={workspace.pool}
					activeUri={workspace.activeUri}
					activeGroup={workspace.activeGroup}
					onActivate={workspace.activateIframe}
					onClose={workspace.releaseIframe}
				/>
				<ToolExecutionPanel pool={workspace.pool} activeUri={workspace.activeUri} activeGroup={workspace.activeGroup} />
			</section>

			<aside className="right-pane">
				<div className="chat-header">
					<div className="chat-header-info">
						<button type="button" className="chat-menu-btn" aria-label="打开会话列表" onClick={() => setSessionsOpen(true)}>
							☰
						</button>
						<div className="chat-header-icon">π</div>
						<div className="chat-header-meta">
							<div className="chat-header-title">Pi 对话</div>
							<div className="chat-header-status">
								<span
									className={`status-dot ${pi.connectionState === "connected" ? "status-dot-on" : "status-dot-off"}`}
									aria-hidden="true"
								/>
								{pi.activeSessionId !== undefined ? pi.activeSessionId.slice(0, 8) : "未选择会话"}
							</div>
						</div>
					</div>
					<button
						type="button"
						className="theme-toggle"
						aria-label="切换主题"
						onClick={() => setTheme((previous) => (previous === "light" ? "dark" : "light"))}
					>
						{theme === "light" ? "☾" : "☀"}
					</button>
				</div>
				<div className="message-list" ref={listRef}>
					{rows.length === 0 && <div className="message-list-empty">选择或新建会话后开始对话</div>}
					{rows.map((row) => (
						<ChatRowView key={row.key} row={row} onAnswerAsk={answerAsk} />
					))}
				</div>
				{pi.promptError !== undefined && <div className="prompt-error">{pi.promptError}</div>}
				<form
					className="chat-input"
					onSubmit={(event) => {
						event.preventDefault();
						submitDraft();
					}}
				>
					<div className="chat-input-box">
						<textarea
							className="chat-input-textarea"
							value={draft}
							rows={2}
							placeholder="输入消息，Enter 发送，Shift+Enter 换行"
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
									event.preventDefault();
									submitDraft();
								}
							}}
						/>
						<div className="chat-input-toolbar">
							<span className="chat-input-hint">Enter 发送 · Shift+Enter 换行</span>
							{running && (
								<button type="button" className="chat-send-btn chat-send-btn-stop" onClick={() => void pi.abort()}>
									停止
								</button>
							)}
							<button type="submit" className="chat-send-btn" disabled={sending || draft.trim().length === 0}>
								{sending ? "发送中" : "发送"}
							</button>
						</div>
					</div>
				</form>
			</aside>
			{sessionsOpen && (
				<button type="button" className="drawer-scrim" aria-label="关闭会话列表" onClick={() => setSessionsOpen(false)} />
			)}
		</div>
	);
}
