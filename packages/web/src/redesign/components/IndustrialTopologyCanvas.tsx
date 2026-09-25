import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { IndustrialIcon } from './IndustrialIcon';

const streamColors: Record<string, string> = {
  material: '#2563EB',
  product: '#16A34A',
  steam_hp: '#EF4444',
  steam_mp: '#F97316',
  steam_lp: '#FACC15',
  cooling_water: '#0EA5E9',
  fuel_gas: '#F59E0B',
  hydrogen: '#14B8A6',
  electricity: '#7C3AED',
};

const unitPositions: Record<string, { x: number; y: number }> = {
  crude_tank: { x: 96, y: 215 },
  propane_tank: { x: 96, y: 430 },

  cdu: { x: 245, y: 300 },
  fcc: { x: 385, y: 165 },
  hydrocracking: { x: 385, y: 305 },
  sulfur_recovery: { x: 385, y: 445 },
  reforming: { x: 525, y: 165 },
  gasoline_hydrogenation: { x: 525, y: 305 },
  gas_separation: { x: 525, y: 445 },

  pdh: { x: 660, y: 365 },
  hppo: { x: 790, y: 365 },
  eo_eg: { x: 790, y: 510 },
  polyether: { x: 930, y: 365 },

  product_oil: { x: 720, y: 135 },
  propylene: { x: 720, y: 265 },
  po: { x: 850, y: 265 },
  polyether_product: { x: 1030, y: 365 },
  eo_eg_product: { x: 945, y: 510 },

  boiler: { x: 210, y: 760 },
  steam_header: { x: 360, y: 760 },
  cooling_water: { x: 510, y: 760 },
  fuel_gas: { x: 660, y: 760 },
  hydrogen: { x: 810, y: 760 },
  substation: { x: 960, y: 760 },
  letdown_station: { x: 360, y: 615 },
  turbine_generator: { x: 470, y: 835 },
};

interface BottleneckPoint {
  id: string;
  kind: string;
  title: string;
  severity?: string;
  value: string;
  confidence: string;
  location: string;
  x: number;
  y: number;
  relatedIds?: string[];
  details: string[];
}

const bottleneckPoints: BottleneckPoint[] = [
  {
    id: 'bn_hp_letdown',
    kind: 'bottleneck',
    title: '高压蒸汽减温减压量过大',
    severity: 'high',
    value: '4,860 万元/年',
    confidence: '高',
    location: '常减压装置 + 减温减压站',
    x: 360,
    y: 615,
    relatedIds: ['cdu', 'steam_header', 'letdown_station', 'e-steam-cdu', 'e-boiler-steam'],
    details: ['价值等级：高', '可回收价值：4,860 万元/年', '影响路径：锅炉房 - 蒸汽管网 - 常减压', '建议优先进入方案生成'],
  },
  {
    id: 'bn_mp_fluctuation',
    kind: 'bottleneck',
    title: 'PDH / HPPO 中压蒸汽波动',
    severity: 'medium-high',
    value: '1,420 万元/年',
    confidence: '中高',
    location: '聚醚产品链',
    x: 730,
    y: 640,
    relatedIds: ['steam_header', 'pdh', 'hppo', 'e-steam-pdh', 'e-steam-hppo', 's-pdh-hppo'],
    details: ['价值等级：中高', '可回收价值：1,420 万元/年', '影响对象：PDH / HPPO', '主要风险：产品链负荷稳定性'],
  },
  {
    id: 'bn_cooling_margin',
    kind: 'bottleneck',
    title: '循环水换热裕量不足',
    severity: 'medium',
    value: '860 万元/年',
    confidence: '中',
    location: 'HPPO / EOEG',
    x: 550,
    y: 660,
    relatedIds: ['cooling_water', 'hppo', 'eo_eg', 'e-cooling-hppo', 's-eoeg-product'],
    details: ['价值等级：中', '可回收价值：860 万元/年', '影响对象：HPPO / EOEG', '需要补充：换热器运行趋势'],
  },
  {
    id: 'bn_fuel_heat_value',
    kind: 'bottleneck',
    title: '燃料气热值波动',
    severity: 'low',
    value: '520 万元/年',
    confidence: '中',
    location: '锅炉房',
    x: 650,
    y: 700,
    relatedIds: ['fuel_gas', 'boiler', 'steam_header', 'e-fuel-boiler', 'e-boiler-steam'],
    details: ['价值等级：中', '可回收价值：520 万元/年', '影响对象：锅炉房', '主要风险：蒸汽产量与热效率波动'],
  },
];

const bottleneckRelatedIds = new Set(bottleneckPoints.flatMap((point) => [point.id, ...(point.relatedIds || [])]));

interface AIInsight {
  id: string;
  kind: string;
  title: string;
  type: string;
  tone: string;
  x: number;
  y: number;
  value: string;
  confidence: string;
  location: string;
  locationObjectIds?: string[];
  relatedObjectIds?: string[];
  summary: string;
  evidence: string[];
  suggestedActions: string[];
  details: string[];
}

const aiInsights: AIInsight[] = [
  {
    id: 'insight_hp_mp',
    kind: 'insight',
    title: 'HP→MP 减温减压路径异常',
    type: '高价值机会 / 异常',
    tone: 'opportunity',
    x: 330,
    y: 560,
    value: '约 5,360 万元/年',
    confidence: '中高',
    location: '常减压装置 + HP→MP 减温减压站',
    locationObjectIds: ['cdu', 'letdown_station'],
    relatedObjectIds: ['cdu', 'steam_header', 'letdown_station', 'e-steam-cdu', 'e-boiler-steam'],
    summary: 'HP 蒸汽有较大比例经减温减压进入 MP 管网，存在高品位能量损失。',
    evidence: ['PFD 已识别 HP/MP/LP 蒸汽等级', '常减压装置 HP 蒸汽需求已挂接', '减温减压站流量估算约 118 t/h'],
    suggestedActions: ['展开蒸汽系统图', '加入瓶颈诊断', '标记为待验证'],
    details: ['类型：高价值机会', '位置：常减压装置 + HP→MP 减温减压站', '潜在价值：约 5,360 万元/年', '可信度：中高'],
  },
  {
    id: 'insight_pdh_hppo',
    kind: 'insight',
    title: 'PDH/HPPO 与蒸汽系统强耦合',
    type: '系统耦合 / 高价值',
    tone: 'coupling',
    x: 735,
    y: 520,
    value: '影响聚醚产品链',
    confidence: '中高',
    location: 'PDH、HPPO、MP/LP 蒸汽管线',
    locationObjectIds: ['pdh', 'hppo'],
    relatedObjectIds: ['pdh', 'hppo', 'polyether', 'steam_header', 'e-steam-pdh', 'e-steam-hppo', 's-pdh-hppo', 's-hppo-polyether'],
    summary: '高价值聚醚产品链依赖 MP/LP 蒸汽稳定供应，蒸汽波动可能放大产品链收益风险。',
    evidence: ['PDH / HPPO 均已挂接蒸汽依赖', '聚醚链路收益贡献高', 'MP 蒸汽路径与产品链节点存在交叉影响'],
    suggestedActions: ['查看产业链视图', '展开蒸汽系统图', '加入待验证清单'],
    details: ['类型：系统耦合', '位置：PDH / HPPO / MP 蒸汽管线', '影响：聚醚产品链稳定性', '可信度：中高'],
  },
  {
    id: 'insight_condensate_gap',
    kind: 'insight',
    title: '凝结水回收路径不完整',
    type: '待验证 / 损失',
    tone: 'validation',
    x: 500,
    y: 705,
    value: '待补数据',
    confidence: '中',
    location: '凝结水 / 疏水回收路径',
    locationObjectIds: ['steam_header', 'cooling_water'],
    relatedObjectIds: ['steam_header', 'cooling_water', 'letdown_station', 'turbine_generator', 'solution-steam-turbine'],
    summary: '当前图纸能识别蒸汽主路径，但凝结水与疏水回收数据不完整，会影响方案收益测算精度。',
    evidence: ['PFD 中凝结水路径未闭环', 'Excel 数据未覆盖全部疏水点', '方案 A 收益测算依赖回收边界'],
    suggestedActions: ['加入待验证清单', '生成待补数据清单', '标记系统认知待确认项'],
    details: ['类型：待验证', '位置：凝结水 / 疏水回收路径', '影响：收益测算精度', '可信度：中'],
  },
];

const insightRelatedIds = new Set(aiInsights.flatMap((item) => [item.id, ...(item.relatedObjectIds || []), ...(item.locationObjectIds || [])]));

interface UnitEquipmentItem {
  id: string;
  title: string;
  icon: string;
  x: number;
  y: number;
  metric: string;
  status: string;
  details: string[];
}

const unitEquipment: UnitEquipmentItem[] = [
  { id: 'furnace', title: '常压炉', icon: 'boiler', x: 190, y: 330, metric: '热负荷 84%', status: '关注', details: ['设备：常压炉', '热负荷：84%', '燃料气热值波动', '证据：DCS 趋势 + PFD'] },
  { id: 'tower', title: '常压塔', icon: 'distillation_tower', x: 430, y: 230, metric: '压降 0.42MPa', status: '稳定', details: ['设备：常压塔', '压降：0.42 MPa', '塔顶冷凝负荷正常', '证据：PID + 操作记录'] },
  { id: 'exchanger', title: '进料换热器组', icon: 'cooling_tower', x: 430, y: 430, metric: '端差 18C', status: '关注', details: ['设备：进料换热器组', '端差：18 C', '换热裕量偏紧', '证据：月报 + 能耗表'] },
  { id: 'letdown', title: 'HP→MP 减温减压点', icon: 'letdown_station', x: 710, y: 330, metric: '118 t/h', status: '瓶颈', details: ['设备：减温减压点', 'HP→MP：118 t/h', '理论上限：5360 万元/年', '工程可回收：4860 万元/年'] },
];

interface UnitPipeline {
  id: string;
  from: [number, number];
  to: [number, number];
  type: string;
  label: string;
  details: string[];
}

const unitPipelines: UnitPipeline[] = [
  { id: 'u_hp', from: [80, 330], to: [190, 330], type: 'steam_hp', label: 'HP 蒸汽', details: ['介质：HP 蒸汽', '来源：蒸汽管网', '去向：常压炉', '状态：已挂接'] },
  { id: 'u_heat', from: [286, 330], to: [430, 230], type: 'material', label: '加热后进料', details: ['介质：加热后进料', '来源：常压炉', '去向：常压塔', '状态：稳定'] },
  { id: 'u_return', from: [430, 430], to: [710, 330], type: 'steam_mp', label: 'MP 回收路径', details: ['介质：MP 蒸汽/凝液', '来源：换热器组', '去向：减温减压点', '状态：瓶颈相关'] },
  { id: 'u_loss', from: [710, 330], to: [850, 330], type: 'steam_mp', label: '减压损失', details: ['介质：MP 蒸汽', '流量：118 t/h', '问题：压力能未回收', '建议：背压机组接入'] },
];

