import React from 'react';
import { motion, useMotionTemplate, useTransform } from 'framer-motion';
import { cn } from '../utils/classNames';
import { cloneChildren, lerp, type ValueStore } from '../utils/drag';
import {
  useClonedNodes,
  useDockDrag,
  useDockSlot,
  type DockFaceProps,
  type DockSession,
} from './useDockDrag';

const TILE = 32;
const ROW_HEIGHT = 36;
const ROW_WIDTH = 232;
const ROW_GLYPH_X = 4;
const ROW_GLYPH_Y = 2;
const TILE_LIFT = 1.05;
const HIDE_SCALE = 0.94;
const MAX_TILT = 6;
const RAIL_REACH = 72;
const EDGE_ZONE = 40;
const EDGE_SPEED = 12;

export type RailDrop =
  | { kind: 'move'; id: string; to: number }
  | { kind: 'add'; id: string; at: number }
  | { kind: 'remove'; id: string };

export const preventNativeDrag = (event: React.DragEvent): void => event.preventDefault();

const RailFace: React.FC<DockFaceProps<DockSession>> = ({ session, values }) => {
  const glyphX = useTransform(
    [values.morph, values.rowGlyphX, values.tileGlyphX],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const glyphY = useTransform(
    [values.morph, values.rowGlyphY, values.tileGlyphY],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const rowOpacity = useTransform(values.morph, m => 1 - m);
  const labelOpacity = useTransform(values.morph, [0, 0.5], [1, 0]);
  const glyphTransform = useMotionTemplate`translate3d(${glyphX}px, ${glyphY}px, 0)`;
  const glyphRef = useClonedNodes<HTMLDivElement>(session.glyph);
  return (
    <>
      <motion.div
        className='absolute inset-0 rounded-lg border border-border bg-popover'
        style={{ opacity: rowOpacity }}
      />
      <motion.div
        className='absolute inset-0 rounded-lg border border-sidebar-border bg-sidebar-accent'
        style={{ opacity: values.morph }}
      />
      <div className='absolute inset-0 overflow-hidden rounded-lg'>
        <motion.span
          className='absolute left-[42px] top-0 flex h-9 items-center whitespace-nowrap text-sm text-popover-foreground'
          style={{ opacity: labelOpacity }}
        >
          {session.label}
        </motion.span>
      </div>
      <motion.div
        ref={glyphRef}
        className={cn(
          'absolute left-0 top-0 flex size-8 items-center justify-center text-[11px] font-semibold',
          session.origin === 'dock' ? 'text-sidebar-accent-foreground' : 'text-popover-foreground',
        )}
        style={{ transform: glyphTransform }}
      />
    </>
  );
};

export interface RailDrag {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  moreRef: React.RefObject<HTMLLIElement | null>;
  gapRef: React.RefObject<HTMLLIElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  tileRef: (id: string) => (node: HTMLLIElement | null) => void;
  startRailPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startMorePress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  session: ValueStore<DockSession>;
  layer: React.ReactNode;
}

export const useMoreSlot = (session: ValueStore<DockSession>): number | null =>
  useDockSlot(session);

export const useRailDrag = ({
  ids,
  canHide,
  moreSlotFor,
  onDrop,
}: {
  ids: string[];
  canHide: (id: string) => boolean;
  moreSlotFor: (id: string) => number;
  onDrop: (drop: RailDrop) => void;
}): RailDrag => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLLIElement>(null);
  const gapRef = React.useRef<HTMLLIElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const tilesRef = React.useRef(new Map<string, HTMLLIElement>());
  const refCallbacks = React.useRef(new Map<string, (node: HTMLLIElement | null) => void>());

  const tileRef = React.useCallback((id: string) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (node: HTMLLIElement | null): void => {
        if (node) tilesRef.current.set(id, node);
        else tilesRef.current.delete(id);
      };
      refCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  const drag = useDockDrag<DockSession>({
    axis: 'y',
    anchor: 'start',
    socketAttr: 'data-rail-socket',
    tiles: () =>
      ids.flatMap(id => {
        const element = tilesRef.current.get(id);
        return element ? [{ id, element }] : [];
      }),
    dock: () => scrollRef.current ?? moreRef.current?.parentElement ?? null,
    button: () => moreRef.current,
    panel: () =>
      panelRef.current?.closest<HTMLElement>('[data-slot="popover-content"]') ?? panelRef.current,
    slot: () => panelRef.current?.querySelector<HTMLElement>('[data-more-slot]') ?? null,
    ghost: () => gapRef.current,
    scroller: () => scrollRef.current,
    autoScroll: { zone: EDGE_ZONE, speed: EDGE_SPEED },
    lift: ({ origin, source, sourceRect, panel }) => ({
      geometry: {
        tileWidth: TILE,
        tileHeight: TILE,
        rowWidth:
          origin === 'panel'
            ? sourceRect.width
            : (panel?.querySelector('[data-more-row]')?.getBoundingClientRect().width ?? ROW_WIDTH),
        rowHeight: ROW_HEIGHT,
        tileGlyphX: 0,
        tileGlyphY: 0,
        rowGlyphX: ROW_GLYPH_X,
        rowGlyphY: ROW_GLYPH_Y,
      },
      face: {
        label: source.dataset['railLabel'] ?? '',
        glyph: cloneChildren(source.querySelector('[data-rail-glyph]')),
      },
    }),
    hideRule: id => (canHide(id) ? { hint: 'Move to More' } : null),
    slotFor: moreSlotFor,
    inDock: (x, y, rect) =>
      x <= rect.right + RAIL_REACH && y >= rect.top - TILE && y <= rect.bottom + TILE,
    ids,
    onDrop: drop => {
      if (drop.kind === 'move') onDrop({ kind: 'move', id: drop.id, to: drop.index });
      else if (drop.kind === 'add') onDrop({ kind: 'add', id: drop.id, at: drop.index });
      else onDrop(drop);
    },
    feel: { tileLift: TILE_LIFT, hideScale: HIDE_SCALE, buttonPad: 6, rowGrab: 'center' },
    chip: { maxTilt: MAX_TILT, hint: 'right', shapeClass: 'rounded-lg', Face: RailFace },
  });

  return {
    scrollRef,
    moreRef,
    gapRef,
    panelRef,
    tileRef,
    startRailPress: drag.startDockPress,
    startMorePress: drag.startPanelPress,
    session: drag.session,
    layer: drag.layer,
  };
};
