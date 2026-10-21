import { TicketStatusV2 } from '@xyne/shared';

export interface GraphPosition {
  x: number;
  y: number;
}

export interface TransitionGraphLayout {
  stages: Map<number, GraphPosition>;
  bubbles: Map<number, GraphPosition>;
}

export interface LayoutStage {
  tempId: number;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
}

export const ROW_PITCH = 140;

const NODE_WIDTH = 240;
const NODE_HEIGHT = 46;
const HANDLE_OUTSET = 7;
const COL_PITCH = 460;
const STAGGER = 70;
const LANE_GAP = 110;
const WRAP_GAP = 150;
const ROW_PENALTY = 4;
const MARGIN = 60;
const MAX_ROWS = 6;
const SWEEPS = 4;
const BUBBLE_OFFSET = { x: -150, y: -38 };
const BUBBLE_SIZE = { width: 80, height: 26 };
const BUBBLE_FALLBACK_Y = [6, 52];
const LABEL_HALF = { width: 34, height: 12 };
const VIEWPORT = { width: 1300, height: 520, padding: 1.35 };
const READABLE_ZOOM = 0.55;

export const bubbleNextTo = (target: GraphPosition): GraphPosition => ({
  x: target.x + BUBBLE_OFFSET.x,
  y: target.y + BUBBLE_OFFSET.y,
});

type Edge = [number, number];

interface ColumnPlan {
  count: number;
  stacks: number[][];
  laneCol: Map<number, number>;
  rank: Map<number, number>;
}

interface Segment {
  from: number;
  to: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const isTerminal = (status: TicketStatusV2): boolean =>
  status === TicketStatusV2.COMPLETED || status === TicketStatusV2.CANCELLED;

const stackHeight = (size: number): number =>
  size === 0 ? 0 : (size - 1) * ROW_PITCH + NODE_HEIGHT;

function planColumns(ordered: LayoutStage[], edges: Edge[]): ColumnPlan {
  const rank = new Map(ordered.map((s, i) => [s.tempId, i]));
  let spine = ordered.filter(
    s => s.defaultTicketStatusV2 !== TicketStatusV2.PAUSED && !isTerminal(s.defaultTicketStatusV2),
  );
  let terminal = ordered.filter(s => s.defaultTicketStatusV2 === TicketStatusV2.COMPLETED);
  let cancelled = ordered.filter(s => s.defaultTicketStatusV2 === TicketStatusV2.CANCELLED);
  let paused = ordered.filter(s => s.defaultTicketStatusV2 === TicketStatusV2.PAUSED);
  if (spine.length === 0) {
    spine = ordered;
    terminal = [];
    cancelled = [];
    paused = [];
  }

  const spineIds = new Set(spine.map(s => s.tempId));
  const neighbors = new Map<number, number[]>();
  const forwardPreds = new Map<number, number[]>();
  edges.forEach(([from, to]) => {
    neighbors.set(from, [...(neighbors.get(from) ?? []), to]);
    neighbors.set(to, [...(neighbors.get(to) ?? []), from]);
    if (spineIds.has(from) && spineIds.has(to) && (rank.get(from) ?? 0) < (rank.get(to) ?? 0)) {
      forwardPreds.set(to, [...(forwardPreds.get(to) ?? []), from]);
    }
  });

  const col = new Map<number, number>();
  let previous = -1;
  spine.forEach(s => {
    const preds = forwardPreds.get(s.tempId) ?? [];
    const c = preds.length > 0 ? Math.max(...preds.map(p => (col.get(p) ?? 0) + 1)) : previous + 1;
    col.set(s.tempId, c);
    previous = c;
  });
  const terminalCol = spine.length > 0 ? Math.max(...col.values()) + 1 : 0;
  terminal.forEach(s => col.set(s.tempId, terminalCol));

  const count = Math.max(0, ...col.values()) + 1;
  const stacks: number[][] = Array.from({ length: count }, () => []);
  [...spine, ...terminal].forEach(s => stacks[col.get(s.tempId) ?? 0]?.push(s.tempId));

  const slot = new Map<number, number>();
  stacks.forEach(stack => stack.forEach((t, i) => slot.set(t, i)));
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? stacks.keys() : [...stacks.keys()].reverse();
    for (const c of order) {
      const stack = stacks[c];
      if (!stack || stack.length < 2 || (terminal.length > 0 && c === terminalCol)) continue;
      const bary = new Map(
        stack.map(t => {
          const side = (neighbors.get(t) ?? []).filter(u => {
            const cu = col.get(u);
            return cu !== undefined && (forward ? cu < c : cu > c);
          });
          const value =
            side.length > 0
              ? side.reduce((sum, u) => sum + (slot.get(u) ?? 0), 0) / side.length
              : (slot.get(t) ?? 0);
          return [t, value] as const;
        }),
      );
      stack.sort(
        (a, b) =>
          (bary.get(a) ?? 0) - (bary.get(b) ?? 0) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
      );
      stack.forEach((t, i) => slot.set(t, i));
    }
  }