interface UnitPfdEquipmentItem extends UnitEquipmentItem {
  type: string;
}

const unitPfdEquipment: UnitPfdEquipmentItem[] = [
  {
    id: 'exchanger',
    title: '进料换热器组',
    type: 'exchanger',
    icon: 'cooling_tower',
    x: 165,
    y: 285,
    metric: '结垢 18C',
    status: '关注',
    details: ['对象：进料换热器组', '关键指标：结垢 18C', '影响：预热效率下降，抬高炉负荷', '证据：月报 + 能耗表 + PFD'],
  },
  {
    id: 'furnace',
    title: '常压炉',
    type: 'furnace',
    icon: 'boiler',
    x: 385,
    y: 285,
    metric: '热负荷 84%',
    status: '关注',
    details: ['对象：常压炉', '关键指标：热负荷 84%', '影响：燃料气波动放大蒸汽需求', '证据：DCS 趋势 + 操作记录'],
  },
  {
    id: 'tower',
    title: '常压塔',
    type: 'tower',
    icon: 'distillation_tower',
    x: 610,
    y: 265,
    metric: '压降 0.42MPa',
    status: '稳定',
    details: ['对象：常压塔', '关键指标：压降 0.42MPa', '影响：塔顶冷凝负荷正常', '证据：PID + 操作记录'],
  },
  {
    id: 'letdown',
    title: 'HP→MP 减温减压点',
    type: 'letdown',
    icon: 'letdown_station',
    x: 810,
    y: 285,
    metric: '118 t/h',
    status: '瓶颈',
    details: ['对象：HP→MP 减温减压点', '瓶颈属性：高压蒸汽压差未回收', '当前流量：118 t/h', '工程可回收价值：4,860 万元/年'],
  },
];

interface UnitPfdEdgeItem {
  id: string;
  type: string;
  label: string;
  points: [number, number][];
  labelAt: [number, number];
  impact?: boolean;
  recovery?: boolean;
  details?: string[];
}

const unitPfdPipelines: UnitPfdEdgeItem[] = [
  {
    id: 'u_feed_in',
    type: 'material',
    label: '原油预热',
    points: [[62, 285], [118, 285]],
    labelAt: [90, 268],
    details: ['介质：原油/中间物流', '方向：进料换热器组', '状态：稳定'],
  },
  {
    id: 'u_feed_furnace',
    type: 'material',
    label: '预热后进料',
    points: [[214, 285], [324, 285]],
    labelAt: [270, 268],
    details: ['介质：预热后进料', '方向：常压炉', '状态：换热效率偏低'],
  },
  {
    id: 'u_furnace_tower',
    type: 'material',
    label: '加热后进料',
    points: [[446, 285], [520, 285], [520, 245], [565, 245]],
    labelAt: [500, 268],
    details: ['介质：加热后进料', '方向：常压塔', '状态：稳定'],
  },
  {
    id: 'u_tower_out',
    type: 'product',
    label: '塔顶/侧线产品',
    points: [[655, 245], [715, 245], [715, 205], [870, 205]],
    labelAt: [765, 190],
    details: ['介质：塔顶/侧线产品', '方向：后续炼油单元', '状态：受蒸汽系统影响较小'],
  },
  {
    id: 'u_hp_to_furnace',
    type: 'steam_hp',
    label: 'HP 蒸汽',
    points: [[385, 455], [385, 350]],
    labelAt: [420, 410],
    details: ['介质：HP 蒸汽', '用户：常压炉/伴热', '状态：用量高位'],
  },
  {
    id: 'u_hp_letdown',
    type: 'steam_hp',
    label: 'HP→MP 118 t/h',
    points: [[610, 350], [610, 405], [810, 405], [810, 350]],
    labelAt: [708, 390],
    impact: true,
    details: ['介质：HP 蒸汽', '流量：118 t/h', '问题：压差能未回收', '建议：背压机组接入'],
  },
  {
    id: 'u_mp_recovery',
    type: 'steam_mp',
    label: 'MP 回收路径',
    points: [[810, 350], [810, 455], [455, 455], [455, 350]],
    labelAt: [640, 438],
    recovery: true,
    details: ['介质：MP 蒸汽/凝液', '方向：回收至装置蒸汽网络', '状态：方案生成关键路径'],
  },
  {
    id: 'u_energy_relation',
    type: 'fuel_gas',
    label: '能流关联',
    points: [[165, 350], [165, 410], [385, 410], [385, 350]],
    labelAt: [265, 395],
    details: ['关系：换热效率影响炉负荷', '当前判断：结垢造成能耗抬升', '数据：能耗月报 + DCS 趋势'],
  },
];

interface IndustrialUnit {
  id: string;
  type: string;
  icon: string;
  title: string;
  zone: string;
  status: string;
  metric: string;
  systems: string[];
  valueChains?: string[];
  upstream?: string[];
  downstream?: string[];
  bottleneck?: boolean;
  modification?: boolean;
  solutionOnly?: boolean;
  details: string[];
}

const units: IndustrialUnit[] = [
  { id: 'crude_tank', type: 'unit', icon: 'crude_tank', title: '原油罐区', zone: '原料与储运区', status: '运行中', metric: '原油 625 t/h', systems: ['material'], upstream: [], downstream: ['cdu'], details: ['原料：原油', '流量：625 t/h', '去向：常减压装置', '数据可信度：高'] },
  { id: 'propane_tank', type: 'unit', icon: 'sphere_tank', title: '丙烷罐区', zone: '原料与储运区', status: '运行中', metric: '丙烷 75 t/h', systems: ['material'], valueChains: ['polyether', 'po'], upstream: [], downstream: ['pdh'], details: ['原料：丙烷', '外购为主', '价格弹性：±15%', '去向：PDH 装置'] },
  { id: 'cdu', type: 'unit', icon: 'distillation_tower', title: '常减压装置', zone: '炼油主装置区', status: '运行中', metric: '负荷 88%', systems: ['steam', 'fuel_gas'], upstream: ['crude_tank'], downstream: ['fcc', 'hydrocracking'], bottleneck: true, details: ['当前状态：运行中', '当前负荷：88%', 'HP 蒸汽：64 t/h', '产品：石脑油/柴油/航煤'] },
  { id: 'fcc', type: 'unit', icon: 'fcc_reactor', title: '催化裂化装置', zone: '炼油主装置区', status: '运行中', metric: 'MP 蒸汽关联', systems: ['steam'], upstream: ['cdu'], downstream: ['reforming'], details: ['当前状态：运行中', '当前负荷：91%', '产出：汽油/液化气', '关联：MP 蒸汽'] },
  { id: 'hydrocracking', type: 'unit', icon: 'hydrocracking_reactor', title: '加氢裂化装置', zone: '炼油主装置区', status: '运行中', metric: '氢气关联', systems: ['hydrogen', 'cooling_water'], upstream: ['cdu'], downstream: ['gasoline_hydrogenation'], details: ['当前状态：运行中', '介质：氢气', '产品：柴油/石脑油', '数据可信度：中高'] },
  { id: 'reforming', type: 'unit', icon: 'reformer', title: '连续重整装置', zone: '炼油主装置区', status: '运行中', metric: '芳烃/氢气', systems: ['hydrogen', 'electricity'], upstream: ['fcc'], downstream: ['product_oil'], details: ['当前状态：运行中', '产品：芳烃/氢气', '去向：产品区', '数据可信度：高'] },
  { id: 'gasoline_hydrogenation', type: 'unit', icon: 'hydrocracking_reactor', title: '加氢精制装置', zone: '炼油主装置区', status: '运行中', metric: '柴油/航煤', systems: ['hydrogen'], upstream: ['hydrocracking'], downstream: ['product_oil'], details: ['产品：柴油/航煤', '氢气消耗：中', '数据可信度：中高'] },
  { id: 'gas_separation', type: 'unit', icon: 'gas_separation_tower', title: '气体分离装置', zone: '炼油主装置区', status: '运行中', metric: '液化气/丙烯', systems: ['steam'], upstream: ['fcc'], downstream: ['propylene'], details: ['分离对象：液化气/丙烯', '关联：蒸汽、冷却水'] },
  { id: 'sulfur_recovery', type: 'unit', icon: 'sulfur_recovery', title: '硫磺回收装置', zone: '炼油主装置区', status: '运行中', metric: '环保约束', systems: ['steam'], upstream: ['hydrocracking'], downstream: [], details: ['类型：环保装置', '约束：尾气排放', '数据可信度：中'] },
  { id: 'pdh', type: 'unit', icon: 'pdh_reactor', title: 'PDH 装置', zone: '化工深加工区', status: '运行中', metric: '负荷 92%', systems: ['steam', 'cooling_water', 'electricity'], valueChains: ['polyether', 'po'], upstream: ['propane_tank'], downstream: ['hppo'], details: ['当前负荷：92%', '进料：丙烷 75 t/h', '产品：丙烯 65 t/h', '收益贡献：1280 万元/年'] },
  { id: 'hppo', type: 'unit', icon: 'hppo_reactor', title: 'HPPO 装置', zone: '化工深加工区', status: '运行中', metric: '负荷 85%', systems: ['steam', 'hydrogen', 'cooling_water'], valueChains: ['polyether', 'po'], upstream: ['pdh'], downstream: ['polyether'], details: ['当前负荷：85%', '进料：丙烯 30 t/h', '产品：PO', '收益贡献：1420 万元/年'] },
  { id: 'eo_eg', type: 'unit', icon: 'gas_separation_tower', title: 'EO/EG 装置', zone: '化工深加工区', status: '运行中', metric: 'EO/EG 20 万吨/年', systems: ['steam', 'cooling_water'], valueChains: ['eo_eg'], upstream: ['gas_separation'], downstream: ['eo_eg_product'], details: ['消耗：MP/LP 蒸汽', '产品：EO/EG', '数据可信度：中'] },
  { id: 'polyether', type: 'unit', icon: 'polyether_reactor', title: '聚醚装置', zone: '化工深加工区', status: '运行中', metric: '负荷 80%', systems: ['electricity', 'cooling_water'], valueChains: ['polyether'], upstream: ['hppo'], downstream: ['polyether_product'], details: ['当前负荷：80%', '进料：PO', '产品：聚醚', '收益贡献：560 万元/年'] },
  { id: 'boiler', type: 'system', icon: 'boiler', title: '锅炉房', zone: '公用工程区', status: '运行中', metric: '520 t/h', systems: ['steam', 'fuel_gas'], downstream: ['steam_header'], details: ['4 台燃气锅炉', '总蒸发量：520 t/h', '压力：4.0 MPa(g)', '数据可信度：高'] },
  { id: 'steam_header', type: 'system', icon: 'steam_header', title: '蒸汽管网', zone: '公用工程区', status: '部分缺失', metric: 'HP/MP/LP', systems: ['steam'], downstream: ['cdu', 'pdh', 'hppo', 'eo_eg'], modification: true, details: ['HP：182 t/h', 'MP：246 t/h', 'LP：92 t/h', '缺少实时趋势'] },
  { id: 'cooling_water', type: 'system', icon: 'cooling_tower', title: '冷却水系统', zone: '公用工程区', status: '运行中', metric: '3600 万吨/年', systems: ['cooling_water'], downstream: ['hydrocracking', 'hppo', 'eo_eg'], details: ['循环水：18,000,000 t/a', '冷却水：36,000,000 t/a', '换热设备挂接完成'] },
  { id: 'fuel_gas', type: 'system', icon: 'fuel_gas', title: '燃料气系统', zone: '公用工程区', status: '运行中', metric: '1.2 亿 Nm3', systems: ['fuel_gas'], downstream: ['boiler', 'cdu'], details: ['燃料气：120,000,000 Nm3', '供锅炉与加热炉', '数据可信度：中高'] },
  { id: 'hydrogen', type: 'system', icon: 'hydrogen', title: '氢气系统', zone: '公用工程区', status: '运行中', metric: 'H2 管网', systems: ['hydrogen'], downstream: ['hydrocracking', 'hppo'], details: ['氢气管网已挂接', '主要用户：加氢裂化、HPPO'] },
  { id: 'substation', type: 'system', icon: 'substation', title: '电力系统', zone: '公用工程区', status: '运行中', metric: '6.8 亿 kWh', systems: ['electricity'], downstream: ['reforming', 'pdh', 'polyether'], details: ['电力：680,000,000 kWh', '全厂变配电', '数据可信度：高'] },
  { id: 'letdown_station', type: 'system', icon: 'letdown_station', title: '减温减压站', zone: '蒸汽系统', status: '高价值损失', metric: '118 t/h', systems: ['steam'], bottleneck: true, details: ['HP→MP 减温减压量：118 t/h', '理论价值上限：5360 万元/年', '工程可回收价值：4860 万元/年'] },
  { id: 'turbine_generator', type: 'system', icon: 'turbine_generator', title: '背压汽轮机组', zone: '方案A新增', status: '新增方案', metric: '回收 HP 压差', systems: ['steam'], solutionOnly: true, modification: true, details: ['新增背压汽轮机组', '替代 HP→MP 减温减压', '预计年净收益：3630 万元'] },
];

