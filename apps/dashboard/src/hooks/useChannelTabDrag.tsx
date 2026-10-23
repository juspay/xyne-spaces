import React from 'react';
import { motion, useTransform } from 'framer-motion';
import {
  TAB_DROP_REACH,
  TAB_HEIGHT,
  TAB_HIDE_SCALE,
  TAB_LIFT,
  TAB_MAX_TILT,
  TAB_RADIUS,
  TAB_ROW_RADIUS,
} from '../constants/channelTabs';
import { cloneChildren, lerp, type ValueStore } from '../utils/drag';
import {
  useClonedNodes,
  useDockDrag,
  useDockSlot,
  type DockFaceProps,
  type DockSession,
} from './useDockDrag';

export type ChannelTabDrop =
  | { kind: 'move'; id: string; target: string }
  | { kind: 'add'; id: string; before: string | null }
  | { kind: 'remove'; id: string };

export interface ChannelTabDragSession extends DockSession {
  badge: Node[];
}

const measureTab = (sample: HTMLElement, label: string, glyph: Node[]): number => {
  const face = sample.querySelector<HTMLElement>('[data-tab-face]');
  if (!face) return sample.getBoundingClientRect().width;
  const clone = face.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  const text = clone.querySelector('[data-tab-text]');
  if (text) text.textContent = label;
  clone
    .querySelector('[data-tab-glyph]')
    ?.replaceChildren(...glyph.map(node => node.cloneNode(true)));
  clone.style.position = 'absolute';
  clone.style.visibility = 'hidden';
  clone.style.left = '0';
  clone.style.top = '0';
  sample.parentElement?.appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  clone.remove();
  return width;
};

const TabFace: React.FC<DockFaceProps<ChannelTabDragSession>> = ({ session, values }) => {
  const radius = useTransform(values.morph, m => lerp(TAB_ROW_RADIUS, TAB_RADIUS, m));
  const rowLabelOpacity = useTransform(values.morph, m => 1 - m);
  const glyphRef = useClonedNodes<HTMLSpanElement>(session.glyph);
  const badgeRef = useClonedNodes<HTMLSpanElement>(session.badge);
  return (
    <>
      <motion.div
        className='absolute inset-0 border border-border bg-popover'
        style={{ borderRadius: radius }}
      />
      <motion.div
        className='absolute inset-0 flex items-center gap-2 overflow-hidden whitespace-nowrap px-2.5 text-sm text-foreground'
        style={{ borderRadius: radius }}
      >
        <span ref={glyphRef} className='flex shrink-0 items-center' />
        <span className='relative'>
          <motion.span className='font-medium tracking-[-0.28px]' style={{ opacity: values.morph }}>
            {session.label}
          </motion.span>
          <motion.span className='absolute left-0 top-0' style={{ opacity: rowLabelOpacity }}>
            {session.label}
          </motion.span>
        </span>
        {session.badge.length > 0 && (
          <span ref={badgeRef} className='flex shrink-0 items-center text-muted-foreground' />
        )}
      </motion.div>
    </>
  );
};

export interface ChannelTabDrag {
  listRef: React.RefObject<HTMLDivElement | null>;
  addRef: React.RefObject<HTMLSpanElement | null>;
  gapRef: React.RefObject<HTMLSpanElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  startTabPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startRowPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  flyIn: (id: string, row: HTMLElement, commit: () => void) => void;
  cancel: () => void;
  session: ValueStore<ChannelTabDragSession>;
  layer: React.ReactNode;
}

export const usePanelSlot = (session: ValueStore<ChannelTabDragSession>): number | null =>
  useDockSlot(session);

export const useChannelTabDrag = ({
  hideHint,
  slotFor,
  onDrop,
}: {
  hideHint: (id: string) => string | null;
  slotFor: (id: string) => number | null;
  onDrop: (drop: ChannelTabDrop) => void;
}): ChannelTabDrag => {
  const listRef = React.useRef<HTMLDivElement>(null);
  const addRef = React.useRef<HTMLSpanElement>(null);
  const gapRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const drag = useDockDrag<ChannelTabDragSession>({
    axis: 'x',
    anchor: 'start',
    socketAttr: 'data-bar-socket',
    tiles: () =>
      Array.from(
        listRef.current?.querySelectorAll<HTMLElement>(':scope > [data-tab-tile]') ?? [],
      ).map(element => ({ id: element.dataset['tabId'] ?? '', element })),
    dock: () => listRef.current,
    button: () => addRef.current,
    panel: () => panelRef.current?.closest<HTMLElement>('[data-slot="popover-content"]') ?? null,
    slot: () => panelRef.current?.querySelector<HTMLElement>('[data-tab-slot]') ?? null,
    empty: () => panelRef.current?.querySelector<HTMLElement>('[data-tab-empty]') ?? null,
    ghost: () => gapRef.current,
    lift: ({ origin, source, sourceRect, tiles }) => {
      const label = source.dataset['tabLabel'] ?? '';
      const glyph = cloneChildren(source.querySelector('[data-tab-glyph]'));
      const badge = origin === 'dock' ? source.querySelector('[data-tab-badge]') : null;
      const sample = tiles.find(tile => !tile.querySelector('[data-tab-badge]')) ?? tiles[0];
      const width =
        origin === 'dock' || !sample ? sourceRect.width : measureTab(sample, label, glyph);
      const panel = panelRef.current?.getBoundingClientRect();
      return {
        geometry: {
          tileWidth: width,
          tileHeight: TAB_HEIGHT,
          rowWidth: origin === 'dock' ? (panel?.width ?? sourceRect.width) : sourceRect.width,
          rowHeight: TAB_HEIGHT,
          tileGlyphX: 0,
          tileGlyphY: 0,
          rowGlyphX: 0,
          rowGlyphY: 0,
          panelLeft: panel?.left ?? 0,
        },
        face: { label, glyph, badge: badge ? [badge.cloneNode(true)] : [] },
      };
    },
    hideRule: (id, source) => {
      const hint = hideHint(id);
      return hint === null
        ? { refuse: `${source.dataset['tabLabel'] ?? ''} can’t be hidden` }
        : { hint };
    },
    slotFor,
    inDock: (_x, y, rect) => y >= rect.top - TAB_DROP_REACH && y <= rect.bottom + TAB_DROP_REACH,
    isLastRow: row =>
      !row.previousElementSibling?.matches('[data-tab-row]') &&
      !row.nextElementSibling?.matches('[data-tab-row]'),
    onDrop,
    feel: {
      tileLift: TAB_LIFT,
      hideScale: TAB_HIDE_SCALE,
      buttonPad: 2,
      rowGrab: 'proportional',
      snapDock: true,
      snapPanel: true,
    },
    chip: {
      maxTilt: TAB_MAX_TILT,
      hint: 'above',
      radius: [TAB_ROW_RADIUS, TAB_RADIUS],
      Face: TabFace,
    },
  });

  return {
    listRef,
    addRef,
    gapRef,
    panelRef,
    startTabPress: drag.startDockPress,
    startRowPress: drag.startPanelPress,
    flyIn: drag.flyIn,
    cancel: drag.cancel,
    session: drag.session,
    layer: drag.layer,
  };
};