  const laneCol = new Map<number, number>();
  paused.forEach(p => {
    const cols = (neighbors.get(p.tempId) ?? [])
      .map(u => col.get(u))
      .filter((c): c is number => c !== undefined)
      .sort((a, b) => a - b);
    const earlier = ordered
      .slice(0, rank.get(p.tempId) ?? 0)
      .reverse()
      .find(s => col.has(s.tempId));
    const fallback = earlier ? (col.get(earlier.tempId) ?? 0) : 0;
    laneCol.set(
      p.tempId,
      cols.length > 0 ? (cols[Math.floor((cols.length - 1) / 2)] ?? 0) : fallback,
    );
  });
  cancelled.forEach(s => laneCol.set(s.tempId, count - 1));

  return { count, stacks, laneCol, rank };
}

function placeCandidate(
  plan: ColumnPlan,
  perRow: number,
  stagger: boolean,
  mergedTargets: Set<number>,
): TransitionGraphLayout {
  const stages = new Map<number, GraphPosition>();
  const blocks = Math.ceil(plan.count / perRow);
  let top = MARGIN;
  for (let b = 0; b < blocks; b++) {
    const first = b * perRow;
    const last = Math.min(plan.count, first + perRow) - 1;
    const tallest = Math.max(
      0,
      ...plan.stacks.slice(first, last + 1).map(s => stackHeight(s.length)),
    );
    const staggerHeight = stagger && last > first ? STAGGER : 0;
    for (let c = first; c <= last; c++) {
      const stack = plan.stacks[c] ?? [];
      const j = c - first;
      const offset = staggerHeight > 0 && j % 2 === 1 ? STAGGER : 0;
      const y0 = top + offset + (tallest - stackHeight(stack.length)) / 2;
      stack.forEach((t, i) => stages.set(t, { x: MARGIN + j * COL_PITCH, y: y0 + i * ROW_PITCH }));
    }
    const bandBottom = top + tallest + staggerHeight;

    const lane = [...plan.laneCol.entries()]
      .filter(([, c]) => c >= first && c <= last)
      .sort(([a, ca], [b2, cb]) => ca - cb || (plan.rank.get(a) ?? 0) - (plan.rank.get(b2) ?? 0));
    if (lane.length === 0) {
      top = bandBottom + WRAP_GAP;
      continue;
    }
    const laneTop = bandBottom + LANE_GAP;
    const width = last - first + 1;
    const laneRows = Math.ceil(lane.length / width);
    for (let row = 0; row < laneRows; row++) {
      const chunk = lane.slice(row * width, (row + 1) * width);
      const cols: number[] = [];
      chunk.forEach(([, want], i) =>
        cols.push(Math.max(want, i > 0 ? (cols[i - 1] ?? first) + 1 : first)),
      );
      for (let i = chunk.length - 1; i >= 0; i--) {
        cols[i] = Math.min(
          cols[i] ?? last,
          i === chunk.length - 1 ? last : (cols[i + 1] ?? last) - 1,
        );
      }
      chunk.forEach(([t], i) =>
        stages.set(t, {
          x: MARGIN + ((cols[i] ?? first) - first) * COL_PITCH,
          y: laneTop + row * ROW_PITCH,
        }),
      );
    }
    top = laneTop + stackHeight(laneRows) + WRAP_GAP;
  }

  const rounded = new Map(
    [...stages].map(([t, p]) => [t, { x: Math.round(p.x), y: Math.round(p.y) }] as const),
  );
  const bubbles = new Map<number, GraphPosition>();
  const occupied = [...rounded.values()].map(p => ({
    left: p.x - 6,
    top: p.y - 6,
    right: p.x + NODE_WIDTH + 6,
    bottom: p.y + NODE_HEIGHT + 6,
  }));
  mergedTargets.forEach(t => {
    const target = rounded.get(t);
    if (!target) return;
    const preferred = bubbleNextTo(target);
    const candidates = [
      preferred,
      ...BUBBLE_FALLBACK_Y.map(y => ({ x: preferred.x, y: target.y + y })),
    ];
    const position =
      candidates.find(c =>
        occupied.every(
          r =>
            c.x + BUBBLE_SIZE.width <= r.left ||
            c.x >= r.right ||
            c.y + BUBBLE_SIZE.height <= r.top ||
            c.y >= r.bottom,
        ),
      ) ?? preferred;
    bubbles.set(t, position);
    occupied.push({
      left: position.x - 4,
      top: position.y - 4,
      right: position.x + BUBBLE_SIZE.width + 4,
      bottom: position.y + BUBBLE_SIZE.height + 4,
    });
  });
  return { stages: rounded, bubbles };
}

const orientation = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number => Math.sign((by - ay) * (cx - bx) - (bx - ax) * (cy - by));

const onSegment = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean =>
  Math.min(ax, cx) <= bx &&
  bx <= Math.max(ax, cx) &&
  Math.min(ay, cy) <= by &&
  by <= Math.max(ay, cy);

