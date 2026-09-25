import type { CSSProperties } from 'react';

export interface SvgEquipmentNodeData {
  id: string;
  type: string;
  code?: string;
  name?: string;
  subtitle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  feedbackStatus?: string;
  schemeChange?: string;
  diagnosisStatus?: string;
}

export interface EquipmentSelectItem {
  kind: 'equipment';
  id: string;
}

function labelColor(type: string): string {
  if (type === 'product') return 'product';
  if (type === 'byproduct') return 'byproduct';
  if (type === 'wastewater') return 'water';
  if (type === 'purge') return 'purge';
  return 'default';
}

function EquipmentShape({ node }: { node: SvgEquipmentNodeData }) {
  const { type, width, height } = node;
  if (['feed', 'product', 'byproduct', 'wastewater', 'purge'].includes(type)) {
    return (
      <>
        <rect className={`tag-box tag-${labelColor(type)}`} x="0" y="0" width={width} height={height} rx="7" />
        <path className={`tag-arrow tag-${labelColor(type)}`} d={`M ${width - 22} ${height / 2 - 7} L ${width - 8} ${height / 2} L ${width - 22} ${height / 2 + 7}`} />
      </>
    );
  }

  if (type === 'tower') {
    return (
      <>
        <ellipse className="equipment-cap" cx={width / 2} cy="6" rx={width / 2 - 10} ry="6" />
        <rect className="equipment-shell tower-shell" x="10" y="6" width={width - 20} height={height - 18} rx="10" />
        <ellipse className="equipment-cap" cx={width / 2} cy={height - 12} rx={width / 2 - 10} ry="6" />
        {[0.24, 0.38, 0.52, 0.66, 0.8].map((ratio) => (
          <line key={ratio} className="tower-tray" x1="15" x2={width - 15} y1={height * ratio} y2={height * ratio} />
        ))}
        <rect className="tower-top" x={width / 2 - 10} y="-7" width="20" height="6" rx="2" />
      </>
    );
  }

  if (type === 'reactor') {
    return (
      <>
        <rect className="equipment-shell reactor-shell" x="8" y="4" width={width - 16} height={height - 8} rx="18" />
        <path className="catalyst-pattern" d={`M 18 24 H ${width - 18} M 18 38 H ${width - 18} M 18 52 H ${width - 18} M 18 66 H ${width - 18}`} />
        <circle className="reactor-port" cx={width / 2} cy="13" r="4" />
        <circle className="reactor-port" cx={width / 2} cy={height - 13} r="4" />
      </>
    );
  }

  return (
    <>
      <ellipse className="equipment-cap" cx={width / 2} cy="8" rx={width / 2 - 8} ry="7" />
      <rect className="equipment-shell vessel-shell" x="8" y="8" width={width - 16} height={height - 18} rx="12" />
      <ellipse className="equipment-cap" cx={width / 2} cy={height - 10} rx={width / 2 - 8} ry="7" />
      <path className="mixer-impeller" d={`M ${width / 2} 14 V ${height - 16} M ${width / 2 - 13} ${height / 2} H ${width / 2 + 13}`} />
    </>
  );
}

function isTagNode(node: SvgEquipmentNodeData): boolean {
  return ['feed', 'product', 'byproduct', 'wastewater', 'purge'].includes(node.type);
}

function TagNodeLabel({ node }: { node: SvgEquipmentNodeData }) {
  const labelWidth = node.width - 24;
  const textX = labelWidth / 2 + 4;
  const hasSecondary = Boolean(node.name && node.name !== node.code);

  return (
    <>
      <text className="tag-code-text" x={textX} y={hasSecondary ? node.height / 2 - 2 : node.height / 2 + 4}>
        {node.code}
      </text>
      {hasSecondary ? (
        <text className="tag-name-text" x={textX} y={node.height / 2 + 11}>
          {node.name}
        </text>
      ) : null}
    </>
  );
}

export interface SvgEquipmentNodeProps {
  node: SvgEquipmentNodeData;
  selected?: boolean;
  onSelect?: (item: EquipmentSelectItem) => void;
  onHover?: (item: EquipmentSelectItem) => void;
  onLeave?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function SvgEquipmentNode({ node, selected, onSelect, onHover, onLeave, className = '', style }: SvgEquipmentNodeProps) {
  const tagNode = isTagNode(node);

  return (
    <g
      className={`device-pfd-node node-${node.type} status-${node.feedbackStatus || 'normal'} scheme-${node.schemeChange || 'none'} ${node.schemeChange === 'added' ? 'scheme-added' : ''} ${node.schemeChange === 'changed' ? 'scheme-changed' : ''} ${node.schemeChange === 'cancelled' ? 'scheme-cancelled' : ''} ${node.diagnosisStatus ? `diagnosis-${node.diagnosisStatus}` : ''} ${selected ? 'selected' : ''} ${className}`.trim()}
      style={style}
      transform={`translate(${node.x} ${node.y})`}
      onClick={() => onSelect?.({ kind: 'equipment', id: node.id })}
      onMouseEnter={() => onHover?.({ kind: 'equipment', id: node.id })}
      onMouseLeave={onLeave}
      role="button"
      tabIndex={0}
    >
      <EquipmentShape node={node} />
      {tagNode ? (
        <TagNodeLabel node={node} />
      ) : (
        <>
          <text className="equipment-code" x={node.width / 2} y={node.height + 18}>{node.code}</text>
          <text className="equipment-name" x={node.width / 2} y={node.height + 33}>{node.name}</text>
          {node.subtitle ? <text className="equipment-subtitle" x={node.width / 2} y={node.height + 47}>{node.subtitle}</text> : null}
        </>
      )}
    </g>
  );
}
