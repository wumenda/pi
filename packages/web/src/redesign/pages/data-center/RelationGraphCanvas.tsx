/** 任务资料关系图画布（平移/缩放/拖拽/小地图/节点详情）：数据来自 GET /api/v1/data-center/graph/:taskId */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from "react"
import { ArrowLeft, Maximize2, Move, X, ZoomIn, ZoomOut } from "lucide-react"
import { useTheme } from "../../theme"
import type {
  DataCenterGraphNode,
  DataCenterGraphDTO,
  DataCenterMaterialDTO,
  DataCenterResultDTO,
} from "@platform/shared"
import { fetchDataCenterGraph } from "../../../api/data-center"

type RelationNodeType = DataCenterGraphNode["type"]
type FileData = DataCenterMaterialDTO | DataCenterResultDTO

const NODE_WIDTH = 168
const NODE_HEIGHT = 56

interface NodeStyle {
  fill: string
  stroke: string
  tag: string
  tagBg: string
  tagText: string
  icon: string
}

const NODE_STYLE: Record<RelationNodeType, NodeStyle> = {
  raw: { fill: "#ffffff", stroke: "#3168ff", tag: "原始资料", tagBg: "#edf5ff", tagText: "#2d5cff", icon: "#3168ff" },
  stage: { fill: "#f4f8ff", stroke: "#2d69ff", tag: "任务阶段", tagBg: "#2563eb", tagText: "#ffffff", icon: "#2d69ff" },
  intermediate: { fill: "#fffbf5", stroke: "#f59e0b", tag: "中间成果", tagBg: "#fef3c7", tagText: "#b45309", icon: "#f59e0b" },
  final: { fill: "#f0fdf4", stroke: "#16a34a", tag: "最终成果", tagBg: "#dcfce7", tagText: "#15803d", icon: "#16a34a" },
}

/** 暗色主题节点样式：浅底 → 深色同调底，标签保持语义色 */
const NODE_STYLE_DARK: Record<RelationNodeType, NodeStyle> = {
  raw: { fill: "#1b2540", stroke: "#6d93ff", tag: "原始资料", tagBg: "rgba(80, 120, 255, 0.18)", tagText: "#9db4ff", icon: "#6d93ff" },
  stage: { fill: "#1b2540", stroke: "#5b82ff", tag: "任务阶段", tagBg: "#2563eb", tagText: "#ffffff", icon: "#5b82ff" },
  intermediate: { fill: "#282114", stroke: "#f59e0b", tag: "中间成果", tagBg: "rgba(245, 158, 11, 0.16)", tagText: "#fbbf24", icon: "#f59e0b" },
  final: { fill: "#15251a", stroke: "#22c55e", tag: "最终成果", tagBg: "rgba(34, 197, 94, 0.16)", tagText: "#4ade80", icon: "#22c55e" },
}

function useNodeStyles(): Record<RelationNodeType, NodeStyle> {
  const [theme] = useTheme()
  return theme === "dark" ? NODE_STYLE_DARK : NODE_STYLE
}

interface Point {
  x: number
  y: number
}

interface Transform {
  x: number
  y: number
  scale: number
}

