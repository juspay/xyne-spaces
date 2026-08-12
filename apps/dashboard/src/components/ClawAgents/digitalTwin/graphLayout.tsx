/* @dagrejs/dagre ships loose types, so its graph builder / layout calls read as
   `any` to the strict TS-ESLint rules. Scoped-disable them for this file only. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// Subsystem graph layout (dagre) — ported from the reference DigitalTwinMemoriesTab.
// The backend returns { subsystems, edges }; each node is a curated subsystem and
// each edge connects subsystems that share source sessions. We use dagre for a
// left-to-right hierarchical layout and scale node saturation by memory count.

import dagre from '@dagrejs/dagre';
import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react';
import type {
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
} from '@/services/claw/digitalTwinTypes';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;

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

  return subsystems.map(s => {
    const pos = g.node(s.name) as { x: number; y: number } | undefined;
    return {
      id: s.name,
      ariaLabel: `${s.name}: ${s.memoryCount} memories from ${s.sessionCount} sessions`,
      position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: (pos?.y ?? 0) - NODE_HEIGHT / 2 },
      data: {
        label: (
          <div style={{ textAlign: 'left', lineHeight: 1.4 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
            <div style={{ fontSize: 14, color: 'var(--dt-muted)', marginTop: 4 }}>
              {s.memoryCount} {s.memoryCount === 1 ? 'memory' : 'memories'} · {s.sessionCount}{' '}
              {s.sessionCount === 1 ? 'session' : 'sessions'}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: 'var(--dt-paper)',
        color: 'var(--dt-ink)',
        border: '1px solid var(--dt-rule)',
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
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
      stroke: 'var(--dt-accent)',
      opacity: 0.55,
      strokeWidth: Math.max(1.5, (e.sharedSessions / maxShared) * 3.5),
    },
    label: `${e.sharedSessions} shared`,
    labelStyle: { fontSize: 14, fill: 'var(--dt-muted)' },
    labelBgPadding: [4, 4] as [number, number],
    labelBgBorderRadius: 4,
  }));
}
