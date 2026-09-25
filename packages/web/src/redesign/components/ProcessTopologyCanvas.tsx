import { useEffect, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DevicePFDCanvas } from './topology/DevicePFDCanvas';
import { useTheme } from '../theme';
import type {
  DeviceDetailChangeHandler,
  DevicePhase,
  TopologyChangedEdge,
  TopologyChanges,
  TopologySelectItem,
} from './topology/DevicePFDCanvas';

interface LegacyEquipmentInfo {
  typeName?: string;
  status?: string;
  constraint?: string;
  feed?: string;
  product?: string;
}

const equipmentDetails: Record<string, LegacyEquipmentInfo> = {
  'MEOH-001': {
    typeName: '补充原料',
    status: '正常',
    constraint: '按工艺包给定甲醇配比补充',
    feed: '外供甲醇',
    product: '甲醇补充流',
  },
  'FEED-001': {
    typeName: '原料入口',
    status: '正常',
    constraint: 'C5 原料进入装置边界',
    feed: 'C5 原料',
    product: '混合前原料流',
  },
  'M-001': {
    typeName: '混合器',
    status: '待确认装置认知',
    constraint: '需同时接收 C5 原料、甲醇补充和甲醇循环流',
    feed: 'C5 原料、甲醇补充、甲醇循环',
    product: '混合进料',
  },
  'R-101': {
    typeName: '立式反应器',
    status: '待确认装置认知',
    constraint: '后续校核空速、热负荷和操作窗口',
    feed: '混合进料',
    product: '醚化反应产物',
  },
  'T-201': {
    typeName: '催化蒸馏塔',
    status: '待确认装置认知',
    constraint: '兼具反应和分离功能，后续校核塔负荷',
    feed: '醚化反应产物',
    product: '塔顶轻组分、TAME/重组分',
  },
  'T-301': {
    typeName: '解吸塔',
    status: '待确认装置认知',
    constraint: '需保留甲醇循环和目标组分分离路径',
    feed: '塔顶轻组分',
    product: '目标组分流、甲醇循环',
  },
  'T-302': {
    typeName: '产品分离塔',
    status: '待确认装置认知',
    constraint: '产品流股和回收率诊断的关键节点',
    feed: '目标组分流',
    product: '异戊烯产品',
  },
  'P-001': {
    typeName: '产品出口',
    status: '正常',
    constraint: '扩产目标默认按异戊烯产品流量提升 20%',
    feed: '产品分离塔出料',
    product: '异戊烯产品',
  },
  'B-001': {
    typeName: '副产物流出口',
    status: '正常',
    constraint: 'TAME / 重组分副产物流向',
    feed: '催化蒸馏塔釜液',
    product: 'TAME / 重组分',
  },
};

interface LegacyNodePosition {
  x: number;
  y: number;
  kind?: string;
  code?: string;
  name?: string;
  label?: string;
  columnType?: string;
  tagTone?: string;
}

// 设备位置（严格按 demo 实际 8 设备，4 个区域横向并排）
// 区域：①原料预处理 FEED-001/M-001  ②醚化与催化蒸馏 R-101/T-201
//      ③解吸与回收 T-301/T-302  ④产品分离与精制 P-001/B-001
const defaultNodePositions: Record<string, LegacyNodePosition> = {
  'FEED-001': { x: 40, y: 132, kind: 'source', label: '原料' },
  'M-001': { x: 160, y: 90, kind: 'mixer', code: 'M-001', name: '甲醇/原料混合器' },
  'R-101': { x: 270, y: 70, kind: 'reactor', code: 'R-101', name: '醚化反应器' },
  'T-201': { x: 370, y: 60, kind: 'column', code: 'T-201', name: '催化蒸馏塔', columnType: 'catalytic' },
  'T-301': { x: 466, y: 80, kind: 'column', code: 'T-301', name: '解吸塔', columnType: 'packed' },
  'T-302': { x: 632, y: 50, kind: 'column', code: 'T-302', name: '产品分离塔', columnType: 'product' },
  'P-001': { x: 820, y: 100, kind: 'sink', label: '异戊烯产品', tagTone: 'out' },
  'B-001': { x: 790, y: 260, kind: 'sink', label: 'TAME 重组分', tagTone: 'aux' },
  // 方案生成/设备校验阶段：新增/取消的设备位置（基于 8 设备单层布局）
  'MEOH-001': { x: 32, y: 200, kind: 'source', label: '甲醇补充' },
  'R-102': { x: 250, y: 360, kind: 'reactor', code: 'R-102', name: '并联反应器' },
  'R-17': { x: 250, y: 360, kind: 'reactor', code: 'R-17', name: '利旧反应器' },
  'R-New': { x: 250, y: 360, kind: 'reactor', code: 'R-New', name: '专用反应器' },
  'S-New': { x: 460, y: 360, kind: 'column', code: 'S-New', name: '快速分离塔', columnType: 'product' },
};

interface StreamMetaEntry {
  className: string;
  marker: string;
}

const streamMeta: Record<string, StreamMetaEntry> & { main: StreamMetaEntry } = {
  main: { className: 'stream-main', marker: 'pfd-arrow-main' },
  methanol: { className: 'stream-methanol', marker: 'pfd-arrow-methanol' },
  intermediate: { className: 'stream-intermediate', marker: 'pfd-arrow-intermediate' },
  light: { className: 'stream-light', marker: 'pfd-arrow-light' },
  recycle: { className: 'stream-recycle', marker: 'pfd-arrow-recycle' },
  byproduct: { className: 'stream-byproduct', marker: 'pfd-arrow-byproduct' },
  purge: { className: 'stream-purge', marker: 'pfd-arrow-light' },
  scheme: { className: 'stream-scheme', marker: 'pfd-arrow-scheme' },
};

interface LegacyStreamInfo {
  status?: string;
  constraint?: string;
  medium?: string;
  temperature?: string;
  pressure?: string;
}

const streamDetails: Record<string, LegacyStreamInfo> = {
  'E-MEOH': { status: '正常', constraint: '甲醇补充从上方进入 M-001', medium: '甲醇', temperature: '35°C', pressure: '0.45 MPa' },
  'E-001': { status: '正常', constraint: 'C5 原料进入混合器', medium: 'C5 原料', temperature: '32°C', pressure: '0.42 MPa' },
  'E-002': { status: '正常', constraint: '混合进料进入醚化反应器', medium: 'C5 + 甲醇', temperature: '38°C', pressure: '0.55 MPa' },
  'E-003': { status: '正常', constraint: '反应产物进入催化蒸馏塔', medium: '醚化反应产物', temperature: '62°C', pressure: '0.52 MPa' },
  'E-004': { status: '正常', constraint: '塔顶轻组分进入解吸塔', medium: '塔顶轻组分', temperature: '58°C', pressure: '0.38 MPa' },
  'E-005': { status: '正常', constraint: 'TAME / 重组分副产物流出', medium: 'TAME / 重组分', temperature: '88°C', pressure: '0.43 MPa' },
  'E-006': { status: '正常', constraint: '目标组分流进入产品分离塔', medium: '异戊烯富集流', temperature: '54°C', pressure: '0.36 MPa' },
  'E-007': { status: '正常', constraint: '异戊烯产品出口流股', medium: '异戊烯产品', temperature: '40°C', pressure: '0.30 MPa' },
  'E-008': { status: '正常', constraint: '甲醇循环必须闭合回 M-001', medium: '甲醇循环液', temperature: '45°C', pressure: '0.40 MPa' },
  'E-RECYCLE-OPT': { status: '新增', constraint: '短程回流降低长程循环滞后', medium: '未反应碳五', temperature: '50°C', pressure: '0.42 MPa' },
  'E-SNEW-IN': { status: '新增', constraint: '塔釜出料进入快速分离塔', medium: '塔釜出料', temperature: '88°C', pressure: '0.45 MPa' },
  'E-SNEW-TAME': { status: '新增', constraint: 'TAME 快速移出反应系统', medium: 'TAME 富集流', temperature: '82°C', pressure: '0.40 MPa' },
  'E-SNEW-C5': { status: '新增', constraint: '未反应碳五回流', medium: '未反应碳五', temperature: '56°C', pressure: '0.42 MPa' },
};