interface MaterialNode {
  id: string;
  title: string;
  metric: string;
}

const materialNodes: MaterialNode[] = [
  { id: 'product_oil', title: '油品外送', metric: '汽油/柴油/航煤' },
  { id: 'propylene', title: '丙烯', metric: '520,000 t/a' },
  { id: 'po', title: 'PO', metric: '300,000 t/a' },
  { id: 'polyether_product', title: '聚醚产品', metric: '240,000 t/a' },
  { id: 'eo_eg_product', title: 'EO/EG 产品', metric: '200,000 t/a' },
];

interface IndustrialEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  label?: string;
  points: [number, number][];
  labelAt?: [number, number];
  systems?: string[];
  valueChains?: string[];
  bottleneckPath?: boolean;
  solutionOnly?: boolean;
  details?: string[];
}

// 注：原型保留了一套大坐标系 streams 数据但组件实际渲染 plantStreams，此处同样保留（组件内未使用，导出以保留数据）
export const streams: IndustrialEdge[] = [
  { id: 's-crude-cdu', from: 'crude_tank', to: 'cdu', type: 'material', label: '原油 625 t/h', points: [[172, 220], [220, 220]], details: ['介质：原油', '流量：625 t/h', '来源：原油罐区', '去向：常减压装置'] },
  { id: 's-cdu-fcc', from: 'cdu', to: 'fcc', type: 'material', label: '中间馏分', points: [[380, 220], [430, 220], [430, 150], [440, 150]], details: ['介质：中间馏分', '来源：常减压装置', '去向：催化裂化装置'] },
  { id: 's-cdu-hydro', from: 'cdu', to: 'hydrocracking', type: 'material', label: '柴油馏分', points: [[380, 220], [430, 220], [430, 290], [440, 290]], details: ['介质：柴油馏分', '来源：常减压装置', '去向：加氢裂化装置'] },
  { id: 's-fcc-reform', from: 'fcc', to: 'reforming', type: 'material', label: '石脑油', points: [[600, 150], [640, 150]], details: ['介质：石脑油', '去向：连续重整装置'] },
  { id: 's-hydro-gasoline', from: 'hydrocracking', to: 'gasoline_hydrogenation', type: 'material', label: '精制物流', points: [[600, 290], [640, 290]], details: ['介质：精制物流', '去向：加氢精制装置'] },
  { id: 's-fcc-gas', from: 'fcc', to: 'gas_separation', type: 'material', label: '液化气', points: [[560, 210], [560, 430], [640, 430]], details: ['介质：液化气', '去向：气体分离装置'] },
  { id: 's-propane-pdh', from: 'propane_tank', to: 'pdh', type: 'material', label: '丙烷', points: [[172, 420], [880, 420], [880, 360]], valueChains: ['polyether', 'po'], details: ['介质：丙烷', '来源：丙烷罐区', '去向：PDH 装置'] },
  { id: 's-pdh-hppo', from: 'pdh', to: 'hppo', type: 'product', label: '丙烯', points: [[1040, 360], [1080, 360]], valueChains: ['polyether', 'po'], details: ['介质：丙烯', '流量：65 t/h', '来源：PDH 装置', '去向：HPPO 装置'] },
  { id: 's-hppo-polyether', from: 'hppo', to: 'polyether', type: 'product', label: 'PO', points: [[1240, 360], [1280, 360]], valueChains: ['polyether'], details: ['介质：PO', '去向：聚醚装置'] },
  { id: 's-polyether-product', from: 'polyether', to: 'polyether_product', type: 'product', label: '聚醚', points: [[1440, 360], [1500, 360]], valueChains: ['polyether'], details: ['产品：聚醚', '外送：240,000 t/a'] },
  { id: 's-eoeg-product', from: 'eo_eg', to: 'eo_eg_product', type: 'product', label: 'EO/EG', points: [[1240, 500], [1360, 500]], valueChains: ['eo_eg'], details: ['产品：EO/EG', '外送：200,000 t/a'] },
  { id: 'e-boiler-steam', from: 'boiler', to: 'steam_header', type: 'steam_hp', label: 'HP 蒸汽', points: [[320, 710], [420, 710]], systems: ['steam'], details: ['介质：HP 蒸汽', '流量：182 t/h', '来源：锅炉房'] },
  { id: 'e-steam-cdu', from: 'steam_header', to: 'cdu', type: 'steam_hp', label: 'HP 蒸汽', points: [[500, 650], [500, 610], [300, 610], [300, 278]], systems: ['steam'], bottleneckPath: true, details: ['介质：HP 蒸汽', '用户：常减压装置', '存在减温减压损失'] },
  { id: 'e-steam-pdh', from: 'steam_header', to: 'pdh', type: 'steam_mp', label: 'MP 蒸汽', points: [[560, 710], [960, 710], [960, 418]], systems: ['steam'], valueChains: ['polyether', 'po'], details: ['介质：MP 蒸汽', '用户：PDH 装置'] },
  { id: 'e-steam-hppo', from: 'steam_header', to: 'hppo', type: 'steam_mp', label: 'MP 蒸汽', points: [[560, 710], [1160, 710], [1160, 418]], systems: ['steam'], valueChains: ['polyether', 'po'], details: ['介质：MP 蒸汽', '用户：HPPO 装置'] },
  { id: 'e-cooling-hppo', from: 'cooling_water', to: 'hppo', type: 'cooling_water', label: '冷却水', points: [[760, 650], [760, 600], [1160, 600], [1160, 418]], systems: ['cooling_water'], valueChains: ['polyether', 'po'], details: ['介质：冷却水', '用户：HPPO 装置'] },
  { id: 'e-fuel-boiler', from: 'fuel_gas', to: 'boiler', type: 'fuel_gas', label: '燃料气', points: [[1020, 710], [1020, 760], [240, 760], [240, 768]], systems: ['fuel_gas'], details: ['介质：燃料气', '用户：锅炉房'] },
  { id: 'e-hydrogen-hydro', from: 'hydrogen', to: 'hydrocracking', type: 'hydrogen', label: '氢气', points: [[1220, 650], [1220, 580], [520, 580], [520, 348]], systems: ['hydrogen'], details: ['介质：氢气', '用户：加氢裂化装置'] },
  { id: 'e-power-polyether', from: 'substation', to: 'polyether', type: 'electricity', label: '电力', points: [[1420, 650], [1420, 580], [1360, 580], [1360, 418]], systems: ['electricity'], valueChains: ['polyether'], details: ['介质：电力', '用户：聚醚装置'] },
  { id: 'solution-steam-turbine', from: 'steam_header', to: 'turbine_generator', type: 'product', label: '新增回收路径', points: [[560, 690], [660, 640], [660, 800], [500, 800]], solutionOnly: true, details: ['方案A新增管线', '回收 HP→MP 压差', '绿色表示新增改造内容'] },
];

