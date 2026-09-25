/**
 * 插槽占位页：原型中未实现、系统暂未支持的功能统一落在这里。
 * 视觉沿用原型 token（--blue/--line/--muted 等），不打断整体风格。
 */
export function SlotPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="redesign-slot-page">
      <div className="redesign-slot-card">
        <span className="redesign-slot-badge">预留插槽</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  )
}
