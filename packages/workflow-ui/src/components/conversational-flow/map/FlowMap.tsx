/**
 * The conversation as a map: screens as cards, options as lines, laid out by
 * `layoutFlow` and never dragged. It reads left→right by default, or
 * top→bottom; the choice is the viewer's and is remembered, never saved in the
 * workflow. React Flow supplies the viewport — pan, pinch
 * and cursor-anchored zoom, fit, minimap — and nothing else; the picture is
 * always derived from the workflow config.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type BuiltInEdge,
} from '@xyflow/react';
import { ChevronsDownUp, ChevronsUpDown, Maximize, Minus, Network, Plus, Route } from 'lucide-react';
import { ancestorsOf, childrenOf, flowRouter, routerName, routersOf, scopeOf, type ConversationalFlow, type ScreenKind } from '@xyne/workflow-sdk/conversational-flow';
import { layoutFlow, type MapDirection } from './layout.js';
import { AddMenu, type AddChoice } from './AddMenu.js';
import { CallCard, type CallNode } from './CallCard.js';
import { ScreenCard, type ScreenNode } from './ScreenCard.js';
import { KIND } from '../ui.js';
import { readPref, writePref } from '../panel.js';

const nodeTypes = { screen: ScreenCard, call: CallCard };

function useDirection(): [MapDirection, (d: MapDirection) => void] {
  const [direction, setDirection] = useState<MapDirection>(() => (readPref('direction') === 'down' ? 'down' : 'right'));
  const set = useCallback((d: MapDirection) => {
    setDirection(d);
    writePref('direction', d);
  }, []);
  return [direction, set];
}

export interface FlowMapProps {
  flow: ConversationalFlow;
  folded: ReadonlySet<string>;
  selected: string | null;
  /** Screens the current Test run went through. */
  visited?: ReadonlySet<string>;
  canEdit: boolean;
  /** Bump `n` to bring `id` into view (e.g. after picking it from the path bar). */
  focus?: { id: string; n: number } | undefined;
  onSelect: (id: string | null) => void;
  onToggleFold: (id: string) => void;
  onFoldAll: () => void;
  onUnfoldAll: () => void;
  /** Put something new inside a screen: another screen, or something to look up. */
  onAdd: (parent: string, choice: AddChoice) => void;
  /** Copy a screen, beside it or inside it. */
  onDuplicate: (id: string, as: 'sibling' | 'child') => void;
  onSelectRouter: () => void;
}

/** The kinds with room for screens inside them. */
const holdsScreens = (screen: { kind: ScreenKind } | undefined): boolean => screen?.kind === 'menu';

