import type { CSSProperties } from 'react';
import { StreamLabel } from './StreamLabel';
import type { TopologyPoint } from './processTopologyLayout';

export interface OrthogonalStreamEdgeData {
  id: string;
  type: string;
  label?: string;
  points: TopologyPoint[];
  dashed?: boolean;
  arrow?: boolean;
  schemeChange?: string;
  diagnosisStatus?: string;
}

export interface StreamSelectItem {
  kind: 'stream';
  id: string;
}

function pathFromPoints(points: TopologyPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export interface OrthogonalStreamEdgeProps {
  edge: OrthogonalStreamEdgeData;
  selected?: boolean;
  onSelect?: (item: StreamSelectItem) => void;
  onHover?: (item: StreamSelectItem) => void;
  onLeave?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function OrthogonalStreamEdge({ edge, selected, onSelect, onHover, onLeave, className = '', style }: OrthogonalStreamEdgeProps) {
  const path = pathFromPoints(edge.points);
  return (
    <g
      className={`device-pfd-stream stream-${edge.type} ${edge.dashed ? 'is-dashed' : ''} ${edge.schemeChange === 'added' ? 'scheme-added' : ''} ${edge.diagnosisStatus ? `diagnosis-${edge.diagnosisStatus}` : ''} ${selected ? 'selected' : ''} ${className}`.trim()}
      style={style}
      onClick={() => onSelect?.({ kind: 'stream', id: edge.id })}
      onMouseEnter={() => onHover?.({ kind: 'stream', id: edge.id })}
      onMouseLeave={onLeave}
      role="button"
      tabIndex={0}
    >
      <path className="stream-hit" d={path} />
      <path className="stream-line" d={path} markerEnd={edge.arrow ? `url(#device-pfd-arrow-${edge.type})` : undefined} />
      <StreamLabel edge={edge} />
    </g>
  );
}
