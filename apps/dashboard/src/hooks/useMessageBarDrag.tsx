import React from 'react';
import { motion, useMotionTemplate, useTransform } from 'framer-motion';
import { messageActionsStore } from './barItems';
import { MAX_MESSAGE_BAR_ACTIONS } from '../constants/settings';
import { DRAG_EASE_OUT } from '../constants/drag';
import {
  BAR_DROP_REACH,
  BAR_HIDE_SCALE,
  BAR_MAX_TILT,
  BAR_TILE_GLYPH_INSET,
  BAR_TILE_LIFT,
  BAR_TILE_SIZE,
} from '../constants/messageBar';
import { isMessageBarActionId } from '../utils/messageBar';
import { cloneChildren, lerp, setTranslate, within } from '../utils/drag';
import {
  useClonedNodes,
  useDockDrag,
  type DockDrop,
  type DockFaceProps,
  type DockSession,
} from './useDockDrag';

interface BarSession extends DockSession {
  labelX: number;
}

const commitDrop = (drop: DockDrop): void => {
  const stored = messageActionsStore.get();
  if (drop.kind === 'move') {
    messageActionsStore.move(stored.indexOf(drop.id), stored.indexOf(drop.target));
    return;
  }
  if (drop.kind === 'add') {
    const at = drop.before ? stored.indexOf(drop.before) : -1;
    messageActionsStore.add(drop.id, at === -1 ? undefined : at);
    return;
  }
  messageActionsStore.remove(drop.id);
};

