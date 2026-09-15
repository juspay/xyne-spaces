import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { MemoryBankMemory } from "../../../lib/api";
import { SUBSYSTEM_LABELS } from "./ProposalModal";

/**
 * Canvas-rendered memory constellation. Nodes are memories; edges are links we
 * can derive client-side: "topic" (same subsystem) and "temporal" (created
 * close in time). Force-directed layout; pinch to zoom, drag to pan, hover to
 * highlight, click to select. Neutral, muted palette.
 *
 * Interaction note: the wheel handler is attached NATIVELY with {passive:false}
 * so preventDefault actually stops the page from scrolling while zooming (React's
 * synthetic onWheel is passive and can't). View state lives in a ref and redraws
 * are pushed imperatively so zoom/pan never blanks between React renders.
 */

// Vibrant hues for the inner dots — distinct + saturated so subsystems pop.
export const SUBSYSTEM_COLOR: Record<string, string> = {
  style: "#3b82f6",         // blue
  triage: "#f59e0b",        // amber
  expertise: "#14b8a6",     // teal
  projects: "#f97316",      // orange
  relationships: "#a855f7", // purple
  preferences: "#22c55e",   // green
  decisions: "#ef4444",     // red
  context: "#6366f1",       // indigo
  docs: "#eab308",          // yellow
};
export const DEFAULT_COLOR = "#94a3b8";
// Hindsight's full edge vocabulary — every value its memory_links.link_type
// CHECK constraint allows, each mapped 1:1 so nothing is silently folded into a
// neighbouring type. `other` is a deliberate catch-all: if a future Hindsight
// adds an eighth type it shows up as unknown rather than being mislabelled as
// semantic, which is exactly the bug the old two-branch fallback had.
//
// The four causal types share a warm family so they read as related at a glance
// while staying individually identifiable. In practice only `caused_by` occurs
// today — the legend hides types with no edges, so the unused ones cost nothing.
export const LINK_COLOR = {
  semantic: "#9a8fc0",
  temporal: "#7fa890",
  entity: "#c2a15e",
  causes: "#c08f8f",
  caused_by: "#c08f8f",
  enables: "#c08f8f",
  prevents: "#c08f8f",
  other: DEFAULT_COLOR,
} as const;
/**
 * Edge colour at rest, before a node is hovered or selected. Hardcoded rather
 * than read from a theme token so it can be tuned on its own — the design
 * system's greys are sized for text and borders, not for thousands of hairlines
 * at low alpha.
 *
 * Two values because one grey cannot be right on both a white and a near-black
 * canvas: on light it has to be dark enough to survive the idle alpha, on dark
 * it has to be light enough. Tune these directly.
 */
export const EDGE_IDLE_COLOR = {
  light: "#5a5a5a3c",
  dark: "#a3a3a32e",
} as const;

/**
 * Idle edge opacity, scaled to how many edges are actually on screen.
 *
 * Overlapping semi-transparent strokes accumulate: at a fixed alpha, 200 edges
 * read as a faint sketch while 5,000 read as a solid wash, because what the eye
 * registers is roughly count × alpha. Holding that product near-constant keeps
 * a sparse graph legible and a dense one from filling in — so a small bank gets
 * darker lines and a large one gets lighter ones, automatically.
 *
 * sqrt rather than 1/n: strictly inverse over-corrects and makes big graphs
 * vanish. Clamped at both ends so neither extreme runs away. Tune freely —
 * `base` is the opacity at exactly `refCount` edges. Calibrated so a dense
 * ~5.8k-edge bank lands on the 0.14 that was hand-tuned against the current
 * palette — this only *raises* opacity for sparser graphs, it does not change
 * how a large one already looks.
 */
const EDGE_ALPHA = { base: 0.14, refCount: 5800, min: 0.08, max: 0.42 } as const;

export function idleEdgeAlpha(visibleEdgeCount: number): number {
  if (visibleEdgeCount <= 0) return EDGE_ALPHA.max;
  return clamp(
    EDGE_ALPHA.base * Math.sqrt(EDGE_ALPHA.refCount / visibleEdgeCount),
    EDGE_ALPHA.min,
    EDGE_ALPHA.max,
  );
}

