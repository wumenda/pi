import { useEffect, useState, type ReactNode } from "react"
import { Form, Input, Modal } from "antd"
import { ApiOutlined } from "@ant-design/icons"
import { loadConnectionPrefs, saveConnectionPrefs, usePiStore } from "../../pi/pi-app"

/**
 * pi 连接门（pi 适配新增，UI 不属于复刻范围）：
 * - 已连接：右下角状态徽标（绿点）；
 * - 未连接/连接失败：黄色徽标 + 点击弹出连接配置（WS URL / serverId / token）；
 * - 配置持久化 localStorage，下次启动自动连接。
 */
export function ConnectionGate(): ReactNode {
	const phase = usePiStore((s) => s.phase)
	const connectionState = usePiStore((s) => s.connectionState)
	const error = usePiStore((s) => s.error)
	const connect = usePiStore((s) => s.connect)
	const [open, setOpen] = useState(false)
	const [form] = Form.useForm<{ url: string; serverId: string; token?: string }>()

	const connected = phase === "ready" && connectionState === "connected"
	const connecting = phase === "connecting"

	// 自动连接失败（error 非空且未在连接中）→ 自动弹开配置（预填已保存偏好）
	useEffect(() => {
		if (error !== undefined && phase === "idle" && connectionState === "disconnected") {
			const prefs = loadConnectionPrefs()
			form.setFieldsValue({ url: prefs.url, serverId: prefs.serverId, token: prefs.token })
			setOpen(true)
		}
	}, [error, phase, connectionState, form])

	const openDialog = (): void => {
		const prefs = loadConnectionPrefs()
		form.setFieldsValue({ url: prefs.url, serverId: prefs.serverId, token: prefs.token })
		setOpen(true)
	}

	const submit = (): void => {
		void form
			.validateFields()
			.then((values) => {
				saveConnectionPrefs(values)
				connect(values)
				setOpen(false)
			})
			.catch(() => undefined)
	}

	return (
		<>
			<button
				type="button"
				className="pi-connection-badge"
				onClick={() => (connected ? undefined : openDialog())}
				title={connected ? "已连接 pi-server" : (error ?? "未连接 pi-server，点击配置")}
				style={{ cursor: connected ? "default" : "pointer" }}
			>
				<ApiOutlined style={{ fontSize: 14 }} />
				<span
					className={`status-dot ${connected ? "status-dot-on" : connecting ? "status-dot-on" : "status-dot-off"}`}
					aria-hidden="true"
				/>
				<span className="pi-connection-text">
					{connecting ? "连接中" : connected ? "已连接" : "未连接"}
				</span>
			</button>
			<Modal
				title="连接 pi-server"
				open={open}
				onOk={submit}
				onCancel={() => setOpen(false)}
				okText={connecting ? "连接中…" : "连接"}
				cancelText="取消"
				confirmLoading={connecting}
				destroyOnHidden
			>
				<Form form={form} layout="vertical" component={false}>
					<Form.Item
						label="WebSocket 地址"
						name="url"
						rules={[{ required: true, message: "请输入 pi-server WS 地址" }]}
						extra="app-server 默认 ws://127.0.0.1:8790（启动日志打印）"
					>
						<Input spellCheck={false} placeholder="ws://127.0.0.1:8790" />
					</Form.Item>
					<Form.Item
						label="Server ID"
						name="serverId"
						rules={[
							{ required: true, message: "请输入 serverId" },
							{
								pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
								message: "必须是小写 UUIDv4（app-server 启动日志打印）",
							},
						]}
					>
						<Input spellCheck={false} placeholder="00000000-0000-4000-8000-000000000000" />
					</Form.Item>
					<Form.Item label="访问令牌（可选）" name="token" extra="设置 APP_SERVER_TOKEN 时填写">
						<Input.Password spellCheck={false} placeholder="APP_SERVER_TOKEN" />
					</Form.Item>
				</Form>
				{error !== undefined && (
					<div style={{ color: "var(--th-danger, #cf1322)", fontSize: 12 }}>{error}</div>
				)}
			</Modal>
		</>
	)
}
