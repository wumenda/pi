/**
 * 主题化下拉选择（替代原生 <select>）：原生弹出列表由浏览器渲染、无法主题化，
 * 此组件用按钮 + 自绘列表实现统一视觉，支持键盘导航（Enter/Space 开、↑↓ 移动、
 * Enter 选中、Esc/Tab 关闭）、点击外部关闭、悬停高亮与选中勾标。
 */
import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

export interface ThemeSelectOption {
  value: string
  label: string
}

interface ThemeSelectProps {
  value: string
  onChange: (value: string) => void
  /** 字符串数组（value=label）或 {value,label} 对象数组 */
  options: readonly string[] | readonly ThemeSelectOption[]
  id?: string
  ariaLabel?: string
}

export function ThemeSelect({ value, onChange, options, id, ariaLabel }: ThemeSelectProps) {
  const opts: ThemeSelectOption[] = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  )
  const selectedIdx = Math.max(0, opts.findIndex((o) => o.value === value))
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(selectedIdx)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)

  const openMenu = (): void => {
    setActiveIdx(selectedIdx)
    setOpen(true)
  }

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  // 键盘导航时保持活动项可见
  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelectorAll("li")
      [activeIdx]?.scrollIntoView({ block: "nearest" })
  }, [open, activeIdx])

  const commit = (idx: number): void => {
    const opt = opts[idx]
    if (opt) onChange(opt.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault()
        if (open) commit(activeIdx)
        else openMenu()
        break
      case "Escape":
        setOpen(false)
        break
      case "ArrowDown":
        e.preventDefault()
        if (!open) {
          openMenu()
        } else {
          setActiveIdx((i) => Math.min(opts.length - 1, i + 1))
        }
        break
      case "ArrowUp":
        e.preventDefault()
        if (!open) {
          openMenu()
        } else {
          setActiveIdx((i) => Math.max(0, i - 1))
        }
        break
      case "Tab":
        setOpen(false)
        break
    }
  }

  const selected = opts[selectedIdx]

  return (
    <div className="rs-select" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        id={id}
        className={`rs-select-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="rs-select-value">{selected?.label ?? value}</span>
        <ChevronDown size={15} className={`rs-select-chevron ${open ? "rotated" : ""}`} />
      </button>
      {open && (
        <ul className="rs-select-menu" role="listbox" ref={menuRef}>
          {opts.map((o, i) => {
            const isSelected = o.value === value
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                className={`rs-select-option ${i === activeIdx ? "active" : ""} ${isSelected ? "selected" : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => commit(i)}
              >
                <span>{o.label}</span>
                {isSelected && <Check size={14} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
