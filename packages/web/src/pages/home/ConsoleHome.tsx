import { App as AntdApp } from "antd"
import { createSession } from "../../api/sessions"
import { sendPrompt } from "../../api/messages"
import { navigateSession } from "../../redesign/routes"
import { HomePage } from "../../redesign/pages/home/HomePage"
import { useAppStore } from "../../stores/app-store"

/** 首页 = redesign HomePage；「启动任务/开始诊断」真实创建会话并把目标作为首条消息 */
export function ConsoleHome() {
  const upsertSession = useAppStore((s) => s.upsertSession)
  const setCurrentSession = useAppStore((s) => s.setCurrentSession)
  const { message } = AntdApp.useApp()

  // pi 适配：失败必须可见（未连接/serverId 不匹配时否则表现为"点了没反应"）
  async function onStartTask(text: string) {
    try {
      const created = await createSession(text.slice(0, 40))
      upsertSession(created)
      setCurrentSession(created.id)
      navigateSession(created.id)
      await sendPrompt(created.id, text)
    } catch (e) {
      message.error(`创建会话失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return <HomePage onStartTask={onStartTask} />
}
