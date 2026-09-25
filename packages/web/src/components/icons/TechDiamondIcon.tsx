import type { SVGProps } from "react"

/**
 * 科技感 3D 等轴测八面体（菱形宝石）空态图标。
 * 设计要点：
 * - 4 个切面用不同明度渐变模拟左上主光源；
 * - 外轮廓发青光描边 + 外发光 filter；
 * - 内部等轴网格线强化"科技感"；
 * - 外层 <g> 提供可被父级 font-size 驱动的尺寸（默认 viewBox 128×128）。
 */
export function TechDiamondIcon({
  className,
  style,
  "aria-hidden": ariaHidden = true,
  ...rest
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 128 128"
      width="1em"
      height="1em"
      fill="none"
      className={className}
      style={style}
      aria-hidden={ariaHidden}
      {...rest}
    >
      <defs>
        {/* 主光源（左上）→ 暗面（右下）四个面的渐变 */}
        <linearGradient id="td-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7ee8ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#3ba0ff" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="td-right" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2f7fd6" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#1d4e8a" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="td-bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#245d99" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#0f2b4d" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="td-left" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4fb4ff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#1e5a99" stopOpacity="0.85" />
        </linearGradient>
        {/* 描边光晕 */}
        <filter id="td-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 软阴影 */}
      <ellipse cx="64" cy="112" rx="28" ry="4" fill="#000" opacity="0.25" />

      {/*
        等轴测八面体：顶点 T(64,14)、底点 B(64,110)；
        腰环四点 L(18,62) R(110,62) F(64,38) BK(64,86)
        前腰是 F（远离观察者？不，等轴测：上半两个面 T-L-F / T-F-R；下半两个面 L-B-F / F-B-R）
        为简化画四个三角形构成上下两锥，上半亮、下半暗。
      */}
      <g filter="url(#td-glow)" strokeLinejoin="round">
        {/* 上半左前三角（最亮，迎光面） */}
        <path d="M64 14 L18 62 L64 38 Z" fill="url(#td-top)" stroke="#9ff0ff" strokeOpacity="0.9" strokeWidth="1" />
        {/* 上半右前三角（次亮） */}
        <path d="M64 14 L64 38 L110 62 Z" fill="url(#td-left)" stroke="#6cc8ff" strokeOpacity="0.75" strokeWidth="1" />
        {/* 下半左前三角（暗面） */}
        <path d="M18 62 L64 110 L64 86 Z" fill="url(#td-bottom)" stroke="#2f6ba8" strokeOpacity="0.85" strokeWidth="1" />
        {/* 下半右前三角（最暗） */}
        <path d="M64 86 L64 110 L110 62 Z" fill="url(#td-right)" stroke="#2a5f96" strokeOpacity="0.85" strokeWidth="1" />

        {/* 中心棱（上下连接边） */}
        <line x1="64" y1="14" x2="64" y2="110" stroke="#bff5ff" strokeOpacity="0.5" strokeWidth="0.8" />
        {/* 腰线（四面体水平截面） */}
        <path d="M18 62 L64 38 L110 62" stroke="#c7f6ff" strokeOpacity="0.55" strokeWidth="0.8" fill="none" />
        <path d="M18 62 L64 86 L110 62" stroke="#3f7fb8" strokeOpacity="0.7" strokeWidth="0.8" fill="none" />

        {/* 科技网格切角：上半面内部小三角（等轴小切角） */}
        <path d="M64 26 L38 50 L64 40 Z" fill="#cdf6ff" fillOpacity="0.18" stroke="none" />
        <path d="M64 26 L64 40 L90 50 Z" fill="#cdf6ff" fillOpacity="0.1" stroke="none" />
        {/* 下半面的细节线（呼应科技感刻面） */}
        <path d="M40 70 L64 96 L64 86 Z" fill="#000" fillOpacity="0.15" stroke="none" />
        <path d="M64 86 L64 96 L88 70 Z" fill="#000" fillOpacity="0.25" stroke="none" />

        {/* 高光线（顶面迎光边） */}
        <path d="M64 14 L18 62 L64 38 Z" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.6" fill="none" />

        {/* 中心高光点 */}
        <circle cx="58" cy="34" r="1.6" fill="#ffffff" fillOpacity="0.85" />
      </g>
    </svg>
  )
}