export interface LegacyTopologyNode {
  id: string;
  label?: string;
  type?: string;
  kind?: string;
  code?: string;
  name?: string;
  columnType?: string;
  tagTone?: string;
  x?: number;
  y?: number;
  schemeChange?: string;
  feedbackStatus?: string;
}

export interface LegacyTopologyEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  streamType?: string;
}

export interface LegacyTopology {
  nodes: LegacyTopologyNode[];
  edges: LegacyTopologyEdge[];
}

interface LegacyModelNode {
  id: string;
  label?: string;
  type?: string;
  kind?: string;
  code?: string;
  name?: string;
  columnType?: string;
  tagTone?: string;
  schemeChange?: string;
  feedbackStatus?: string;
  x: number;
  y: number;
}

interface LegacyModelEdge {
  id: string;
  source?: string;
  target?: string;
  label?: string;
  streamType: string;
  path: string;
  labelAt: { x: number; y: number };
}

interface LegacyModel {
  nodes: LegacyModelNode[];
  edges: LegacyModelEdge[];
  nodeById: Record<string, LegacyModelNode>;
  topologyChanges?: TopologyChanges;
}

interface LegacyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LegacyDraftSelection extends LegacyRect {
  startX: number;
  startY: number;
  dragging: boolean;
}

interface LegacyHoverItem {
  kind: 'equipment' | 'stream' | 'marker';
  id: string;
  title: string;
  typeName?: string;
  status?: string;
  constraint?: string;
  medium?: string;
  temperature?: string;
  pressure?: string;
  feed?: string;
  product?: string;
  related?: string;
  x: number;
  y: number;
}

interface LegacyIntent {
  phase: string;
  selectionType: 'node' | 'edge' | 'marker' | 'region';
  targetIds: string[];
  targetLabel: string;
  region?: LegacyRect;
  actions: string[];
}

interface LegacyAnnotation {
  id: string;
  type: string;
  action: string;
  targetLabel?: string;
  x: number;
  y: number;
  icon: string;
  labelWidth: number;
}

function isDevicePhase(phase: string): phase is DevicePhase {
  return ['cognition', 'diagnosis', 'scheme', 'feedback'].includes(phase);
}

export interface ProcessTopologyCanvasProps {
  topology: LegacyTopology;
  selectedId?: string | null;
  onSelect?: (item: TopologySelectItem) => void;
  phase?: string;
  topologyChanges?: TopologyChanges;
  hidePurge?: boolean;
  hidePurgeLegend?: boolean;
  interactive?: boolean;
  detailNodeId?: string | null;
  onDetailNodeChange?: (id: string | null) => void;
  onDetailChange?: DeviceDetailChangeHandler;
  hideInlineDetailCard?: boolean;
  hideInternalDetailBack?: boolean;
  openDetailOnSelect?: boolean;
  drawingMode?: 'flow' | 'pfd';
  revealOnMount?: boolean;
  schemeBuildStep?: string | number;
  diagnosisSection?: number;
  dataStatusMap?: Record<string, string>;
}

export function ProcessTopologyCanvas({
  topology,
  selectedId,
  onSelect,
  phase = 'cognition',
  topologyChanges,
  hidePurge = false,
  hidePurgeLegend,
  interactive = false,
  detailNodeId,
  onDetailNodeChange,
  onDetailChange,
  hideInlineDetailCard = false,
  hideInternalDetailBack = false,
  openDetailOnSelect = false,
  drawingMode = 'flow',
  revealOnMount = false,
  schemeBuildStep,
  diagnosisSection,
  dataStatusMap,
}: ProcessTopologyCanvasProps) {
  if (isDevicePhase(phase)) {
    return (
      <DevicePFDCanvas
        selectedId={selectedId}
        onSelect={onSelect}
        phase={phase}
        topologyChanges={topologyChanges}
        hidePurge={hidePurge}
        hidePurgeLegend={hidePurgeLegend}
        interactive={interactive}
        detailNodeId={detailNodeId}
        onDetailNodeChange={onDetailNodeChange}
        onDetailChange={onDetailChange}
        hideInlineDetailCard={hideInlineDetailCard}
        hideInternalDetailBack={hideInternalDetailBack}
        openDetailOnSelect={openDetailOnSelect}
        drawingMode={drawingMode}
        revealOnMount={revealOnMount}
        schemeBuildStep={schemeBuildStep}
        diagnosisSection={diagnosisSection}
        dataStatusMap={dataStatusMap}
      />
    );
  }

  return (
    <LegacyProcessTopologyCanvas
      topology={topology}
      selectedId={selectedId}
      onSelect={onSelect}
      phase={phase}
      topologyChanges={topologyChanges}
      hidePurge={hidePurge}
      interactive={interactive}
    />
  );
}

interface LegacyProcessTopologyCanvasProps {
  topology: LegacyTopology;
  selectedId?: string | null;
  onSelect?: (item: TopologySelectItem) => void;
  phase?: string;
  topologyChanges?: TopologyChanges;
  hidePurge?: boolean;
  interactive?: boolean;
}

