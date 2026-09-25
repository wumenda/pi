import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App as AntdApp, ConfigProvider } from "antd"
import zhCN from "antd/locale/zh_CN"
import enUS from "antd/locale/en_US"
import App from "./App"
import { useAppStore } from "./stores/app-store"
import { antdThemeConfig } from "./theme"
import { useLangStore } from "./i18n/lang-store"
import { installGlobalErrorReporting } from "./utils/error-reporter"
import "./i18n"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

/** 订阅主题与语言：主题切换同步 antd 算法与 token（CSS 变量由 setTheme 直接写 <html data-theme>）；
 * 语言切换同步 antd locale（i18next/dayjs 由 lang-store 统一驱动） */
function ThemedProviders({ children }: { children: React.ReactNode }) {
  const themeMode = useAppStore((s) => s.theme)
  const lang = useLangStore((s) => s.lang)
  return (
    <ConfigProvider locale={lang === "en-US" ? enUS : zhCN} theme={antdThemeConfig(themeMode)}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}

// 渲染前同步初始主题到 <html data-theme>（避免首帧闪色）
document.documentElement.dataset.theme = useAppStore.getState().theme

// 全局错误上报（fire-and-forget 静默，不携带凭据）：渲染前安装，覆盖初始化阶段错误
installGlobalErrorReporting()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemedProviders>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemedProviders>
  </React.StrictMode>,
)