// 贝塞尔曲线连接，柔和曲线
function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = Math.abs(tx - sx)
  const cx = Math.max(60, dx * 0.5)
  const c1x = sx + cx
  const c2x = tx - cx
  return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`
}

interface RelationGraphCanvasProps {
  taskId: string
  /** 初始聚焦的节点 id（g-<refId>，可为 null） */
  focusNodeId: string | null
  /** 节点详情回查数据源（与关系图同源的聚合清单） */
  materials: DataCenterMaterialDTO[]
  results: DataCenterResultDTO[]
  taskName: string
  onClose: () => void
}

export function RelationGraphCanvas({
  taskId,
  focusNodeId,
  materials,
  results,
  taskName,
  onClose,
}: RelationGraphCanvasProps) {
  const nodeStyles = useNodeStyles()
  const [theme] = useTheme()
  const graphInk = theme === "dark" ? "#c3d0f4" : "#0b1b6e"
  const [graph, setGraph] = useState<DataCenterGraphDTO | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 })
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, originX: 0, originY: 0 })
  const dragStart = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 })
  const [nodePositions, setNodePositions] = useState<Record<string, Point>>({})
  const svgRef = useRef<SVGSVGElement | null>(null)
  // fitToCanvas 需要稳定身份（否则 fit effect 随 nodePositions 变化反复重跑，
  // 拖拽节点时视图被不断重置），节点位置经 ref 读取
  const nodePositionsRef = useRef(nodePositions)
  useEffect(() => {
    nodePositionsRef.current = nodePositions
  }, [nodePositions])

  // 真实关系图加载（由后端按注册表关联关系推导）
  useEffect(() => {
    let cancelled = false
    setGraphError(null)
    fetchDataCenterGraph(taskId)
      .then((g) => {
        if (cancelled) return
        setGraph(g)
        const map: Record<string, Point> = {}
        g.nodes.forEach((n) => {
          map[n.id] = { x: n.x, y: n.y }
        })
        setNodePositions(map)
      })
      .catch(() => {
        if (!cancelled) setGraphError("关系图加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []

  const getNodeByRefId = useCallback(
    (refId: string): FileData | null =>
      materials.find((m) => m.id === refId) || results.find((r) => r.id === refId) || null,
    [materials, results],
  )

  // 初始适应画布
  const fitToCanvas = useCallback(() => {
    const positions = Object.values(nodePositionsRef.current)
    if (positions.length === 0) return
    const xs = positions.map((p) => p.x)
    const ys = positions.map((p) => p.y)
    const minX = Math.min(...xs) - 20
    const minY = Math.min(...ys) - 20
    const maxX = Math.max(...xs) + NODE_WIDTH + 20
    const maxY = Math.max(...ys) + NODE_HEIGHT + 20
    const contentW = maxX - minX
    const contentH = maxY - minY
    const svgRect = svgRef.current?.getBoundingClientRect()
    if (!svgRect || svgRect.width === 0 || svgRect.height === 0) return
    const padding = 40
    const availW = Math.max(svgRect.width - padding * 2, 1)
    const availH = Math.max(svgRect.height - padding * 2, 1)
    const scaleX = availW / contentW
    const scaleY = availH / contentH
    const scale = Math.max(0.2, Math.min(scaleX, scaleY, 1))
    const offsetX = padding - minX * scale + (availW - contentW * scale) / 2
    const offsetY = padding - minY * scale + (availH - contentH * scale) / 2
    setTransform({ x: offsetX, y: offsetY, scale })
  }, [])

  useEffect(() => {
    // 等待画布布局完成后再适应，部分场景需要多次重试才能拿到真实尺寸
    if (!graph) return
    let raf = 0
    let attempts = 0
    const tryFit = () => {
      const svgRect = svgRef.current?.getBoundingClientRect()
      if (svgRect && svgRect.width > 0 && svgRect.height > 0) {
        fitToCanvas()
        return
      }
      if (attempts++ < 10) {
        raf = window.requestAnimationFrame(tryFit)
      } else {
        // 兜底：用默认 transform 居中显示
        fitToCanvas()
      }
    }
    raf = window.requestAnimationFrame(tryFit)
    return () => window.cancelAnimationFrame(raf)
  }, [graph, fitToCanvas])

  // 自动聚焦指定节点
  useEffect(() => {
    if (!focusNodeId || !graph) return
    const pos = nodePositions[focusNodeId]
    if (!pos) return
    setSelectedNode(focusNodeId)
    // 延后到 fit 的 rAF 之后执行（fit effect 先声明先调度，同帧顺序触发），
    // 避免初始 fit 覆盖聚焦变换；scale 经函数式更新取 fit 后的最新值
    let raf = 0
    raf = window.requestAnimationFrame(() => {
      const svgRect = svgRef.current?.getBoundingClientRect()
      if (!svgRect) return
      setTransform((t) => ({
        ...t,
        x: svgRect.width / 2 - (pos.x + NODE_WIDTH / 2) * t.scale,
        y: svgRect.height / 2 - (pos.y + NODE_HEIGHT / 2) * t.scale,
      }))
    })
    return () => window.cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, graph])

  const zoomBy = useCallback((factor: number) => {
    setTransform((t) => {
      const svgRect = svgRef.current?.getBoundingClientRect()
      const cx = svgRect ? svgRect.width / 2 : 0
      const cy = svgRect ? svgRect.height / 2 : 0
      const newScale = Math.min(2, Math.max(0.4, t.scale * factor))
      const k = newScale / t.scale
      return {
        scale: newScale,
        x: cx - (cx - t.x) * k,
        y: cy - (cy - t.y) * k,
      }
    })
  }, [])

  // 滚轮缩放：React 18 将 wheel 注册为 passive 合成事件，合成 onWheel 内
  // preventDefault 无效（页面同时滚动），必须挂原生非 passive 监听
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 0.92
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setTransform((t) => {
        const newScale = Math.min(2, Math.max(0.4, t.scale * factor))
        const k = newScale / t.scale
        return {
          scale: newScale,
          x: mx - (mx - t.x) * k,
          y: my - (my - t.y) * k,
        }
      })
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [])

  const onCanvasMouseDown = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest("[data-node-id]")) return
      setPanning(true)
      panStart.current = { x: e.clientX, y: e.clientY, originX: transform.x, originY: transform.y }
    },
    [transform.x, transform.y],
  )

  useEffect(() => {
    if (!panning && !draggingNode) return
    const onMove = (e: MouseEvent) => {
      if (draggingNode) {
        const dx = (e.clientX - dragStart.current.x) / transform.scale
        const dy = (e.clientY - dragStart.current.y) / transform.scale
        setNodePositions((prev) => ({
          ...prev,
          [draggingNode]: { x: dragStart.current.nodeX + dx, y: dragStart.current.nodeY + dy },
        }))
      } else if (panning) {
        setTransform((t) => ({
          ...t,
          x: panStart.current.originX + (e.clientX - panStart.current.x),
          y: panStart.current.originY + (e.clientY - panStart.current.y),
        }))
      }
    }
    const onUp = () => {
      setPanning(false)
      setDraggingNode(null)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [panning, draggingNode, transform.scale])

  const onNodeMouseDown = useCallback(
    (e: ReactMouseEvent<SVGGElement>, nodeId: string) => {
      e.stopPropagation()
      const pos = nodePositions[nodeId]
      if (!pos) return
      dragStart.current = { x: e.clientX, y: e.clientY, nodeX: pos.x, nodeY: pos.y }
      setDraggingNode(nodeId)
    },
    [nodePositions],
  )

  const onNodeClick = useCallback((nodeId: string) => {
    setSelectedNode((prev) => (prev === nodeId ? null : nodeId))
  }, [])

  // 高亮计算：选中节点的上下游
  const highlightSet = useMemo(() => {
    if (!selectedNode) return null
    const related = new Set<string>([selectedNode])
    const queue: string[] = [selectedNode]
    while (queue.length > 0) {
      const cur = queue.shift()
      if (cur === undefined) break
      edges.forEach((edge) => {
        if (edge.from === cur && !related.has(edge.to)) {
          related.add(edge.to)
          queue.push(edge.to)
        }
        if (edge.to === cur && !related.has(edge.from)) {
          related.add(edge.from)
          queue.push(edge.from)
        }
      })
    }
    return related
  }, [selectedNode, edges])

  const selectedNodeData = useMemo(
    () => nodes.find((n) => n.id === selectedNode) || null,
    [nodes, selectedNode],
  )

  const selectedDetail = useMemo(() => {
    if (!selectedNodeData) return null
    if (selectedNodeData.refId) return getNodeByRefId(selectedNodeData.refId)
    return null
  }, [selectedNodeData, getNodeByRefId])

  // 选中节点使用的阶段
  const selectedStages = useMemo(() => {
    if (!selectedNode) return []
    const stages = new Set<string>()
    edges.forEach((edge) => {
      const targetNode = nodes.find((n) => n.id === edge.to)
      const sourceNode = nodes.find((n) => n.id === edge.from)
      if (edge.from === selectedNode && targetNode?.type === "stage") stages.add(targetNode.label)
      if (edge.to === selectedNode && sourceNode?.type === "stage") stages.add(sourceNode.label)
    })
    return [...stages]
  }, [selectedNode, nodes, edges])

  return (
    <div className="dc-relation-graph">
      <header className="dc-graph-header">
        <div className="dc-graph-title">
          <button type="button" className="dc-graph-back" onClick={onClose} aria-label="返回数据中心">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2>任务资料关系图</h2>
            <p>{taskName} · 资料输入、阶段处理与成果输出追溯</p>
          </div>
        </div>
        <div className="dc-graph-tools">
          <button type="button" onClick={() => zoomBy(0.85)} title="缩小">
            <ZoomOut size={18} />
          </button>
          <button type="button" onClick={() => zoomBy(1.18)} title="放大">
            <ZoomIn size={18} />
          </button>
          <button type="button" onClick={fitToCanvas} title="适应画布">
            <Maximize2 size={18} />
          </button>
          <span className="dc-graph-zoom-label">{Math.round(transform.scale * 100)}%</span>
        </div>
      </header>

      <div className="dc-graph-body">
        <div className="dc-graph-canvas-wrap">
          {graphError && <div className="dc-empty-row dc-error-row">{graphError}</div>}
          {graph && nodes.length === 0 && (
            <div className="dc-empty-row">该任务暂无关联资料与成果（上传资料时可关联任务）</div>
          )}
          <svg
            ref={svgRef}
            className="dc-graph-canvas"
            onMouseDown={onCanvasMouseDown}
            role="application"
            aria-label="任务资料关系图画布"
          >
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
              {/* 连线 */}
              {edges.map((edge, idx) => {
                const s = nodePositions[edge.from]
                const t = nodePositions[edge.to]
                if (!s || !t) return null
                const sx = s.x + NODE_WIDTH
                const sy = s.y + NODE_HEIGHT / 2
                const tx = t.x
                const ty = t.y + NODE_HEIGHT / 2
                const isHl = highlightSet ? highlightSet.has(edge.from) && highlightSet.has(edge.to) : true
                return (
                  <path
                    key={idx}
                    d={edgePath(sx, sy, tx, ty)}
                    className={`dc-graph-edge ${isHl ? "hl" : "dim"}`}
                    fill="none"
                  />
                )
              })}
              {/* 节点 */}
              {nodes.map((node) => {
                const pos = nodePositions[node.id]
                if (!pos) return null
                const style = nodeStyles[node.type]
                const isHl = highlightSet ? highlightSet.has(node.id) : true
                const isSel = selectedNode === node.id
                return (
                  <g
                    key={node.id}
                    data-node-id={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className={`dc-graph-node ${isSel ? "selected" : ""} ${isHl ? "" : "dim"}`}
                    onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                    onClick={() => onNodeClick(node.id)}
                    style={{ cursor: draggingNode === node.id ? "grabbing" : "grab" }}
                  >
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={10}
                      ry={10}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeWidth={isSel ? 2.4 : 1.4}
                    />
                    <rect x={0} y={0} width={4} height={NODE_HEIGHT} rx={2} fill={style.stroke} />
                    <text x={16} y={22} className="dc-node-tag" fill={style.tagText}>
                      {style.tag}
                    </text>
                    <text x={16} y={42} className="dc-node-label" fill={graphInk}>
                      {node.label}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>

          {/* 图例 */}
          <div className="dc-graph-legend">
            <span className="dc-legend-title">图例</span>
            {Object.entries(nodeStyles).map(([key, s]) => (
              <span className="dc-legend-item" key={key}>
                <i style={{ background: s.stroke }} />
                {s.tag}
              </span>
            ))}
            <span className="dc-legend-hint">
              <Move size={13} /> 拖拽画布平移 · 滚轮缩放 · 点击节点聚焦
            </span>
          </div>

          {/* Minimap */}
          <Minimap
            nodes={nodes}
            nodePositions={nodePositions}
            transform={transform}
            setTransform={setTransform}
            svgRef={svgRef}
          />
        </div>

        {/* 右侧详情面板 */}
        <aside className={`dc-graph-detail ${selectedNodeData ? "open" : ""}`}>
          {selectedNodeData ? (
            <RelationNodeDetail
              node={selectedNodeData}
              detail={selectedDetail}
              stages={selectedStages}
              taskName={taskName}
              nodes={nodes}
              edges={edges}
              onClose={() => setSelectedNode(null)}
            />
          ) : (
            <div className="dc-graph-detail-empty">
              <p>点击任意节点查看详情</p>
              <span>点击任务阶段可高亮其输入与输出；点击文件节点可高亮其上下游链路。</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Minimap({
  nodes,
  nodePositions,
  transform,
  setTransform,
  svgRef,
}: {
  nodes: DataCenterGraphNode[]
  nodePositions: Record<string, Point>
  transform: Transform
  setTransform: Dispatch<SetStateAction<Transform>>
  svgRef: RefObject<SVGSVGElement | null>
}) {
  const nodeStyles = useNodeStyles()
  const xs = Object.values(nodePositions).map((p) => p.x)
  const ys = Object.values(nodePositions).map((p) => p.y)
  if (xs.length === 0 || ys.length === 0) return null
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs) + NODE_WIDTH
  const maxY = Math.max(...ys) + NODE_HEIGHT
  const contentW = maxX - minX
  const contentH = maxY - minY
  const miniW = 168
  const miniH = Math.max(80, (miniW * contentH) / contentW)
  const s = miniW / contentW

  const onMinimapClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - rect.left) / s + minX
    const my = (e.clientY - rect.top) / s + minY
    const svgRect = svgRef.current?.getBoundingClientRect()
    if (!svgRect) return
    setTransform((t) => ({
      ...t,
      x: svgRect.width / 2 - mx * t.scale,
      y: svgRect.height / 2 - my * t.scale,
    }))
  }

  const viewportW = svgRef.current?.getBoundingClientRect().width || 0
  const viewportH = svgRef.current?.getBoundingClientRect().height || 0
  const vpX = -transform.x / transform.scale + minX
  const vpY = -transform.y / transform.scale + minY
  const vpW = viewportW / transform.scale
  const vpH = viewportH / transform.scale

  return (
    <div className="dc-minimap" style={{ width: miniW, height: miniH }}>
      <svg width={miniW} height={miniH} onClick={onMinimapClick} role="img" aria-label="小地图">
        {nodes.map((n) => {
          const p = nodePositions[n.id]
          if (!p) return null
          const style = nodeStyles[n.type]
          return (
            <rect
              key={n.id}
              x={(p.x - minX) * s}
              y={(p.y - minY) * s}
              width={NODE_WIDTH * s}
              height={NODE_HEIGHT * s}
              rx={2}
              fill={style.stroke}
              opacity={0.6}
            />
          )
        })}
        <rect x={vpX * s} y={vpY * s} width={vpW * s} height={vpH * s} fill="none" stroke="#2563eb" strokeWidth={1.5} />
      </svg>
      <span className="dc-minimap-label">小地图</span>
    </div>
  )
}

function RelationNodeDetail({
  node,
  detail,
  stages,
  taskName,
  nodes,
  edges,
  onClose,
}: {
  node: DataCenterGraphNode
  detail: FileData | null
  stages: string[]
  taskName: string
  nodes: DataCenterGraphNode[]
  edges: DataCenterGraphDTO["edges"]
  onClose: () => void
}) {
  const nodeStyles = useNodeStyles()
  const style = nodeStyles[node.type]
  return (
    <div className="dc-node-detail-content">
      <header>
        <span className="dc-detail-tag" style={{ background: style.tagBg, color: style.tagText }}>
          {style.tag}
        </span>
        <button type="button" onClick={onClose} aria-label="关闭详情">
          <X size={18} />
        </button>
      </header>
      <h3>{node.label}</h3>

      {detail && (
        <>
          <section className="dc-detail-block">
            <h4>文件说明</h4>
            <p>{detail.description}</p>
          </section>
          {detail.remark ? (
            <section className="dc-detail-block">
              <h4>用户备注</h4>
              <p className="dc-detail-remark">{detail.remark}</p>
            </section>
          ) : null}
        </>
      )}

      <section className="dc-detail-block">
        <h4>所属任务</h4>
        <p>{taskName}</p>
      </section>

      {stages.length > 0 && (
        <section className="dc-detail-block">
          <h4>在该任务中使用的阶段</h4>
          <div className="dc-detail-stage-list">
            {stages.map((s) => (
              <span className="dc-detail-stage-chip" key={s}>
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {node.type === "stage" && <StageIO node={node} nodes={nodes} edges={edges} />}
    </div>
  )
}

function StageIO({
  node,
  nodes,
  edges,
}: {
  node: DataCenterGraphNode
  nodes: DataCenterGraphNode[]
  edges: DataCenterGraphDTO["edges"]
}) {
  const inputs = useMemo(() => {
    const set = new Set<DataCenterGraphNode>()
    edges.forEach((e) => {
      if (e.to === node.id) {
        const n = nodes.find((x) => x.id === e.from)
        if (n) set.add(n)
      }
    })
    return [...set]
  }, [node.id, nodes, edges])
  const outputs = useMemo(() => {
    const set = new Set<DataCenterGraphNode>()
    edges.forEach((e) => {
      if (e.from === node.id) {
        const n = nodes.find((x) => x.id === e.to)
        if (n) set.add(n)
      }
    })
    return [...set]
  }, [node.id, nodes, edges])
  return (
    <>
      <section className="dc-detail-block">
        <h4>输入</h4>
        {inputs.length ? (
          <ul className="dc-detail-io-list">
            {inputs.map((n) => (
              <li key={n.id}>{n.label}</li>
            ))}
          </ul>
        ) : (
          <p className="dc-detail-empty-text">无直接输入</p>
        )}
      </section>
      <section className="dc-detail-block">
        <h4>输出</h4>
        {outputs.length ? (
          <ul className="dc-detail-io-list">
            {outputs.map((n) => (
              <li key={n.id}>{n.label}</li>
            ))}
          </ul>
        ) : (
          <p className="dc-detail-empty-text">无直接输出</p>
        )}
      </section>
    </>
  )
}