function LegacyProcessTopologyCanvas({
  topology,
  selectedId,
  onSelect,
  phase = 'cognition',
  topologyChanges,
  interactive = false,
}: LegacyProcessTopologyCanvasProps) {
  const [theme] = useTheme();
  const isDarkTheme = theme === 'dark';
  const pfdInk = isDarkTheme ? '#a8c2ee' : '#1e3a5f';
  const pfdGridStroke = isDarkTheme ? 'rgba(122, 158, 224, 0.30)' : '#d8e7fb';
  const [hoverItem, setHoverItem] = useState<LegacyHoverItem | null>(null);
  const [draftSelection, setDraftSelection] = useState<LegacyDraftSelection | null>(null);
  const [activeIntent, setActiveIntent] = useState<LegacyIntent | null>(null);
  const [annotations, setAnnotations] = useState<LegacyAnnotation[]>(() => getDefaultAnnotations(phase, topologyChanges));
  const model = useMemo(() => buildPfdModel(topology, topologyChanges), [topology, topologyChanges]);
  const visibleEdges = model.edges.filter((edge) => edge.id !== 'E-009');
  const visibleNodes = model.nodes.filter((node) => node.id !== 'PURGE-001');
  const canInteract = interactive && ['cognition', 'diagnosis', 'scheme', 'feedback'].includes(phase);

  useEffect(() => {
    setAnnotations(getDefaultAnnotations(phase, topologyChanges));
    setActiveIntent(null);
    setDraftSelection(null);
  }, [phase, topologyChanges]);

  function selectItem(item: TopologySelectItem) {
    onSelect?.(item);
    window.dispatchEvent(new CustomEvent('redesign-topology-select', {
      detail: { item },
    }));
    if (canInteract) {
      const intent = buildIntentFromSelection({
        phase,
        selectionType: item.kind === 'equipment' ? 'node' : item.kind === 'stream' ? 'edge' : 'marker',
        targetIds: [item.id],
        model,
      });
      setActiveIntent(intent);
    }
  }

  function getSvgPoint(event: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!canInteract || event.button !== 0) return;
    if ((event.target as Element).closest('.pfd-equipment, .pfd-stream, .topology-marker, .scheme-change-marker')) return;
    const point = getSvgPoint(event);
    setDraftSelection({ startX: point.x, startY: point.y, x: point.x, y: point.y, width: 0, height: 0, dragging: true });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draftSelection?.dragging) return;
    const point = getSvgPoint(event);
    const x = Math.min(draftSelection.startX, point.x);
    const y = Math.min(draftSelection.startY, point.y);
    const width = Math.abs(point.x - draftSelection.startX);
    const height = Math.abs(point.y - draftSelection.startY);
    setDraftSelection((draft) => (draft ? { ...draft, x, y, width, height } : draft));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draftSelection?.dragging) return;
    const point = getSvgPoint(event);
    const rect = {
      x: Math.min(draftSelection.startX, point.x),
      y: Math.min(draftSelection.startY, point.y),
      width: Math.abs(point.x - draftSelection.startX),
      height: Math.abs(point.y - draftSelection.startY),
    };
    setDraftSelection(null);
    if (rect.width < 22 || rect.height < 22) return;

    const targetIds = detectRegionTargets(rect, visibleNodes, visibleEdges);
    const intent = buildIntentFromSelection({
      phase,
      selectionType: 'region',
      targetIds,
      region: rect,
      model,
    });
    setActiveIntent(intent);
  }

  function confirmIntent(action: string) {
    if (!activeIntent) return;
    const annotation = buildAnnotation(activeIntent, action);
    setAnnotations((items) => [annotation, ...items].slice(0, 5));
    setActiveIntent(null);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('redesign-ai-interaction', {
        detail: {
          stageLevel: getStageLevelByPhase(phase),
          title: `图上意图已确认：${action}`,
          body: buildIntentMessage(activeIntent, action),
        },
      }));
    }
  }

  return (
    <div className="process-topology-wrap">
      <svg
        className={`process-topology-canvas phase-${phase} ${canInteract ? 'is-interactive' : ''}`}
        viewBox="0 0 930 470"
        role="img"
        aria-label="异戊烯装置简化 PFD 流程图"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setDraftSelection(null)}
      >
        <defs>
          <ProcessArrow id="pfd-arrow-main" color={pfdInk} width={12} height={8} />
          <ProcessArrow id="pfd-arrow-methanol" color="#38bdf8" width={10} height={7} />
          <ProcessArrow id="pfd-arrow-intermediate" color="#2563eb" width={10} height={7} />
          <ProcessArrow id="pfd-arrow-light" color="#94a3b8" width={8} height={6} />
          <ProcessArrow id="pfd-arrow-recycle" color="#0891b2" width={10} height={7} />
          <ProcessArrow id="pfd-arrow-byproduct" color="#64748b" />
          <ProcessArrow id="pfd-arrow-scheme" color="#dc2626" width={10} height={7} />
          <pattern id="pfd-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke={pfdGridStroke} strokeWidth="0.8" opacity="0.52" />
          </pattern>
          <filter id="pfd-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor={pfdInk} floodOpacity="0.10" />
          </filter>
        </defs>

        <rect x="16" y="18" width="898" height="430" rx="10" className="pfd-boundary" />
        <rect x="17" y="19" width="896" height="428" rx="10" className="pfd-grid" />

        {/* 4 个区域分组：①原料预处理 ②醚化与催化蒸馏 ③解吸与回收 ④产品分离与精制 */}
        <AreaGroups />

        {visibleEdges.map((edge) => (
          <StreamEdge
            key={edge.id}
            edge={edge}
            phase={phase}
            selected={selectedId === edge.id}
            onClick={() => selectItem({ kind: 'stream', id: edge.id })}
            onHover={setHoverItem}
          />
        ))}

        {visibleNodes.map((node) => (
          <EquipmentNode
            key={node.id}
            node={node}
            phase={phase}
            selected={selectedId === node.id}
            onClick={() => selectItem({ kind: 'equipment', id: node.id })}
            onHover={setHoverItem}
          />
        ))}

        <TopologyMarker phase={phase} onSelect={selectItem} onHover={setHoverItem} />
        <SchemeChangeMarker phase={phase} topologyChanges={topologyChanges} />
        <UserAnnotationLayer annotations={annotations} />
        {draftSelection?.dragging ? <SelectionMarquee rect={draftSelection} /> : null}
        {hoverItem ? <EquipmentTooltip item={hoverItem} nodes={model.nodeById} /> : null}
      </svg>
      {canInteract && activeIntent ? (
        <TopologyInteractionCoach
          phase={phase}
          activeIntent={activeIntent}
          onConfirm={confirmIntent}
          onClose={() => setActiveIntent(null)}
        />
      ) : null}
      <div className="pfd-legend" aria-hidden="true">
        <span className="legend-main">主流程</span>
        <span className="legend-methanol">甲醇补充</span>
        <span className="legend-recycle">甲醇循环</span>
        <span className="legend-byproduct">副产物流</span>
      </div>
    </div>
  );
}

interface LegacyPhaseCopy {
  title: string;
  hint: string;
  empty: string;
  actions: string[];
}

const phaseInteractionCopy: Record<DevicePhase, LegacyPhaseCopy> = {
  cognition: {
    title: '图上协同：装置认知',
    hint: '点击设备/管线，或拖拽框选流程片段，让 AI 判断你是在修正流程还是补充资料。',
    empty: '可点击 M-001、R-101、T-301 等设备；也可以框选一段流程。',
    actions: ['流程有误', '补充信息', '确认关键关系'],
  },
  diagnosis: {
    title: '图上协同：工艺诊断',
    hint: '框选疑似瓶颈区域，AI 会结合当前诊断阶段识别瓶颈、异常或质疑意图。',
    empty: '试试框选 T-301 → T-302 → 产品出口，或点击橙色诊断标记。',
    actions: ['添加瓶颈点', '补充运行异常', '质疑瓶颈判断'],
  },
  scheme: {
    title: '图上协同：方案生成',
    hint: '在图上标记可改造点、不可改造区域或补充工程约束，方案会围绕这些标注生成。',
    empty: '试试点击 S-New 快速分离支路、短程回流路径，或框选改造区域。',
    actions: ['添加改造点', '此处不可改造', '补充改造约束'],
  },
  feedback: {
    title: '图上协同：约束校验',
    hint: '点击失败设备或框选设备组，AI 会把设备约束回传到装置级方案上下文。',
    empty: '试试点击 S-New、短程回流路径、T-301 等设备查看校验约束。',
    actions: ['需人工复核', '接受设备约束', '补充校验条件'],
  },
};

function getPhaseCopy(phase: string): LegacyPhaseCopy {
  return (phaseInteractionCopy as Record<string, LegacyPhaseCopy>)[phase] || phaseInteractionCopy.cognition;
}

function TopologyInteractionCoach({ phase, activeIntent, onConfirm, onClose }: {
  phase: string;
  activeIntent: LegacyIntent;
  onConfirm: (action: string) => void;
  onClose: () => void;
}) {
  const copy = getPhaseCopy(phase);

  return (
    <aside className={`topology-interaction-coach phase-${phase}`}>
      <header>
        <span>{copy.title}</span>
        <strong>AI 已识别图上意图</strong>
      </header>
      <p>
        你{activeIntent.selectionType === 'region' ? '框选了' : '选择了'}
        <b>{activeIntent.targetLabel}</b>。
        结合当前阶段，我判断你可能想要：
      </p>
      <small>{copy.hint}</small>
      <div className="intent-action-list">
        {activeIntent.actions.map((action) => (
          <button type="button" key={action} onClick={() => onConfirm(action)}>
            {action}
          </button>
        ))}
      </div>
      <button type="button" className="intent-dismiss" onClick={onClose}>暂不处理</button>
    </aside>
  );
}

function SelectionMarquee({ rect }: { rect: LegacyRect }) {
  return (
    <g className="pfd-selection-marquee">
      <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="6" />
    </g>
  );
}

function UserAnnotationLayer({ annotations }: { annotations: LegacyAnnotation[] }) {
  if (!annotations.length) return null;
  return (
    <g className="user-annotation-layer">
      {annotations.map((annotation) => (
        <g key={annotation.id} className={`user-annotation type-${annotation.type}`} transform={`translate(${annotation.x} ${annotation.y})`}>
          <circle r="13" />
          <text x="0" y="4">{annotation.icon}</text>
          <rect x="18" y="-16" width={annotation.labelWidth} height="32" rx="8" />
          <text x="30" y="4" className="annotation-label">{annotation.action}</text>
        </g>
      ))}
    </g>
  );
}