function segmentsCross(s: Segment, t: Segment): boolean {
  const o1 = orientation(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1);
  const o2 = orientation(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2);
  const o3 = orientation(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1);
  const o4 = orientation(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(s.x1, s.y1, t.x1, t.y1, s.x2, s.y2)) ||
    (o2 === 0 && onSegment(s.x1, s.y1, t.x2, t.y2, s.x2, s.y2)) ||
    (o3 === 0 && onSegment(t.x1, t.y1, s.x1, s.y1, t.x2, t.y2)) ||
    (o4 === 0 && onSegment(t.x1, t.y1, s.x2, s.y2, t.x2, t.y2))
  );
}

function segmentHitsRect(
  s: Segment,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const checks: Array<[number, number]> = [
    [-dx, s.x1 - left],
    [dx, right - s.x1],
    [-dy, s.y1 - top],
    [dy, bottom - s.y1],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

function scoreCandidate(layout: TransitionGraphLayout, edges: Edge[]): number {
  const boxes = [
    ...[...layout.stages.values()].map(p => [p.x, p.y, p.x + NODE_WIDTH, p.y + NODE_HEIGHT]),
    ...[...layout.bubbles.values()].map(p => [
      p.x,
      p.y,
      p.x + BUBBLE_SIZE.width,
      p.y + BUBBLE_SIZE.height,
    ]),
  ];
  const width = Math.max(...boxes.map(b => b[2] ?? 0)) - Math.min(...boxes.map(b => b[0] ?? 0));
  const height = Math.max(...boxes.map(b => b[3] ?? 0)) - Math.min(...boxes.map(b => b[1] ?? 0));
  const zoom = Math.min(
    VIEWPORT.width / (Math.max(width, 1) * VIEWPORT.padding),
    VIEWPORT.height / (Math.max(height, 1) * VIEWPORT.padding),
  );

  const segments: Segment[] = edges.flatMap(([from, to]) => {
    const a = layout.stages.get(from);
    const b = layout.stages.get(to);
    if (!a || !b) return [];
    return [
      {
        from,
        to,
        x1: a.x + NODE_WIDTH + HANDLE_OUTSET,
        y1: a.y + NODE_HEIGHT / 2,
        x2: b.x - HANDLE_OUTSET,
        y2: b.y + NODE_HEIGHT / 2,
      },
    ];
  });

  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s) continue;
    for (let j = i + 1; j < segments.length; j++) {
      const t = segments[j];
      if (!t || s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
      if (segmentsCross(s, t)) crossings++;
    }
  }

  let nodeHits = 0;
  let labelHits = 0;
  let length = 0;
  segments.forEach(s => {
    length += Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const midX = (s.x1 + s.x2) / 2;
    const midY = (s.y1 + s.y2) / 2;
    layout.stages.forEach((p, t) => {
      if (t === s.from || t === s.to) return;
      if (segmentHitsRect(s, p.x - 4, p.y - 4, p.x + NODE_WIDTH + 4, p.y + NODE_HEIGHT + 4))
        nodeHits++;
      if (
        midX + LABEL_HALF.width > p.x &&
        midX - LABEL_HALF.width < p.x + NODE_WIDTH &&
        midY + LABEL_HALF.height > p.y &&
        midY - LABEL_HALF.height < p.y + NODE_HEIGHT
      ) {
        labelHits++;
      }
    });
  });

  const perEdge = Math.max(1, segments.length);
  return (
    400 * Math.max(0, READABLE_ZOOM - zoom) -
    20 * Math.min(zoom, 1) +
    (25 * nodeHits + 25 * labelHits + 4 * crossings) / perEdge +
    length / perEdge / 200
  );
}

let cache: { key: string; layout: TransitionGraphLayout } | null = null;

export function layoutTransitionGraph(
  stages: LayoutStage[],
  transitions: Map<number, Set<number>>,
  mergedTargets: Iterable<number>,
): TransitionGraphLayout {
  const ordered = [...stages].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber || a.tempId - b.tempId,
  );
  const known = new Set(ordered.map(s => s.tempId));
  const merged = new Set([...mergedTargets].filter(t => known.has(t)));
  const edges: Edge[] = [];
  transitions.forEach((targets, from) => {
    targets.forEach(to => {
      if (from !== to && known.has(from) && known.has(to) && !merged.has(to))
        edges.push([from, to]);
    });
  });
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const key = [
    ordered.map(s => `${s.tempId}:${s.sequenceNumber}:${s.defaultTicketStatusV2}`).join(','),
    edges.map(([from, to]) => `${from}>${to}`).join(','),
    [...merged].sort((a, b) => a - b).join(','),
  ].join('|');
  if (cache?.key === key) return cache.layout;

  const plan = planColumns(ordered, edges);
  let best: TransitionGraphLayout = { stages: new Map(), bubbles: new Map() };
  let bestScore = Infinity;
  for (let rows = 1; rows <= Math.min(MAX_ROWS, plan.count); rows++) {
    const perRow = Math.ceil(plan.count / rows);
    if (rows > 1 && Math.ceil(plan.count / (rows - 1)) === perRow) continue;
    for (const stagger of [false, true]) {
      const candidate = placeCandidate(plan, perRow, stagger, merged);
      const score = scoreCandidate(candidate, edges) + ROW_PENALTY * (rows - 1);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  cache = { key, layout: best };
  return best;
}
