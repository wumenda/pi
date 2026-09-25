import type { TopologyPoint } from './processTopologyLayout';

export interface StreamLabelEdge {
  label?: string;
  type: string;
  points: TopologyPoint[];
}

export function StreamLabel({ edge }: { edge: StreamLabelEdge }) {
  if (!edge.label || edge.points.length < 2) return null;
  const midIndex = Math.floor((edge.points.length - 1) / 2);
  const a = edge.points[midIndex]!;
  const b = edge.points[midIndex + 1] || a;
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2 - 8;
  const width = Math.max(42, edge.label.length * 11 + 12);
  return (
    <g className={`device-pfd-stream-label label-${edge.type}`}>
      <rect x={x - width / 2} y={y - 13} width={width} height="20" rx="5" />
      <text x={x} y={y + 1}>{edge.label}</text>
    </g>
  );
}
