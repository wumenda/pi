import { Component, type ErrorInfo, type ReactNode } from "react"
import { reportError } from "../utils/error-reporter"

interface ErrorBoundaryProps {
  children: ReactNode
  /** fallback 中显示的局部说明（如"消息流"/"工具面板"）；缺省为通用文案 */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | undefined
}

/**
 * 渲染错误边界：捕获子树渲染异常，降级为可操作的兜底 UI，而不是把整树卸载成白屏。
 *
 * fallback 故意只用原生 HTML + 内联样式：边界要在任何依赖（antd/主题/CSS）自身
 * 出错时依然能渲染出来。错误经 error-reporter 上报（带 componentStack，与全局
 * window error 上报同通道、同去重），控制台保留完整堆栈便于排查。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: undefined }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- 保留完整堆栈供开发者排查；用户只见 fallback
    console.error("[ErrorBoundary]", error, info.componentStack)
    reportError({
      message: error.message,
      stack: info.componentStack ? `${error.stack ?? ""}\n${info.componentStack}` : error.stack,
    })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 24,
          color: "inherit",
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600 }}>{this.props.label ?? "界面组件渲染出错"}</div>
        <div style={{ opacity: 0.7, maxWidth: 480, wordBreak: "break-all" }}>{error.message}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: "4px 16px", cursor: "pointer" }}
        >
          重新加载
        </button>
      </div>
    )
  }
}