function getDefaultAnnotations(phase: string, topologyChanges?: TopologyChanges): LegacyAnnotation[] {
  if (phase === 'scheme' && topologyChanges?.addedNodes?.length) {
    const addedId = topologyChanges.addedNodes[0]!.id;
    return [
      {
        id: `default-scheme-${addedId}`,
        type: ['R-17', 'S-New'].includes(addedId) ? 'risk' : 'retrofit',
        action: ['R-17', 'S-New'].includes(addedId) ? '待校验改造点' : '新增改造点',
        targetLabel: addedId,
        x: 386,
        y: 344,
        icon: ['R-17', 'S-New'].includes(addedId) ? '!' : '+',
        labelWidth: ['R-17', 'S-New'].includes(addedId) ? 108 : 92,
      },
    ];
  }
  if (phase === 'feedback') {
    if (topologyChanges?.validationStatus === 'passed') {
      return [
        {
          id: 'default-feedback-passed',
          type: 'retrofit',
          action: '设备复验通过',
          targetLabel: '短程回流 / T-301 / T-302',
          x: 388,
          y: 318,
          icon: '✓',
          labelWidth: 112,
        },
      ];
    }
    return [
      {
        id: 'default-feedback-snew',
        type: 'forbidden',
        action: '设备约束',
        targetLabel: 'S-New 不可继续采用',
        x: 380,
        y: 344,
        icon: '×',
        labelWidth: 86,
      },
    ];
  }
  return [];
}

function detectRegionTargets(rect: LegacyRect, nodes: LegacyModelNode[], edges: LegacyModelEdge[]): string[] {
  const nodeTargets = nodes
    .filter((node) => isPointInRect({ x: node.x + getNodeCenterOffset(node).x, y: node.y + getNodeCenterOffset(node).y }, rect))
    .map((node) => node.id);
  const edgeTargets = edges
    .filter((edge) => isPointInRect(edge.labelAt, rect))
    .map((edge) => edge.id);
  const targets = [...nodeTargets, ...edgeTargets];
  if (targets.length) return targets.slice(0, 5);

  const hotspot = getHotspotByRegion(rect);
  return hotspot?.targetIds || ['局部流程区域'];
}

function getNodeCenterOffset(node: LegacyModelNode): { x: number; y: number } {
  if (node.kind === 'column') return { x: 26, y: 75 };
  if (node.kind === 'reactor') return { x: 32, y: 75 };
  if (node.kind === 'mixer') return { x: 28, y: 40 };
  if (node.kind === 'sink') return { x: 46, y: 24 };
  if (node.kind === 'source') return { x: 60, y: 24 };
  return { x: 0, y: 0 };
}

