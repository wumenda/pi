import type { ProcessZone } from './processTopologyLayout';

export function ZonePanel({ zone }: { zone: ProcessZone }) {
  return (
    <g className="device-pfd-zone">
      <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} rx="10" />
      <circle cx={zone.x + 18} cy={zone.y + 19} r="10" />
      <text className="zone-index" x={zone.x + 18} y={zone.y + 23}>{zone.index}</text>
      <text className="zone-title" x={zone.x + 34} y={zone.y + 23}>{zone.title}</text>
    </g>
  );
}
