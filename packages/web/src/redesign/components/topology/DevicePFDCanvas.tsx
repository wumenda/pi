import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { LegendPanel } from './LegendPanel';
import { OrthogonalStreamEdge } from './OrthogonalStreamEdge';
import { SvgEquipmentNode } from './SvgEquipmentNode';
import { ZonePanel } from './ZonePanel';
import towerEquipmentDetailImage from '../../assets/tower-equipment-detail.png';
import reactorEquipmentDetailImage from '../../assets/reactor-equipment-detail.png';
import {
  processNodes,
  processStreams,
  processZones,
  schemeNodeLayout,
  schemeStreamLayout,
} from './processTopologyLayout';
import type { TopologyPoint } from './processTopologyLayout';
import { getTopologyTheme, topologyTheme } from './topologyTheme';
import { useTheme } from '../../theme';

export type DevicePhase = 'cognition' | 'diagnosis' | 'scheme' | 'feedback';

export interface TopologySelectItem {
  kind: 'equipment' | 'stream' | 'marker';
  id: string;
}

export interface TopologyChangedNode {
  id: string;
  label?: string;
  name?: string;
  code?: string;
  type?: string;
  change?: string;
  schemeChange?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface TopologyChangedEdge {
  id: string;
  source?: string;
  target?: string;
  label?: string;
  type?: string;
  streamType?: string;
  points?: TopologyPoint[];
  dashed?: boolean;
}

export interface TopologyOperationMarker {
  id: string;
  title?: string;
  detail?: string;
  label?: string;
}

export interface TopologyChanges {
  removedEdges?: string[];
  removedNodes?: string[];
  addedNodes?: TopologyChangedNode[];
  cancelledNodes?: TopologyChangedNode[];
  changedNodes?: TopologyChangedNode[];
  addedEdges?: TopologyChangedEdge[];
  feedbackStatus?: Record<string, string>;
  validationStatus?: string;
  hideDefaultAnnotations?: boolean;
  operationMarkers?: TopologyOperationMarker[];
}

export type DiagnosisSectionKey = 'reaction' | 'separation' | 'recovery';

export interface DeviceNodeModel {
  id: string;
  type: string;
  code?: string;
  name?: string;
  label?: string;
  subtitle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zoneId?: string;
  schemeChange?: 'added' | 'cancelled' | 'changed';
  feedbackStatus?: string;
  diagnosisStatus?: string;
  diagnosisSection?: DiagnosisSectionKey | null;
}

export interface DeviceStreamInput {
  id: string;
  source?: string;
  target?: string;
  type: string;
  label?: string;
  points: TopologyPoint[];
  arrow?: boolean;
  dashed?: boolean;
  streamType?: string;
  schemeChange?: string;
  labelAt?: TopologyPoint;
  diagnosisStatus?: string;
  diagnosisSection?: DiagnosisSectionKey | null;
}

export interface DeviceStreamModel extends DeviceStreamInput {
  labelAt: TopologyPoint;
}

export interface DeviceModel {
  nodes: DeviceNodeModel[];
  streams: DeviceStreamModel[];
  nodeById: Record<string, DeviceNodeModel>;
  streamById: Record<string, DeviceStreamModel>;
}

export interface EquipmentDetailData {
  title: string;
  equipmentType: string;
  design: string;
  operation: string;
  risk: string;
  inlet: string[];
  outlet: string[];
  checks: string[];
  designParameters: [string, string][];
  structureParameters: [string, string][];
  dataSources: string[];
  metrics: [string, string][];
}

export type DeviceDetailChangeHandler = (payload: { node: DeviceNodeModel; detail: EquipmentDetailData } | null) => void;

interface PhaseInteractionCopy {
  title: string;
  hint: string;
  actions: string[];
}

const phaseInteractionCopy: Record<DevicePhase, PhaseInteractionCopy> = {
  cognition: {
    title: '图上协同：装置认知',
    hint: '点击设备/管线，或拖拽框选流程片段，让 AI 判断你是在修正流程还是补充资料。',
    actions: ['流程有误', '补充信息', '确认关键关系'],
  },
  diagnosis: {
    title: '图上协同：工艺诊断',
    hint: '框选疑似异常区域，AI 会结合当前诊断阶段识别瓶颈、异常或质疑意图。',
    actions: ['添加异常点', '补充信息', '质疑瓶颈判断'],
  },
  scheme: {
    title: '图上协同：方案生成',
    hint: '在图上标记可改造点、不可改造区域或补充信息，方案会围绕这些标注生成。',
    actions: ['添加改造点', '此处不可改造', '补充信息'],
  },
  feedback: {
    title: '图上协同：限制条件校验',
    hint: '点击失败设备或框选设备组，AI 会把设备限制条件回传到装置级方案上下文。',
    actions: ['需人工复核', '接收设备限制条件', '补充校验条件'],
  },
};

interface EquipmentBriefInfo {
  typeName?: string;
  status?: string;
  feed?: string;
  product?: string;
  constraint?: string;
}

const equipmentDetails: Record<string, EquipmentBriefInfo> = {
  'FEED-001': { typeName: '原料入口', status: '正常', feed: 'C5 原料', product: '混合前原料流', constraint: 'C5 原料进入装置边界' },
  'MEOH-001': { typeName: '补充原料', status: '正常', feed: '外供甲醇', product: '甲醇补充流', constraint: '按工艺包给定甲醇配比补充' },
  'M-001': { typeName: '混合器', status: '待确认', feed: 'C5 原料、甲醇补充、甲醇循环', product: '混合进料', constraint: '需同时接收新鲜原料和回收甲醇' },
  'R-101': { typeName: '醚化反应器', status: '待确认', feed: '混合进料', product: '醚化反应产物', constraint: '后续校核空速、热负荷和操作窗口' },
  'T-201': { typeName: '催化蒸馏塔', status: '待确认', feed: '醚化反应产物', product: '塔顶轻组分、TAME/重组分', constraint: '兼具反应和分离功能，后续校核塔负荷' },
  'T-301': { typeName: '解吸塔', status: '待确认', feed: '塔顶轻组分', product: '目标组分流、甲醇循环', constraint: '需保留甲醇循环和目标组分分离路径' },
  'W-301': { typeName: '水洗罐', status: '待确认', feed: '含甲醇轻组分', product: '甲醇水洗后物流', constraint: '甲醇水洗与回收段关键设备' },
  'T-302': { typeName: '产品分离塔', status: '待确认', feed: '目标组分流', product: '异戊烯产品', constraint: '产品流股和回收率诊断的关键节点' },
  'P-001': { typeName: '产品出口', status: '正常', feed: '产品分离塔出料', product: '异戊烯产品', constraint: '扩产目标默认按异戊烯产品流量提升 20%' },
  'TAME-001': { typeName: '副产物出口', status: '正常', feed: '催化蒸馏塔釜液', product: 'TAME / 重组分', constraint: 'TAME / 重组分副产物流向' },
  'W-401': { typeName: '水洗设备', status: '正常', feed: '未反应物流', product: '水洗后物流、水相', constraint: '下游异构化前置处理' },
  'R-401': { typeName: '异构化反应器', status: '正常', feed: '水洗后物流', product: '异构化产物', constraint: '异构化路径保持独立' },
  'T-401': { typeName: '异戊烯精制塔', status: '正常', feed: '异构化产物', product: '异戊烯精制产品', constraint: '下排精制路径' },
  'WW-001': { typeName: '污水出口', status: '正常', feed: '水洗水相', product: '污水/水相', constraint: '水相排出边界' },
  'PURGE-001': { typeName: '放空出口', status: '正常', feed: '轻组分', product: '放空', constraint: '轻组分放空路径' },
  'S-New': { typeName: '快速分离塔', status: '新增待校验', feed: '塔釜出料', product: 'TAME 富集流、未反应碳五', constraint: '第 1 轮专家会审不通过，后续方案需取消' },
  'R-New': { typeName: '新增反应器', status: '新增待校验', feed: '混合进料', product: '新增出料', constraint: '需要校核空速、压降和热负荷' },
  'R-102': { typeName: '并联反应器', status: '新增待校验', feed: '混合进料', product: '并联反应出料', constraint: '并联扩能需要校核负荷分配' },
  'R-17': { typeName: '利旧反应器', status: '新增待校验', feed: '混合进料', product: '利旧反应出料', constraint: '利旧设备需确认可用窗口' },
};

interface StreamBriefInfo {
  medium?: string;
  temperature?: string;
  pressure?: string;
  constraint?: string;
}

const streamDetails: Record<string, StreamBriefInfo> = {
  'E-001': { medium: 'C5 原料', temperature: '32°C', pressure: '0.42 MPa', constraint: 'C5 原料进入混合器' },
  'E-MEOH': { medium: '甲醇', temperature: '35°C', pressure: '0.45 MPa', constraint: '甲醇补充从左侧进入 M-001' },
  'E-002': { medium: 'C5 + 甲醇', temperature: '38°C', pressure: '0.55 MPa', constraint: '混合进料进入醚化反应器' },
  'E-003': { medium: '醚化反应产物', temperature: '62°C', pressure: '0.52 MPa', constraint: '反应产物进入催化蒸馏塔' },
  'E-004': { medium: '塔顶轻组分', temperature: '58°C', pressure: '0.38 MPa', constraint: '塔顶轻组分进入解吸塔' },
  'E-005': { medium: 'TAME / 重组分', temperature: '88°C', pressure: '0.43 MPa', constraint: 'TAME / 重组分副产物流出' },
  'E-006': { medium: '异戊烯富集流', temperature: '54°C', pressure: '0.36 MPa', constraint: '目标组分流进入产品分离塔' },
  'E-007': { medium: '异戊烯产品', temperature: '40°C', pressure: '0.30 MPa', constraint: '异戊烯产品出口流股' },
  'E-008': { medium: '甲醇循环液', temperature: '45°C', pressure: '0.40 MPa', constraint: '甲醇循环必须闭合回 M-001' },
  'E-RECYCLE-OPT': { medium: '未反应碳五', temperature: '50°C', pressure: '0.42 MPa', constraint: '短程回流降低长程循环滞后' },
  'E-SNEW-IN': { medium: '塔釜出料', temperature: '88°C', pressure: '0.45 MPa', constraint: '塔釜出料进入快速分离塔' },
  'E-SNEW-TAME': { medium: 'TAME 富集流', temperature: '82°C', pressure: '0.40 MPa', constraint: 'TAME 快速移出反应系统' },
  'E-SNEW-C5': { medium: '未反应碳五', temperature: '56°C', pressure: '0.42 MPa', constraint: '未反应碳五回流' },
};

const equipmentDetailMock: Record<string, Partial<EquipmentDetailData>> = {
  'M-001': {
    title: '甲醇 / 原料混合器',
    equipmentType: '立式混合器',
    design: '设计处理量 22.5 t/h，操作压力 0.55 MPa，设计温度 80°C',
    operation: '当前负荷 83%，入口甲醇 / C5 比例稳定，混合后组成波动小于 1.5%',
    risk: '扩产后主要关注入口循环甲醇波动和混合均匀性。',
    inlet: ['C5 原料', '甲醇补充', '甲醇循环'],
    outlet: ['混合进料'],
    checks: ['流量闭合', '组成稳定', '循环接入'],
    metrics: [['负荷', '83%'], ['压力', '0.55 MPa'], ['温度', '38°C'], ['状态', '正常']],
  },
  'R-101': {
    title: '醚化反应器',
    equipmentType: '固定床醚化反应器',
    design: '设计空速 1.1 h⁻¹，设计压力 0.65 MPa，催化剂床层温升上限 18°C',
    operation: '当前转化率达标，扩产工况下反应热负荷仍在公用工程可覆盖范围内。',
    risk: '不是当前主要瓶颈，后续只需复核短程回流对入口组成的影响。',
    inlet: ['混合进料'],
    outlet: ['醚化反应产物'],
    checks: ['空速校核', '温升校核', '反应热负荷'],
    metrics: [['转化率', '达标'], ['空速裕量', '12%'], ['床层温升', '14°C'], ['状态', '通过']],
  },
  'T-201': {
    title: '催化蒸馏塔',
    equipmentType: '反应-分离耦合塔',
    design: '设计塔板 42 块，催化段位于中部，塔釜温度上限 92°C',
    operation: '主反应段转化率达标，塔釜 TAME / 重组分出料稳定。',
    risk: '方案三会从塔釜引出新支路，需要关注塔釜液相负荷变化。',
    inlet: ['醚化反应产物'],
    outlet: ['塔顶轻组分', 'TAME / 重组分'],
    checks: ['反应段效率', '塔釜负荷', '催化段压降'],
    metrics: [['转化率', '达标'], ['塔釜负荷', '76%'], ['压降', '正常'], ['状态', '通过']],
  },
  'T-301': {
    title: '解吸塔',
    equipmentType: '甲醇回收解吸塔',
    design: '设计塔板 30 块，塔顶压力 0.38 MPa，操作窗口偏窄',
    operation: '回收段对产品回收率敏感，第 1 轮专家会审确认操作窗口偏窄。',
    risk: '需要把操作限制条件反馈给方案生成，避免新增塔器带来不可承受负荷。',
    inlet: ['塔顶轻组分', '短程回流'],
    outlet: ['目标组分流', '甲醇循环'],
    checks: ['分离效率', '回流比', '塔顶压力'],
    metrics: [['回收率', '不足'], ['操作窗口', '偏窄'], ['压力', '0.38 MPa'], ['状态', '限制条件']],
  },
  'T-302': {
    title: '产品分离塔',
    equipmentType: '异戊烯产品分离塔',
    design: '设计塔板 36 块，产品纯度目标 99.3%，产品侧流量为扩产目标对象',
    operation: '产品纯度达标，但产品回收率不足，诊断阶段定位为重点关注对象。',
    risk: '后续方案应优先减少回收损失，而不是继续提高产品纯度。',
    inlet: ['目标组分流'],
    outlet: ['异戊烯产品', '轻组分放空'],
    checks: ['产品纯度', '产品回收率', '塔顶轻组分'],
    metrics: [['产品纯度', '达标'], ['回收率', '偏低'], ['目标提升', '+20%'], ['状态', '瓶颈']],
  },
  'S-New': {
    title: '快速分离塔',
    equipmentType: '候选新增分离塔',
    design: '方案三新增设备，串联在 T-201 塔釜出料后，用于快速移出 TAME',
    operation: '产能模拟通过，但专家会审认为分离效率和公用工程裕量不足。',
    risk: '第 1 轮专家会审不通过，第二轮方案应取消该设备。',
    inlet: ['T-201 塔釜出料'],
    outlet: ['TAME 快速移出', '未反应碳五回流'],
    checks: ['效率校核', '能耗评估', '施工周期'],
    metrics: [['校验结果', '不通过'], ['负荷裕量', '不足'], ['能耗', '偏高'], ['状态', '取消']],
  },
};

function ArrowDefs({ monochrome = false, dark = false }: { monochrome?: boolean; dark?: boolean }) {
  const { colors } = getTopologyTheme(dark);
  return (
    <>
      {Object.entries(colors)
        .filter(([key]) => ['main', 'methanolMakeup', 'methanolRecycle', 'waterWaste', 'byproduct', 'purge', 'product', 'scheme'].includes(key))
        .map(([key, color]) => (
          <marker key={key} id={`device-pfd-arrow-${key}`} markerWidth="6" markerHeight="4" refX="5.5" refY="2" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L6,2 L0,4 Z" fill={monochrome && key !== 'scheme' ? (dark ? '#e5e7eb' : '#111827') : color} />
          </marker>
        ))}
    </>
  );
}

const cognitionRevealStreamOrder = [
  'E-001',
  'E-MEOH',
  'E-002',
  'E-003',
  'E-005',
  'E-004',
  'E-008',
  'E-006',
  'E-007',
  'E-WASH-IN',
  'E-WASH-WATER',
  'E-WASH-OUT',
  'E-WW',
  'E-ISO-IN',
  'E-ISO-OUT',
  'E-FINAL',
  'E-PURGE',
];

const cognitionRevealNodeOrder = [
  'FEED-001',
  'MEOH-001',
  'M-001',
  'R-101',
  'T-201',
  'TAME-001',
  'T-301',
  'W-301',
  'T-302',
  'P-001',
  'WW-001',
  'PURGE-001',
  'W-401',
  'R-401',
  'T-401',
];

function getRevealDelay(id: string, order: string[], baseDelay: number, stepDelay: number): number {
  const orderIndex = order.indexOf(id);
  const index = orderIndex >= 0 ? orderIndex : order.length;
  return baseDelay + index * stepDelay;
}

interface DiagnosisSection {
  order: number;
  nodes: string[];
  streams: string[];
}

// 诊断阶段三段映射：反应段 → 分离段 → 回收段，沿产品流向损失累积递进
const diagnosisSectionMap: Record<DiagnosisSectionKey, DiagnosisSection> = {
  reaction: { order: 1, nodes: ['R-101', 'T-201'], streams: ['E-002', 'E-003'] },
  separation: { order: 2, nodes: ['T-301', 'W-301'], streams: ['E-004', 'E-008'] },
  recovery: { order: 3, nodes: ['T-302', 'P-001'], streams: ['E-006', 'E-007'] },
};

const nodeDiagnosisSection: Record<string, DiagnosisSectionKey> = {};
const streamDiagnosisSection: Record<string, DiagnosisSectionKey> = {};
(Object.entries(diagnosisSectionMap) as [DiagnosisSectionKey, DiagnosisSection][]).forEach(([key, { nodes, streams }]) => {
  nodes.forEach((id) => { nodeDiagnosisSection[id] = key; });
  streams.forEach((id) => { streamDiagnosisSection[id] = key; });
});

// 根据当前激活段（0 待机 / 1-3 三段 / 4 完成）计算节点/流股的联动 class
function getDiagnosisHighlightClass(itemSection: DiagnosisSectionKey | null | undefined, activeSection: number): string {
  if (!itemSection || !activeSection || activeSection >= 4) return '';
  if (activeSection === 0) return 'diagnosis-dimmed';
  const order = diagnosisSectionMap[itemSection].order;
  if (order === activeSection) return 'diagnosis-active';
  if (order < activeSection) return ''; // 已点亮段保持正常
  return 'diagnosis-dimmed'; // 未到段灰化
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DraftSelection extends SelectionRect {
  startX: number;
  startY: number;
  dragging: boolean;
}

interface HoverPayloadBase {
  kind: 'equipment' | 'stream' | 'marker';
  id: string;
  title: string;
  typeName?: string;
  status?: string;
  constraint?: string;
  related?: string;
  x: number;
  y: number;
}

interface StreamHoverPayload extends HoverPayloadBase {
  kind: 'stream';
  medium: string;
  temperature: string;
  pressure: string;
}

interface EquipmentHoverPayload extends HoverPayloadBase {
  kind: 'equipment' | 'marker';
  feed?: string;
  product?: string;
}

type HoverPayload = StreamHoverPayload | EquipmentHoverPayload;

interface DeviceIntent {
  phase: DevicePhase;
  selectionType: 'node' | 'edge' | 'marker' | 'region';
  targetIds: string[];
  targetLabel: string;
  region?: SelectionRect;
  actions: string[];
}

interface UserAnnotation {
  id: string;
  type: string;
  action: string;
  x: number;
  y: number;
  icon: string;
  labelWidth: number;
}

export interface DevicePFDCanvasProps {
  selectedId?: string | null;
  onSelect?: (item: TopologySelectItem) => void;
  phase?: DevicePhase;
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

export function DevicePFDCanvas({
  selectedId,
  onSelect,
  phase = 'cognition',
  topologyChanges,
  hidePurge = false,
  hidePurgeLegend,
  interactive = false,
  detailNodeId: controlledDetailNodeId,
  onDetailNodeChange,
  onDetailChange,
  hideInlineDetailCard = false,
  hideInternalDetailBack = false,
  openDetailOnSelect = false,
  drawingMode = 'flow',
  revealOnMount = false,
  schemeBuildStep,
  diagnosisSection = 4,
  dataStatusMap = {},
}: DevicePFDCanvasProps) {
  const [theme] = useTheme();
  const isDarkTheme = theme === 'dark';
  const model = useMemo(() => buildDeviceModel({ phase, topologyChanges, hidePurge }), [phase, topologyChanges, hidePurge]);
  const [hoverItem, setHoverItem] = useState<HoverPayload | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);
  const [activeIntent, setActiveIntent] = useState<DeviceIntent | null>(null);
  const [internalDetailNodeId, setInternalDetailNodeId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<UserAnnotation[]>(() => getDefaultAnnotations(phase, topologyChanges));
  const hoverCloseTimer = useRef<number | null>(null);
  const isPfdDrawing = drawingMode === 'pfd';
  const canInteract = !isPfdDrawing && interactive && ['cognition', 'diagnosis', 'scheme', 'feedback'].includes(phase);
  const isDetailControlled = controlledDetailNodeId !== undefined;
  const detailNodeId = isDetailControlled ? controlledDetailNodeId : internalDetailNodeId;
  const shouldRevealTopology = revealOnMount && phase === 'cognition' && !isPfdDrawing && !detailNodeId;
  const detailNode = detailNodeId ? model.nodeById[detailNodeId] : null;
  const detailData = useMemo(
    () => (detailNode ? getEquipmentDetailData(detailNode, model) : null),
    [detailNode, model],
  );

  function setDetailNode(id: string | null) {
    if (isDetailControlled) {
      onDetailNodeChange?.(id);
      return;
    }
    setInternalDetailNodeId(id);
  }

  useEffect(() => {
    setAnnotations(getDefaultAnnotations(phase, topologyChanges));
    setActiveIntent(null);
    setDraftSelection(null);
    setDetailNode(null);
  }, [phase, topologyChanges]);

  useEffect(() => {
    onDetailChange?.(detailNode && detailData ? { node: detailNode, detail: detailData } : null);
  }, [detailNodeId, detailNode, detailData, onDetailChange]);

  useEffect(() => () => {
    if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
  }, []);

  function showHoverItem(item: HoverPayload | null) {
    if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
    setHoverItem(item);
  }

  function scheduleHoverClose() {
    if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = window.setTimeout(() => setHoverItem(null), 140);
  }

  function openEquipmentDetail(id: string) {
    const node = model.nodeById[id];
    if (!node) return;
    setDetailNode(id);
    setHoverItem(null);
    setActiveIntent(null);
  }

  function selectItem(item: TopologySelectItem) {
    onSelect?.(item);
    window.dispatchEvent(new CustomEvent('redesign-topology-select', {
      detail: { item },
    }));
    if (!canInteract) return;
    if (openDetailOnSelect && item.kind === 'equipment') {
      openEquipmentDetail(item.id);
      return;
    }
    setActiveIntent(buildIntentFromSelection({
      phase,
      selectionType: item.kind === 'equipment' ? 'node' : item.kind === 'stream' ? 'edge' : 'marker',
      targetIds: [item.id],
      model,
    }));
  }

  function getSvgPoint(event: ReactPointerEvent<SVGSVGElement>): TopologyPoint {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!canInteract || event.button !== 0) return;
    if ((event.target as Element).closest('.device-pfd-node, .device-pfd-stream, .topology-marker, .scheme-change-marker, .pfd-tooltip')) return;
    const point = getSvgPoint(event);
    setDraftSelection({ startX: point.x, startY: point.y, x: point.x, y: point.y, width: 0, height: 0, dragging: true });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draftSelection?.dragging) return;
    const point = getSvgPoint(event);
    setDraftSelection((draft) => (draft ? {
      ...draft,
      x: Math.min(draft.startX, point.x),
      y: Math.min(draft.startY, point.y),
      width: Math.abs(point.x - draft.startX),
      height: Math.abs(point.y - draft.startY),
    } : draft));
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
    setActiveIntent(buildIntentFromSelection({
      phase,
      selectionType: 'region',
      targetIds: detectRegionTargets(rect, model),
      region: rect,
      model,
    }));
  }

  function confirmIntent(action: string) {
    if (!activeIntent) return;
    setAnnotations((items) => [buildAnnotation(activeIntent, action, model), ...items].slice(0, 6));
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
    <div className={`device-pfd-wrap ${isPfdDrawing ? 'is-pfd-drawing' : ''} ${shouldRevealTopology ? 'is-cognition-reveal' : ''} ${schemeBuildStep ? `scheme-build-${schemeBuildStep}` : ''}`}>
      <svg
        className={`device-pfd-canvas phase-${phase} ${canInteract ? 'is-interactive' : ''}`}
        viewBox={`0 0 ${topologyTheme.canvas.width} ${topologyTheme.canvas.height}`}
        role="img"
        aria-label="异戊烯装置专业 PFD"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setDraftSelection(null)}
      >
        <defs>
          <ArrowDefs monochrome={isPfdDrawing} dark={isDarkTheme} />
          <pattern id="device-pfd-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" />
          </pattern>
        </defs>
        {detailNode && detailData ? (
          <EquipmentDetailDiagram
            node={detailNode}
            detail={detailData}
            onBack={() => setDetailNode(null)}
            hideBack={hideInternalDetailBack}
          />
        ) : (
          <>
            <rect className="device-pfd-bg" x="0" y="0" width={topologyTheme.canvas.width} height={topologyTheme.canvas.height} rx="12" />
            <rect className="device-pfd-grid" x="148" y="24" width="1010" height="512" rx="10" />
            <LegendPanel hidePurge={hidePurge} hidePurgeLegend={hidePurgeLegend} />
            <g className="device-pfd-zones">
              {processZones.map((zone) => <ZonePanel key={zone.id} zone={zone} />)}
            </g>
            <g className="device-pfd-streams">
              {model.streams.map((stream) => (
                <OrthogonalStreamEdge
                  key={stream.id}
                  edge={stream}
                  selected={selectedId === stream.id}
                  className={`${shouldRevealTopology ? 'is-reveal-item' : ''} ${getDiagnosisHighlightClass(stream.diagnosisSection, diagnosisSection)} ${dataStatusMap[stream.id] ? `data-status-${dataStatusMap[stream.id]}` : ''}`.trim()}
                  style={shouldRevealTopology ? ({ '--reveal-delay': `${getRevealDelay(stream.id, cognitionRevealStreamOrder, 120, 120)}ms` } as CSSProperties) : undefined}
                  onSelect={selectItem}
                  onHover={(item) => showHoverItem(buildHoverPayload(item, model))}
                  onLeave={scheduleHoverClose}
                />
              ))}
            </g>
            <g className="device-pfd-nodes">
              {model.nodes.map((node) => (
                <SvgEquipmentNode
                  key={node.id}
                  node={node}
                  selected={selectedId === node.id}
                  className={`${shouldRevealTopology ? 'is-reveal-item' : ''} ${getDiagnosisHighlightClass(node.diagnosisSection, diagnosisSection)} ${dataStatusMap[node.id] ? `data-status-${dataStatusMap[node.id]}` : ''}`.trim()}
                  style={shouldRevealTopology ? ({ '--reveal-delay': `${getRevealDelay(node.id, cognitionRevealNodeOrder, 210, 140)}ms` } as CSSProperties) : undefined}
                  onSelect={selectItem}
                  onHover={(item) => showHoverItem(buildHoverPayload(item, model))}
                  onLeave={scheduleHoverClose}
                />
              ))}
            </g>
            <DataStatusMarkerLayer model={model} statusMap={dataStatusMap} />
            <TopologyMarker phase={phase} diagnosisSection={diagnosisSection} onSelect={selectItem} onHover={showHoverItem} />
            <SchemeChangeMarker phase={phase} topologyChanges={topologyChanges} model={model} />
            <UserAnnotationLayer annotations={annotations} />
            {draftSelection?.dragging ? <SelectionMarquee rect={draftSelection} /> : null}
            {hoverItem ? (
              <EquipmentTooltip
                item={hoverItem}
                onOpenDetail={hoverItem.kind === 'equipment' ? openEquipmentDetail : undefined}
                onEnter={() => {
                  if (hoverCloseTimer.current) window.clearTimeout(hoverCloseTimer.current);
                }}
                onLeave={scheduleHoverClose}
              />
            ) : null}
          </>
        )}
      </svg>
      {detailNode && detailData && !hideInlineDetailCard ? <EquipmentDetailCard node={detailNode} detail={detailData} /> : null}
      {canInteract && activeIntent && !detailNode ? (
        <TopologyInteractionCoach
          phase={phase}
          activeIntent={activeIntent}
          onConfirm={confirmIntent}
          onClose={() => setActiveIntent(null)}
        />
      ) : null}
    </div>
  );
}