export const LINK_TYPES = [
  "semantic", "temporal", "entity", "causes", "caused_by", "enables", "prevents", "other",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const LINK_LABEL: Record<LinkType, string> = {
  semantic: "semantic",
  temporal: "temporal",
  entity: "entity",
  causes: "causes",
  caused_by: "caused by",
  enables: "enables",
  prevents: "prevents",
  other: "other",
};
const KNOWN_TYPES = new Set<string>(LINK_TYPES);
export function normalizeLinkType(t: string): LinkType {
  return KNOWN_TYPES.has(t) && t !== "other" ? (t as LinkType) : "other";
}

/** A raw edge from Hindsight's memory graph, keyed by memory id. */
export interface GraphLink { source: string; target: string; linkType: string; weight?: number }

function subsystemOf(m: MemoryBankMemory): string {
  const t = (m.tags ?? []).find((x) => x.startsWith("subsystem:"));
  if (t) return t.slice("subsystem:".length);
  return (m.category ?? "other").toLowerCase();
}
function cleanText(s: string): string {
  return s.replace(/\s*\|\s*(Involving|When|Where|Who|Related|Context)\s*:.*$/i, "").trim();
}
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function fmtDate(ts: number): string {
  if (!ts) return "unknown date";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// x/y = layout target; cx/cy = current (animated) render position; vx/vy = sim velocity.
interface Node { id: string; text: string; subsystem: string; ts: number; hits: number; degree: number; x: number; y: number; cx: number; cy: number; vx: number; vy: number }
interface Edge { a: number; b: number; type: LinkType; weight: number }
/** Luminance heuristic → pick a readable label colour over a coloured badge. */
function isLightColor(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

/**
 * Build the graph from the memories (nodes) + Hindsight's REAL links (edges).
 * Links reference memories by id; we resolve them to node indices, drop any whose
 * endpoints aren't in the current (filtered) node set, and de-dupe per (pair,type).
 */
function buildGraph(memories: MemoryBankMemory[], links: GraphLink[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = memories.map((m) => ({
    id: m.hindsightMemoryId,
    text: cleanText(m.content),
    subsystem: subsystemOf(m),
    ts: Date.parse(m.createdAt) || 0,
    hits: m.recallHits7d ?? 0,
    degree: 0,
    x: 0, y: 0, cx: 0, cy: 0, vx: 0, vy: 0,
  }));
  const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    const a = idToIndex.get(l.source);
    const b = idToIndex.get(l.target);
    if (a == null || b == null || a === b) continue;
    const type = normalizeLinkType(l.linkType);
    const key = `${Math.min(a, b)}-${Math.max(a, b)}-${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a, b, type, weight: typeof l.weight === "number" ? l.weight : 1 });
    nodes[a]!.degree++; nodes[b]!.degree++;
  }
  return { nodes, edges };
}

/** Fruchterman-Reingold, run to steady state. `spacing` (a UI slider, ~0.6-2.2)
 *  scales the whole layout: bigger spread + weaker attraction/gravity → more room
 *  between nodes AND between clusters. Deterministic (no randomness). */
function layout(nodes: Node[], edges: Edge[], spacing = 1): void {
  const n = nodes.length;
  if (n === 0) return;
  // Roomier base than before (340/38 vs 260/26) — clusters breathe by default.
  const spread = (340 + n * 38) * spacing;
  nodes.forEach((nd, i) => {
    const a = (i / n) * Math.PI * 2;
    nd.x = Math.cos(a) * spread * 0.5 + ((i * 37) % 23) - 11;
    nd.y = Math.sin(a) * spread * 0.5 + ((i * 53) % 23) - 11;
  });
  const area = spread * spread;
  const k = Math.sqrt(area / n);
  const iters = 340;
  for (let it = 0; it < iters; it++) {
    const cooling = 1 - it / iters;
    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0; const a = nodes[i]!;
      for (let j = 0; j < n; j++) {
        if (i === j) continue; const b = nodes[j]!;
        let dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / d; fx += (dx / d) * rep; fy += (dy / d) * rep;
      }
      a.vx = fx; a.vy = fy;
    }
    // Weaker attraction (÷1.9) → connected memories sit farther apart.
    for (const e of edges) {
      const A = nodes[e.a]!, B = nodes[e.b]!;
      let dx = A.x - B.x, dy = A.y - B.y; const d = Math.hypot(dx, dy) || 0.01;
      const att = (d * d) / (k * 1.9); const ux = dx / d, uy = dy / d;
      A.vx -= ux * att; A.vy -= uy * att; B.vx += ux * att; B.vy += uy * att;
    }
    // Gentler gravity, further relaxed by spacing → clusters drift apart more.
    const grav = 0.014 / spacing;
    for (const nd of nodes) { nd.vx -= nd.x * grav; nd.vy -= nd.y * grav; }
    const maxDisp = (spread / 12) * cooling + 1;
    for (const nd of nodes) {
      const d = Math.hypot(nd.vx, nd.vy) || 0.01; const m = Math.min(d, maxDisp);
      nd.x += (nd.vx / d) * m; nd.y += (nd.vy / d) * m;
    }
  }
}

// Smaller nodes — a small vibrant core (drawn at ~55% of this) with a soft halo.
function nodeRadius(n: Node): number { return 3 + Math.min(4, Math.sqrt(n.hits) * 1.1) + Math.min(1.5, n.degree * 0.12); }

/** One neighbour of the selected node, numbered so the badge on the graph maps
 *  to the row in the detail panel below. `relation` is the edge type. */
export interface ConstellationNeighbor {
  index: number;
  id: string;
  text: string;
  subsystem: string;
  relation: LinkType;
  weight: number;
  entities: string[];
}

interface Props {
  memories: MemoryBankMemory[];
  /** Real edges from Hindsight's memory graph (by memory id). */
  links: GraphLink[];
  /** memory id → its extracted entity names (for the hover tooltip). */
  entitiesById?: Record<string, string[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Fired with the selected node's numbered neighbours (+ relation) so the
   *  parent can list them below the graph. Empty when nothing is selected. */
  onNeighbors?: (neighbors: ConstellationNeighbor[]) => void;
  /** Fullscreen state + toggle — rendered as an Expand / Collapse button. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Timeline cutoff (epoch ms): only memories created at/before this show — newer
   *  ones fade OUT. Undefined = all visible. Layout never reflows when this changes. */
  visibleUntil?: number;
  /** Hidden edge types. Pass with onHiddenTypesChange to let a parent (the
   *  filter rail) own the legend; omit for self-managed toggles. */
  hiddenTypes?: Set<LinkType>;
  onHiddenTypesChange?: (next: Set<LinkType>) => void;
  /** Draw the in-canvas subsystem + edge-type legends. Off when the parent
   *  renders them somewhere with more room. */
  showLegends?: boolean;
}

export function MemoryConstellation({
  memories, links, entitiesById, selectedId, onSelect, onNeighbors, expanded, onToggleExpand, visibleUntil,
  hiddenTypes: hiddenTypesProp, onHiddenTypesChange, showLegends = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const [hover, setHover] = useState<number | null>(null);
  // Tooltip node — set only after a short hover dwell (see the delay effect below).
  const [tipIdx, setTipIdx] = useState<number | null>(null);
  // Edge-type visibility toggles (temporal is the noisiest → hidden by default).
  // Edge-type visibility. Controlled when the parent passes hiddenTypes (the
  // filter rail owns the legend); otherwise self-managed so the component still
  // works standalone. All types start visible.
  const [ownHidden, setOwnHidden] = useState<Set<LinkType>>(() => new Set<LinkType>());
  const hiddenTypes = hiddenTypesProp ?? ownHidden;
  const setHiddenTypes = (fn: (prev: Set<LinkType>) => Set<LinkType>): void => {
    if (onHiddenTypesChange) onHiddenTypesChange(fn(hiddenTypes));
    else setOwnHidden(fn);
  };
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const drawRef = useRef<() => void>(() => {});

  const { nodes, edges } = useMemo(() => {
    const g = buildGraph(memories, links);
    // 1.6 spread: at the default the clusters packed into a single blob and
    // individual nodes were indistinguishable.
    layout(g.nodes, g.edges, 1.6);
    for (const n of g.nodes) { n.cx = n.x; n.cy = n.y; } // start settled (no intro animation)
    return g;
  }, [memories, links]);
  // Layout uses ALL edges (stable positions); only DRAWING + neighbour tracing
  // respect the toggles, so flipping a type never re-lays-out the graph.
  const visibleEdges = useMemo(() => edges.filter((e) => !hiddenTypes.has(e.type)), [edges, hiddenTypes]);
  const idToIndex = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const idToMemory = useMemo(() => new Map(memories.map((m) => [m.hindsightMemoryId, m])), [memories]);
  // Distinct subsystems present — drives the colour legend (only shown buckets).
  const presentSubsystems = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of nodes) if (!seen.has(n.subsystem)) { seen.add(n.subsystem); out.push(n.subsystem); }
    return out;
  }, [nodes]);

  // Per-node animation state (hover pop, dim fade, timeline visibility); the RAF
  // lerps each toward its target every frame.
  const visibleUntilRef = useRef<number | undefined>(visibleUntil); visibleUntilRef.current = visibleUntil;
  const animRef = useRef<{ hoverT: Float32Array; dimT: Float32Array; visT: Float32Array }>({ hoverT: new Float32Array(0), dimT: new Float32Array(0), visT: new Float32Array(0) });
  useEffect(() => {
    // Seed visibility at the current cutoff so the initial render has no fade.
    const visT = new Float32Array(nodes.length);
    const cut = visibleUntilRef.current;
    for (let i = 0; i < nodes.length; i++) visT[i] = cut == null || nodes[i]!.ts <= cut ? 1 : 0;
    animRef.current = { hoverT: new Float32Array(nodes.length), dimT: new Float32Array(nodes.length), visT };
  }, [nodes]);
  // Live mirrors so the RAF loop reads current hover/selection without re-binding.
  const hoverRef = useRef<number | null>(null); hoverRef.current = hover;
  // Read inside the native wheel listener, which is registered once.
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const selIdxRef = useRef<number | null>(null);
  selIdxRef.current = selectedId ? idToIndex.get(selectedId) ?? null : null;

  // Selected node's neighbours, numbered + tagged with the (strongest) edge
  // relation, its weight, and the neighbour's entities — shown in the panel below.
  const selectedIndex = selectedId ? idToIndex.get(selectedId) ?? null : null;
  const selectedNeighbors = useMemo<ConstellationNeighbor[]>(() => {
    if (selectedIndex == null) return [];
    const rel = new Map<number, { type: LinkType; weight: number }>();
    for (const e of visibleEdges) {
      const other = e.a === selectedIndex ? e.b : e.b === selectedIndex ? e.a : -1;
      if (other < 0) continue;
      const cur = rel.get(other);
      if (!cur || e.weight > cur.weight) rel.set(other, { type: e.type, weight: e.weight });
    }
    const order: Record<LinkType, number> = {
      semantic: 0, temporal: 1, entity: 2,
      causes: 3, caused_by: 4, enables: 5, prevents: 6,
      other: 7,
    };
    const arr = [...rel.entries()].sort((x, y) =>
      x[1].type !== y[1].type ? order[x[1].type] - order[y[1].type] : y[1].weight - x[1].weight,
    );
    return arr.map(([idx, info], i) => ({
      index: i + 1,
      id: nodes[idx]!.id,
      text: nodes[idx]!.text,
      subsystem: nodes[idx]!.subsystem,
      relation: info.type,
      weight: info.weight,
      entities: entitiesById?.[nodes[idx]!.id] ?? [],
    }));
  }, [selectedIndex, visibleEdges, nodes, entitiesById]);
  const badgeByIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (const nb of selectedNeighbors) {
      const idx = idToIndex.get(nb.id);
      if (idx != null) m.set(idx, nb.index);
    }
    return m;
  }, [selectedNeighbors, idToIndex]);

  // Emit neighbours to the parent (ref-held callback so an inline prop can't loop).
  const onNeighborsRef = useRef(onNeighbors);
  onNeighborsRef.current = onNeighbors;
  useEffect(() => { onNeighborsRef.current?.(selectedNeighbors); }, [selectedNeighbors]);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || nodes.length === 0) return;
    const W = wrap.clientWidth || 800, H = wrap.clientHeight || 500;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const gw = maxX - minX || 1, gh = maxY - minY || 1;
    // ×0.82 → a slightly more zoomed-out default with breathing room.
    // Lower floor (0.05) so a DENSE graph (hundreds of memories) actually fits
    // the viewport instead of bottoming out zoomed-in and overflowing.
    // 0.9 rather than 0.82: the layout now carries its own breathing room via
    // the wider spread, so the fit does not need to double up on margin.
    const scale = (clamp(Math.min(W / (gw + 140), H / (gh + 140)), 0.05, 2.4) * 0.9) || 1;
    viewRef.current = { scale, ox: W / 2 - ((minX + maxX) / 2) * scale, oy: H / 2 - ((minY + maxY) / 2) * scale };
    drawRef.current();
  }, [nodes]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W === 0 || H === 0) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { scale, ox, oy } = viewRef.current;
    const sx = (x: number) => x * scale + ox;
    const sy = (y: number) => y * scale + oy;

    const active = hover ?? (selectedId ? idToIndex.get(selectedId) ?? null : null);
    const { hoverT, dimT, visT } = animRef.current;
    // Theme-adaptive ring colour — reads the live CSS var (light vs dark).
    const fg = getComputedStyle(wrap).getPropertyValue("--color-xyne-fg-primary").trim() || "#101828";
    // Edges rest in one neutral grey and only take their type colour around the
    // active node. With thousands of links, five hues at once is noise: the
    // colour means nothing until you have asked a question of a specific node,
    // and then it answers "how is this connected?" precisely where you looked.
    // A light foreground means a dark canvas, so the greys swap.
    const idleEdge = isLightColor(fg) ? EDGE_IDLE_COLOR.dark : EDGE_IDLE_COLOR.light;

    // Density-adaptive: recomputed per frame because hiding an edge type (or the
    // timeline) changes how many are actually drawn.
    const idleAlpha = idleEdgeAlpha(visibleEdges.length);
    for (const e of visibleEdges) {
      const A = nodes[e.a]!, B = nodes[e.b]!;
      const vis = Math.min(visT[e.a] ?? 1, visT[e.b] ?? 1); // edge only as visible as its dimmer endpoint
      if (vis < 0.02) continue;
      const lit = active != null && (e.a === active || e.b === active);
      ctx.strokeStyle = lit ? LINK_COLOR[e.type] : idleEdge;
      // Stronger fade of unrelated edges when a node is active; × timeline visibility.
      ctx.globalAlpha = (active == null ? idleAlpha : lit ? 0.7 : 0.02) * vis;
      ctx.lineWidth = lit ? 1.4 : 0.8;
      ctx.beginPath(); ctx.moveTo(sx(A.cx), sy(A.cy)); ctx.lineTo(sx(B.cx), sy(B.cy)); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const rScale = clamp(scale, 0.7, 1.6);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const vis = visT[i] ?? 1; // timeline visibility 0..1
      if (vis < 0.02) continue;
      const hs = hoverT[i] ?? 0; // hover pop 0..1
      const dm = dimT[i] ?? 0;   // dim fade 0..1
      const r = nodeRadius(n) * rScale * (1 + hs * 0.5);
      const color = SUBSYSTEM_COLOR[n.subsystem] ?? DEFAULT_COLOR;
      const px = sx(n.cx), py = sy(n.cy);
      // Soft halo.
      ctx.globalAlpha = (0.13 + hs * 0.14) * (1 - dm * 0.92) * vis;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, r + 5, 0, Math.PI * 2); ctx.fill();
      // Small vibrant core dot.
      ctx.globalAlpha = (1 - dm * 0.86) * vis;
      ctx.beginPath(); ctx.arc(px, py, Math.max(1.5, r * 0.55), 0, Math.PI * 2); ctx.fill();
      // Active ring — theme-aware.
      if (i === active) {
        ctx.globalAlpha = vis; ctx.strokeStyle = fg; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(px, py, r + 2.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Number the SELECTED node's neighbours — a small badge in the node's own
    // (vibrant) colour, with a luminance-picked readable number. Works on both themes.
    if (badgeByIndex.size > 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 8px ui-sans-serif, system-ui, sans-serif";
      for (const [idx, num] of badgeByIndex) {
        if ((visT[idx] ?? 1) < 0.5) continue; // hidden by the timeline
        const n = nodes[idx]!;
        const r = nodeRadius(n) * rScale * (1 + (hoverT[idx] ?? 0) * 0.5);
        const bx = sx(n.cx) + r * 0.7 + 4;
        const by = sy(n.cy) - r * 0.7 - 4;
        const col = SUBSYSTEM_COLOR[n.subsystem] ?? DEFAULT_COLOR;
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isLightColor(col) ? "#1e293b" : "#ffffff";
        ctx.fillText(String(num), bx, by + 0.5);
      }
      ctx.textAlign = "left";
    }
  }, [nodes, visibleEdges, hover, selectedId, idToIndex, badgeByIndex, visibleUntil]);

  // keep an imperative handle to the latest draw for native/drag redraws
  drawRef.current = draw;

  // ── Animation loop ────────────────────────────────────────────────────────
  // One RAF that lerps three things toward their targets and redraws each frame,
  // stopping when everything is settled: node position (cx,cy → x,y, for the
  // spacing slider), hover pop (hoverT), and dim fade (dimT). Lightweight — a few
  // multiply/adds per node per frame, only while something is actually moving.
  const rafRef = useRef<number | null>(null);
  const startAnim = useCallback(() => {
    const step = () => {
      const active = hoverRef.current ?? selIdxRef.current;
      const { hoverT, dimT, visT } = animRef.current;
      const cut = visibleUntilRef.current;
      const neigh = new Set<number>();
      if (active != null) { neigh.add(active); for (const e of visibleEdges) { if (e.a === active) neigh.add(e.b); if (e.b === active) neigh.add(e.a); } }
      let moving = false;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const dx = n.x - n.cx, dy = n.y - n.cy;
        if (Math.abs(dx) + Math.abs(dy) > 0.4) { n.cx += dx * 0.18; n.cy += dy * 0.18; moving = true; } else { n.cx = n.x; n.cy = n.y; }
        const th = i === active ? 1 : 0;
        const dh = th - (hoverT[i] ?? 0);
        if (Math.abs(dh) > 0.01) { hoverT[i] = (hoverT[i] ?? 0) + dh * 0.22; moving = true; } else hoverT[i] = th;
        const td = active != null && !neigh.has(i) ? 1 : 0;
        const dd = td - (dimT[i] ?? 0);
        if (Math.abs(dd) > 0.01) { dimT[i] = (dimT[i] ?? 0) + dd * 0.18; moving = true; } else dimT[i] = td;
        // Timeline visibility — newer-than-cutoff nodes fade out; they fade back in as time advances.
        const tv = cut == null || n.ts <= cut ? 1 : 0;
        const dv = tv - (visT[i] ?? 1);
        if (Math.abs(dv) > 0.01) { visT[i] = (visT[i] ?? 1) + dv * 0.25; moving = true; } else visT[i] = tv;
      }
      drawRef.current();
      rafRef.current = moving ? requestAnimationFrame(step) : null;
    };
    // Self-healing kick: cancel any in-flight (or stale-cancelled) frame, then start
    // fresh. A bare `if (rafRef.current != null) return` guard jams permanently under
    // React StrictMode — the mount effect schedules a frame, the dev double-invoke
    // cancels it but leaves rafRef non-null, so every later kick early-returns and the
    // loop (hover pop, dim fade, TIMELINE visibility) never runs, while search still
    // works via the reseed+redraw path. Cancel+reschedule keeps exactly one live loop.
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [nodes, visibleEdges]);
  const startAnimRef = useRef(startAnim); startAnimRef.current = startAnim;

  // Kick the animation on hover / selection / edge-toggle / timeline changes.
  useEffect(() => { startAnimRef.current(); }, [hover, selectedIndex, visibleEdges, visibleUntil]);
  // Tooltip only appears after a short dwell on one node; moving resets the timer.
  useEffect(() => {
    if (hover == null) { setTipIdx(null); return; }
    const t = window.setTimeout(() => setTipIdx(hover), 500);
    return () => window.clearTimeout(t);
  }, [hover]);
  // Cancel any in-flight frame on unmount.
  useEffect(() => () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } }, []);

  // redraw on React state changes (hover / selection / new data)
  useEffect(() => { draw(); }, [draw]);
  // fit whenever the graph changes
  useEffect(() => { fit(); }, [fit]);

  // Native, non-passive wheel. PINCH zooms; a plain scroll is left alone so it
  // scrolls the page.
  //
  // The canvas is tall enough that the memory list sits below the fold, so
  // swallowing every wheel event to zoom made the page feel stuck — you had to
  // find a gap beside the graph to scroll past it. A trackpad pinch arrives as
  // a wheel event with ctrlKey set (and ctrl/⌘+wheel is the same gesture on a
  // mouse), which separates the two cleanly. preventDefault is still required
  // on the zoom path, otherwise the browser zooms the whole page instead.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Fullscreen has nothing behind it to scroll, so a plain wheel zooms
      // there — the reason to yield the gesture only exists inline.
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && !expandedRef.current) return; // plain scroll → scroll the panel
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const v = viewRef.current;
      // Pinch produces much smaller deltas than a wheel notch, so it needs a
      // larger coefficient to feel 1:1; a real wheel keeps the old rate.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
      const ns = clamp(v.scale * factor, 0.05, 6);
      const wx = (mx - v.ox) / v.scale, wy = (my - v.oy) / v.scale;
      v.ox = mx - wx * ns; v.oy = my - wy * ns; v.scale = ns;
      drawRef.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // refit on container resize
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit]);

  const worldFromEvent = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
  };
  const hitTest = (clientX: number, clientY: number): number | null => {
    const { x, y } = worldFromEvent(clientX, clientY);
    const cut = visibleUntilRef.current;
    let best: number | null = null, bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (cut != null && n.ts > cut) continue; // hidden by the timeline — not interactive
      const d = Math.hypot(n.cx - x, n.cy - y);
      const r = (nodeRadius(n) + 8) / viewRef.current.scale;
      if (d < r && d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  // Hover tooltip anchor — the hovered node's on-screen position. viewRef is the
  // live pan/zoom transform, read at render (hover changes trigger the render).
  const hv = viewRef.current;
  // Tooltip follows the DWELL node (tipIdx, set after ~1s), anchored at its
  // current animated position.
  const hoveredNode = tipIdx != null ? nodes[tipIdx] ?? null : null;
  const hoveredMem = hoveredNode ? idToMemory.get(hoveredNode.id) ?? null : null;
  const tipX = hoveredNode ? hoveredNode.cx * hv.scale + hv.ox : 0;
  const tipY = hoveredNode ? hoveredNode.cy * hv.scale + hv.oy : 0;

  return (
    <div className="relative h-full w-full">
      <div
        ref={wrapRef}
        className="h-full w-full cursor-grab overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface active:cursor-grabbing"
        onMouseDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY, moved: false }; }}
        onMouseMove={(e) => {
          const d = dragRef.current;
          if (d) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            viewRef.current.ox += dx; viewRef.current.oy += dy;
            d.x = e.clientX; d.y = e.clientY;
            drawRef.current();
          } else {
            const h = hitTest(e.clientX, e.clientY);
            if (h !== hover) setHover(h);
          }
        }}
        onMouseUp={(e) => {
          const d = dragRef.current; dragRef.current = null;
          if (d && !d.moved) { const h = hitTest(e.clientX, e.clientY); onSelect(h != null ? nodes[h]!.id : null); }
        }}
        onMouseLeave={() => { dragRef.current = null; if (hover !== null) setHover(null); }}
      >
        <canvas ref={canvasRef} />
      </div>

      {/* Subsystem colour legend — only the buckets actually present. */}
      {showLegends && presentSubsystems.length > 0 && (
        <div className="pointer-events-none absolute left-[12px] top-[10px] flex max-w-[56%] flex-wrap gap-x-[10px] gap-y-[3px]">
          {presentSubsystems.map((s) => (
            <span key={s} className="flex items-center gap-[4px] font-mono text-[10px] text-xyne-fg-muted">
              <span className="h-[8px] w-[8px] rounded-full" style={{ background: SUBSYSTEM_COLOR[s] ?? DEFAULT_COLOR }} />
              {SUBSYSTEM_LABELS[s] ?? s}
            </span>
          ))}
        </div>
      )}

      {/* Hover tooltip — content + subsystem + category + date + entities. */}
      {hoveredNode && (
        <div
          className="pointer-events-none absolute z-20 w-[260px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[8px] shadow-lg"
          style={{
            left: clamp(tipX + 14, 8, (wrapRef.current?.clientWidth ?? 800) - 268),
            top: clamp(tipY - 12, 8, (wrapRef.current?.clientHeight ?? 500) - 132),
          }}
        >
          <p className="line-clamp-4 text-[12px] leading-[1.5] text-xyne-fg-primary">{hoveredNode.text}</p>
          <div className="mt-[6px] flex flex-wrap items-center gap-[6px] text-[10px] text-xyne-fg-tertiary">
            <span className="flex items-center gap-[4px] font-medium text-xyne-fg-secondary">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: SUBSYSTEM_COLOR[hoveredNode.subsystem] ?? DEFAULT_COLOR }} />
              {SUBSYSTEM_LABELS[hoveredNode.subsystem] ?? hoveredNode.subsystem}
            </span>
            {hoveredMem?.category && <span className="uppercase tracking-wide">{hoveredMem.category}</span>}
            <span>· {fmtDate(hoveredNode.ts)}</span>
          </div>
          {(entitiesById?.[hoveredNode.id]?.length ?? 0) > 0 && (
            <p className="mt-[5px] line-clamp-2 text-[10px] leading-[1.4] text-xyne-fg-tertiary">
              <span className="text-xyne-fg-muted">entities:</span> {entitiesById![hoveredNode.id]!.slice(0, 6).join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-[10px] left-[12px] font-mono text-[10px] text-xyne-fg-muted">
        {visibleUntil == null
          ? `${nodes.length} memories`
          : `${nodes.filter((n) => n.ts <= visibleUntil).length} of ${nodes.length} memories`}{" "}
        · {visibleEdges.length} links · {expanded ? "scroll" : "pinch"} zoom / drag pan / click details
      </div>
      {/* Edge-type legend doubles as toggles — click to show/hide a link type. */}
      <div className={`absolute bottom-[10px] right-[12px] flex items-center gap-[10px] font-mono text-[10px] ${showLegends ? "" : "hidden"}`}>
        {LINK_TYPES.map((t) => {
          const off = hiddenTypes.has(t);
          return (
            <button
              key={t}
              onClick={() =>
                setHiddenTypes((prev) => {
                  const next = new Set(prev);
                  if (next.has(t)) next.delete(t);
                  else next.add(t);
                  return next;
                })
              }
              title={off ? `Show ${LINK_LABEL[t]} links` : `Hide ${LINK_LABEL[t]} links`}
              className={`flex items-center gap-[4px] transition ${off ? "text-xyne-fg-muted opacity-40" : "text-xyne-fg-muted hover:text-xyne-fg-secondary"}`}
            >
              <span className="h-[8px] w-[16px] rounded-full" style={{ background: off ? "#c4c8d1" : LINK_COLOR[t] }} />
              {LINK_LABEL[t]}
            </button>
          );
        })}
      </div>
      <div className="absolute right-[12px] top-[10px] flex items-center gap-[6px]">
        {onToggleExpand && (
          <button
            onClick={onToggleExpand}
            className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[3px] text-[10px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
        <button
          onClick={fit}
          className="rounded-md border border-xyne-border bg-xyne-surface px-[8px] py-[3px] text-[10px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken"
        >
          Reset view
        </button>
      </div>
    </div>
  );
}