const plantStreams: IndustrialEdge[] = [
  { id: 's-crude-cdu', from: 'crude_tank', to: 'cdu', type: 'material', label: '原油 625 t/h', points: [[160, 215], [176, 215], [176, 300], [180, 300]], details: ['介质：原油', '流量：625 t/h', '来源：原油罐区', '去向：常减压装置'] },
  { id: 's-cdu-fcc', from: 'cdu', to: 'fcc', type: 'material', label: '中间馏分', points: [[310, 300], [330, 300], [330, 165], [320, 165]], details: ['介质：中间馏分', '来源：常减压装置', '去向：催化裂化装置'] },
  { id: 's-cdu-hydro', from: 'cdu', to: 'hydrocracking', type: 'material', label: '柴油馏分', points: [[310, 300], [320, 300]], details: ['介质：柴油馏分', '来源：常减压装置', '去向：加氢裂化装置'] },
  { id: 's-cdu-sulfur', from: 'cdu', to: 'sulfur_recovery', type: 'material', label: '含硫物流', points: [[310, 320], [330, 320], [330, 445], [320, 445]], details: ['介质：含硫物流', '去向：硫磺回收装置', '状态：环保约束相关'] },
  { id: 's-fcc-reform', from: 'fcc', to: 'reforming', type: 'material', label: '石脑油', points: [[450, 165], [460, 165]], details: ['介质：石脑油', '去向：连续重整装置'] },
  { id: 's-hydro-gasoline', from: 'hydrocracking', to: 'gasoline_hydrogenation', type: 'material', label: '精制物流', points: [[450, 305], [460, 305]], details: ['介质：精制物流', '去向：加氢精制装置'] },
  { id: 's-fcc-gas', from: 'fcc', to: 'gas_separation', type: 'material', label: '液化气', points: [[385, 230], [385, 525], [460, 525], [460, 445]], details: ['介质：液化气', '去向：气体分离装置'] },
  { id: 's-gas-propylene', from: 'gas_separation', to: 'propylene', type: 'product', label: '丙烯产品', points: [[575, 445], [610, 445], [610, 265], [660, 265]], details: ['产品：丙烯', '去向：产品/化工链'] },
  { id: 's-product-oil', from: 'reforming', to: 'product_oil', type: 'product', label: '油品/芳烃', points: [[575, 165], [620, 165], [620, 135], [660, 135]], details: ['产品：汽油/柴油/芳烃', '去向：产品外送区'] },
  { id: 's-propane-pdh', from: 'propane_tank', to: 'pdh', type: 'material', label: '丙烷', points: [[160, 430], [600, 430], [600, 365], [595, 365]], valueChains: ['polyether', 'po'], details: ['介质：丙烷', '来源：丙烷罐区', '去向：PDH 装置'] },
  { id: 's-pdh-hppo', from: 'pdh', to: 'hppo', type: 'product', label: '丙烯', points: [[720, 365], [730, 365]], valueChains: ['polyether', 'po'], details: ['介质：丙烯', '来源：PDH 装置', '去向：HPPO 装置'] },
  { id: 's-hppo-polyether', from: 'hppo', to: 'polyether', type: 'product', label: 'PO', points: [[855, 365], [865, 365]], valueChains: ['polyether'], details: ['介质：PO', '去向：聚醚装置'] },
  { id: 's-hppo-po', from: 'hppo', to: 'po', type: 'product', label: 'PO 产品', points: [[790, 315], [790, 265]], valueChains: ['po'], details: ['产品：PO', '外送：300,000 t/a'] },
  { id: 's-polyether-product', from: 'polyether', to: 'polyether_product', type: 'product', label: '聚醚', points: [[995, 365], [970, 365]], valueChains: ['polyether'], details: ['产品：聚醚', '外送：240,000 t/a'] },
  { id: 's-eoeg-product', from: 'eo_eg', to: 'eo_eg_product', type: 'product', label: 'EO/EG', points: [[855, 510], [885, 510]], valueChains: ['eo_eg'], details: ['产品：EO/EG', '外送：200,000 t/a'] },
  { id: 'e-boiler-steam', from: 'boiler', to: 'steam_header', type: 'steam_hp', label: 'HP 蒸汽', points: [[275, 760], [295, 760]], systems: ['steam'], details: ['介质：HP 蒸汽', '流量：182 t/h', '来源：锅炉系统'] },
  { id: 'e-steam-cdu', from: 'steam_header', to: 'cdu', type: 'steam_hp', label: 'HP 蒸汽', points: [[360, 695], [360, 610], [245, 610], [245, 365]], systems: ['steam'], bottleneckPath: true, details: ['介质：HP 蒸汽', '用户：常减压装置', '存在减温减压损失'] },
  { id: 'e-steam-pdh', from: 'steam_header', to: 'pdh', type: 'steam_mp', label: 'MP 蒸汽', points: [[405, 735], [660, 735], [660, 430]], systems: ['steam'], valueChains: ['polyether', 'po'], details: ['介质：MP 蒸汽', '用户：PDH 装置'] },
  { id: 'e-steam-hppo', from: 'steam_header', to: 'hppo', type: 'steam_mp', label: 'MP 蒸汽', points: [[405, 745], [790, 745], [790, 430]], systems: ['steam'], valueChains: ['polyether', 'po'], details: ['介质：MP 蒸汽', '用户：HPPO 装置'] },
  { id: 'e-cooling-hppo', from: 'cooling_water', to: 'hppo', type: 'cooling_water', label: '冷却水', points: [[510, 695], [510, 610], [790, 610], [790, 430]], systems: ['cooling_water'], valueChains: ['polyether', 'po'], details: ['介质：冷却水', '用户：HPPO 装置'] },
  { id: 'e-cooling-eoeg', from: 'cooling_water', to: 'eo_eg', type: 'cooling_water', label: '冷却水', points: [[545, 720], [760, 720], [760, 510]], systems: ['cooling_water'], valueChains: ['eo_eg'], details: ['介质：冷却水', '用户：EO/EG 装置'] },
  { id: 'e-fuel-boiler', from: 'fuel_gas', to: 'boiler', type: 'fuel_gas', label: '燃料气', points: [[595, 760], [595, 800], [280, 800], [280, 760]], systems: ['fuel_gas'], details: ['介质：燃料气', '用户：锅炉系统'] },
  { id: 'e-fuel-cdu', from: 'fuel_gas', to: 'cdu', type: 'fuel_gas', label: '燃料气', points: [[660, 695], [660, 635], [300, 635], [300, 365]], systems: ['fuel_gas'], details: ['介质：燃料气', '用户：常减压加热炉'] },
  { id: 'e-hydrogen-hydro', from: 'hydrogen', to: 'hydrocracking', type: 'hydrogen', label: '氢气', points: [[810, 695], [810, 590], [385, 590], [385, 370]], systems: ['hydrogen'], details: ['介质：氢气', '用户：加氢裂化装置'] },
  { id: 'e-hydrogen-hppo', from: 'hydrogen', to: 'hppo', type: 'hydrogen', label: '氢气', points: [[810, 695], [810, 430]], systems: ['hydrogen'], valueChains: ['polyether', 'po'], details: ['介质：氢气', '用户：HPPO 装置'] },
  { id: 'e-power-polyether', from: 'substation', to: 'polyether', type: 'electricity', label: '电力', points: [[960, 695], [960, 430]], systems: ['electricity'], valueChains: ['polyether'], details: ['介质：电力', '用户：聚醚装置'] },
  { id: 'solution-steam-turbine', from: 'steam_header', to: 'turbine_generator', type: 'product', label: '新增回收路径', points: [[405, 780], [470, 780], [470, 800]], solutionOnly: true, details: ['方案A新增管线', '回收 HP→MP 压差', '绿色表示新增改造内容'] },
];

// 注：原型中 viewLabels 定义后未被使用，此处保留并导出
export const viewLabels: Record<string, string> = {
  system_overview: '系统概况',
  bottleneck_location: '瓶颈定位',
  solution_a: '方案A',
  solution_b: '方案B',
  solution_c: '方案C',
};

const modeLabels: Record<string, string> = {
  plant_overview: '全厂概况',
  system_view: '系统图',
  value_chain_view: '产业链视图',
};

const systemLabels: Record<string, string> = {
  all: '全部',
  steam: '蒸汽',
  cooling_water: '冷却水',
  fuel_gas: '燃料气',
  hydrogen: '氢气',
  electricity: '电力',
};

const chainLabels: Record<string, string> = {
  none: '无',
  polyether: '聚醚',
  po: 'PO',
  eo_eg: 'EO/EG',
  polypropylene: '聚丙烯',
  polyethylene: '聚乙烯',
};

export interface TopologyInteractiveItem {
  id: string;
  kind?: string;
  title?: string;
  label?: string;
  type?: string;
  status?: string;
  metric?: string;
  icon?: string;
  value?: string;
  confidence?: string;
  location?: string;
  severity?: string;
  tone?: string;
  summary?: string;
  x?: number;
  y?: number;
  details?: string[];
  relatedIds?: string[];
  relatedObjectIds?: string[];
  locationObjectIds?: string[];
  upstream?: string[];
  downstream?: string[];
  from?: string | [number, number];
  to?: string | [number, number];
}

interface RelevantItem {
  id: string;
  from?: string;
  to?: string;
  type?: string;
  systems?: string[];
  valueChains?: string[];
  solutionOnly?: boolean;
  modification?: boolean;
  bottleneck?: boolean;
  bottleneckPath?: boolean;
}

interface CanvasState {
  mainView: string;
  mode: string;
  selectedSystem: string;
  selectedValueChain: string;
  selection: TopologyInteractiveItem | null;
  guideFocusIds: string[];
}

function buildPath(points: [number, number][]): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