function getStatusMarkerMeta(status: string | undefined): { label: string; title: string } | null {
  if (!status) return null;
  const metas: Record<string, { label: string; title: string }> = {
    waiting_user_confirm: { label: '待', title: '参数待确认' },
    unconfirmed: { label: '待补', title: '参数暂不确认' },
    modified: { label: '已改', title: '参数已修改' },
  };
  return metas[status] || null;
}

function getStreamMarkerPoint(stream: DeviceStreamModel): TopologyPoint {
  const points = stream.points || [];
  if (!points.length) return { x: 0, y: 0 };
  const index = Math.floor((points.length - 1) / 2);
  const start = points[index]!;
  const end = points[index + 1] || start;
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

interface StatusMarker {
  id: string;
  status: string;
  label: string;
  title: string;
  x: number;
  y: number;
}

function DataStatusMarkerLayer({ model, statusMap }: { model: DeviceModel; statusMap: Record<string, string> }) {
  const markers: StatusMarker[] = [];

  model.nodes.forEach((node) => {
    const status = statusMap[node.id];
    const meta = getStatusMarkerMeta(status);
    if (!meta || !status) return;
    markers.push({
      id: `node-${node.id}`,
      status,
      ...meta,
      x: node.x + node.width - 8,
      y: node.y - 10,
    });
  });

  model.streams.forEach((stream) => {
    const status = statusMap[stream.id];
    const meta = getStatusMarkerMeta(status);
    if (!meta || !status) return;
    const point = getStreamMarkerPoint(stream);
    markers.push({
      id: `stream-${stream.id}`,
      status,
      ...meta,
      x: point.x,
      y: point.y - 16,
    });
  });

  if (!markers.length) return null;

  return (
    <g className="data-status-marker-layer" aria-label="参数确认状态标记">
      {markers.map((marker) => {
        const width = marker.label.length > 1 ? 36 : 22;
        return (
          <g key={marker.id} className={`data-status-marker data-status-${marker.status}`} transform={`translate(${marker.x} ${marker.y})`}>
            <title>{marker.title}</title>
            <rect x={-width / 2} y="-12" width={width} height="24" rx="12" />
            <text y="4">{marker.label}</text>
          </g>
        );
      })}
    </g>
  );
}

function buildDeviceModel({ phase, topologyChanges, hidePurge }: {
  phase: DevicePhase;
  topologyChanges?: TopologyChanges;
  hidePurge: boolean;
}): DeviceModel {
  const removedEdges = new Set(topologyChanges?.removedEdges || []);
  const removedNodeIds = new Set(topologyChanges?.removedNodes || []);
  const addedNodeIds = new Set(topologyChanges?.addedNodes?.map((node) => node.id) || []);
  const cancelledNodeIds = new Set(topologyChanges?.cancelledNodes?.map((node) => node.id) || []);
  const changedNodeMap: Record<string, TopologyChangedNode> = Object.fromEntries((topologyChanges?.changedNodes || []).map((node) => [node.id, node]));
  const feedbackStatus = topologyChanges?.feedbackStatus || {};
  const addedEdges = topologyChanges?.addedEdges || [];

  const addedNodeModels = (topologyChanges?.addedNodes || []).map((node) => {
    const layout = schemeNodeLayout[node.id];
    return {
      ...layout,
      ...node,
      code: layout?.code || node.id,
      name: node.label?.replace(node.id, '').trim() || layout?.name || node.label,
      schemeChange: 'added' as const,
    } as DeviceNodeModel;
  });
  const cancelledNodeModels = (topologyChanges?.cancelledNodes || []).map((node) => {
    const layout = schemeNodeLayout[node.id];
    return {
      ...layout,
      ...node,
      code: layout?.code || node.id,
      name: node.label?.replace(node.id, '').trim() || layout?.name || node.label,
      schemeChange: 'cancelled' as const,
    } as DeviceNodeModel;
  });
  const addedStreamModels = addedEdges.map((edge): DeviceStreamInput => {
    const layout = schemeStreamLayout[edge.id];
    return {
      ...layout,
      ...edge,
      type: layout?.type || normalizeStreamType(edge),
      points: layout?.points || [],
      arrow: true,
      schemeChange: 'added',
    };
  });

  const baseNodes: DeviceNodeModel[] = [
    ...processNodes,
    ...addedNodeModels,
    ...cancelledNodeModels,
  ];
  const nodes: DeviceNodeModel[] = baseNodes
    .filter((node) => !removedNodeIds.has(node.id))
    .filter((node) => !(hidePurge && node.id === 'PURGE-001'))
    .filter((node, index, all) => all.findIndex((item) => item.id === node.id) === index)
    .map((node): DeviceNodeModel => ({
      ...node,
      schemeChange: node.schemeChange || (addedNodeIds.has(node.id) ? 'added' : cancelledNodeIds.has(node.id) ? 'cancelled' : changedNodeMap[node.id] ? 'changed' : undefined),
      feedbackStatus: feedbackStatus[node.id],
      diagnosisStatus: phase === 'diagnosis' && ['T-301', 'T-302'].includes(node.id) ? 'bottleneck' : undefined,
      diagnosisSection: phase === 'diagnosis' ? (nodeDiagnosisSection[node.id] || null) : undefined,
    }));

  const streams: DeviceStreamModel[] = [
    ...processStreams,
    ...addedStreamModels,
  ]
    .filter((stream) => !removedEdges.has(stream.id))
    .filter((stream) => !(hidePurge && stream.id === 'E-PURGE'))
    .filter((stream, index, all) => all.findIndex((item) => item.id === stream.id) === index)
    .map((stream): DeviceStreamModel => ({
      ...stream,
      labelAt: getStreamLabelPoint(stream),
      diagnosisStatus: undefined,
      diagnosisSection: phase === 'diagnosis' ? (streamDiagnosisSection[stream.id] || null) : undefined,
      type: stream.type || normalizeStreamType(stream),
    }));

  return {
    nodes,
    streams,
    nodeById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    streamById: Object.fromEntries(streams.map((stream) => [stream.id, stream])),
  };
}

function normalizeStreamType(edge: { id?: string; streamType?: string }): string {
  if (edge.streamType === 'recycle') return 'methanolRecycle';
  if (edge.streamType === 'byproduct') return 'byproduct';
  if (edge.streamType === 'purge') return 'purge';
  if (edge.id?.includes('SNEW') || edge.id?.includes('RNEW') || edge.id?.includes('R17') || edge.id?.includes('R102')) return 'scheme';
  return edge.streamType || 'main';
}

function getStreamLabelPoint(stream: { labelAt?: TopologyPoint; points?: TopologyPoint[] }): TopologyPoint {
  if (stream.labelAt) return stream.labelAt;
  const points = stream.points || [];
  if (!points.length) return { x: 0, y: 0 };
  const middle = points[Math.floor(points.length / 2)]!;
  const previous = points[Math.max(0, Math.floor(points.length / 2) - 1)]!;
  return { x: Math.round((middle.x + previous.x) / 2), y: Math.round((middle.y + previous.y) / 2) - 8 };
}

function buildHoverPayload(item: { kind: string; id: string }, model: DeviceModel): HoverPayload {
  if (item.kind === 'stream') {
    const stream = model.streamById[item.id];
    const detail = streamDetails[item.id] || {};
    const issue = stream?.diagnosisStatus === 'bottleneck';
    return {
      kind: 'stream',
      id: item.id,
      title: stream?.label || item.id,
      typeName: getStreamTypeName(stream?.type),
      status: issue ? '瓶颈关注' : stream?.schemeChange === 'added' ? '新增' : '正常',
      constraint: issue ? '回收率不足，需进入方案生成环节' : detail.constraint || '装置流股',
      medium: detail.medium || stream?.label || '装置物流',
      temperature: detail.temperature || '按模拟工况计算',
      pressure: detail.pressure || '按模拟工况计算',
      related: `${stream?.source || ''} → ${stream?.target || ''}`,
      x: stream?.labelAt?.x || 120,
      y: stream?.labelAt?.y || 120,
    };
  }

  const node = model.nodeById[item.id];
  const detail = equipmentDetails[item.id] || {};
  const issue = node?.diagnosisStatus === 'bottleneck' || ['failed', 'conditional'].includes(node?.feedbackStatus ?? '');
  return {
    kind: 'equipment',
    id: item.id,
    title: `${node?.code || item.id} ${node?.name || ''}`.trim(),
    typeName: detail.typeName || node?.type || '设备',
    status: getNodeStatusText(node, detail, issue),
    constraint: detail.constraint || '待确认',
    feed: detail.feed || '上游流股',
    product: detail.product || '下游流股',
    related: getRelatedStreams(item.id, model),
    x: node?.x || 120,
    y: Math.max((node?.y || 120) - 74, 20),
  };
}

function getNodeStatusText(node: DeviceNodeModel | undefined, detail: EquipmentBriefInfo, issue: boolean): string {
  if (node?.schemeChange === 'cancelled') return '已取消';
  if (node?.schemeChange === 'added') return '新增待校验';
  if (node?.feedbackStatus === 'pass' || node?.feedbackStatus === 'passed') return '通过';
  if (node?.feedbackStatus === 'failed') return '不通过';
  if (issue) return '异常';
  return detail.status || '正常';
}

function getStreamTypeName(type: string | undefined): string {
  const names: Record<string, string> = {
    main: '主流程',
    product: '产品流',
    methanolMakeup: '甲醇补充',
    methanolRecycle: '循环流',
    waterWaste: '水相/污水',
    byproduct: '副产物流',
    purge: '放空',
    scheme: '改造流股',
  };
  return (type && names[type]) || '装置流股';
}

function getRelatedStreams(nodeId: string, model: DeviceModel): string {
  return model.streams
    .filter((stream) => stream.source === nodeId || stream.target === nodeId)
    .map((stream) => stream.id)
    .join(' / ') || '待识别';
}

function detectRegionTargets(rect: SelectionRect, model: DeviceModel): string[] {
  const nodeTargets = model.nodes
    .filter((node) => isRectCenterInRect(node, rect))
    .map((node) => node.id);
  const streamTargets = model.streams
    .filter((stream) => isPointInRect(stream.labelAt, rect))
    .map((stream) => stream.id);
  const targets = [...nodeTargets, ...streamTargets];
  if (targets.length) return targets.slice(0, 6);
  return getHotspotByRegion(rect)?.targetIds || ['局部流程区域'];
}

function isRectCenterInRect(node: DeviceNodeModel, rect: SelectionRect): boolean {
  return isPointInRect({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, rect);
}

function isPointInRect(point: TopologyPoint, rect: SelectionRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

interface RegionHotspot {
  targetIds: string[];
  x: number;
  y: number;
  radius: number;
}

function getHotspotByRegion(rect: SelectionRect): RegionHotspot | undefined {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const hotspots: RegionHotspot[] = [
    { targetIds: ['R-101', 'T-201'], x: 486, y: 186, radius: 145 },
    { targetIds: ['T-301', 'T-302', 'E-006', 'E-007'], x: 784, y: 182, radius: 175 },
    { targetIds: ['S-New', 'E-SNEW-IN', 'E-SNEW-TAME', 'E-SNEW-C5'], x: 592, y: 390, radius: 150 },
    { targetIds: ['E-RECYCLE-OPT', 'T-301', 'T-302'], x: 790, y: 276, radius: 160 },
  ];
  return hotspots.find((item) => Math.hypot(center.x - item.x, center.y - item.y) <= item.radius);
}

function buildIntentFromSelection({ phase, selectionType, targetIds, region, model }: {
  phase: DevicePhase;
  selectionType: DeviceIntent['selectionType'];
  targetIds?: string[];
  region?: SelectionRect;
  model: DeviceModel;
}): DeviceIntent {
  const copy = phaseInteractionCopy[phase] || phaseInteractionCopy.cognition;
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

function getReadableTargetName(id: string, model: DeviceModel): string {
  const node = model.nodeById[id];
  if (node) return node.code || node.name || node.id;
  const stream = model.streamById[id];
  if (stream) return stream.label || stream.id;
  return id;
}

function buildAnnotation(intent: DeviceIntent, action: string, model: DeviceModel): UserAnnotation {
  const type = getAnnotationType(action, intent.phase);
  const anchor = getAnnotationAnchor(intent, model);
  return {
    id: `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    action,
    x: anchor.x,
    y: anchor.y,
    icon: getAnnotationIcon(type),
    labelWidth: Math.max(76, Math.min(142, action.length * 14 + 28)),
  };
}

function getAnnotationAnchor(intent: DeviceIntent, model: DeviceModel): TopologyPoint {
  if (intent.region) {
    return { x: Math.min(intent.region.x + intent.region.width, 1040), y: Math.max(intent.region.y, 52) };
  }
  const firstTarget = intent.targetIds[0]!;
  const node = model.nodeById[firstTarget];
  if (node) return { x: node.x + node.width / 2, y: Math.max(node.y - 18, 44) };
  const stream = model.streamById[firstTarget];
  if (stream) return { x: stream.labelAt.x + 28, y: Math.max(stream.labelAt.y - 22, 44) };
  return { x: 188, y: 88 };
}

function getAnnotationType(action: string, phase: DevicePhase): string {
  if (action.includes('有误') || action.includes('不可') || action.includes('限制条件')) return 'forbidden';
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

function getDefaultAnnotations(phase: DevicePhase, topologyChanges?: TopologyChanges): UserAnnotation[] {
  if (topologyChanges?.hideDefaultAnnotations) return [];
  if (phase === 'diagnosis') {
    return [
      { id: 'default-diagnosis-recovery', type: 'bottleneck', action: '回收率瓶颈', x: 788, y: 126, icon: '!', labelWidth: 104 },
    ];
  }
  if (phase === 'scheme' && topologyChanges?.addedEdges?.length) {
    return [
      { id: 'default-scheme-change', type: 'retrofit', action: '新增改造路径', x: 752, y: 246, icon: '+', labelWidth: 112 },
    ];
  }
  if (phase === 'feedback') {
    if (topologyChanges?.validationStatus === 'passed' || topologyChanges?.feedbackStatus?.['T-301'] === 'pass') {
      return [
        { id: 'default-feedback-passed', type: 'retrofit', action: '设备复验通过', x: 744, y: 246, icon: '✓', labelWidth: 112 },
      ];
    }
    return [
      { id: 'default-feedback-failed', type: 'forbidden', action: '设备限制条件', x: 628, y: 310, icon: '×', labelWidth: 86 },
    ];
  }
  return [];
}

interface DiagnosisMarker {
  id: string;
  section: DiagnosisSectionKey;
  severity: string;
  cx: number;
  cy: number;
  rectX: number;
  rectY: number;
  rectW: number;
  textX: number;
  textY: number;
  label: string;
  hover: {
    x: number;
    y: number;
    title: string;
    typeName: string;
    status: string;
    related: string;
  };
}

// 诊断标记：按段（reaction/separation/recovery）逐个出现，当前段标记强调
const topologyDiagnosisMarkers: DiagnosisMarker[] = [
  { id: 'ISSUE-004', section: 'reaction', severity: 'severity-normal', cx: 472, cy: 276, rectX: 484, rectY: 264, rectW: 82, textX: 494, textY: 280, label: '反应段达标', hover: { x: 472, y: 276, title: '反应段达标', typeName: '诊断标记', status: '未形成主要瓶颈', related: 'R-101 / T-201' } },
  { id: 'ISSUE-002', section: 'separation', severity: 'severity-medium', cx: 714, cy: 104, rectX: 726, rectY: 92, rectW: 84, textX: 736, textY: 108, label: '回收率不足', hover: { x: 714, y: 104, title: '回收段瓶颈', typeName: '诊断标记', status: 'T-301 / T-302 回收率不足', related: 'E-006 / E-008' } },
  { id: 'ISSUE-001', section: 'recovery', severity: 'severity-high', cx: 930, cy: 102, rectX: 942, rectY: 90, rectW: 72, textX: 952, textY: 106, label: '收率偏低', hover: { x: 930, y: 102, title: '产品流股收率偏低', typeName: '诊断标记', status: '需重点追踪', related: 'E-007 / T-302' } },
];

function TopologyMarker({ phase, diagnosisSection = 4, onSelect, onHover }: {
  phase: DevicePhase;
  diagnosisSection?: number;
  onSelect?: (item: TopologySelectItem) => void;
  onHover?: (item: HoverPayload | null) => void;
}) {
  if (phase !== 'diagnosis') return null;
  return (
    <>
      {topologyDiagnosisMarkers.map((m) => {
        const order = diagnosisSectionMap[m.section].order;
        // 0 待机不显示；未到该段不显示
        if (!diagnosisSection || diagnosisSection < order) return null;
        const isCurrent = diagnosisSection === order;
        return (
          <g
            key={m.id}
            className={`topology-marker ${m.severity} ${isCurrent ? 'is-current' : ''}`}
            onClick={() => onSelect?.({ kind: 'marker', id: m.id })}
            onMouseEnter={() => onHover?.({ kind: 'marker', id: m.id, ...m.hover })}
            onMouseLeave={() => onHover?.(null)}
          >
            <circle cx={m.cx} cy={m.cy} r="7" />
            <rect x={m.rectX} y={m.rectY} width={m.rectW} height="24" rx="7" />
            <text x={m.textX} y={m.textY}>{m.label}</text>
          </g>
        );
      })}
    </>
  );
}

function SchemeChangeMarker({ phase, topologyChanges, model }: {
  phase: DevicePhase;
  topologyChanges?: TopologyChanges;
  model: DeviceModel;
}) {
  if (!['scheme', 'feedback'].includes(phase)) return null;
  const operationMarkers = topologyChanges?.operationMarkers || [];
  if (operationMarkers.length) {
    const fallbackPositions: Record<string, TopologyPoint> = {
      'T-301': { x: 690, y: 254 },
      'R-101': { x: 412, y: 206 },
    };

    return (
      <>
        {operationMarkers.map((item) => {
          const position = fallbackPositions[item.id] || { x: 690, y: 254 };
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

  const addedId = topologyChanges?.addedNodes?.[0]?.id || topologyChanges?.cancelledNodes?.[0]?.id;
  const changedIds = topologyChanges?.changedNodes?.map((item) => item.id) || [];
  const markerMap: Record<string, { x: number; y: number; title: string; detail: string }> = {
    'R-102': { x: 420, y: 286, title: '并联扩能', detail: '新增并联反应器' },
    'R-17': { x: 420, y: 286, title: '利旧并联', detail: 'R-17 利旧接入' },
    'R-New': { x: 420, y: 286, title: '新增专用', detail: '专用反应器' },
    'S-New': { x: 744, y: 296, title: phase === 'feedback' ? '已取消' : '快速分离', detail: phase === 'feedback' ? '专家会审不通过' : '塔釜串联分离塔' },
  };
  const marker = (addedId ? markerMap[addedId] : undefined) || (model.streamById['E-RECYCLE-OPT']
    ? { x: 788, y: 252, title: '短程回流', detail: '替代新增分离塔' }
    : changedIds.includes('T-301') ? { x: 690, y: 254, title: '流程微调', detail: '回收段条件变更' } : null);

  if (!marker) return null;
  return (
    <g className="scheme-change-marker" transform={`translate(${marker.x} ${marker.y})`}>
      <rect width="132" height="42" rx="8" />
      <text x="12" y="17">{marker.title}</text>
      <text x="12" y="32">{marker.detail}</text>
    </g>
  );
}

function SelectionMarquee({ rect }: { rect: SelectionRect }) {
  return (
    <g className="pfd-selection-marquee">
      <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="6" />
    </g>
  );
}

function UserAnnotationLayer({ annotations }: { annotations: UserAnnotation[] }) {
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

function EquipmentTooltip({ item, onOpenDetail, onEnter, onLeave }: {
  item: HoverPayload;
  onOpenDetail?: (id: string) => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const x = Math.min(Math.max(item.x + 16, 164), 902);
  const y = Math.min(Math.max(item.y - 8, 22), 390);
  const isStream = item.kind === 'stream';
  const height = isStream ? 116 : 150;
  return (
    <g className={`pfd-tooltip ${onOpenDetail ? 'has-action' : ''}`} transform={`translate(${x} ${y})`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <rect width="246" height={height} rx="10" />
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
          {onOpenDetail ? (
            <g className="tooltip-detail-action" transform="translate(14 118)" onClick={() => onOpenDetail(item.id)}>
              <rect width="86" height="24" rx="7" />
              <text x="43" y="16">查看详情</text>
            </g>
          ) : null}
        </>
      )}
    </g>
  );
}

function getEquipmentDetailData(node: DeviceNodeModel, model: DeviceModel): EquipmentDetailData {
  const mock = equipmentDetailMock[node.id] || {};
  const detail = equipmentDetails[node.id] || {};
  const connected = model.streams.filter((stream) => stream.source === node.id || stream.target === node.id);
  const designParameters = mock.designParameters || getEquipmentDesignParameters(node);
  const structureParameters = mock.structureParameters || getEquipmentStructureParameters(node, connected);
  return {
    title: mock.title || `${node.code || node.id} ${node.name || ''}`.trim(),
    equipmentType: mock.equipmentType || detail.typeName || node.type || '工艺设备',
    design: mock.design || detail.constraint || '设计数据来自 PFD、设备表和运行数据的对齐结果。',
    operation: mock.operation || '当前运行数据已进入装置级流程认知，后续阶段会按扩产工况重新校核。',
    risk: mock.risk || '暂无限制条件，后续随方案生成和设备校验更新。',
    inlet: mock.inlet || connected.filter((stream) => stream.target === node.id).map((stream) => stream.label ?? ''),
    outlet: mock.outlet || connected.filter((stream) => stream.source === node.id).map((stream) => stream.label ?? ''),
    checks: mock.checks || ['模拟仿真', '负荷校核', '操作窗口'],
    designParameters,
    structureParameters,
    dataSources: mock.dataSources || ['PFD 图纸', '设备表', '设计数据表', '运行数据'],
    metrics: mock.metrics || [
      ['状态', detail.status || '正常'],
      ['入口', detail.feed || '上游流股'],
      ['出口', detail.product || '下游流股'],
      ['关联流股', connected.map((stream) => stream.id).join(' / ') || '待识别'],
    ],
  };
}

export function getEquipmentDesignParameters(node: DeviceNodeModel): [string, string][] {
  if (node.type === 'tower') {
    const towerDefaults: Record<string, { load: string; pressure: string; topTemperature: string; refluxRatio: string; feedTray: string }> = {
      'T-201': { load: '18.0 t/h', pressure: '0.52 MPa', topTemperature: '58°C', refluxRatio: '1.8', feedTray: '第 18 块' },
      'T-301': { load: '16.8 t/h', pressure: '0.38 MPa', topTemperature: '76.4°C', refluxRatio: '1.35', feedTray: '第 12 块' },
      'T-302': { load: '18.0 t/h', pressure: '0.38 MPa', topTemperature: '92°C', refluxRatio: '2.1', feedTray: '第 20 块' },
      'T-401': { load: '14.5 t/h', pressure: '0.34 MPa', topTemperature: '48°C', refluxRatio: '2.4', feedTray: '第 16 块' },
      'S-New': { load: '9.6 t/h', pressure: '0.45 MPa', topTemperature: '56°C', refluxRatio: '1.4', feedTray: '第 10 块' },
    };
    const data = towerDefaults[node.id] || { load: '18.0 t/h', pressure: '0.38 MPa', topTemperature: '92°C', refluxRatio: '1.8', feedTray: '第 18 块' };
    return [
      ['设计处理量', data.load],
      ['设计压力', data.pressure],
      ['塔顶温度', data.topTemperature],
      ['回流比', data.refluxRatio],
      ['进料板位置', data.feedTray],
    ];
  }

  return [
    ['设计处理量', node.type === 'reactor' ? '22.5 t/h' : '24.0 t/h'],
    ['设计压力', '0.65 MPa'],
    ['设计温度', '80°C'],
    ['设计裕量', '15%'],
  ];
}

export function getEquipmentStructureParameters(node: DeviceNodeModel, connected: DeviceStreamModel[]): [string, string][] {
  const mock = equipmentDetailMock[node.id] || {};
  const detail = equipmentDetails[node.id] || {};
  const connectedStreams = connected.map((stream) => stream.id).join(' / ') || '待识别';
  if (node.type === 'tower') {
    const towerDefaults: Record<string, { trayCount: string; diameter: string; height: string }> = {
      'T-201': { trayCount: '42 块', diameter: '2.2 m', height: '28 m' },
      'T-301': { trayCount: '30 块', diameter: '1.8 m', height: '24 m' },
      'T-302': { trayCount: '36 块', diameter: '2.0 m', height: '26 m' },
      'T-401': { trayCount: '32 块', diameter: '1.6 m', height: '22 m' },
      'S-New': { trayCount: '24 块', diameter: '1.4 m', height: '18 m' },
    };
    const data = towerDefaults[node.id] || { trayCount: '36 块', diameter: '2.0 m', height: '26 m' };
    return [
      ['设备型式', mock.equipmentType || detail.typeName || '塔器'],
      ['主体材质', '316L / 塔盘'],
      ['关键内件', '浮阀塔盘 / 填料段'],
      ['塔板数', data.trayCount],
      ['直径', data.diameter],
      ['塔高', data.height],
      ['连接流股', connectedStreams],
    ];
  }

  return [
    ['设备型式', mock.equipmentType || detail.typeName || node.type || '工艺设备'],
    ['主体材质', '316L'],
    ['关键内件', node.type === 'reactor' ? '固定床催化剂篮' : '静态混合元件'],
    ['连接流股', connectedStreams],
  ];
}

function EquipmentDetailDiagram({ node, detail, onBack, hideBack = false }: {
  node: DeviceNodeModel;
  detail: EquipmentDetailData;
  onBack: () => void;
  hideBack?: boolean;
}) {
  const inlet = detail.inlet?.[0] || '入口物流';
  const outlet = detail.outlet?.[0] || '出口物流';
  const equipmentImage = getEquipmentDetailImage(node);
  return (
    <>
      <rect className="device-detail-bg" x="0" y="0" width={topologyTheme.canvas.width} height={topologyTheme.canvas.height} rx="12" />
      {!hideBack ? (
        <foreignObject x="42" y="42" width="120" height="34">
          <button type="button" className="device-detail-back" onClick={onBack}>返回流程图</button>
        </foreignObject>
      ) : null}

      {equipmentImage ? (
        <image
          className="device-detail-equipment-image"
          href={equipmentImage}
          x="245"
          y="-340"
          width="690"
          height="1248"
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
      <>
        <text className="device-detail-kicker" x="190" y="60">设备详情图</text>
        <text className="device-detail-title" x="190" y="88">{detail.title}</text>
        <text className="device-detail-subtitle" x="190" y="112">{detail.equipmentType}</text>

        <g className="device-detail-flow" transform="translate(220 162)">
        <rect className="detail-stream-box inlet" x="0" y="122" width="138" height="40" rx="9" />
        <text x="69" y="146">{inlet}</text>
        <path className="detail-stream-line" d="M138 142 H252" markerEnd="url(#device-pfd-arrow-main)" />

        <g className={`device-detail-equipment node-${node.type}`} transform="translate(282 0)">
          <DetailEquipmentShape node={node} />
          <text className="detail-equipment-code" x="130" y="258">{node.code || node.id}</text>
          <text className="detail-equipment-name" x="130" y="282">{node.name || detail.title}</text>
        </g>

        <path className="detail-stream-line" d="M552 142 H672" markerEnd="url(#device-pfd-arrow-product)" />
        <rect className="detail-stream-box outlet" x="672" y="122" width="150" height="40" rx="9" />
        <text x="747" y="146">{outlet}</text>

        </g>
      </>
      )}
    </>
  );
}

function getEquipmentDetailImage(node: DeviceNodeModel): string | null {
  if (node.type === 'tower') return towerEquipmentDetailImage;
  if (node.type === 'reactor') return reactorEquipmentDetailImage;
  return null;
}

function DetailEquipmentShape({ node }: { node: DeviceNodeModel }) {
  if (node.type === 'tower') {
    return (
      <>
        <ellipse className="detail-cap" cx="130" cy="18" rx="42" ry="10" />
        <rect className="detail-shell" x="88" y="18" width="84" height="210" rx="20" />
        <ellipse className="detail-cap" cx="130" cy="228" rx="42" ry="10" />
        {[48, 78, 108, 138, 168, 198].map((y) => <line key={y} className="detail-tray" x1="104" x2="156" y1={y} y2={y} />)}
      </>
    );
  }
  if (node.type === 'reactor') {
    return (
      <>
        <rect className="detail-shell reactor" x="82" y="28" width="96" height="190" rx="28" />
        {[68, 104, 140, 176].map((y) => <line key={y} className="detail-tray" x1="104" x2="156" y1={y} y2={y} />)}
        <circle className="detail-port" cx="130" cy="48" r="7" />
        <circle className="detail-port" cx="130" cy="198" r="7" />
      </>
    );
  }
  return (
    <>
      <ellipse className="detail-cap" cx="130" cy="40" rx="44" ry="12" />
      <rect className="detail-shell" x="86" y="40" width="88" height="160" rx="24" />
      <ellipse className="detail-cap" cx="130" cy="200" rx="44" ry="12" />
      <path className="detail-impeller" d="M130 56 V184 M104 120 H156" />
    </>
  );
}

function EquipmentDetailCard({ node, detail }: { node: DeviceNodeModel; detail: EquipmentDetailData }) {
  return (
    <aside className="device-detail-card">
      <header>
        <span>{node.code || node.id}</span>
        <strong>{detail.title}</strong>
      </header>
      <p>{detail.operation}</p>
      <div className="device-detail-metrics">
        {detail.metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <section>
        <b>设计依据</b>
        <span>{detail.design}</span>
      </section>
      <section>
        <b>风险 / 限制条件</b>
        <span>{detail.risk}</span>
      </section>
    </aside>
  );
}

function TopologyInteractionCoach({ phase, activeIntent, onConfirm, onClose }: {
  phase: DevicePhase;
  activeIntent: DeviceIntent;
  onConfirm: (action: string) => void;
  onClose: () => void;
}) {
  const copy = phaseInteractionCopy[phase] || phaseInteractionCopy.cognition;
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

function buildIntentMessage(intent: DeviceIntent, action: string): string[] {
  const stageTexts: Record<DevicePhase, string> = {
    cognition: '装置认知',
    diagnosis: '工艺诊断',
    scheme: '方案生成',
    feedback: '设备校验 / 限制条件反馈',
  };
  const effectTexts: Record<DevicePhase, string> = {
    cognition: '该标注会进入装置认知修正记录，后续诊断会以修正后的流程和补充信息为输入。',
    diagnosis: '该标注会写入诊断清单，后续方案会优先围绕这个瓶颈或异常区域生成。',
    scheme: '该标注会写入方案设计限制条件，候选方案会避开不可改造点或优先围绕改造点展开。',
    feedback: '该标注会进入设备级 Agent 建议集，并回传给装置级 Agent 作为下一轮方案条件。',
  };
  const stageText = stageTexts[intent.phase] || '当前阶段';
  const effectText = effectTexts[intent.phase];
  return [
    `阶段：${stageText}`,
    `图上对象：${intent.targetLabel}`,
    `用户意图：${action}`,
    effectText,
  ];
}

function getStageLevelByPhase(phase: DevicePhase): number {
  const levels: Record<DevicePhase, number> = {
    cognition: 1,
    diagnosis: 2,
    scheme: 3,
    feedback: 5,
  };
  return levels[phase] || 1;
}
