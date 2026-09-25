import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface OverlayPoint {
  x: number;
  y: number;
}

export interface OverlayViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayConnection {
  id: string;
  connectionType: string;
  displayName: string;
  anchorPoints: OverlayPoint[];
  issueIds: string[];
}

export interface OverlayStream {
  id: string;
  streamNo: string;
  name: string;
  points: OverlayPoint[];
  issueIds: string[];
}

export interface OverlayEquipment {
  id: string;
  tag?: string;
  name: string;
  bbox: { x: number; y: number; width: number; height: number };
  issueIds: string[];
}

export interface OverlayPage {
  id: string;
  viewBox: OverlayViewBox;
  connections: OverlayConnection[];
  streams: OverlayStream[];
  equipment: OverlayEquipment[];
}

export interface OverlayIssue {
  id: string;
  severity: string;
  position: OverlayPoint;
  title: string;
}

export type OverlayIssueStates = Record<string, { resolved?: boolean; status?: string; value?: string; unit?: string } | undefined>;

export interface OverlaySelectedRef {
  type: string;
  id: string;
  issueId?: string | null;
}

function pathFromPoints(points: OverlayPoint[]): string {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

function midpoint(points: OverlayPoint[]): OverlayPoint {
  if (!points.length) return { x: 0, y: 0 };
  const index = Math.floor((points.length - 1) / 2);
  const a = points[index]!;
  const b = points[Math.min(points.length - 1, index + 1)]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

interface IssueStatusSummary {
  hasError: boolean;
  hasWarning: boolean;
  confirmed: boolean;
}

function issueStatus(issueIds: string[], issues: OverlayIssue[], issueStates: OverlayIssueStates): IssueStatusSummary {
  const boundIssues = issues.filter((issue) => issueIds.includes(issue.id));
  return {
    hasError: boundIssues.some(
      (issue) => issue.severity === 'blocking' && !issueStates[issue.id]?.resolved,
    ),
    hasWarning: boundIssues.some((issue) => issue.severity === 'warning'),
    confirmed: boundIssues.some(
      (issue) => issue.severity === 'blocking' && issueStates[issue.id]?.resolved,
    ),
  };
}

function objectClassName(type: string, id: string, issueIds: string[], selectedRef: OverlaySelectedRef | null, issues: OverlayIssue[], issueStates: OverlayIssueStates): string {
  const selected = selectedRef?.type === type && selectedRef?.id === id;
  const dimmed = Boolean(selectedRef && !selected);
  const status = issueStatus(issueIds, issues, issueStates);
  return [
    'parsed-overlay-object',
    `is-${type}`,
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
    status.hasError ? 'has-error' : '',
    status.hasWarning ? 'has-warning' : '',
    status.confirmed ? 'is-confirmed' : '',
  ].filter(Boolean).join(' ');
}

interface InteractiveProps {
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
  onClick?: (event: ReactMouseEvent<SVGGElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<SVGGElement>) => void;
}

function interactiveProps(interactive: boolean, label: string, onActivate: () => void): InteractiveProps {
  if (!interactive) return { 'aria-hidden': true };
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: (event) => {
      event.stopPropagation();
      onActivate();
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    },
  };
}

export interface ParsedOverlayLayerProps {
  page: OverlayPage;
  issues: OverlayIssue[];
  issueStates: OverlayIssueStates;
  selectedRef: OverlaySelectedRef | null;
  interactive?: boolean;
  onSelectObject?: (type: string, id: string) => void;
  onSelectIssue?: (issueId: string) => void;
  onClearSelection?: () => void;
}

export function ParsedOverlayLayer({
  page,
  issues,
  issueStates,
  selectedRef,
  interactive = true,
  onSelectObject,
  onSelectIssue,
  onClearSelection,
}: ParsedOverlayLayerProps) {
  const { x, y, width, height } = page.viewBox;
  const arrowId = `pfd-arrow-${page.id}-${interactive ? 'full' : 'preview'}`;

  return (
    <svg
      className={`parsed-overlay-layer ${interactive ? 'is-interactive' : 'is-preview'}`}
      viewBox={`${x} ${y} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label={`${page.id} 算法解析覆盖层`}
      onClick={interactive ? onClearSelection : undefined}
    >
      <defs>
        <marker
          id={arrowId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>

      <g className="parsed-connection-layer">
        {page.connections.map((connection) => {
          const marker = midpoint(connection.anchorPoints);
          const className = objectClassName(
            'connection',
            connection.id,
            connection.issueIds,
            selectedRef,
            issues,
            issueStates,
          );
          return (
            <g
              key={connection.id}
              data-overlay-object="connection"
              className={`${className} is-${connection.connectionType}`}
              {...interactiveProps(
                interactive,
                `连接 ${connection.displayName}`,
                () => onSelectObject?.('connection', connection.id),
              )}
            >
              <path className="connection-path" d={pathFromPoints(connection.anchorPoints)} />
              <circle className="connection-anchor" cx={marker.x} cy={marker.y} r="8" />
              {connection.connectionType !== 'process_stream' ? (
                <text x={marker.x + 12} y={marker.y - 10}>{connection.displayName}</text>
              ) : null}
            </g>
          );
        })}
      </g>

      <g className="parsed-stream-layer">
        {page.streams.map((stream) => {
          const labelPoint = midpoint(stream.points);
          const className = objectClassName(
            'stream',
            stream.id,
            stream.issueIds,
            selectedRef,
            issues,
            issueStates,
          );
          return (
            <g
              key={stream.id}
              data-overlay-object="stream"
              className={className}
              {...interactiveProps(
                interactive,
                `流股 ${stream.streamNo} ${stream.name}`,
                () => onSelectObject?.('stream', stream.id),
              )}
            >
              <path className="stream-hit-path" d={pathFromPoints(stream.points)} />
              <path
                className="stream-visible-path"
                d={pathFromPoints(stream.points)}
                markerEnd={`url(#${arrowId})`}
              />
              <circle className="stream-endpoint" cx={stream.points[0]!.x} cy={stream.points[0]!.y} r="5" />
              <circle
                className="stream-endpoint"
                cx={stream.points[stream.points.length - 1]!.x}
                cy={stream.points[stream.points.length - 1]!.y}
                r="5"
              />
              <text x={labelPoint.x} y={labelPoint.y - 12}>{stream.streamNo}</text>
            </g>
          );
        })}
      </g>

      <g className="parsed-equipment-layer">
        {page.equipment.map((item) => {
          const className = objectClassName(
            'equipment',
            item.id,
            item.issueIds,
            selectedRef,
            issues,
            issueStates,
          );
          return (
            <g
              key={item.id}
              data-overlay-object="equipment"
              className={className}
              {...interactiveProps(
                interactive,
                `设备 ${item.tag || '位号缺失'} ${item.name}`,
                () => onSelectObject?.('equipment', item.id),
              )}
            >
              <rect
                x={item.bbox.x}
                y={item.bbox.y}
                width={item.bbox.width}
                height={item.bbox.height}
                rx="10"
              />
              <text x={item.bbox.x + 8} y={item.bbox.y - 10}>
                {item.tag || '位号缺失'} · {item.name}
              </text>
            </g>
          );
        })}
      </g>

      <g className="parsed-issue-layer">
        {issues.map((issue) => {
          const resolved = Boolean(issueStates[issue.id]?.resolved);
          const selected = selectedRef?.issueId === issue.id;
          return (
            <g
              key={issue.id}
              data-overlay-object="issue"
              className={[
                'parsed-issue-marker',
                `is-${issue.severity}`,
                resolved ? 'is-resolved' : '',
                selected ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              transform={`translate(${issue.position.x} ${issue.position.y})`}
              {...interactiveProps(
                interactive,
                `${issue.severity === 'blocking' ? '错误' : '警告'} ${issue.title}`,
                () => onSelectIssue?.(issue.id),
              )}
            >
              <circle r="15" />
              <text x="0" y="5" textAnchor="middle">
                {resolved ? '✓' : issue.severity === 'blocking' ? '!' : '△'}
              </text>
              <rect x="21" y="-17" width={Math.max(86, issue.title.length * 15)} height="34" rx="8" />
              <text className="issue-label" x="31" y="5">{resolved ? '已补齐' : issue.title}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