function isPointInRect(point: { x: number; y: number }, rect: LegacyRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

interface LegacyHotspot {
  targetIds: string[];
  x: number;
  y: number;
  radius: number;
}

function getHotspotByRegion(rect: LegacyRect): LegacyHotspot | undefined {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const hotspots: LegacyHotspot[] = [
    { targetIds: ['R-101', 'T-201'], x: 360, y: 245, radius: 140 },
    { targetIds: ['T-301', 'T-302', 'E-007'], x: 700, y: 255, radius: 170 },
    { targetIds: ['S-New', 'E-SNEW-IN', 'E-SNEW-TAME', 'E-SNEW-C5'], x: 340, y: 382, radius: 150 },
    { targetIds: ['R-17', 'E-R17-IN', 'E-R17-OUT'], x: 340, y: 382, radius: 150 },
    { targetIds: ['M-001', 'E-008', 'E-MEOH'], x: 220, y: 305, radius: 150 },
  ];
  return hotspots.find((item) => Math.hypot(center.x - item.x, center.y - item.y) <= item.radius);
}

function buildIntentFromSelection({ phase, selectionType, targetIds, region, model }: {
  phase: string;
  selectionType: LegacyIntent['selectionType'];
  targetIds?: string[];
  region?: LegacyRect;
  model: LegacyModel;
}): LegacyIntent {
  const copy = getPhaseCopy(phase);
  const cleanTargetIds = targetIds?.length ? targetIds : ['局部流程区域'];
  return {
    phase,
    selectionType,
    targetIds: cleanTargetIds,
    targetLabel: cleanTargetIds.map((id) => getReadableTargetName(id, model)).join('、'),
    region,
    actions: copy.actions,
  };
}

function getReadableTargetName(id: string, model: LegacyModel): string {
  const node = model.nodeById?.[id];
  if (node) return node.code || node.label || node.id;
  return id;
}

function buildAnnotation(intent: LegacyIntent, action: string): LegacyAnnotation {
  const type = getAnnotationType(action, intent.phase);
  const anchor = getAnnotationAnchor(intent);
  return {
    id: `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    action,
    targetLabel: intent.targetLabel,
    x: anchor.x,
    y: anchor.y,
    icon: getAnnotationIcon(type),
    labelWidth: Math.max(76, Math.min(136, action.length * 14 + 28)),
  };
}

function getAnnotationAnchor(intent: LegacyIntent): { x: number; y: number } {
  if (intent.region) {
    return {
      x: Math.min(intent.region.x + intent.region.width, 830),
      y: Math.max(intent.region.y, 52),
    };
  }

  const firstTarget = intent.targetIds[0]!;
  const node = defaultNodePositions[firstTarget];
  if (node) return { x: node.x + 48, y: Math.max(node.y - 18, 44) };
  const label = getLabelPosition(firstTarget);
  if (label.x || label.y) return { x: label.x + 22, y: Math.max(label.y - 18, 44) };
  return { x: 120, y: 88 };
}

function getAnnotationType(action: string, phase: string): string {
  if (action.includes('有误') || action.includes('不可') || action.includes('约束')) return 'forbidden';
  if (action.includes('瓶颈') || phase === 'diagnosis') return 'bottleneck';
  if (action.includes('改造') || phase === 'scheme') return 'retrofit';
  if (action.includes('复核') || action.includes('校验')) return 'risk';
  return 'info';
}

function getAnnotationIcon(type: string): string {
  const icons: Record<string, string> = {
    forbidden: '×',
    bottleneck: '!',
    retrofit: '+',
    risk: '!',
    info: 'i',
  };
  return icons[type] || 'i';
}

function buildIntentMessage(intent: LegacyIntent, action: string): string[] {
  const stageTexts: Record<string, string> = {
    cognition: '装置认知',
    diagnosis: '工艺诊断',
    scheme: '方案生成',
    feedback: '设备校验 / 约束反馈',
  };
  const effectTexts: Record<string, string> = {
    cognition: '该标注会进入装置认知修正记录，后续诊断会以修正后的流程和补充信息为输入。',
    diagnosis: '该标注会写入诊断清单，后续方案会优先围绕这个瓶颈或异常区域生成。',
    scheme: '该标注会写入方案生成约束，候选方案会避开不可改造点或优先围绕改造点展开。',
    feedback: '该标注会进入设备级 Agent 约束包，并回传给装置级 Agent 作为下一轮方案条件。',
  };
  const stageText = stageTexts[intent.phase] || '当前阶段';
  const effectText = effectTexts[intent.phase] || '';
  return [
    `阶段：${stageText}`,
    `图上对象：${intent.targetLabel}`,
    `用户意图：${action}`,
    effectText,
  ];
}

function getStageLevelByPhase(phase: string): number {
  const stageMap: Record<string, number> = {
    cognition: 1,
    diagnosis: 2,
    scheme: 3,
    feedback: 5,
  };
  return stageMap[phase] || 1;
}

function buildPfdModel(topology: LegacyTopology, topologyChanges?: TopologyChanges): LegacyModel {
  // v4 严格按 demo 实际 8 设备数据，不再自动注入 MEOH-001 额外节点
  const addedNodes = topologyChanges?.addedNodes || [];
  const addedEdges = topologyChanges?.addedEdges || [];
  const changedNodes = topologyChanges?.changedNodes || [];
  const cancelledNodes = topologyChanges?.cancelledNodes || [];
  const removedEdges = new Set(topologyChanges?.removedEdges || []);
  const feedbackStatus = topologyChanges?.feedbackStatus || {};
  const sourceEdges: (LegacyTopologyEdge | TopologyChangedEdge)[] = [
    ...topology.edges,
    ...addedEdges,
  ].filter((edge) => !removedEdges.has(edge.id));
  const nodes = [...topology.nodes, ...addedNodes, ...cancelledNodes].map((node) => ({
    ...node,
    ...(defaultNodePositions[node.id] || {}),
    schemeChange: node.schemeChange || (addedNodes.some((item) => item.id === node.id) ? 'added' : changedNodes.find((item) => item.id === node.id)?.change),
    feedbackStatus: feedbackStatus[node.id],
  })) as LegacyModelNode[];
  const edges = sourceEdges.map((edge): LegacyModelEdge => ({
    ...edge,
    streamType: normalizeStreamType(edge),
    path: getStreamPath(edge.id),
    labelAt: getLabelPosition(edge.id),
  }));

  return {
    nodes,
    edges,
    nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    topologyChanges,
  };
}

function normalizeStreamType(edge: { id: string; streamType?: string }): string {
  if (edge.id.includes('R17') || edge.id.includes('R102') || edge.id.includes('RNEW') || edge.id.includes('SNEW') || edge.id === 'E-RECYCLE-OPT') return 'scheme';
  if (edge.streamType) return edge.streamType;
  if (edge.id === 'E-MEOH') return 'methanol';
  if (edge.id === 'E-004') return 'light';
  if (edge.id === 'E-008') return 'recycle';
  if (edge.id === 'E-005') return 'byproduct';
  if (edge.id === 'E-009') return 'purge';
  return 'main';
}

// 流线路径（基于 v4 设计，按 demo baseDeviceTopology 的原始 ID 映射）
// 上排 7 设备主流程 + B-001 下排接收塔釜出料 + 顶部排放/甲醇循环
function getStreamPath(id: string): string {
  const paths: Record<string, string> = {
    // 主流程：FEED → M → R → T201 → T301 → T302 → P
    'E-001': 'M 110 140 L 160 140',
    'E-002': 'M 220 140 L 270 140',
    'E-003': 'M 330 140 L 370 140',
    'E-004': 'M 410 110 L 466 110',
    // T-301 → T-302（原始 E-006：目标组分流）
    'E-006': 'M 510 140 L 632 140',
    // T-302 → P-001（原始 E-007：异戊烯产品）
    'E-007': 'M 750 110 L 820 110',
    // T-201 塔釜出料 → B-001（原始 E-005：TAME/重组分，先向下再向右）
    'E-005': 'M 390 220 L 390 270 L 815 270',
    // T-301 顶部 → M-001 顶部 甲醇循环
    'E-008': 'M 490 60 L 490 30 L 200 30 L 200 80',
    // 排放
    'E-009': 'M 510 60 L 510 24 L 880 24',
    // 顶部辅助：T-302 顶部 → 排放
    'E-VENT-T302': 'M 720 60 L 720 18 L 900 18',
    // 兼容旧流线
    'E-MEOH': 'M 102 200 L 132 200 L 132 142 L 160 142',
    // 方案生成阶段的支路（不与 8 设备主流重叠，置于下排）
    'E-RECYCLE-OPT': 'M 750 188 L 600 188 L 600 110',
    'E-R102-IN': 'M 220 140 L 220 360 L 250 360',
    'E-R102-OUT': 'M 290 360 L 320 360 L 320 140 L 370 140',
    'E-R17-IN': 'M 220 140 L 220 360 L 250 360',
    'E-R17-OUT': 'M 290 360 L 320 360 L 320 140 L 370 140',
    'E-RNEW-IN': 'M 330 140 L 330 330 L 250 330 L 250 360',
    'E-RNEW-OUT': 'M 290 360 L 320 360 L 320 140 L 370 140',
    'E-SNEW-IN': 'M 390 220 L 390 360 L 460 360',
    'E-SNEW-TAME': 'M 500 360 L 660 360 L 660 270 L 790 270',
    'E-SNEW-C5': 'M 500 310 L 660 310 L 660 180 L 632 180',
  };
  return paths[id] || 'M 0 0 L 0 0';
}

// 流线标签位置（居中于流线，不遮挡设备）
function getLabelPosition(id: string): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    'E-001': { x: 130, y: 132 },
    'E-002': { x: 245, y: 132 },
    'E-003': { x: 350, y: 132 },
    'E-004': { x: 438, y: 102 },
    'E-006': { x: 555, y: 132 },
    'E-007': { x: 778, y: 102 },
    'E-005': { x: 580, y: 262 },
    'E-008': { x: 240, y: 22 },
    'E-009': { x: 882, y: 14 },
    'E-VENT-T302': { x: 892, y: 10 },
    'E-MEOH': { x: 110, y: 192 },
    'E-RECYCLE-OPT': { x: 670, y: 180 },
    'E-R102-IN': { x: 210, y: 240 },
    'E-R102-OUT': { x: 310, y: 240 },
    'E-R17-IN': { x: 210, y: 240 },
    'E-R17-OUT': { x: 310, y: 240 },
    'E-RNEW-IN': { x: 318, y: 260 },
    'E-RNEW-OUT': { x: 310, y: 240 },
    'E-SNEW-IN': { x: 410, y: 300 },
    'E-SNEW-TAME': { x: 660, y: 320 },
    'E-SNEW-C5': { x: 660, y: 240 },
  };
  return positions[id] || { x: 0, y: 0 };
}

interface LegacyAreaGroup {
  id: string;
  no: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  titleX: number;
  titleWidth: number;
}

// 4 个区域分组背景（原料预处理/醚化与催化蒸馏/解吸与回收/产品分离与精制）
const areaGroups: LegacyAreaGroup[] = [
  { id: 'A1', no: '①', title: '原料预处理区', x: 14, y: 40, width: 180, height: 320, titleX: 22, titleWidth: 100 },
  { id: 'A2', no: '②', title: '醚化与催化蒸馏区', x: 204, y: 40, width: 220, height: 320, titleX: 212, titleWidth: 140 },
  { id: 'A3', no: '③', title: '解吸与回收区', x: 434, y: 40, width: 160, height: 320, titleX: 442, titleWidth: 120 },
  { id: 'A4', no: '④', title: '产品分离与精制区', x: 604, y: 40, width: 312, height: 360, titleX: 612, titleWidth: 150 },
];

function AreaGroups() {
  return (
    <g className="pfd-areas">
      {areaGroups.map((area) => (
        <g key={area.id} className="pfd-area-group">
          <rect
            x={area.x}
            y={area.y}
            width={area.width}
            height={area.height}
            rx="6"
            className="pfd-area"
          />
          <rect
            x={area.titleX}
            y={32}
            width={area.titleWidth}
            height={14}
            className="pfd-area-title-bg"
          />
          <text x={area.titleX + 8} y={42} className="pfd-area-no">
            {area.no} {area.title}
          </text>
        </g>
      ))}
    </g>
  );
}

function ProcessArrow({ id, color, width = 10, height = 7 }: {
  id: string;
  color: string;
  width?: number;
  height?: number;
}) {
  const markerWidth = width / 2;
  const markerHeight = height / 2;
  const refX = markerWidth - 0.5;
  const refY = markerHeight / 2;
  return (
    <marker id={id} markerWidth={markerWidth} markerHeight={markerHeight} refX={refX} refY={refY} orient="auto" markerUnits="strokeWidth">
      <path d={`M0,0 L${markerWidth},${refY} L0,${markerHeight} Z`} fill={color} />
    </marker>
  );
}

function StreamEdge({ edge, phase, selected, onClick, onHover }: {
  edge: LegacyModelEdge;
  phase: string;
  selected?: boolean;
  onClick?: () => void;
  onHover?: (item: LegacyHoverItem | null) => void;
}) {
  const meta = streamMeta[edge.streamType] || streamMeta.main;
  const detail = streamDetails[edge.id] || {};
  const diagnosisIssue = phase === 'diagnosis' && edge.id === 'E-007';
  const hoverPayload: LegacyHoverItem = {
    kind: 'stream',
    id: edge.id,
    title: edge.label ?? edge.id,
    typeName: streamTypeName(edge.streamType),
    status: diagnosisIssue ? '收率偏低' : detail.status || '正常',
    constraint: diagnosisIssue ? '产品纯度达标，但产品回收率不足' : detail.constraint || '装置流股',
    medium: detail.medium || edge.label,
    temperature: detail.temperature || '按模拟工况计算',
    pressure: detail.pressure || '按模拟工况计算',
    related: `${edge.source} → ${edge.target}`,
    x: edge.labelAt.x,
    y: edge.labelAt.y,
  };
  return (
    <g
      className={`pfd-stream ${meta.className} ${diagnosisIssue ? 'diagnosis-yield-issue' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(hoverPayload)}
      onMouseLeave={() => onHover?.(null)}
    >
      <path className="pfd-stream-hit" d={edge.path} />
      <path d={edge.path} markerEnd={`url(#${meta.marker})`} />
      <text x={edge.labelAt.x} y={edge.labelAt.y}>{edge.label}</text>
    </g>
  );
}

function EquipmentNode({ node, phase, selected, onClick, onHover }: {
  node: LegacyModelNode;
  phase: string;
  selected?: boolean;
  onClick?: () => void;
  onHover?: (item: LegacyHoverItem | null) => void;
}) {
  const detail = equipmentDetails[node.id] || {};
  const hoverPayload: LegacyHoverItem = {
    kind: 'equipment',
    id: node.id,
    title: `${node.code || node.id} ${node.name || node.label}`,
    typeName: detail.typeName || node.type,
    status: getEquipmentRuntimeStatus(node, phase, detail.status),
    constraint: detail.constraint || '待确认',
    feed: detail.feed || '上游流股',
    product: detail.product || '下游流股',
    related: getRelatedStreams(node.id),
    x: node.x,
    y: node.y - 52,
  };
  return (
    <g
      className={`pfd-equipment type-${node.kind} status-${node.feedbackStatus || phaseStatusClass(node.id, phase)} scheme-${node.schemeChange || 'none'} ${node.schemeChange === 'added' ? 'scheme-added' : ''} ${node.schemeChange && node.schemeChange !== 'added' ? 'scheme-changed' : ''} ${selected ? 'selected' : ''}`}
      transform={`translate(${node.x} ${node.y})`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(hoverPayload)}
      onMouseLeave={() => onHover?.(null)}
      role="button"
      tabIndex={0}
    >
      {node.kind === 'source' ? <SourceSymbol node={node} /> : null}
      {node.kind === 'mixer' ? <MixerSymbol node={node} /> : null}
      {node.kind === 'reactor' ? <ReactorSymbol node={node} /> : null}
      {node.kind === 'column' ? <DistillationColumnSymbol node={node} /> : null}
      {node.kind === 'sink' ? <ProductSinkSymbol node={node} /> : null}
      {node.kind === 'vent' ? <VentSymbol node={node} /> : null}
    </g>
  );
}

// 原型定义后未使用，保留导出
export function getFeedbackStatusText(status: string | undefined): string | undefined {
  const labels: Record<string, string> = {
    failed: '不通过',
    conditional: '条件通过',
    pass: '通过',
    passed: '通过',
    cancelled: '已取消',
  };
  return status ? labels[status] : undefined;
}

function getEquipmentRuntimeStatus(node: LegacyModelNode, phase: string, fallback: string | undefined): string {
  if (node.feedbackStatus === 'cancelled') return '停工';
  if (['failed', 'conditional'].includes(node.feedbackStatus ?? '')) return '异常';
  if (node.feedbackStatus === 'pass' || node.feedbackStatus === 'passed') return '正常';
  if (phase === 'diagnosis' && ['T-301', 'T-302'].includes(node.id)) return '异常';
  if (phase === 'feedback' && ['R-17', 'S-New'].includes(node.id)) return '异常';
  if (fallback === '停工') return '停工';
  if (fallback === '异常') return '异常';
  return '正常';
}

// v4 设计：原料输入/甲醇补充 等 source 节点 = 箭头 + 标牌
function SourceSymbol({ node }: { node: LegacyModelNode }) {
  const code = node.id;
  const name = node.label;
  return (
    <>
      <rect className="pfd-hover-bg" x="-6" y="-4" width="86" height="30" />
      <line x1="0" y1="10" x2="14" y2="10" className="source-arrow-line" />
      <path d="M14,5 L24,10 L14,15 Z" className="source-arrow-head" />
      <rect x="26" y="0" width="56" height="22" rx="3" className="pfd-tag-bg" />
      <text className="equipment-code" x="54" y="11">{code}</text>
      <text className="equipment-name" x="54" y="19">{name}</text>
    </>
  );
}

// v4 设计：混合器 M-001 = 容器 + 搅拌轴 + 顶部电机 + 标牌
function MixerSymbol({ node }: { node: LegacyModelNode }) {
  return (
    <>
      <rect className="pfd-hover-bg" x="-10" y="-12" width="58" height="124" />
      <ellipse cx="20" cy="1" rx="16" ry="4" className="mixer-cap" />
      <rect x="4" y="1" width="32" height="80" className="mixer-shell" />
      <ellipse cx="20" cy="81" rx="16" ry="4" className="mixer-cap" />
      <line x1="20" y1="-10" x2="20" y2="82" className="agitator-line" />
      <line x1="6" y1="22" x2="34" y2="22" className="agitator-line" />
      <line x1="8" y1="24" x2="32" y2="24" className="agitator-line" />
      <line x1="6" y1="42" x2="34" y2="42" className="agitator-line" />
      <line x1="8" y1="44" x2="32" y2="44" className="agitator-line" />
      <line x1="6" y1="62" x2="34" y2="62" className="agitator-line" />
      <line x1="8" y1="64" x2="32" y2="64" className="agitator-line" />
      <rect x="16" y="-14" width="8" height="4" className="motor-block" />
      <circle cx="0" cy="14" r="2.5" className="nozzle" />
      <circle cx="40" cy="14" r="2.5" className="nozzle" />
      <line x1="20" y1="81" x2="20" y2="88" className="utility-line" />
      <rect x="8" y="88" width="24" height="4" className="reboiler" />
      <rect x="-26" y="96" width="92" height="24" rx="3" className="pfd-tag-bg" />
      <text className="equipment-code" x="20" y="107">{node.code}</text>
      <text className="equipment-name" x="20" y="117">{node.name}</text>
    </>
  );
}

// v4 设计：反应器 R-101 = 立式容器 + 搅拌轴 + 4 层搅拌叶 + 顶部电机（明显区别于塔）
function ReactorSymbol({ node }: { node: LegacyModelNode }) {
  return (
    <>
      <rect className="pfd-hover-bg" x="-8" y="-12" width="48" height="160" />
      <ellipse cx="20" cy="1" rx="16" ry="4" className="vessel-cap" />
      <rect x="4" y="1" width="32" height="120" className="vessel-shell" />
      <ellipse cx="20" cy="121" rx="16" ry="4" className="vessel-cap" />
      <line x1="20" y1="-10" x2="20" y2="122" className="reactor-stem" />
      <line x1="6" y1="22" x2="34" y2="22" className="agitator-line" />
      <line x1="8" y1="24" x2="32" y2="24" className="agitator-line" />
      <line x1="6" y1="46" x2="34" y2="46" className="agitator-line" />
      <line x1="8" y1="48" x2="32" y2="48" className="agitator-line" />
      <line x1="6" y1="70" x2="34" y2="70" className="agitator-line" />
      <line x1="8" y1="72" x2="32" y2="72" className="agitator-line" />
      <line x1="6" y1="94" x2="34" y2="94" className="agitator-line" />
      <line x1="8" y1="96" x2="32" y2="96" className="agitator-line" />
      <rect x="16" y="-14" width="8" height="4" className="motor-block" />
      <circle cx="0" cy="40" r="2.5" className="nozzle" />
      <circle cx="36" cy="80" r="2.5" className="nozzle" />
      <line x1="20" y1="121" x2="20" y2="128" className="utility-line" />
      <rect x="8" y="128" width="24" height="4" className="reboiler" />
      <rect x="-30" y="136" width="100" height="24" rx="3" className="pfd-tag-bg" />
      <text className="equipment-code" x="20" y="147">{node.code}</text>
      <text className="equipment-name" x="20" y="157">{node.name}</text>
    </>
  );
}

function DistillationColumnSymbol({ node }: { node: LegacyModelNode }) {
  if (node.columnType === 'catalytic') return <CatalyticColumnSymbol node={node} />;
  if (node.columnType === 'packed') return <PackedColumnSymbol node={node} />;
  return <ProductColumnSymbol node={node} />;
}

// v4 设计：催化蒸馏塔 T-201 = 高塔体 + 5 块精馏段塔板 + 3 段催化段（中部）+ 3 块提馏段塔板 + 顶部冷凝器
function CatalyticColumnSymbol({ node }: { node: LegacyModelNode }) {
  return (
    <>
      <rect className="pfd-hover-bg" x="-8" y="-12" width="48" height="220" />
      <ellipse cx="20" cy="1" rx="16" ry="4" className="column-cap" />
      <rect x="4" y="1" width="32" height="180" className="column-shell" />
      <ellipse cx="20" cy="181" rx="16" ry="4" className="column-cap" />
      {/* 精馏段塔板 */}
      <line x1="6" y1="16" x2="34" y2="16" className="column-tray" />
      <line x1="6" y1="30" x2="34" y2="30" className="column-tray" />
      <line x1="6" y1="44" x2="34" y2="44" className="column-tray" />
      <line x1="6" y1="58" x2="34" y2="58" className="column-tray" />
      <line x1="6" y1="72" x2="34" y2="72" className="column-tray" />
      {/* 催化段（中部）*/}
      <rect x="4" y="84" width="32" height="40" className="catalytic-section" />
      <line x1="6" y1="94" x2="34" y2="94" className="catalytic-grid" />
      <line x1="6" y1="104" x2="34" y2="104" className="catalytic-grid" />
      <line x1="6" y1="114" x2="34" y2="114" className="catalytic-grid" />
      {/* 提馏段塔板 */}
      <line x1="6" y1="134" x2="34" y2="134" className="column-tray" />
      <line x1="6" y1="148" x2="34" y2="148" className="column-tray" />
      <line x1="6" y1="162" x2="34" y2="162" className="column-tray" />
      {/* 顶部冷凝器 */}
      <ellipse cx="20" cy="-6" rx="14" ry="3.5" className="condenser" />
      <line x1="20" y1="-2" x2="20" y2="1" className="utility-line" />
      <line x1="20" y1="-12" x2="20" y2="-9" className="utility-line" />
      <circle cx="0" cy="60" r="2.5" className="nozzle" />
      <circle cx="36" cy="130" r="2.5" className="nozzle" />
      <line x1="20" y1="181" x2="20" y2="188" className="utility-line" />
      <rect x="8" y="188" width="24" height="4" className="reboiler" />
      <rect x="-30" y="196" width="100" height="24" rx="3" className="pfd-tag-bg" />
      <text className="equipment-code" x="20" y="207">{node.code}</text>
      <text className="equipment-name" x="20" y="217">{node.name}</text>
    </>
  );
}

// v4 设计：解吸塔 T-301 = 较窄的塔体 + 8 块塔板 + 顶部冷凝器（明显比 T-201 矮）
function PackedColumnSymbol({ node }: { node: LegacyModelNode }) {
  return (
    <>
      <rect className="pfd-hover-bg" x="-8" y="-10" width="44" height="180" />
      <ellipse cx="18" cy="1" rx="14" ry="3.5" className="column-cap" />
      <rect x="4" y="1" width="28" height="150" className="column-shell" />
      <ellipse cx="18" cy="151" rx="14" ry="3.5" className="column-cap" />
      <line x1="6" y1="18" x2="30" y2="18" className="column-tray" />
      <line x1="6" y1="34" x2="30" y2="34" className="column-tray" />
      <line x1="6" y1="50" x2="30" y2="50" className="column-tray" />
      <line x1="6" y1="66" x2="30" y2="66" className="column-tray" />
      <line x1="6" y1="82" x2="30" y2="82" className="column-tray" />
      <line x1="6" y1="98" x2="30" y2="98" className="column-tray" />
      <line x1="6" y1="114" x2="30" y2="114" className="column-tray" />
      <line x1="6" y1="130" x2="30" y2="130" className="column-tray" />
      <ellipse cx="18" cy="-6" rx="12" ry="3" className="condenser" />
      <line x1="18" y1="-2" x2="18" y2="1" className="utility-line" />
      <line x1="18" y1="-12" x2="18" y2="-9" className="utility-line" />
      <circle cx="0" cy="60" r="2.5" className="nozzle" />
      <line x1="18" y1="151" x2="18" y2="158" className="utility-line" />
      <rect x="6" y="158" width="24" height="4" className="reboiler" />
      <rect x="-28" y="166" width="92" height="24" rx="3" className="pfd-tag-bg" />
      <text className="equipment-code" x="18" y="177">{node.code}</text>
      <text className="equipment-name" x="18" y="187">{node.name}</text>
    </>
  );
}

// v4 设计：产品分离塔 T-302 = 高塔体 + 11 块塔板 + 顶部冷凝器
function ProductColumnSymbol({ node }: { node: LegacyModelNode }) {
  return (
    <>
      <rect className="pfd-hover-bg" x="-8" y="-12" width="48" height="230" />
      <ellipse cx="20" cy="1" rx="16" ry="4" className="column-cap" />
      <rect x="4" y="1" width="32" height="200" className="column-shell" />
      <ellipse cx="20" cy="201" rx="16" ry="4" className="column-cap" />
      <line x1="6" y1="18" x2="34" y2="18" className="column-tray" />
      <line x1="6" y1="34" x2="34" y2="34" className="column-tray" />
      <line x1="6" y1="50" x2="34" y2="50" className="column-tray" />
      <line x1="6" y1="66" x2="34" y2="66" className="column-tray" />
      <line x1="6" y1="82" x2="34" y2="82" className="column-tray" />
      <line x1="6" y1="98" x2="34" y2="98" className="column-tray" />
      <line x1="6" y1="114" x2="34" y2="114" className="column-tray" />
      <line x1="6" y1="130" x2="34" y2="130" className="column-tray" />
      <line x1="6" y1="146" x2="34" y2="146" className="column-tray" />
      <line x1="6" y1="162" x2="34" y2="162" className="column-tray" />
      <line x1="6" y1="178" x2="34" y2="178" className="column-tray" />
      <ellipse cx="20" cy="-6" rx="14" ry="3.5" className="condenser" />
      <line x1="20" y1="-2" x2="20" y2="1" className="utility-line" />
      <line x1="20" y1="-12" x2="20" y2="-9" className="utility-line" />
      <circle cx="0" cy="80" r="2.5" className="nozzle" />
      <line x1="20" y1="201" x2="20" y2="208" className="utility-line" />
      <rect x="8" y="208" width="24" height="4" className="reboiler" />
      <rect x="-30" y="216" width="100" height="24" rx="3" className="pfd-tag-bg" />
      <text className="equipment-code" x="20" y="227">{node.code}</text>
      <text className="equipment-name" x="20" y="237">{node.name}</text>
    </>
  );
}

// v4 设计：产品出口/副产物收集 = 标牌 + 箭头（带 tone 颜色：out=绿，aux=橙）
function ProductSinkSymbol({ node }: { node: LegacyModelNode }) {
  const tone = node.tagTone || 'out';
  const tagClass = tone === 'aux' ? 'pfd-tag-bg-aux' : 'pfd-tag-bg-out';
  const arrowClass = tone === 'aux' ? 'sink-arrow-head-aux' : 'sink-arrow-head-out';
  const lineClass = tone === 'aux' ? 'sink-arrow-line-aux' : 'sink-arrow-line-out';
  // 区分 P-001（带出口箭头）和 B-001（无出口箭头）
  const isExport = node.id === 'P-001';
  return (
    <>
      <rect className="pfd-hover-bg" x="-6" y="-6" width={isExport ? 92 : 68} height="32" />
      <rect x="0" y="0" width={isExport ? 62 : 56} height="22" rx="3" className={tagClass} />
      <text className="equipment-code" x={isExport ? 31 : 28} y="11">{node.id}</text>
      <text className="equipment-name" x={isExport ? 31 : 28} y="20">{node.label}</text>
      {isExport ? (
        <>
          <line x1="62" y1="12" x2="78" y2="12" className={lineClass} />
          <path d="M74,7 L84,12 L74,17 Z" className={arrowClass} />
        </>
      ) : null}
    </>
  );
}

function VentSymbol({ node }: { node: LegacyModelNode }) {
  return (
    <>
      <rect className="pfd-hover-bg" x="-6" y="-22" width="86" height="34" />
      <path d="M37,6 L37,-15 M30,-9 L37,-17 L44,-9" className="vent-stack" />
      <text className="equipment-code" x="37" y="14">{node.id}</text>
      <text className="equipment-name" x="37" y="24">{node.label}</text>
    </>
  );
}

function TopologyMarker({ phase, onSelect, onHover }: {
  phase: string;
  onSelect?: (item: TopologySelectItem) => void;
  onHover?: (item: LegacyHoverItem | null) => void;
}) {
  if (phase !== 'diagnosis') return null;
  return (
    <>
      <g
        className="topology-marker severity-high"
        onClick={() => onSelect?.({ kind: 'marker', id: 'ISSUE-001' })}
        onMouseEnter={() => onHover?.({ kind: 'marker', id: 'ISSUE-001', x: 822, y: 286, title: '产品流股收率偏低', typeName: '诊断标记', status: '需重点追踪', related: 'E-007 / T-302' })}
        onMouseLeave={() => onHover?.(null)}
      >
        <title>产品流股收率偏低：E-007 / T-302 需重点追踪</title>
        <circle cx="822" cy="286" r="12" />
        <text x="838" y="290">收率偏低</text>
      </g>
      <g
        className="topology-marker severity-medium"
        onClick={() => onSelect?.({ kind: 'marker', id: 'ISSUE-002' })}
        onMouseEnter={() => onHover?.({ kind: 'marker', id: 'ISSUE-002', x: 612, y: 214, title: '回收段瓶颈', typeName: '诊断标记', status: 'T-301 / T-302 回收率不足', related: 'E-006 / E-008' })}
        onMouseLeave={() => onHover?.(null)}
      >
        <title>回收段瓶颈：T-301 / T-302 回收率不足</title>
        <circle cx="612" cy="214" r="10" />
        <text x="626" y="218">回收率不足</text>
      </g>
      <g
        className="topology-marker severity-normal"
        onClick={() => onSelect?.({ kind: 'marker', id: 'ISSUE-004' })}
        onMouseEnter={() => onHover?.({ kind: 'marker', id: 'ISSUE-004', x: 334, y: 172, title: '反应段达标', typeName: '诊断标记', status: '未形成主要瓶颈', related: 'R-101 / T-201' })}
        onMouseLeave={() => onHover?.(null)}
      >
        <title>反应段达标：R-101 / T-201 未形成主要瓶颈</title>
        <circle cx="334" cy="172" r="9" />
        <text x="347" y="176">反应段达标</text>
      </g>
    </>
  );
}

function SchemeChangeMarker({ phase, topologyChanges }: {
  phase: string;
  topologyChanges?: TopologyChanges;
}) {
  if (phase !== 'scheme') return null;

  const operationMarkers = topologyChanges?.operationMarkers || [];
  if (operationMarkers.length) {
    const fallbackPositions: Record<string, { x: number; y: number }> = {
      'T-301': { x: 572, y: 262 },
      'R-101': { x: 330, y: 192 },
    };

    return (
      <>
        {operationMarkers.map((item) => {
          const position = fallbackPositions[item.id] || { x: 572, y: 262 };
          return (
            <g key={item.id} className="scheme-change-marker operation-change-marker" transform={`translate(${position.x} ${position.y})`}>
              <rect width="146" height="42" rx="8" />
              <text x="12" y="17">{item.title || item.id}</text>
              <text x="12" y="32">{item.detail || item.label}</text>
            </g>
          );
        })}
      </>
    );
  }

  const addedId = topologyChanges?.addedNodes?.[0]?.id;
  const changedIds = topologyChanges?.changedNodes?.map((item) => item.id) || [];
  const markerMap: Record<string, { x: number; y: number; title: string; detail: string }> = {
    'R-102': { x: 285, y: 300, title: '并联扩能', detail: '新增并联反应器' },
    'R-17': { x: 286, y: 300, title: '利旧并联', detail: 'R-17 利旧接入' },
    'R-New': { x: 286, y: 300, title: '新增专用', detail: '专用反应器' },
    'S-New': { x: 286, y: 300, title: '快速分离', detail: '塔釜串联分离塔' },
  };
  const marker = (addedId ? markerMap[addedId] : undefined) || (changedIds.includes('T-301')
    ? { x: 572, y: 262, title: '流程微调', detail: '回收段条件变更' }
    : null);

  if (!marker) return null;

  return (
    <g className="scheme-change-marker" transform={`translate(${marker.x} ${marker.y})`}>
      <rect width="118" height="42" rx="8" />
      <text x="12" y="17">{marker.title}</text>
      <text x="12" y="32">{marker.detail}</text>
    </g>
  );
}

function EquipmentTooltip({ item }: { item: LegacyHoverItem; nodes?: Record<string, LegacyModelNode> }) {
  const x = Math.min(Math.max(item.x + 14, 22), 780);
  const y = Math.min(Math.max(item.y - 8, 22), 260);
  const isStream = item.kind === 'stream';
  return (
    <g className="pfd-tooltip" transform={`translate(${x} ${y})`}>
      <rect width="246" height="116" rx="10" />
      <text x="14" y="23" className="tooltip-title">{item.title}</text>
      {isStream ? (
        <>
          <text x="14" y="47">介质：{item.medium}</text>
          <text x="14" y="67">温度：{item.temperature}</text>
          <text x="14" y="87">压力：{item.pressure}</text>
          <text x="14" y="107">流向：{item.related}</text>
        </>
      ) : (
        <>
          <text x="14" y="47">类型：{item.typeName}</text>
          <text x="14" y="67">状态：{item.status}</text>
          <text x="14" y="87">原料：{item.feed}</text>
          <text x="14" y="107">产品：{item.product}</text>
        </>
      )}
    </g>
  );
}

function streamTypeName(type: string): string {
  if (type === 'methanol') return '甲醇补充线';
  if (type === 'recycle') return '甲醇循环线';
  if (type === 'byproduct') return '副产物流';
  return '主流程线';
}

// 原型定义后未使用，保留导出
export function getPhaseStatus(id: string, phase: string, fallback = '正常'): string {
  if (phase === 'diagnosis' && ['T-301', 'T-302'].includes(id)) return '回收率不足';
  if (phase === 'diagnosis' && ['R-101', 'T-201'].includes(id)) return '反应段达标';
  if (phase === 'feedback' && ['R-17', 'S-New'].includes(id)) return '不通过';
  return fallback || '正常';
}

function phaseStatusClass(id: string, phase: string): string {
  if (phase === 'diagnosis' && ['T-301', 'T-302'].includes(id)) return 'warning';
  if (phase === 'diagnosis' && ['R-101', 'T-201'].includes(id)) return 'pass';
  if (phase === 'feedback' && ['R-17', 'S-New'].includes(id)) return 'failed';
  return 'normal';
}

function getRelatedStreams(id: string): string {
  const related: Record<string, string> = {
    'MEOH-001': 'E-MEOH',
    'FEED-001': 'E-001',
    'M-001': 'E-001 / E-MEOH / E-008 / E-002',
    'R-101': 'E-002 / E-003',
    'T-201': 'E-003 / E-004 / E-005',
    'T-301': 'E-004 / E-006 / E-008',
    'T-302': 'E-006 / E-007',
    'P-001': 'E-007',
    'B-001': 'E-005',
  };
  return related[id] || '待识别';
}
