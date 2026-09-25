const streamLegend: [string, string][] = [
  ['main', '主流程'],
  ['methanolMakeup', '甲醇补充'],
  ['methanolRecycle', '甲醇循环'],
  ['waterWaste', '水相/污水'],
  ['byproduct', '副产物'],
  ['purge', '放空'],
];

const equipmentLegend: [string, string][] = [
  ['tower', '塔器'],
  ['reactor', '反应器'],
  ['vessel', '罐/水洗器'],
  ['tag', '进出口'],
];

export interface LegendPanelProps {
  hidePurge?: boolean;
  hidePurgeLegend?: boolean;
}

export function LegendPanel({ hidePurge = false, hidePurgeLegend }: LegendPanelProps) {
  // hidePurgeLegend 单独控制图例是否隐藏放空；未传时回退到 hidePurge
  const hideLegend = hidePurgeLegend === undefined ? hidePurge : hidePurgeLegend;
  const visibleStreamLegend = streamLegend.filter(([type]) => !(hideLegend && type === 'purge'));

  return (
    <g className="device-pfd-legend">
      <rect x="16" y="32" width="116" height="490" rx="10" />
      <text className="legend-title" x="34" y="60">图例</text>
      <text className="legend-subtitle" x="34" y="86">物流类型</text>
      {visibleStreamLegend.map(([type, label], index) => {
        const y = 110 + index * 28;
        return (
          <g key={type} className={`legend-stream stream-${type}`}>
            <line x1="34" x2="66" y1={y} y2={y} />
            <text x="74" y={y + 4}>{label}</text>
          </g>
        );
      })}
      <text className="legend-subtitle" x="34" y="302">设备类型</text>
      {equipmentLegend.map(([type, label], index) => {
        const y = 326 + index * 34;
        return (
          <g key={type} className={`legend-equipment legend-${type}`}>
            <rect x="34" y={y - 12} width="28" height="20" rx="5" />
            <text x="74" y={y + 3}>{label}</text>
          </g>
        );
      })}
    </g>
  );
}