function midpoint(points: [number, number][]): { x: number; y: number } {
  if (!points?.length) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0]![0], y: points[0]![1] };
  const segments = points.slice(1).map((point, index) => {
    const prev = points[index]!;
    return {
      from: prev,
      to: point,
      length: Math.abs(point[0] - prev[0]) + Math.abs(point[1] - prev[1]),
    };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  let walked = 0;
  const target = total / 2;
  for (const segment of segments) {
    if (walked + segment.length >= target) {
      const ratio = segment.length ? (target - walked) / segment.length : 0;
      return {
        x: segment.from[0] + (segment.to[0] - segment.from[0]) * ratio,
        y: segment.from[1] + (segment.to[1] - segment.from[1]) * ratio,
      };
    }
    walked += segment.length;
  }
  const last = points[points.length - 1]!;
  return { x: last[0], y: last[1] };
}

function getRelatedIds(selection: TopologyInteractiveItem | null): Set<string> {
  if (selection?.kind === 'insight') return new Set([selection.id, ...(selection.relatedObjectIds || []), ...(selection.locationObjectIds || [])]);
  if (selection?.kind === 'bottleneck') return new Set([selection.id, ...(selection.relatedIds || [])]);
  if (!selection || selection.kind !== 'node') return new Set();
  const node = units.find((item) => item.id === selection.id);
  if (!node) return new Set();
  return new Set([node.id, ...(node.upstream || []), ...(node.downstream || [])]);
}

function matchesRelated(relatedIds: Set<string>, item: RelevantItem): boolean {
  return relatedIds.has(item.id)
    || (item.from !== undefined && relatedIds.has(item.from))
    || (item.to !== undefined && relatedIds.has(item.to));
}

function isVisibleInView(item: { solutionOnly?: boolean }, mainView: string): boolean {
  if (item.solutionOnly) return mainView === 'solution_a' || mainView === 'solution_b' || mainView === 'solution_c';
  return true;
}

function isRelevant(item: RelevantItem, { mainView, mode, selectedSystem, selectedValueChain, selection, guideFocusIds = [] }: CanvasState): boolean {
  if (!isVisibleInView(item, mainView)) return false;
  if (selection?.kind === 'insight') {
    const relatedIds = getRelatedIds(selection);
    return matchesRelated(relatedIds, item);
  }
  if (selection?.kind === 'bottleneck') {
    const relatedIds = getRelatedIds(selection);
    return matchesRelated(relatedIds, item);
  }
  if (guideFocusIds.length) {
    const guideIds = new Set(guideFocusIds);
    return matchesRelated(guideIds, item);
  }
  if (mainView === 'bottleneck_location') return Boolean(item.bottleneck || item.bottleneckPath || matchesRelated(bottleneckRelatedIds, item));
  if (mainView === 'system_overview' && mode === 'plant_overview') return matchesRelated(insightRelatedIds, item) || true;
  if (mainView.startsWith('solution')) return Boolean(item.modification || item.solutionOnly || item.bottleneck || item.bottleneckPath || item.id === 'steam_header' || item.id === 'cdu');
  if (mode === 'system_view' && selectedSystem !== 'all') return Boolean(item.systems?.includes(selectedSystem) || item.type === `steam_${selectedSystem}`);
  if (mode === 'value_chain_view' && selectedValueChain !== 'none') return Boolean(item.valueChains?.includes(selectedValueChain) || item.id.includes(selectedValueChain));
  if (selection) {
    if (selection.kind === 'node') {
      const relatedIds = getRelatedIds(selection);
      return matchesRelated(relatedIds, item);
    }
    if (selection.kind === 'edge') return item.id === selection.id || item.id === selection.from || item.id === selection.to;
  }
  return true;
}

export interface TopologyToolbarProps {
  mainView: string;
  setMainView: (value: string) => void;
  mode: string;
  setMode: (value: string) => void;
  selectedSystem: string;
  setSelectedSystem: (value: string) => void;
  selectedValueChain: string;
  setSelectedValueChain: (value: string) => void;
  showPrimaryTabs?: boolean;
}

export function TopologyToolbar({
  mainView,
  setMainView,
  mode,
  setMode,
  selectedSystem,
  setSelectedSystem,
  selectedValueChain,
  setSelectedValueChain,
  showPrimaryTabs = false,
}: TopologyToolbarProps) {
  return (
    <div className="industrial-toolbar">
      {showPrimaryTabs ? (
        <div className="toolbar-row main-tabs">
          {([
            ['system_overview', '系统概况'],
            ['bottleneck_location', '瓶颈定位'],
          ] as [string, string][]).map(([value, label]) => (
            <button
              type="button"
              className={mainView === value ? 'active' : ''}
              key={value}
              onClick={() => {
                setMainView(value);
                if (value === 'system_overview') setMode('system_view');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {mainView === 'system_overview' ? (
        <div className="toolbar-row">
          <span>视图</span>
          {Object.entries(modeLabels).map(([value, label]) => (
            <button
              type="button"
              className={mode === value ? 'active' : ''}
              key={value}
              onClick={() => {
                setMode(value);
                if (value === 'system_view' && selectedSystem === 'all') setSelectedSystem('steam');
                if (value === 'value_chain_view' && selectedValueChain === 'none') setSelectedValueChain('polyether');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {mainView === 'system_overview' && mode === 'system_view' ? (
        <div className="toolbar-row">
          <span>系统筛选</span>
          {Object.entries(systemLabels).filter(([value]) => value !== 'all').map(([value, label]) => (
            <button type="button" className={selectedSystem === value ? 'active' : ''} key={value} onClick={() => setSelectedSystem(value)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {mainView === 'system_overview' && mode === 'value_chain_view' ? (
        <div className="toolbar-row">
          <span>产品链</span>
          {Object.entries(chainLabels).filter(([value]) => value !== 'none').map(([value, label]) => (
            <button type="button" className={selectedValueChain === value ? 'active' : ''} key={value} onClick={() => setSelectedValueChain(value)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type HoverHandler = (item: TopologyInteractiveItem, event: ReactMouseEvent<SVGGElement>) => void;
type LeaveHandler = () => void;
type SelectHandler = (item: TopologyInteractiveItem, event: ReactMouseEvent<SVGGElement>) => void;

export function IndustrialUnitNode({ node, state, onHover, onLeave, onSelect }: {
  node: IndustrialUnit;
  state: CanvasState;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  const related = isRelevant(node, state);
  const position = unitPositions[node.id];
  if (!position || !isVisibleInView(node, state.mainView)) return null;
  return (
    <g
      className={`industrial-node ${node.type} ${related ? 'related' : 'dimmed'} ${state.selection?.id === node.id ? 'selected' : ''} ${node.bottleneck ? 'bottleneck-node' : ''} ${node.modification ? 'modification-node' : ''}`}
      transform={`translate(${position.x} ${position.y})`}
      onMouseEnter={(event) => onHover(node, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ ...node, kind: 'node' }, event);
      }}
    >
      <g className="node-icon" transform="translate(-46 -46)">
        <IndustrialIcon type={node.icon} />
      </g>
      <circle className="status-dot" cx="70" cy="-40" r="5" />
      <text className="node-title" x="0" y="56">{node.title}</text>
      <text className="node-metric" x="0" y="75">{node.metric}</text>
    </g>
  );
}

export function IndustrialSystemNode(props: {
  node: IndustrialUnit;
  state: CanvasState;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  return <IndustrialUnitNode {...props} />;
}

export function IndustrialMaterialNode({ node, state, onHover, onLeave, onSelect }: {
  node: MaterialNode;
  state: CanvasState;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  const position = unitPositions[node.id];
  if (!position) return null;
  const related = isRelevant(node, state);
  return (
    <g
      className={`material-node ${related ? 'related' : 'dimmed'} ${state.selection?.id === node.id ? 'selected' : ''}`}
      transform={`translate(${position.x} ${position.y})`}
      onMouseEnter={(event) => onHover(node, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ ...node, kind: 'node' }, event);
      }}
    >
      <rect x="-58" y="-24" width="116" height="48" rx="12" />
      <text className="node-title" x="0" y="-2">{node.title}</text>
      <text className="node-metric" x="0" y="16">{node.metric}</text>
    </g>
  );
}

export function IndustrialStreamEdge({ edge, state, onHover, onLeave, onSelect }: {
  edge: IndustrialEdge;
  state: CanvasState;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  if (!isVisibleInView(edge, state.mainView)) return null;
  const related = isRelevant(edge, state);
  const markerId = `arrow-${edge.type}`;
  const mid = midpoint(edge.points);
  const labelPoint = edge.labelAt ? { x: edge.labelAt[0], y: edge.labelAt[1] } : { x: mid.x + 8, y: mid.y - 8 };
  return (
    <g
      className={`industrial-edge ${related ? 'related' : 'dimmed'} ${state.selection?.id === edge.id ? 'selected' : ''} ${edge.solutionOnly ? 'solution-edge' : ''}`}
      onMouseEnter={(event) => onHover(edge, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ ...edge, kind: 'edge' }, event);
      }}
    >
      <path className="edge-hit" d={buildPath(edge.points)} />
      <path className="edge-line" d={buildPath(edge.points)} style={{ stroke: streamColors[edge.type] || streamColors.material }} markerEnd={`url(#${markerId})`} />
      <text className="edge-label" x={labelPoint.x} y={labelPoint.y}>{edge.label}</text>
    </g>
  );
}

export function BottleneckMarker({ point, state, onHover, onLeave, onSelect }: {
  point: BottleneckPoint;
  state: CanvasState;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  if (state.mainView !== 'bottleneck_location') return null;
  const selected = state.selection?.id === point.id;
  const dimmed = state.selection?.kind === 'bottleneck' && !selected && !(point.relatedIds || []).includes(state.selection.id);
  return (
    <g
      className={`bottleneck-marker ${point.severity || 'pending'} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      transform={`translate(${point.x} ${point.y})`}
      onMouseEnter={(event) => onHover(point, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(point, event);
      }}
    >
      <circle className="marker-halo" r="22" />
      <circle className="marker-ring" r="13" />
      <circle className="marker-core" r="6" />
      <path className="marker-cross" d="M-7 0H7M0 -7V7" />
      <text className="marker-label" x="18" y="-16">{point.value}</text>
    </g>
  );
}

export function AIInsightMarker({ insight, state, onHover, onLeave, onSelect }: {
  insight: AIInsight;
  state: CanvasState;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  if (state.mainView !== 'system_overview' || state.mode !== 'plant_overview') return null;
  const selected = state.selection?.id === insight.id;
  const dimmed = state.selection?.kind === 'insight' && !selected;
  return (
    <g
      className={`ai-insight-marker ${insight.tone} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      transform={`translate(${insight.x} ${insight.y})`}
      onMouseEnter={(event) => onHover(insight, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(insight, event);
      }}
    >
      <circle className="insight-pulse" r="24" />
      <circle className="insight-core" r="13" />
      <text className="insight-ai" x="0" y="4">AI</text>
      <g className="insight-label" transform="translate(20 -30)">
        <rect x="0" y="0" width="188" height="46" rx="12" />
        <text x="12" y="18">AI 关注点</text>
        <text x="12" y="34">{insight.title}</text>
      </g>
    </g>
  );
}

interface TooltipState {
  item: TopologyInteractiveItem;
  x: number;
  y: number;
}

export function TopologyTooltip({ tooltip, actionLabel, onAction, onEnter, onLeave }: {
  tooltip: TooltipState | null;
  actionLabel?: string | null;
  onAction?: (item: TopologyInteractiveItem) => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  if (!tooltip) return null;
  const showDataAction = Boolean(actionLabel && onAction);
  return (
    <div className="topology-tooltip" style={{ left: tooltip.x, top: tooltip.y }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <strong>{tooltip.item.title || tooltip.item.label}</strong>
      {(tooltip.item.details || []).slice(0, 4).map((line) => <span key={line}>{line}</span>)}
      {showDataAction ? (
        <button type="button" className="tooltip-action" onClick={() => onAction?.(tooltip.item)}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function TopologyActionMenu({ menu, onClose }: {
  menu: { x: number; y: number } | null;
  onClose: () => void;
}) {
  if (!menu) return null;
  return (
    <div className="topology-action-menu" style={{ left: menu.x, top: menu.y }}>
      {['查看详情', '添加改造点', '标记不可改造', '查看方案影响', '取消'].map((item) => (
        <button type="button" key={item} onClick={onClose}>{item}</button>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <g className="industrial-legend" transform="translate(60 628)">
      <text className="legend-title" x="0" y="0">图例</text>
      {([
        ['material', '原料/中间物料'],
        ['product', '产品'],
        ['steam_hp', '高压蒸汽'],
        ['steam_mp', '中压蒸汽'],
        ['cooling_water', '冷却水'],
        ['fuel_gas', '燃料气'],
        ['hydrogen', '氢气'],
        ['electricity', '电力'],
      ] as [string, string][]).map(([type, label], index) => (
        <g key={type} transform={`translate(0 ${24 + index * 22})`}>
          <line x1="0" y1="0" x2="28" y2="0" stroke={streamColors[type]} strokeWidth="3" />
          <text x="38" y="4">{label}</text>
        </g>
      ))}
    </g>
  );
}

function UnitPfdIcon({ type }: { type?: string }) {
  if (type === 'exchanger') {
    return (
      <g className="unit-pfd-icon exchanger-icon">
        <rect x="-42" y="-18" width="84" height="36" rx="18" />
        <rect x="-34" y="-34" width="68" height="28" rx="14" />
        <rect x="-34" y="6" width="68" height="28" rx="14" />
        <path d="M-48 0H-42M42 0H48M-22 -18L-6 18M-4 -18L12 18M14 -18L30 18" />
        <path className="unit-pfd-accent" d="M-24 -20C-14 -29 14 -29 24 -20M-24 20C-14 29 14 29 24 20" />
      </g>
    );
  }

  if (type === 'furnace') {
    return (
      <g className="unit-pfd-icon furnace-icon">
        <path d="M-34 34V-28C-34 -38 -26 -46 -16 -46H16C26 -46 34 -38 34 -28V34Z" />
        <path d="M-24 -28H24M-24 -12H24M-24 4H24" />
        <path d="M-18 26C-20 12 -8 8 -8 -2C0 6 10 10 6 26Z" className="flame-main" />
        <path d="M4 26C2 17 12 14 12 7C18 14 22 18 18 26Z" className="flame-side" />
        <path d="M-40 34H40M-28 42H28" />
      </g>
    );
  }

  if (type === 'tower') {
    return (
      <g className="unit-pfd-icon tower-icon">
        <path d="M-16 -58C-16 -68 16 -68 16 -58V54C16 64 -16 64 -16 54Z" />
        <path d="M-16 -48C-8 -42 8 -42 16 -48M-16 -24H16M-16 0H16M-16 24H16M-16 48C-8 54 8 54 16 48" />
        <path d="M-34 -44H-16M16 -18H36M-34 16H-16M16 42H36" />
        <circle cx="0" cy="-36" r="3" />
        <circle cx="0" cy="12" r="3" />
      </g>
    );
  }

  return (
    <g className="unit-pfd-icon letdown-icon">
      <path d="M-50 0H-20M20 0H50" />
      <path d="M-20 -18L20 18M20 -18L-20 18Z" />
      <rect x="-10" y="-44" width="20" height="24" rx="6" />
      <path d="M0 -20V-2M-34 -30H34M-34 -30V-12M34 -30V-12" />
      <circle className="bottleneck-ring" cx="0" cy="0" r="36" />
      <path className="bottleneck-mark" d="M0 -22V2M0 14V18" />
    </g>
  );
}

function UnitPfdEdge({ edge, onHover, onLeave, onSelect }: {
  edge: UnitPfdEdgeItem;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  const markerId = `unit-arrow-${edge.impact ? 'impact' : edge.type}`;
  const color = edge.impact ? '#EF4444' : streamColors[edge.type] || streamColors.material;
  return (
    <g
      className={`unit-pfd-edge ${edge.type} ${edge.impact ? 'impact' : ''} ${edge.recovery ? 'recovery' : ''}`}
      onMouseEnter={(event) => onHover({ ...edge, kind: 'unit-edge' }, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ ...edge, kind: 'edge' }, event);
      }}
    >
      <path className="edge-hit" d={buildPath(edge.points)} />
      <path className="edge-line" d={buildPath(edge.points)} style={{ stroke: color }} markerEnd={`url(#${markerId})`} />
      <text x={edge.labelAt[0]} y={edge.labelAt[1]}>{edge.label}</text>
    </g>
  );
}

function UnitPfdNode({ item, onHover, onLeave, onSelect }: {
  item: UnitPfdEquipmentItem;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
}) {
  const isBottleneck = item.status === '瓶颈';
  return (
    <g
      className={`unit-pfd-node ${item.type} ${isBottleneck ? 'bottleneck' : ''}`}
      transform={`translate(${item.x} ${item.y})`}
      onMouseEnter={(event) => onHover({ ...item, kind: 'equipment' }, event)}
      onMouseLeave={onLeave}
      onClick={(event) => {
        event.stopPropagation();
        onSelect({ ...item, kind: 'equipment' }, event);
      }}
    >
      <ellipse className="unit-device-halo" cx="0" cy="8" rx="74" ry="54" />
      {isBottleneck ? <rect className="unit-bottleneck-frame" x="-76" y="-72" width="152" height="132" rx="20" /> : null}
      <UnitPfdIcon type={item.type} />
      <circle className="unit-status-dot" cx="62" cy="-54" r="5" />
      <text className="unit-node-title" x="0" y="82">{item.title}</text>
      <text className="unit-node-metric" x="0" y="102">{item.metric}</text>
      {isBottleneck ? <text className="unit-node-badge" x="0" y="-78">瓶颈</text> : null}
    </g>
  );
}

function UnitDrilldownPfdView({ unit, onHover, onLeave, onSelect, onClose }: {
  unit: TopologyInteractiveItem | null;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
  onClose: () => void;
}) {
  const title = unit?.title || unit?.label || '常减压装置';
  const arrowTypes = ['material', 'product', 'steam_hp', 'steam_mp', 'fuel_gas', 'impact'];
  return (
    <svg className="industrial-svg drilldown-svg unit-pfd-svg" viewBox="0 0 1000 600" onClick={(event) => event.stopPropagation()} aria-label="装置级流程下钻">
      <defs>
        {arrowTypes.map((type) => {
          const color = type === 'impact' ? '#EF4444' : streamColors[type] || streamColors.material;
          return (
            <marker key={type} id={`unit-arrow-${type}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10Z" fill={color} />
            </marker>
          );
        })}
      </defs>
      <rect className="drilldown-bg unit-workspace-bg" x="24" y="64" width="952" height="500" rx="22" />
      <rect className="unit-flow-band primary" x="48" y="176" width="890" height="160" rx="20" />
      <rect className="unit-flow-band utility" x="48" y="360" width="890" height="132" rx="20" />
      <text className="drilldown-title" x="44" y="42">装置级流程 / {title}</text>
      <text className="drilldown-subtitle" x="44" y="82">围绕“HP→MP 减温减压量过大”展示关键设备、蒸汽路径与可回收能流。</text>
      <text className="svg-link" x="858" y="42" onClick={onClose}>返回上一级</text>
      <text className="unit-zone-label" x="62" y="164">工艺主流程</text>
      <text className="unit-zone-label" x="62" y="350">蒸汽 / 回收路径</text>
      <g className="unit-pfd-streams">
        {unitPfdPipelines.map((edge) => (
          <UnitPfdEdge key={edge.id} edge={edge} onHover={onHover} onLeave={onLeave} onSelect={onSelect} />
        ))}
      </g>
      <g className="unit-pfd-nodes">
        {unitPfdEquipment.map((item) => (
          <UnitPfdNode key={item.id} item={item} onHover={onHover} onLeave={onLeave} onSelect={onSelect} />
        ))}
      </g>
      <g className="unit-pfd-callout" transform="translate(690 118)">
        <rect x="0" y="0" width="232" height="58" rx="16" />
        <text x="18" y="24">核心瓶颈：HP→MP 减温减压</text>
        <text x="18" y="44">118 t/h · 可回收 4,860 万元/年</text>
      </g>
    </svg>
  );
}

// 原型定义后未渲染（实际使用 UnitDrilldownPfdView），保留导出
export function UnitDrilldownView({ unit, onHover, onLeave, onSelect, onClose }: {
  unit: TopologyInteractiveItem | null;
  onHover: HoverHandler;
  onLeave: LeaveHandler;
  onSelect: SelectHandler;
  onClose: () => void;
}) {
  const title = unit?.title || unit?.label || '常减压装置';
  return (
    <svg className="industrial-svg drilldown-svg" viewBox="0 0 1000 600" onClick={(event) => event.stopPropagation()} aria-label="装置级流程下钻">
      <rect className="drilldown-bg" x="24" y="64" width="952" height="500" rx="24" />
      <text className="drilldown-title" x="44" y="42">装置级流程 / {title}</text>
      <text className="drilldown-subtitle" x="44" y="82">鼠标移入设备或管线查看摘要，点击悬浮框底部“查看设备详情”进入设备级。</text>
      <text className="svg-link" x="860" y="42" onClick={onClose}>返回全厂概况</text>
      <g className="unit-drilldown-streams">
        {unitPipelines.map((edge) => (
          <g
            key={edge.id}
            className={`unit-drilldown-edge ${edge.type}`}
            onMouseEnter={(event) => onHover({ ...edge, kind: 'unit-edge' }, event)}
            onMouseLeave={onLeave}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ ...edge, kind: 'edge' }, event);
            }}
          >
            <path className="edge-hit" d={`M${edge.from[0]} ${edge.from[1]} L${edge.to[0]} ${edge.to[1]}`} />
            <path className="edge-line" d={`M${edge.from[0]} ${edge.from[1]} L${edge.to[0]} ${edge.to[1]}`} style={{ stroke: streamColors[edge.type] || streamColors.material }} />
            <text x={(edge.from[0] + edge.to[0]) / 2} y={(edge.from[1] + edge.to[1]) / 2 - 10}>{edge.label}</text>
          </g>
        ))}
      </g>
      {unitEquipment.map((item) => (
        <g
          key={item.id}
          className={`drilldown-equipment ${item.status === '瓶颈' ? 'risk' : ''}`}
          transform={`translate(${item.x} ${item.y})`}
          onMouseEnter={(event) => onHover({ ...item, kind: 'equipment' }, event)}
          onMouseLeave={onLeave}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ ...item, kind: 'equipment' }, event);
          }}
        >
          <rect x="-64" y="-56" width="128" height="112" rx="16" />
          <g transform="translate(-34 -42) scale(0.74)">
            <IndustrialIcon type={item.icon} />
          </g>
          <text className="node-title" x="0" y="34">{item.title}</text>
          <text className="node-metric" x="0" y="52">{item.metric}</text>
        </g>
      ))}
    </svg>
  );
}

function EquipmentPfdDetailView({ equipment, onClose }: {
  equipment?: TopologyInteractiveItem | null;
  onClose: () => void;
}) {
  const item = equipment || unitPfdEquipment[0]!;
  const isBottleneck = item.status === '瓶颈';
  const facts: [string, string | undefined][] = [
    ['设备状态', item.status],
    ['关键指标', item.metric],
    ['数据置信度', isBottleneck ? '高' : '中高'],
    ['证据来源', 'PFD / PID / DCS 趋势'],
    ['AI 判断', item.details?.[2] || '运行状态可复核'],
  ];
  return (
    <svg className="industrial-svg drilldown-svg equipment-pfd-svg" viewBox="0 0 1000 600" onClick={(event) => event.stopPropagation()} aria-label="设备级详情下钻">
      <defs>
        <marker id="equipment-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" fill="#2563EB" />
        </marker>
        <marker id="equipment-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" fill="#EF4444" />
        </marker>
        <marker id="equipment-arrow-orange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" fill="#F97316" />
        </marker>
      </defs>
      <rect className="drilldown-bg equipment-workspace-bg" x="24" y="64" width="952" height="500" rx="22" />
      <text className="drilldown-title" x="44" y="42">设备级详情 / {item.title}</text>
      <text className="drilldown-subtitle" x="44" y="82">展示设备本体、关键接口、仪表点与当前诊断证据；关闭后返回装置级流程。</text>
      <text className="svg-link" x="858" y="42" onClick={onClose}>返回上一级</text>

      <g className="equipment-process-panel" transform="translate(62 118)">
        <rect x="0" y="0" width="575" height="390" rx="24" />
        <text className="equipment-panel-label" x="24" y="34">设备工程视图</text>
        <path className="equipment-pipe material" d="M48 190H210" markerEnd="url(#equipment-arrow-blue)" />
        <path className="equipment-pipe steam" d="M292 320V238" markerEnd="url(#equipment-arrow-red)" />
        <path className="equipment-pipe recovery" d="M390 252H510V320H230" markerEnd="url(#equipment-arrow-orange)" />
        <text className="equipment-pipe-label" x="114" y="174">入口物流</text>
        <text className="equipment-pipe-label" x="336" y="302">蒸汽 / 能流</text>
        <text className="equipment-pipe-label" x="406" y="240">回收/影响路径</text>
        <g className={`equipment-main-object ${isBottleneck ? 'bottleneck' : ''}`} transform="translate(292 190) scale(1.62)">
          <UnitPfdIcon type={item.type} />
        </g>
        <g className="equipment-instrument" transform="translate(150 88)">
          <circle r="16" />
          <text x="0" y="5">TI</text>
        </g>
        <g className="equipment-instrument" transform="translate(446 106)">
          <circle r="16" />
          <text x="0" y="5">PI</text>
        </g>
        <g className="equipment-instrument" transform="translate(482 270)">
          <circle r="16" />
          <text x="0" y="5">FI</text>
        </g>
        <g className="equipment-metric-tag primary" transform="translate(58 252)">
          <rect x="0" y="0" width="150" height="54" rx="14" />
          <text x="16" y="23">{item.metric}</text>
          <text x="16" y="42">当前关键指标</text>
        </g>
        <g className={`equipment-metric-tag ${isBottleneck ? 'risk' : 'normal'}`} transform="translate(366 52)">
          <rect x="0" y="0" width="160" height="58" rx="14" />
          <text x="16" y="24">{isBottleneck ? '瓶颈对象' : '可复核对象'}</text>
          <text x="16" y="44">{isBottleneck ? '压差能未回收' : '证据链完整'}</text>
        </g>
      </g>

      <g className="equipment-detail-facts equipment-pfd-facts" transform="translate(678 118)">
        <rect className="facts-shell" x="0" y="0" width="256" height="390" rx="22" />
        <text className="equipment-panel-label" x="22" y="34">诊断事实</text>
        {facts.map(([label, value], index) => (
          <g key={label} transform={`translate(20 ${58 + index * 62})`}>
            <rect x="0" y="0" width="216" height="46" rx="13" />
            <text className="fact-label" x="14" y="19">{label}</text>
            <text className="fact-value" x="14" y="37">{value}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// 原型定义后未渲染（实际使用 EquipmentPfdDetailView），保留导出
export function EquipmentDetailView({ equipment, onClose }: {
  equipment?: UnitPfdEquipmentItem | null;
  onClose: () => void;
}) {
  const item = equipment || unitPfdEquipment[0]!;
  return (
    <svg className="industrial-svg drilldown-svg" viewBox="0 0 1000 600" onClick={(event) => event.stopPropagation()} aria-label="设备级详情下钻">
      <rect className="drilldown-bg" x="24" y="64" width="952" height="500" rx="24" />
      <text className="drilldown-title" x="44" y="42">设备级详情 / {item.title}</text>
      <text className="drilldown-subtitle" x="44" y="82">关闭后返回装置级流程，继续查看其它设备或管线。</text>
      <text className="svg-link" x="850" y="42" onClick={onClose}>返回装置级流程</text>
      <g className="equipment-detail-diagram" transform="translate(112 132)">
        <rect x="0" y="0" width="330" height="330" rx="24" />
        <g transform="translate(112 70) scale(1.55)">
          <IndustrialIcon type={item.icon} />
        </g>
        <text x="165" y="246">{item.title}</text>
        <text x="165" y="276">{item.metric}</text>
      </g>
      <g className="equipment-detail-facts" transform="translate(500 130)">
        {([
          ['设备状态', item.status],
          ['关键指标', item.metric],
          ['数据置信度', item.status === '瓶颈' ? '高' : '中高'],
          ['证据来源', 'PFD / PID / DCS 趋势'],
          ['AI 判断', item.details?.[2] || '运行状态可复核'],
        ] as [string, string][]).map(([label, value], index) => (
          <g key={label} transform={`translate(0 ${index * 72})`}>
            <rect x="0" y="0" width="390" height="54" rx="14" />
            <text className="fact-label" x="18" y="22">{label}</text>
            <text className="fact-value" x="18" y="42">{value}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

interface SelectionBoxState {
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DraftBottleneckState {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface DrilldownState {
  level: 'plant' | 'unit' | 'equipment';
  unit: TopologyInteractiveItem | null;
  equipment: TopologyInteractiveItem | null;
}

export interface IndustrialTopologyCanvasProps {
  onSelectionChange?: (item: TopologyInteractiveItem | null) => void;
  initialMainView?: string;
  initialMode?: string;
  initialSystem?: string;
  showPrimaryTabs?: boolean;
  showAddBottleneckControl?: boolean;
  guideFocusIds?: string[];
}

export function IndustrialTopologyCanvas({
  onSelectionChange,
  initialMainView = 'system_overview',
  initialMode = 'plant_overview',
  initialSystem = 'all',
  showPrimaryTabs = false,
  showAddBottleneckControl = false,
  guideFocusIds = [],
}: IndustrialTopologyCanvasProps) {
  const [mainView, setMainView] = useState(initialMainView);
  const [mode, setMode] = useState(initialMode);
  const [selectedSystem, setSelectedSystem] = useState('all');
  const [selectedValueChain, setSelectedValueChain] = useState('none');
  const [selection, setSelection] = useState<TopologyInteractiveItem | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [draftBottleneck, setDraftBottleneck] = useState<DraftBottleneckState | null>(null);
  const [userBottlenecks, setUserBottlenecks] = useState<BottleneckPoint[]>([]);
  const [drilldown, setDrilldown] = useState<DrilldownState>({ level: 'plant', unit: null, equipment: null });
  const tooltipTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setMainView(initialMainView);
    setMode(initialMode);
    setSelectedSystem(initialSystem);
    setSelection(null);
    setMenu(null);
    setSelectionBox(null);
    setDraftBottleneck(null);
    setDrilldown({ level: 'plant', unit: null, equipment: null });
  }, [initialMainView, initialMode, initialSystem]);

  const state = useMemo<CanvasState>(() => ({
    mainView,
    mode,
    selectedSystem,
    selectedValueChain,
    selection,
    guideFocusIds,
  }), [mainView, mode, selectedSystem, selectedValueChain, selection, guideFocusIds]);

  function handleSelect(item: TopologyInteractiveItem, _event?: ReactMouseEvent<SVGGElement>) {
    setSelection(item);
    onSelectionChange?.(item);
    setMenu(null);
    // 通知右侧对话栏记录拓扑图操作
    window.dispatchEvent(new CustomEvent('redesign-topology-select', {
      detail: { item },
    }));
  }

  function handleHover(item: TopologyInteractiveItem, event: ReactMouseEvent<SVGGElement>) {
    window.clearTimeout(tooltipTimerRef.current);
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setTooltip({ item, x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12 });
  }

  function scheduleTooltipClose() {
    window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => setTooltip(null), 220);
  }

  function keepTooltipOpen() {
    window.clearTimeout(tooltipTimerRef.current);
  }

  function openUnitDrilldown(item: TopologyInteractiveItem) {
    setDrilldown({ level: 'unit', unit: item, equipment: null });
    setSelection(item);
    setTooltip(null);
  }

  function emitInteraction(title: string, body: string[]) {
    window.dispatchEvent(new CustomEvent('redesign-ai-interaction', {
      detail: { title, body },
    }));
  }

  function expandInsight(item: TopologyInteractiveItem) {
    setSelection(item);
    setTooltip(null);
    if (item.id === 'insight_hp_mp') {
      setMode('system_view');
      setSelectedSystem('steam');
      emitInteraction('已展开 AI 关注点', ['已切换到蒸汽系统图，并高亮常减压装置、蒸汽管网与 HP→MP 减温减压路径。', '建议下一步进入瓶颈诊断，验证 118 t/h 减温减压流量和可回收价值。']);
    } else if (item.id === 'insight_pdh_hppo') {
      setMode('value_chain_view');
      setSelectedValueChain('polyether');
      emitInteraction('已展开 AI 关注点', ['已切换到聚醚产业链视图，并高亮 PDH、HPPO、聚醚装置与 MP 蒸汽依赖路径。', '建议查看蒸汽波动对高价值产品链收益的影响。']);
    } else {
      setMode('system_view');
      setSelectedSystem('steam');
      emitInteraction('已加入待验证关注点', ['凝结水回收路径已标记为待验证项。', '建议生成待补数据清单，补齐疏水点、凝结水流量和回收边界。']);
    }
    onSelectionChange?.(item);
  }

  function openEquipmentDrilldown(item: TopologyInteractiveItem) {
    setDrilldown((current) => ({ ...current, level: 'equipment', equipment: item }));
    setSelection(item);
    setTooltip(null);
  }

  function closeDrilldown() {
    setDrilldown((current) => {
      if (current.level === 'equipment') return { ...current, level: 'unit', equipment: null };
      return { level: 'plant', unit: null, equipment: null };
    });
    setTooltip(null);
  }

  function clearSelection() {
    setSelection(null);
    setMenu(null);
    setDraftBottleneck(null);
    setSelectionBox(null);
    onSelectionChange?.(null);
  }

  function getSvgPoint(svg: SVGSVGElement, event: ReactMouseEvent<SVGSVGElement>): { x: number; y: number } {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  function canBoxSelect(event: ReactMouseEvent<SVGSVGElement>): boolean {
    const startsOnObject = (event.target as Element).closest?.('.industrial-node, .industrial-edge, .material-node, .bottleneck-marker');
    return event.button === 0
      && (mainView.startsWith('solution') || (showAddBottleneckControl && mainView === 'bottleneck_location' && !startsOnObject));
  }

  function handleCanvasPointerDown(event: ReactMouseEvent<SVGSVGElement>) {
    if (!canBoxSelect(event)) return;
    const cursor = getSvgPoint(event.currentTarget, event);
    setDraftBottleneck(null);
    setSelectionBox({
      startX: cursor.x,
      startY: cursor.y,
      x: cursor.x,
      y: cursor.y,
      width: 0,
      height: 0,
    });
  }

  function handleCanvasPointerMove(event: ReactMouseEvent<SVGSVGElement>) {
    if (!selectionBox) return;
    const cursor = getSvgPoint(event.currentTarget, event);
    setSelectionBox({
      ...selectionBox,
      x: Math.min(selectionBox.startX, cursor.x),
      y: Math.min(selectionBox.startY, cursor.y),
      width: Math.abs(cursor.x - selectionBox.startX),
      height: Math.abs(cursor.y - selectionBox.startY),
    });
  }

  function handleCanvasPointerUp(event: ReactMouseEvent<SVGSVGElement>) {
    if (!selectionBox) return;
    event.stopPropagation();
    if (selectionBox.width < 18 || selectionBox.height < 18) {
      setSelectionBox(null);
      return;
    }
    setDraftBottleneck({
      x: selectionBox.x,
      y: selectionBox.y,
      width: selectionBox.width,
      height: selectionBox.height,
      centerX: Math.round(selectionBox.x + selectionBox.width / 2),
      centerY: Math.round(selectionBox.y + selectionBox.height / 2),
    });
  }

  function addBottleneckFromDraft() {
    if (!draftBottleneck) return;
    const newBottleneck: BottleneckPoint = {
      id: `bn_user_${Date.now()}`,
      kind: 'bottleneck',
      title: '用户补充瓶颈点',
      severity: 'pending',
      value: '待 AI 评估',
      confidence: '待验证',
      location: '用户在系统图上框选标记',
      x: draftBottleneck.centerX,
      y: draftBottleneck.centerY,
      relatedIds: [],
      details: ['来源：用户框选区域', '状态：待 AI 结合图纸与运行数据复核', '下一步：补充瓶颈原因、影响范围和可回收价值'],
    };
    setUserBottlenecks((items) => [...items, newBottleneck]);
    setSelection(newBottleneck);
    setDraftBottleneck(null);
    setSelectionBox(null);
    setMenu(null);
    onSelectionChange?.(newBottleneck);
  }

  function addContextFromDraft() {
    if (!draftBottleneck) return;
    const contextItem: TopologyInteractiveItem = {
      id: `bn_context_${Date.now()}`,
      kind: 'bottleneck',
      title: '用户补充信息',
      value: '待 AI 解析',
      confidence: '待验证',
      location: '用户框选区域',
      details: ['请在右侧对话栏补充该区域的异常现象、运行约束或经验判断。'],
    };
    setSelection(contextItem);
    setDraftBottleneck(null);
    setSelectionBox(null);
    onSelectionChange?.(contextItem);
  }

  function addSolutionRegionFromDraft(type: 'blocked' | 'required' | 'info') {
    if (!draftBottleneck) return;
    const labels: Record<'blocked' | 'required' | 'info', [string, string, string]> = {
      blocked: ['此处不可改造', '施工约束', 'AI 将在方案复核中避开该区域，并重新评估替代路径。'],
      required: ['此处需要改造', '用户指定', 'AI 将把该区域纳入改造边界，补充工程量、停工窗口与收益影响。'],
      info: ['用户补充信息', '待 AI 解析', '请在右侧对话栏补充该区域的施工条件、设备状态或运行约束。'],
    };
    const [title, value, detail] = labels[type] || labels.info;
    const solutionItem: TopologyInteractiveItem = {
      id: `solution_region_${Date.now()}`,
      kind: 'solution_note',
      title,
      value,
      confidence: '待方案复核',
      location: '用户框选方案区域',
      details: ['来源：用户框选区域', detail],
    };
    setSelection(solutionItem);
    setDraftBottleneck(null);
    setSelectionBox(null);
    setMenu(null);
    onSelectionChange?.(solutionItem);
  }

  // 原型此函数在 clearSelection() 后还有一段引用 addBottleneckMode 的不可达代码（该状态在原型中亦未定义），转换时移除
  function handleCanvasClick() {
    if (selectionBox || draftBottleneck) return;
    clearSelection();
  }

  return (
    <div className="industrial-topology-canvas">
      <TopologyToolbar
        mainView={mainView}
        setMainView={(value) => {
          setMainView(value);
          setSelection(null);
          setMenu(null);
          if (value === 'bottleneck_location') setSelectedSystem('steam');
        }}
        mode={mode}
        setMode={setMode}
        selectedSystem={selectedSystem}
        setSelectedSystem={setSelectedSystem}
        selectedValueChain={selectedValueChain}
        setSelectedValueChain={setSelectedValueChain}
        showPrimaryTabs={showPrimaryTabs}
      />
      {drilldown.level === 'unit' ? (
        <>
          <UnitDrilldownPfdView
            unit={drilldown.unit}
            onHover={handleHover}
            onLeave={scheduleTooltipClose}
            onSelect={handleSelect}
            onClose={closeDrilldown}
          />
          <TopologyTooltip
            tooltip={tooltip}
            actionLabel={tooltip?.item?.kind === 'equipment' ? '查看设备详情 →' : null}
            onAction={openEquipmentDrilldown}
            onEnter={keepTooltipOpen}
            onLeave={scheduleTooltipClose}
          />
        </>
      ) : drilldown.level === 'equipment' ? (
        <EquipmentPfdDetailView equipment={drilldown.equipment} onClose={closeDrilldown} />
      ) : (
        <>
      <svg
        className="industrial-svg"
        viewBox="0 0 1100 900"
        preserveAspectRatio="xMidYMin meet"
        onMouseDown={handleCanvasPointerDown}
        onMouseMove={handleCanvasPointerMove}
        onMouseUp={handleCanvasPointerUp}
        onMouseLeave={handleCanvasPointerUp}
        onClick={handleCanvasClick}
        aria-label="AI for Redesign 全厂系统流程图"
      >
        <defs>
          {Object.entries(streamColors).map(([type, color]) => (
            <marker id={`arrow-${type}`} key={type} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={color} />
            </marker>
          ))}
        </defs>
        <rect className="zone-card feed-zone" x="28" y="92" width="136" height="442" rx="22" />
        <rect className="zone-card refining-zone" x="176" y="66" width="398" height="508" rx="22" />
        <rect className="zone-card chemical-zone" x="590" y="232" width="486" height="356" rx="22" />
        <rect className="zone-card product-zone" x="590" y="66" width="486" height="142" rx="22" />
        <rect className="zone-card utility-zone" x="150" y="658" width="900" height="192" rx="22" />
        <rect className="zone-card legend-zone" x="28" y="592" width="108" height="258" rx="18" />
        <text className="zone-label" x="54" y="172">原料与储运区</text>
        <text className="zone-label" x="260" y="104">炼油主装置区</text>
        <text className="zone-label" x="930" y="284">化工深加工区</text>
        <text className="zone-label" x="930" y="104">产品与外送区</text>
        <text className="zone-label" x="182" y="658">公用工程区</text>
        <text className="zone-label-new" x="48" y="126">原料与储运区</text>
        <text className="zone-label-new" x="206" y="100">炼油主装置区</text>
        <text className="zone-label-new" x="620" y="266">化工深加工区</text>
        <text className="zone-label-new" x="620" y="100">产品 / 外送区</text>
        <text className="zone-label-new" x="182" y="692">公用工程区</text>
        <Legend />
        {mainView === 'bottleneck_location' ? (
          <g className="bottleneck-overlay">
            <path d="M360 695 L360 610 L245 610 L245 365" />
            <circle cx="360" cy="615" r="8" />
            <circle cx="245" cy="365" r="8" />
          </g>
        ) : null}
        {mainView.startsWith('solution') ? (
          <g className="solution-overlay">
            <path className="solution-route" d="M360 695 L360 615 L470 615 L470 835" />
            <g className="solution-benefit" transform="translate(505 640)">
              <rect x="-70" y="-20" width="140" height="40" rx="12" />
              <text x="0" y="5">年净收益 3,630 万</text>
            </g>
            <g className="solution-risk-tag" transform="translate(300 615)">
              <rect x="-76" y="-18" width="152" height="36" rx="11" />
              <text x="0" y="5">替代部分减温减压</text>
            </g>
            <g className="solution-risk-tag warning" transform="translate(580 835)">
              <rect x="-86" y="-18" width="172" height="36" rx="11" />
              <text x="0" y="5">大修期切换 8 小时</text>
            </g>
          </g>
        ) : null}
        {aiInsights.map((insight) => (
          <AIInsightMarker key={insight.id} insight={insight} state={state} onHover={handleHover} onLeave={scheduleTooltipClose} onSelect={handleSelect} />
        ))}
        {plantStreams.map((edge) => (
          <IndustrialStreamEdge key={edge.id} edge={edge} state={state} onHover={handleHover} onLeave={scheduleTooltipClose} onSelect={handleSelect} />
        ))}
        {materialNodes.map((node) => (
          <IndustrialMaterialNode key={node.id} node={node} state={state} onHover={handleHover} onLeave={scheduleTooltipClose} onSelect={handleSelect} />
        ))}
        {units.map((node) => node.type === 'system' ? (
          <IndustrialSystemNode key={node.id} node={node} state={state} onHover={handleHover} onLeave={scheduleTooltipClose} onSelect={handleSelect} />
        ) : (
          <IndustrialUnitNode key={node.id} node={node} state={state} onHover={handleHover} onLeave={scheduleTooltipClose} onSelect={handleSelect} />
        ))}
        {[...bottleneckPoints, ...userBottlenecks].map((point) => (
          <BottleneckMarker key={point.id} point={point} state={state} onHover={handleHover} onLeave={scheduleTooltipClose} onSelect={handleSelect} />
        ))}
        {selectionBox ? (
          <rect
            className="bottleneck-selection-box"
            x={selectionBox.x}
            y={selectionBox.y}
            width={selectionBox.width}
            height={selectionBox.height}
            rx="10"
          />
        ) : null}
      </svg>
      {draftBottleneck ? (
        <div
          className="bottleneck-selection-prompt"
          style={{
            left: `${Math.min((draftBottleneck.x + draftBottleneck.width + 18) / 1100 * 100, 76)}%`,
            top: `${Math.min((draftBottleneck.y + 12) / 900 * 100, 72)}%`,
          }}
        >
          <strong>{mainView.startsWith('solution') ? '已框选方案区域' : '已框选该区域'}</strong>
          <span>
            {mainView.startsWith('solution')
              ? '这里是不可改造、需要改造，还是要补充工程信息？'
              : '需要我将这里作为瓶颈点，还是先补充判断信息？'}
          </span>
          {mainView.startsWith('solution') ? (
            <div className="solution-selection-actions">
              <button type="button" onClick={() => addSolutionRegionFromDraft('blocked')}>此处不可改造</button>
              <button type="button" onClick={() => addSolutionRegionFromDraft('required')}>此处需要改造</button>
              <button type="button" onClick={() => addSolutionRegionFromDraft('info')}>补充信息</button>
            </div>
          ) : (
            <div>
              <button type="button" onClick={addBottleneckFromDraft}>添加瓶颈点</button>
              <button type="button" onClick={addContextFromDraft}>补充信息</button>
            </div>
          )}
        </div>
      ) : null}
      <TopologyTooltip
        tooltip={tooltip}
        actionLabel={tooltip?.item?.kind === 'insight' ? '展开分析 →' : tooltip?.item?.type === 'unit' || tooltip?.item?.type === 'system' ? '查看完整数据 →' : null}
        onAction={(item) => (item.kind === 'insight' ? expandInsight(item) : openUnitDrilldown(item))}
        onEnter={keepTooltipOpen}
        onLeave={scheduleTooltipClose}
      />
        </>
      )}
    </div>
  );
}