export function FlowMap(props: FlowMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MapCanvas({
  flow,
  folded,
  selected,
  visited,
  canEdit,
  focus,
  onSelect,
  onToggleFold,
  onFoldAll,
  onUnfoldAll,
  onAdd,
  onDuplicate,
  onSelectRouter,
}: FlowMapProps) {
  const [direction, setDirection] = useDirection();
  const down = direction === 'down';
  // Which card's "+" is open. The menu is placed beside that card, in the map's
  // own pixels, so it stays put as the canvas is panned under it.
  const [adding, setAdding] = useState<string | null>(null);
  const onAddChild = useCallback((id: string) => setAdding(id), []);

  const layout = useMemo(() => layoutFlow(flow, folded, direction), [flow, folded, direction]);
  const byId = useMemo(() => new Map(flow.screens.map((s) => [s.id, s])), [flow]);
  const kids = useMemo(() => childrenOf(flow), [flow]);
  const endIds = useMemo(() => new Set(flow.screens.filter((s) => s.kind === 'end').map((s) => s.id)), [flow]);
  const path = useMemo(() => new Set(selected ? [selected, ...ancestorsOf(flow, selected)] : []), [flow, selected]);
  const titleOf = useCallback((id: string) => byId.get(id)?.title ?? id, [byId]);

  /** Section id → the router that keeps typed messages inside it. */
  const scopedSections = useMemo(() => {
    const out = new Map<string, string>();
    for (const router of routersOf(flow)) {
      const section = scopeOf(flow, router);
      if (section) out.set(section.id, router.id);
    }
    return out;
  }, [flow]);

  const nodes = useMemo<Array<ScreenNode | CallNode>>(
    () =>
      layout.cards.map((box) => {
        const node = layout.nodes.get(box.id);
        if (node?.kind === 'call') {
          return {
            id: box.id,
            type: 'call' as const,
            position: { x: box.x, y: box.y },
            width: box.w,
            height: box.h,
            draggable: false,
            connectable: false,
            // The card inside carries the name; labelling the wrapper too would
            // announce the lookup twice.
            data: {
              call: node.call,
              owner: node.owner.id,
              box,
              direction,
              selected: box.id === selected,
              onPath: path.has(node.owner.id),
              visited: visited?.has(node.owner.id) ?? false,
              onSelect,
            },
          } satisfies CallNode;
        }
        const screen = byId.get(box.id)!;
        // The endings drawn beneath a screen count as its children here, so the
        // card's handles, its "N beneath" and the lines all agree.
        const childIds = new Set([...(kids.get(box.id) ?? []), ...(layout.owned.get(box.id) ?? [])].map((c) => c.id));
        return {
          id: box.id,
          type: 'screen',
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          draggable: false,
          connectable: false,
          ariaLabel: `${KIND[screen.kind].label}: ${screen.title}`,
          data: {
            screen,
            box,
            direction,
            isRoot: box.id === flow.rootScreen,
            selected: box.id === selected,
            onPath: path.has(box.id) && box.id !== selected,
            visited: visited?.has(box.id) ?? false,
            folded: folded.has(box.id),
            childCount: childIds.size,
            titleOf,
            endIds,
            childIds,
            canEdit,
            onSelect,
            onToggleFold,
            keepsTyping: scopedSections.get(box.id),
            onAddChild,
            onDuplicate,
          },
        } satisfies ScreenNode;
      }),
    [layout, direction, byId, kids, flow.rootScreen, selected, path, visited, folded, titleOf, endIds, scopedSections, canEdit, onSelect, onToggleFold, onAddChild, onDuplicate],
  );

  const edges = useMemo<BuiltInEdge[]>(
    () =>
      layout.edges.map((e) => {
        const lit = path.has(e.to) && path.has(e.from);
        const walked = (visited?.has(e.from) ?? false) && (visited?.has(e.to) ?? false);
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: e.handle,
          // Read downwards, a parent and its children join like an org chart;
          // jumps across the tree stay curved so they read as something else.
          ...(down && e.kind === 'child' ? { type: 'smoothstep' as const, pathOptions: { borderRadius: 12 } } : { type: 'default' as const }),
          focusable: false,
          style: {
            stroke: lit ? 'var(--wui-primary)' : walked ? 'var(--wui-status-completed)' : 'var(--wui-border-strong)',
            strokeWidth: lit || walked ? 2 : 1.5,
            ...(e.kind === 'jump' ? { strokeDasharray: '5 5' } : {}),
          },
        };
      }),
    [layout, down, path, visited],
  );

  const { fitView, setCenter, getZoom, setViewport, flowToScreenPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  // Before the pane is measured the zoom can read NaN, which Math.max passes on.
  const zoomNow = useCallback(() => {
    const z = getZoom();
    return Number.isFinite(z) ? z : 0.85;
  }, [getZoom]);

  // Open readable, on the first screen — not fitted: a whole large flow fitted
  // into one view is too small to read. "Fit" in the controls gives the overview.
  const openOnRoot = useCallback(() => {
    const root = layout.cards.find((c) => c.id === flow.rootScreen);
    const width = wrapper.current?.clientWidth ?? 0;
    const height = wrapper.current?.clientHeight ?? 0;
    // Not laid out yet (or no room at all): nothing sensible to aim at.
    if (width === 0 || height === 0) return;
    if (!root) {
      void fitView({ padding: 0.12, maxZoom: 1 });
      return;
    }
    const zoom = 0.85;
    const margin = 56;
    void setViewport(
      down
        ? { x: width / 2 - (root.x + root.w / 2) * zoom, y: margin + 24 - root.y * zoom, zoom }
        : { x: margin - root.x * zoom, y: height / 2 - (root.y + root.h / 2) * zoom, zoom },
    );
  }, [layout, flow.rootScreen, down, fitView, setViewport]);

  // Turning the map keeps your place: the selected screen, or else the start.
  const turned = useRef(direction);
  useEffect(() => {
    if (turned.current === direction) return;
    turned.current = direction;
    const box = selected ? layout.cards.find((c) => c.id === selected) : undefined;
    if (box) void setCenter(box.x + box.w / 2, box.y + box.h / 2, { zoom: zoomNow(), duration: 250 });
    else openOnRoot();
  }, [direction, layout, selected, setCenter, zoomNow, openOnRoot]);

  useEffect(() => {
    if (!focus) return;
    const box = layout.cards.find((c) => c.id === focus.id);
    if (box) void setCenter(box.x + box.w / 2, box.y + box.h / 2, { zoom: Math.max(zoomNow(), 0.8), duration: 300 });
    // Only a new request moves the view — not every re-layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const router = flowRouter(flow);
  const scoped = routersOf(flow).filter((r) => scopeOf(flow, r) !== undefined);

  return (
    <div ref={wrapper} className="relative h-full w-full" style={{ background: 'var(--wui-cf-canvas)' }}>
      {adding !== null && (() => {
        const box = layout.cards.find((c) => c.id === adding);
        const rect = wrapper.current?.getBoundingClientRect();
        if (!box || !rect) return null;
        const corner = flowToScreenPosition({ x: box.x + (down ? 0 : box.w + 12), y: box.y + (down ? box.h + 12 : 0) });
        return (
          <AddMenu
            parentTitle={byId.get(adding)?.title ?? adding}
            canHoldScreens={holdsScreens(byId.get(adding))}
            isFirstScreen={adding === flow.rootScreen}
            at={{ x: corner.x - rect.left, y: corner.y - rect.top }}
            onPick={(choice) => {
              setAdding(null);
              onAdd(adding, choice);
            }}
            onClose={() => setAdding(null)}
          />
        );
      })()}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onInit={openOnRoot}
        minZoom={0.15}
        maxZoom={1.6}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--wui-cf-dot)" />

        {router && (
          <Panel position="top-left" className="!m-3">
            <button
              type="button"
              onClick={onSelectRouter}
              className="flex max-w-[420px] items-start gap-2.5 rounded-[12px] border border-dashed bg-[var(--wui-surface,var(--wui-bg))] px-3.5 py-2.5 text-left shadow-[var(--wui-shadow)] transition-shadow hover:shadow-[var(--wui-shadow-md)]"
              style={{ borderColor: 'color-mix(in srgb, var(--wui-cf-ai) 55%, transparent)' }}
            >
              <Route className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--wui-cf-ai)' }} aria-hidden />
              <span className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-[var(--wui-fg)]">If they type instead of tapping</span>
                <span className="text-[12px] leading-snug text-[var(--wui-fg-muted)]">
                  <span className="font-mono">{routerName(flow, router)}</span> opens the screen that fits.
                  {scoped.length > 0 && (
                    <span className="mt-0.5 block">
                      {scoped.length === 1 ? '1 section keeps' : `${String(scoped.length)} sections keep`} typing inside{' '}
                      {scoped.length === 1 ? 'it' : 'them'}.
                    </span>
                  )}
                </span>
              </span>
            </button>
          </Panel>
        )}

        <Panel position="bottom-right" className="!m-3">
          <MapControls
            direction={direction}
            onDirection={setDirection}
            onFit={() => void fitView({ padding: 0.12, maxZoom: 1, duration: 300 })}
            onFoldAll={onFoldAll}
            onUnfoldAll={onUnfoldAll}
          />
        </Panel>

        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          ariaLabel="Overview of the whole flow"
          nodeColor={(n) => KIND[byId.get(n.id)?.kind ?? 'custom'].color}
          nodeStrokeWidth={0}
          maskColor="color-mix(in srgb, var(--wui-bg) 70%, transparent)"
          style={{ width: 168, height: 112, background: 'var(--wui-surface, var(--wui-bg))' }}
        />
      </ReactFlow>
    </div>
  );
}

function MapControls({
  direction,
  onDirection,
  onFit,
  onFoldAll,
  onUnfoldAll,
}: {
  direction: MapDirection;
  onDirection: (d: MapDirection) => void;
  onFit: () => void;
  onFoldAll: () => void;
  onUnfoldAll: () => void;
}) {
  const { zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();
  const btn =
    'grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--wui-primary)]';
  return (
    <div className="flex items-center gap-0.5 rounded-[12px] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] p-1 text-[12px] shadow-[var(--wui-shadow)]">
      <div role="group" aria-label="Direction" className="flex items-center gap-0.5 rounded-lg bg-[var(--wui-bg-muted)] p-0.5">
        {(
          [
            ['right', 'Left to right', -90],
            ['down', 'Top to bottom', 0],
          ] as const
        ).map(([d, label, turn]) => {
          const on = direction === d;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={label}
              title={label}
              onClick={() => onDirection(d)}
              className="grid h-7 w-7 place-items-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--wui-primary)]"
              style={
                on
                  ? { background: 'var(--wui-surface, var(--wui-bg))', color: 'var(--wui-fg)', boxShadow: '0 1px 2px rgba(15,23,42,0.12)' }
                  : { color: 'var(--wui-fg-muted)' }
              }
            >
              <Network className="h-3.5 w-3.5" style={{ transform: `rotate(${turn}deg)` }} aria-hidden />
            </button>
          );
        })}
      </div>
      <span className="mx-1 h-5 w-px bg-[var(--wui-border)]" aria-hidden />
      <button type="button" className={btn} aria-label="Zoom out" onClick={() => void zoomOut({ duration: 150 })}><Minus className="h-3.5 w-3.5" /></button>
      <span className="w-11 text-center tabular-nums text-[var(--wui-fg)]" aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" className={btn} aria-label="Zoom in" onClick={() => void zoomIn({ duration: 150 })}><Plus className="h-3.5 w-3.5" /></button>
      <span className="mx-1 h-5 w-px bg-[var(--wui-border)]" aria-hidden />
      <button type="button" className={btn} title="Fit the whole flow" aria-label="Fit the whole flow" onClick={onFit}><Maximize className="h-3.5 w-3.5" /></button>
      <button type="button" className={btn} title="Fold everything" aria-label="Fold everything" onClick={onFoldAll}><ChevronsDownUp className="h-3.5 w-3.5" /></button>
      <button type="button" className={btn} title="Unfold everything" aria-label="Unfold everything" onClick={onUnfoldAll}><ChevronsUpDown className="h-3.5 w-3.5" /></button>
    </div>
  );
}