const BarFace: React.FC<DockFaceProps<BarSession>> = ({ session, values }) => {
  const glyphX = useTransform(
    [values.morph, values.rowGlyphX, values.tileGlyphX],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const glyphY = useTransform(
    [values.morph, values.rowGlyphY, values.tileGlyphY],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const labelOpacity = useTransform(values.morph, [0, 0.5], [1, 0]);
  const glyphTransform = useMotionTemplate`translate3d(${glyphX}px, ${glyphY}px, 0)`;
  const glyphRef = useClonedNodes<HTMLSpanElement>(session.glyph);
  return (
    <>
      <div className='absolute inset-0 rounded-md border border-border bg-popover' />
      <div className='absolute inset-0 overflow-hidden rounded-md'>
        <motion.span
          className='absolute top-0 flex h-full items-center whitespace-nowrap text-sm text-popover-foreground'
          style={{ left: session.labelX, opacity: labelOpacity }}
        >
          {session.label}
        </motion.span>
      </div>
      <motion.span
        ref={glyphRef}
        className='absolute left-0 top-0 flex size-4 items-center justify-center text-muted-foreground'
        style={{ transform: glyphTransform }}
      />
    </>
  );
};

export interface MessageBarDrag {
  barRef: React.RefObject<HTMLDivElement | null>;
  startBarPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startMenuPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  layer: React.ReactNode;
}

export const useMessageBarDrag = ({
  onActiveChange,
}: {
  onActiveChange: (active: boolean) => void;
}): MessageBarDrag => {
  const barRef = React.useRef<HTMLDivElement>(null);
  const extrasRef = React.useRef<{ lead: HTMLElement | null; chrome: HTMLElement | null }>({
    lead: null,
    chrome: null,
  });
  const moreOf = (): HTMLElement | null =>
    barRef.current?.querySelector<HTMLElement>('[data-bar-more]') ?? null;

  const drag = useDockDrag<BarSession>({
    axis: 'x',
    anchor: 'end',
    socketAttr: 'data-bar-socket',
    tiles: () =>
      Array.from(
        barRef.current?.querySelectorAll<HTMLElement>(':scope > [data-bar-tile]') ?? [],
      ).map(element => ({ id: element.dataset['barId'] ?? '', element })),
    dock: () => barRef.current,
    button: moreOf,
    panel: (origin, source) => {
      if (origin === 'panel') return source.closest<HTMLElement>('[role="menu"]');
      const menuId = moreOf()?.getAttribute('aria-controls');
      return menuId ? document.getElementById(menuId) : null;
    },
    slot: (id, panel) =>
      panel?.querySelector<HTMLElement>(`[data-bar-slot="${CSS.escape(id)}"]`) ?? null,
    ghost: () => barRef.current?.querySelector<HTMLElement>(':scope > [data-bar-gap]') ?? null,
    lift: ({ origin, source, panel }) => {
      const sample =
        origin === 'panel'
          ? source
          : (panel?.querySelector('[data-bar-text]')?.closest<HTMLElement>('[role="menuitem"]') ??
            null);
      const rowRect = sample?.getBoundingClientRect() ?? null;
      const rowGlyph = sample?.querySelector('[data-bar-glyph]')?.getBoundingClientRect();
      const rowText = sample?.querySelector('[data-bar-text]')?.getBoundingClientRect();
      return {
        geometry: {
          tileWidth: BAR_TILE_SIZE,
          tileHeight: BAR_TILE_SIZE,
          rowWidth: rowRect?.width ?? BAR_TILE_SIZE,
          rowHeight: rowRect?.height ?? BAR_TILE_SIZE,
          tileGlyphX: BAR_TILE_GLYPH_INSET,
          tileGlyphY: BAR_TILE_GLYPH_INSET,
          rowGlyphX: rowGlyph && rowRect ? rowGlyph.left - rowRect.left : BAR_TILE_GLYPH_INSET,
          rowGlyphY: rowGlyph && rowRect ? rowGlyph.top - rowRect.top : BAR_TILE_GLYPH_INSET,
        },
        face: {
          label: source.dataset['barLabel'] ?? '',
          labelX: rowText && rowRect ? rowText.left - rowRect.left : 0,
          glyph: cloneChildren(source.querySelector('[data-bar-glyph]')),
        },
      };
    },
    hideRule: () => ({ hint: 'Move to More' }),
    canAdd: () =>
      messageActionsStore.get().filter(isMessageBarActionId).length < MAX_MESSAGE_BAR_ACTIONS,
    refuseAdd: 'Bar is full',
    inDock: (x, y, rect, origin) =>
      origin === 'dock'
        ? y >= rect.top - BAR_DROP_REACH && y <= rect.bottom + BAR_DROP_REACH
        : within(rect, x, y, BAR_DROP_REACH),
    onDrop: commitDrop,
    onActiveChange,
    onBegin: (origin, source, shiftMs) => {
      const bar = barRef.current;
      const lead = bar?.querySelector<HTMLElement>(':scope > [data-bar-lead]') ?? null;
      const chrome = bar?.querySelector<HTMLElement>(':scope > [data-bar-chrome]') ?? null;
      extrasRef.current = { lead, chrome };
      if (lead) lead.style.transition = `transform ${shiftMs}ms ${DRAG_EASE_OUT}`;
      if (chrome) chrome.style.transition = `left ${shiftMs}ms ${DRAG_EASE_OUT}`;
      if (origin === 'panel') source.style.backgroundColor = 'transparent';
    },
    onExtent: delta => {
      const { lead, chrome } = extrasRef.current;
      setTranslate(lead, 'x', delta);
      if (chrome) chrome.style.left = delta ? `${delta - 1}px` : '';
    },
    onReset: () => {
      const { lead, chrome } = extrasRef.current;
      [lead, chrome].forEach(element => {
        if (!element) return;
        element.style.transition = '';
        element.style.transform = '';
        element.style.left = '';
      });
    },
    feel: {
      tileLift: BAR_TILE_LIFT,
      hideScale: BAR_HIDE_SCALE,
      buttonPad: 6,
      rowGrab: 'center',
    },
    chip: { maxTilt: BAR_MAX_TILT, hint: 'aboveEnd', shapeClass: 'rounded-md', Face: BarFace },
  });

  return {
    barRef,
    startBarPress: drag.startDockPress,
    startMenuPress: drag.startPanelPress,
    layer: drag.layer,
  };
};
