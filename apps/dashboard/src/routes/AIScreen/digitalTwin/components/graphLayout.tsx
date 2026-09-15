/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

import dagre from '@dagrejs/dagre';
import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react';
import type {
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
} from '@/services/claw/digitalTwinTypes';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;
const NODE_ACCENT = 'hsl(var(--chart-1))';
const TITLE_FONT_SIZE = 13;
const LABEL_FONT_SIZE = 10;

export function layoutSubsystems(
  subsystems: DigitalTwinSubsystemNode[],
  edges: DigitalTwinSubsystemEdge[],
): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  subsystems.forEach(s => g.setNode(s.name, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);

  const maxMemoryCount = Math.max(1, ...subsystems.map(s => s.memoryCount));

  return subsystems.map(s => {
    const pos = g.node(s.name) as { x: number; y: number } | undefined;
    const sat = 0.4 + 0.5 * (s.memoryCount / maxMemoryCount);
    return {
      id: s.name,
      position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: (pos?.y ?? 0) - NODE_HEIGHT / 2 },
      data: {
        label: (
          <div style={{ textAlign: 'left', lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600, fontSize: TITLE_FONT_SIZE }}>{s.name}</div>
            <div style={{ fontSize: LABEL_FONT_SIZE, opacity: 0.75, marginTop: 2 }}>
              {s.memoryCount} {s.memoryCount === 1 ? 'memory' : 'memories'} · {s.sessionCount}{' '}
              {s.sessionCount === 1 ? 'session' : 'sessions'}
            </div>
            <div
              style={{
                fontSize: LABEL_FONT_SIZE,
                opacity: 0.55,
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
              }}
            >
              {s.sampleContent}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: `color-mix(in srgb, ${NODE_ACCENT} ${Math.round((0.12 + 0.18 * sat) * 100)}%, transparent)`,
        border: `1.5px solid color-mix(in srgb, ${NODE_ACCENT} ${Math.round(sat * 100)}%, transparent)`,
        borderRadius: 10,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        boxShadow: `0 2px 8px hsl(var(--foreground) / 0.15)`,
        cursor: 'pointer',
      },
    };
  });
}

export function makeSubsystemEdges(edges: DigitalTwinSubsystemEdge[]): RFEdge[] {
  if (edges.length === 0) return [];
  const maxShared = Math.max(1, ...edges.map(e => e.sharedSessions));
  return edges.map(e => ({
    id: `${e.source}::${e.target}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: false,
    style: {
      stroke: `color-mix(in srgb, ${NODE_ACCENT} 55%, transparent)`,
      strokeWidth: Math.max(1.5, (e.sharedSessions / maxShared) * 3.5),
    },
    label: `${e.sharedSessions} shared`,
    labelStyle: { fontSize: LABEL_FONT_SIZE, fill: NODE_ACCENT },
    labelBgPadding: [4, 4] as [number, number],
    labelBgBorderRadius: 4,
  }));
}
