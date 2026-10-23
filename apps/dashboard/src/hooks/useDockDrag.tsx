import React from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  animate,
  motion,
  motionValue,
  useMotionTemplate,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'framer-motion';
import {
  DRAG_ABSORB_SCALE,
  DRAG_ABSORB_SPRING,
  DRAG_EASE_OUT,
  DRAG_EASE_OUT_CURVE,
  DRAG_FLY_SPRING,
  DRAG_HINT_CLASS,
  DRAG_LANDING_SPRING,
  DRAG_LIFTED_SHADOW_CLASS,
  DRAG_MORPH_SPRING,
  DRAG_REDUCED_SHIFT_MS,
  DRAG_ROW_LIFT,
  DRAG_SCALE_SPRING,
  DRAG_SHIFT_MS,
  DRAG_SNAP_SPRING,
  DRAG_TILT_SPRING,
  DRAG_TILT_VELOCITY,
} from '../constants/drag';
import {
  contentOf,
  createValueStore,
  edgeScroll,
  endOf,
  lerp,
  scrollOf,
  setTranslate,
  sizeOf,
  socketOf,
  startOf,
  within,
  type DragAxis,
  type ValueStore,
} from '../utils/drag';
import { usePointerDrag, type PointerSession } from './usePointerDrag';

export type DockOrigin = 'dock' | 'panel';

export type DockIntent =
  | { kind: 'none' }
  | { kind: 'dock'; index: number }
  | { kind: 'hide'; via: 'button' | 'panel' }
  | { kind: 'refuse'; message: string };

export type DockDrop =
  | { kind: 'move'; id: string; index: number; target: string }
  | { kind: 'add'; id: string; index: number; before: string | null }
  | { kind: 'remove'; id: string };

export interface DockSession {
  origin: DockOrigin;
  label: string;
  glyph: Node[];
  slot: number | null;
}

export interface DockGeometry {
  tileWidth: number;
  tileHeight: number;
  rowWidth: number;
  rowHeight: number;
  tileGlyphX: number;
  tileGlyphY: number;
  rowGlyphX: number;
  rowGlyphY: number;
  panelLeft?: number;
}

export interface DockValues {
  px: MotionValue<number>;
  py: MotionValue<number>;
  morph: MotionValue<number>;
  scale: MotionValue<number>;
  shadow: MotionValue<number>;
  opacity: MotionValue<number>;
  hint: MotionValue<number>;
  tileWidth: MotionValue<number>;
  tileHeight: MotionValue<number>;
  rowWidth: MotionValue<number>;
  rowHeight: MotionValue<number>;
  tileGrabX: MotionValue<number>;
  tileGrabY: MotionValue<number>;
  rowGrabX: MotionValue<number>;
  rowGrabY: MotionValue<number>;
  tileGlyphX: MotionValue<number>;
  tileGlyphY: MotionValue<number>;
  rowGlyphX: MotionValue<number>;
  rowGlyphY: MotionValue<number>;
  snapX: MotionValue<number>;
  snapY: MotionValue<number>;
  snapLeft: MotionValue<number>;
  snapTop: MotionValue<number>;
}

export interface DockLiftContext {
  origin: DockOrigin;
  id: string;
  source: HTMLElement;
  sourceRect: DOMRect;
  panel: HTMLElement | null;
  tiles: HTMLElement[];
}

export type DockHideRule = { hint: string } | { refuse: string } | null;

export interface DockFaceProps<S extends DockSession> {
  session: S;
  values: DockValues;
}

export interface DockConfig<S extends DockSession> {
  axis: DragAxis;
  anchor: 'start' | 'end';
  socketAttr: string;
  tiles: () => Array<{ id: string; element: HTMLElement }>;
  dock: () => HTMLElement | null;
  button: () => HTMLElement | null;
  panel: (origin: DockOrigin, source: HTMLElement) => HTMLElement | null;
  slot: (id: string, panel: HTMLElement | null) => HTMLElement | null;
  ghost?: () => HTMLElement | null;
  empty?: () => HTMLElement | null;
  scroller?: () => HTMLElement | null;
  autoScroll?: { zone: number; speed: number };
  lift: (context: DockLiftContext) => { geometry: DockGeometry; face: Omit<S, 'origin' | 'slot'> };
  hideRule: (id: string, source: HTMLElement) => DockHideRule;
  slotFor?: (id: string) => number | null;
  canAdd?: () => boolean;
  refuseAdd?: string;
  inDock: (x: number, y: number, rect: DOMRect, origin: DockOrigin) => boolean;
  isLastRow?: (row: HTMLElement) => boolean;
  ids?: string[];
  onDrop: (drop: DockDrop) => void;
  onActiveChange?: (active: boolean) => void;
  onBegin?: (origin: DockOrigin, source: HTMLElement, shiftMs: number) => void;
  onExtent?: (delta: number) => void;
  onReset?: () => void;
  feel: {
    tileLift: number;
    hideScale: number;
    buttonPad: number;
    rowGrab: 'center' | 'proportional';
    snapDock?: boolean;
    snapPanel?: boolean;
  };
  chip: {
    maxTilt: number;
    hint: 'right' | 'above' | 'aboveEnd';
    shapeClass?: string;
    radius?: readonly [row: number, tile: number];
    Face: React.FC<DockFaceProps<S>>;
  };
}

export interface DockDrag<S extends DockSession> {
  startDockPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  startPanelPress: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  flyIn: (id: string, row: HTMLElement, commit: () => void) => void;
  cancel: () => void;
  session: ValueStore<S>;
  layer: React.ReactNode;
}

interface DockDragState extends PointerSession {
  origin: DockOrigin;
  id: string;
  ids: string[];
  tiles: HTMLElement[];
  rects: DOMRect[];
  sourceRect: DOMRect | null;
  dockRect: DOMRect | null;
  button: HTMLElement | null;
  buttonRect: DOMRect | null;
  panelRect: DOMRect | null;
  slotEl: HTMLElement | null;
  empty: HTMLElement | null;
  ghost: HTMLElement | null;
  ghostX: number;
  ghostY: number;
  ghostSize: number;
  cross: number;
  start: number;
  end: number;
  gap: number;
  incoming: number;
  tileWidth: number;
  tileHeight: number;
  rowHeight: number;
  fromIndex: number;
  hint: string | null;
  refuse: string | null;
  canAdd: boolean;
  intent: DockIntent;
  sourceShift: number;
  buttonShift: number;
  gapAt: number | null;
  startScroll: number;
  morphTarget: number;
  scaleTarget: number;
  hintTarget: number;
  snapXTarget: number;
  snapYTarget: number;
}

const HINT_PLACEMENT = {
  right: 'left-[calc(100%+10px)] top-1/2',
  above: 'bottom-[calc(100%+8px)] left-1/2',
  aboveEnd: 'bottom-[calc(100%+8px)] right-0',
} as const;

const REDUCED_EASE = { duration: 0.18, ease: DRAG_EASE_OUT_CURVE } as const;

const sameIntent = (a: DockIntent, b: DockIntent): boolean => {
  if (a.kind === 'dock' && b.kind === 'dock') return a.index === b.index;
  if (a.kind === 'hide' && b.kind === 'hide') return a.via === b.via;
  if (a.kind === 'refuse' && b.kind === 'refuse') return a.message === b.message;
  return a.kind === b.kind;
};

const orderAfter = (ids: string[], drop: DockDrop): string[] => {
  const next = ids.filter(id => id !== drop.id);
  if (drop.kind !== 'remove') next.splice(drop.index, 0, drop.id);
  return next;
};

const clearStyle = (element: HTMLElement): void => {
  const { style } = element;
  style.transition = '';
  style.transform = '';
  style.opacity = '';
  style.height = '';
  style.width = '';
  style.overflow = '';
  style.paddingTop = '';
  style.paddingBottom = '';
  style.backgroundColor = '';
};

export const useClonedNodes = <T extends HTMLElement>(nodes: Node[]): React.RefObject<T | null> => {
  const ref = React.useRef<T>(null);
  React.useLayoutEffect(() => {
    ref.current?.replaceChildren(...nodes);
  }, [nodes]);
  return ref;
};

export const useDockSlot = <S extends DockSession>(session: ValueStore<S>): number | null =>
  React.useSyncExternalStore(session.subscribe, () => session.get()?.slot ?? null);

const DockChip = <S extends DockSession>({
  session,
  values,
  hintRef,
  reduceMotion,
  chip,
}: {
  session: S;
  values: DockValues;
  hintRef: React.RefObject<HTMLSpanElement | null>;
  reduceMotion: boolean;
  chip: DockConfig<S>['chip'];
}): React.ReactElement => {
  const velocity = useVelocity(values.px);
  const tiltTarget = useTransform(
    velocity,
    [-DRAG_TILT_VELOCITY, 0, DRAG_TILT_VELOCITY],
    [-chip.maxTilt, 0, chip.maxTilt],
    { clamp: true },
  );
  const tilt = useSpring(tiltTarget, DRAG_TILT_SPRING);
  const grabX = useTransform(
    [values.morph, values.rowGrabX, values.tileGrabX],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const grabY = useTransform(
    [values.morph, values.rowGrabY, values.tileGrabY],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const left = useTransform(
    [values.px, grabX, values.snapX, values.snapLeft],
    ([p = 0, g = 0, s = 0, edge = 0]: number[]) => lerp(p - g, edge, s),
  );
  const top = useTransform(
    [values.py, grabY, values.snapY, values.snapTop],
    ([p = 0, g = 0, s = 0, edge = 0]: number[]) => lerp(p - g, edge, s),
  );
  const width = useTransform(
    [values.morph, values.rowWidth, values.tileWidth],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const height = useTransform(
    [values.morph, values.rowHeight, values.tileHeight],
    ([m = 0, row = 0, tile = 0]: number[]) => lerp(row, tile, m),
  );
  const [rowRadius = 0, tileRadius = 0] = chip.radius ?? [];
  const radius = useTransform(values.morph, m => lerp(rowRadius, tileRadius, m));
  const placement = chip.hint;
  const hintTransform = useTransform(values.hint, h => {
    if (placement === 'right') return `translate3d(${lerp(-4, 0, h)}px, -50%, 0)`;
    if (placement === 'above') return `translate3d(-50%, ${lerp(4, 0, h)}px, 0)`;
    return `translate3d(0, ${lerp(4, 0, h)}px, 0)`;
  });
  const transform = useMotionTemplate`translate3d(${left}px, ${top}px, 0) rotate(${
    reduceMotion ? '0' : tilt
  }deg) scale(${values.scale})`;
  const transformOrigin = useMotionTemplate`${grabX}px ${grabY}px`;
  const { Face } = chip;

  return (
    <motion.div
      className='absolute left-0 top-0 will-change-transform'
      style={{ transform, transformOrigin, width, height, opacity: values.opacity }}
    >
      <motion.div
        className={`absolute inset-0${chip.shapeClass ? ` ${chip.shapeClass}` : ''} ${DRAG_LIFTED_SHADOW_CLASS}`}
        style={
          chip.radius
            ? { opacity: values.shadow, borderRadius: radius }
            : { opacity: values.shadow }
        }
      />
      <Face session={session} values={values} />
      <motion.span
        ref={hintRef}
        className={`absolute ${HINT_PLACEMENT[placement]} ${DRAG_HINT_CLASS}`}
        style={{ opacity: values.hint, transform: hintTransform }}
      />
    </motion.div>
  );
};

const DockLayer = <S extends DockSession>({
  store,
  values,
  layerRef,
  hintRef,
  reduceMotion,
  chip,
}: {
  store: ValueStore<S>;
  values: DockValues;
  layerRef: React.RefObject<HTMLDivElement | null>;
  hintRef: React.RefObject<HTMLSpanElement | null>;
  reduceMotion: boolean;
  chip: DockConfig<S>['chip'];
}): React.ReactPortal | null => {
  const session = React.useSyncExternalStore(store.subscribe, store.get);
  if (!session) return null;
  return createPortal(
    <div ref={layerRef} aria-hidden className='pointer-events-none fixed left-0 top-0 z-[70]'>
      <DockChip
        session={session}
        values={values}
        hintRef={hintRef}
        reduceMotion={reduceMotion}
        chip={chip}
      />
    </div>,
    document.body,
  );
};

export const useDockDrag = <S extends DockSession>(config: DockConfig<S>): DockDrag<S> => {
  const reduceMotion = useReducedMotion() ?? false;
  const layerRef = React.useRef<HTMLDivElement>(null);
  const hintRef = React.useRef<HTMLSpanElement>(null);
  const [store] = React.useState(() => createValueStore<S>());
  const [values] = React.useState<DockValues>(() => ({
    px: motionValue(0),
    py: motionValue(0),
    morph: motionValue(1),
    scale: motionValue(1),
    shadow: motionValue(0),
    opacity: motionValue(1),
    hint: motionValue(0),
    tileWidth: motionValue(0),
    tileHeight: motionValue(0),
    rowWidth: motionValue(0),
    rowHeight: motionValue(0),
    tileGrabX: motionValue(0),
    tileGrabY: motionValue(0),
    rowGrabX: motionValue(0),
    rowGrabY: motionValue(0),
    tileGlyphX: motionValue(0),
    tileGlyphY: motionValue(0),
    rowGlyphX: motionValue(0),
    rowGlyphY: motionValue(0),
    snapX: motionValue(0),
    snapY: motionValue(0),
    snapLeft: motionValue(0),
    snapTop: motionValue(0),
  }));
  const frameRef = React.useRef(0);
  const flightRef = React.useRef<object | null>(null);
  const pendingRef = React.useRef<string | null>(null);
  const latest = React.useRef({ config, reduceMotion });
  latest.current = { config, reduceMotion };

  const shiftMs = (): number =>
    latest.current.reduceMotion ? DRAG_REDUCED_SHIFT_MS : DRAG_SHIFT_MS;

  const sequenceFor = (drag: DockDragState): (string | null)[] => {
    const { ids, intent } = drag;
    if (drag.origin === 'dock') {
      const rest = ids.filter(id => id !== drag.id);
      if (intent.kind === 'hide') return rest;
      const at = intent.kind === 'dock' ? intent.index : drag.fromIndex;
      return [...rest.slice(0, at), drag.id, ...rest.slice(at)];
    }
    if (intent.kind !== 'dock') return ids;
    return [...ids.slice(0, intent.index), null, ...ids.slice(intent.index)];
  };

  const place = (drag: DockDragState, moveButton: boolean): void => {
    const { axis, anchor, onExtent } = latest.current.config;
    drag.gapAt = null;
    drag.sourceShift = 0;
    setTranslate(drag.tiles[drag.fromIndex] ?? null, axis, 0);
    const sequence = sequenceFor(drag);
    const placeTile = (id: string, at: number): number => {
      const index = drag.ids.indexOf(id);
      const rect = drag.rects[index];
      const tile = drag.tiles[index];
      if (!rect || !tile) return 0;
      const shift = at - startOf(rect, axis);
      setTranslate(tile, axis, shift);
      if (id === drag.id) drag.sourceShift = shift;
      return sizeOf(rect, axis);
    };
    if (anchor === 'start') {
      let at = drag.start;
      sequence.forEach(id => {
        if (id === null) {
          drag.gapAt = at;
          at += drag.incoming + drag.gap;
          return;
        }
        at += placeTile(id, at) + drag.gap;
      });
      drag.buttonShift = moveButton ? at - drag.end : 0;
      setTranslate(drag.button, axis, drag.buttonShift);
      return;
    }
    let at = drag.end;
    [...sequence].reverse().forEach(id => {
      if (id === null) {
        at -= drag.incoming;
        drag.gapAt = at;
        at -= drag.gap;
        return;
      }
      const index = drag.ids.indexOf(id);
      const rect = drag.rects[index];
      at -= rect ? sizeOf(rect, axis) : 0;
      placeTile(id, at);
      at -= drag.gap;
    });
    drag.buttonShift = 0;
    onExtent?.(at + drag.gap - drag.start);
  };

  const intoSlot = (drag: DockDragState): boolean =>
    drag.intent.kind === 'hide' && drag.intent.via === 'panel' && drag.slotEl !== null;

  const applyIntent = (drag: DockDragState): void => {
    const { axis, socketAttr } = latest.current.config;
    const { intent } = drag;
    place(drag, drag.origin === 'panel');

    if (drag.origin === 'dock') {
      const source = drag.tiles[drag.fromIndex];
      const socket = source ? socketOf(source, socketAttr) : null;
      if (socket) socket.style.opacity = intent.kind === 'hide' ? '0' : '1';
      if (intent.kind === 'hide' && intent.via === 'button') {
        drag.button?.setAttribute('data-drop-target', '');
      } else {
        drag.button?.removeAttribute('data-drop-target');
      }
      const slotted = intoSlot(drag);
      if (drag.slotEl) drag.slotEl.style.height = slotted ? `${drag.rowHeight}px` : '0px';
      if (drag.empty) {
        drag.empty.style.height = slotted ? '0px' : '';
        drag.empty.style.opacity = slotted ? '0' : '';
      }
      return;
    }

    const { ghost } = drag;
    if (!ghost) return;
    if (drag.gapAt === null) {
      ghost.style.opacity = '0';
      return;
    }
    const main = drag.gapAt - (axis === 'x' ? drag.ghostX : drag.ghostY);
    const cross = drag.cross - (axis === 'x' ? drag.ghostY : drag.ghostX);
    const offset =
      axis === 'x'
        ? `translate3d(${main}px, ${cross}px, 0)`
        : `translate3d(${cross}px, ${main}px, 0)`;
    if (ghost.style.opacity !== '1') {
      ghost.style.transition = 'none';
      if (Math.abs(drag.ghostSize - drag.incoming) > 0.5) {
        if (axis === 'x') ghost.style.width = `${drag.incoming}px`;
        else ghost.style.height = `${drag.incoming}px`;
      }
      ghost.style.transform = offset;
      void ghost.offsetHeight;
      ghost.style.transition = `transform ${shiftMs()}ms ${DRAG_EASE_OUT}, opacity 150ms ${DRAG_EASE_OUT}`;
      ghost.style.opacity = '1';
    } else {
      ghost.style.transform = offset;
    }
  };

  const retarget = (drag: DockDragState): void => {
    const { feel } = latest.current.config;
    const reduce = latest.current.reduceMotion;
    const { intent } = drag;
    const slotted = intoSlot(drag);
    const morph =
      drag.origin === 'dock'
        ? slotted
          ? 0
          : 1
        : intent.kind === 'dock' || intent.kind === 'refuse'
          ? 1
          : 0;
    const message =
      intent.kind === 'refuse'
        ? intent.message
        : intent.kind === 'hide' && !slotted
          ? drag.hint
          : null;
    const scale = reduce
      ? 1
      : message
        ? feel.hideScale
        : morph === 1
          ? feel.tileLift
          : DRAG_ROW_LIFT;
    if (message && hintRef.current) hintRef.current.textContent = message;
    const hint = message ? 1 : 0;
    if (morph !== drag.morphTarget) {
      drag.morphTarget = morph;
      animate(
        values.morph,
        morph,
        reduce ? { duration: 0.12, ease: DRAG_EASE_OUT_CURVE } : DRAG_MORPH_SPRING,
      );
    }
    if (scale !== drag.scaleTarget) {
      drag.scaleTarget = scale;
      animate(values.scale, scale, reduce ? { duration: 0 } : DRAG_SCALE_SPRING);
    }
    if (hint !== drag.hintTarget) {
      drag.hintTarget = hint;
      animate(values.hint, hint, { duration: 0.15, ease: DRAG_EASE_OUT_CURVE });
    }
    const snapping = reduce ? { duration: 0.12, ease: DRAG_EASE_OUT_CURVE } : DRAG_SNAP_SPRING;
    const snapX = feel.snapPanel && slotted ? 1 : 0;
    const snapY = feel.snapDock && intent.kind === 'dock' ? 1 : 0;
    if (snapX !== drag.snapXTarget) {
      drag.snapXTarget = snapX;
      animate(values.snapX, snapX, snapping);
    }
    if (snapY !== drag.snapYTarget) {
      drag.snapYTarget = snapY;
      animate(values.snapY, snapY, snapping);
    }
  };

  const resolveIntent = (drag: DockDragState): DockIntent => {
    const { config } = latest.current;
    const { axis } = config;
    const x = drag.lastX;
    const y = drag.lastY;
    const overPanel = !!drag.panelRect && within(drag.panelRect, x, y, 0);
    if (drag.origin === 'dock' && (drag.hint !== null || drag.refuse !== null)) {
      const overButton = !!drag.buttonRect && within(drag.buttonRect, x, y, config.feel.buttonPad);
      if (overPanel || overButton) {
        return drag.refuse !== null
          ? { kind: 'refuse', message: drag.refuse }
          : { kind: 'hide', via: overPanel ? 'panel' : 'button' };
      }
    }
    if (overPanel) return { kind: 'none' };
    if (!drag.dockRect || !config.inDock(x, y, drag.dockRect, drag.origin)) return { kind: 'none' };
    if (!drag.canAdd) return { kind: 'refuse', message: config.refuseAdd ?? '' };
    const scrolled = scrollOf(config.scroller?.() ?? null, axis) - drag.startScroll;
    const probe =
      axis === 'x'
        ? x - values.tileGrabX.get() + drag.tileWidth / 2 + scrolled
        : y - values.tileGrabY.get() + drag.tileHeight / 2 + scrolled;
    let index = 0;
    drag.rects.forEach((rect, i) => {
      if (i !== drag.fromIndex && startOf(rect, axis) + sizeOf(rect, axis) / 2 < probe) index += 1;
    });
    return { kind: 'dock', index };
  };

  const updateIntent = (drag: DockDragState): void => {
    const next = resolveIntent(drag);
    if (sameIntent(next, drag.intent)) return;
    drag.intent = next;
    applyIntent(drag);
    retarget(drag);
  };

  const resetAll = (drag: DockDragState): void => {
    const { socketAttr, onReset } = latest.current.config;
    [...drag.tiles, drag.handle].forEach(element => {
      clearStyle(element);
      contentOf(element, socketAttr).forEach(child => {
        child.style.opacity = '';
      });
      const socket = socketOf(element, socketAttr);
      if (socket) {
        socket.style.transition = '';
        socket.style.opacity = '';
      }
    });
    [drag.button, drag.ghost, drag.slotEl, drag.empty].forEach(element => {
      if (element) clearStyle(element);
    });
    drag.button?.removeAttribute('data-drop-target');
    onReset?.();
  };

  const autoScroll = (): void => {
    const drag = pointer.current();
    const { config } = latest.current;
    const scroller = config.scroller?.() ?? null;
    if (!drag || drag.phase !== 'drag' || !config.autoScroll) return;
    const scrollable =
      config.axis === 'x'
        ? (scroller?.scrollWidth ?? 0) > (scroller?.clientWidth ?? 0)
        : (scroller?.scrollHeight ?? 0) > (scroller?.clientHeight ?? 0);
    if (scroller && drag.dockRect && drag.intent.kind === 'dock' && scrollable) {
      edgeScroll(
        scroller,
        config.axis,
        config.axis === 'x' ? drag.lastX : drag.lastY,
        drag.dockRect,
        config.autoScroll.zone,
        config.autoScroll.speed,
      );
    }
    frameRef.current = requestAnimationFrame(autoScroll);
  };

  const begin = (drag: DockDragState): boolean => {
    const { config } = latest.current;
    const { axis, feel, socketAttr } = config;
    const entries = config.tiles();
    const ids = entries.map(entry => entry.id);
    const tiles = entries.map(entry => entry.element);
    const fromIndex = drag.origin === 'dock' ? ids.indexOf(drag.id) : -1;
    const dock = config.dock();
    const button = config.button();
    if (!dock || !button || (drag.origin === 'dock' && fromIndex === -1)) return false;

    const source = drag.handle;
    const rects = tiles.map(tile => tile.getBoundingClientRect());
    const sourceRect = source.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const panel = config.panel(drag.origin, source);
    const panelBox = panel?.getBoundingClientRect() ?? null;
    const rule = drag.origin === 'dock' ? config.hideRule(drag.id, source) : null;
    const hint = rule && 'hint' in rule ? rule.hint : null;
    const { geometry, face } = config.lift({
      origin: drag.origin,
      id: drag.id,
      source,
      sourceRect,
      panel,
      tiles,
    });
    const [first, second] = rects;
    const last = rects[rects.length - 1];
    const parent = tiles[0]?.parentElement ?? dock;
    const gap =
      first && second
        ? startOf(second, axis) - endOf(first, axis)
        : parseFloat(getComputedStyle(parent)[axis === 'x' ? 'columnGap' : 'rowGap']) || 0;
    const ghost = config.ghost?.() ?? null;
    const ghostRect = ghost?.getBoundingClientRect() ?? null;
    const scroller = config.scroller?.() ?? null;
    const lead = first ?? buttonRect;

    drag.ids = ids;
    drag.tiles = tiles;
    drag.rects = rects;
    drag.sourceRect = sourceRect;
    drag.dockRect = dock.getBoundingClientRect();
    drag.button = button;
    drag.buttonRect = buttonRect;
    drag.ghost = ghost;
    drag.ghostX = ghostRect?.left ?? 0;
    drag.ghostY = ghostRect?.top ?? 0;
    drag.ghostSize = ghostRect ? sizeOf(ghostRect, axis) : 0;
    drag.empty = config.empty?.() ?? null;
    drag.cross = axis === 'x' ? lead.top : lead.left;
    drag.start = startOf(lead, axis);
    drag.end =
      config.anchor === 'start'
        ? last
          ? endOf(last, axis) + gap
          : startOf(buttonRect, axis)
        : last
          ? endOf(last, axis)
          : startOf(buttonRect, axis) - gap;
    drag.gap = gap;
    drag.incoming = axis === 'x' ? geometry.tileWidth : geometry.tileHeight;
    drag.tileWidth = geometry.tileWidth;
    drag.tileHeight = geometry.tileHeight;
    drag.rowHeight = geometry.rowHeight;
    drag.fromIndex = fromIndex;
    drag.hint = hint;
    drag.refuse = rule && 'refuse' in rule ? rule.refuse : null;
    drag.canAdd = drag.origin === 'panel' ? (config.canAdd?.() ?? true) : true;
    drag.intent = drag.origin === 'dock' ? { kind: 'dock', index: fromIndex } : { kind: 'none' };
    drag.startScroll = scrollOf(scroller, axis);

    const grabX = drag.startX - sourceRect.left;
    const grabY = drag.startY - sourceRect.top;
    values.tileWidth.jump(geometry.tileWidth);
    values.tileHeight.jump(geometry.tileHeight);
    values.rowWidth.jump(geometry.rowWidth);
    values.rowHeight.jump(geometry.rowHeight);
    values.tileGlyphX.jump(geometry.tileGlyphX);
    values.tileGlyphY.jump(geometry.tileGlyphY);
    values.rowGlyphX.jump(geometry.rowGlyphX);
    values.rowGlyphY.jump(geometry.rowGlyphY);
    if (drag.origin === 'dock') {
      values.tileGrabX.jump(grabX);
      values.tileGrabY.jump(grabY);
      values.rowGrabX.jump(geometry.rowGlyphX + grabX - geometry.tileGlyphX);
      values.rowGrabY.jump(geometry.rowGlyphY + grabY - geometry.tileGlyphY);
      values.morph.jump(1);
    } else {
      values.rowGrabX.jump(grabX);
      values.rowGrabY.jump(grabY);
      if (feel.rowGrab === 'proportional') {
        values.tileGrabX.jump((grabX / sourceRect.width) * geometry.tileWidth);
        values.tileGrabY.jump(grabY);
      } else {
        values.tileGrabX.jump(geometry.tileWidth / 2);
        values.tileGrabY.jump(geometry.tileHeight / 2);
      }
      values.morph.jump(0);
    }
    values.px.jump(drag.lastX);
    values.py.jump(drag.lastY);
    values.scale.jump(1);
    values.shadow.jump(0);
    values.opacity.jump(1);
    values.hint.jump(0);
    values.snapX.jump(0);
    values.snapY.jump(feel.snapDock && drag.origin === 'dock' ? 1 : 0);
    values.snapLeft.jump(geometry.panelLeft ?? 0);
    values.snapTop.jump(drag.cross);
    drag.morphTarget = values.morph.get();
    drag.scaleTarget = 1;
    drag.hintTarget = 0;
    drag.snapXTarget = 0;
    drag.snapYTarget = values.snapY.get();

    const slot = hint !== null && panel ? (config.slotFor?.(drag.id) ?? null) : null;
    flushSync(() => store.set({ ...face, origin: drag.origin, slot } as S));
    drag.slotEl = hint !== null ? config.slot(drag.id, panel) : null;
    drag.panelRect =
      panelBox && drag.slotEl
        ? new DOMRect(
            panelBox.x,
            panel?.dataset['side'] === 'top' ? panelBox.y - geometry.rowHeight : panelBox.y,
            panelBox.width,
            panelBox.height + geometry.rowHeight,
          )
        : panelBox;

    const transition = `transform ${shiftMs()}ms ${DRAG_EASE_OUT}`;
    tiles.forEach(tile => {
      tile.style.transition = transition;
    });
    if (config.anchor === 'start') button.style.transition = transition;
    if (drag.slotEl) drag.slotEl.style.transition = `height 200ms ${DRAG_EASE_OUT}`;
    if (drag.empty) {
      drag.empty.style.transition = `height 200ms ${DRAG_EASE_OUT}, opacity 150ms ${DRAG_EASE_OUT}`;
    }
    contentOf(source, socketAttr).forEach(child => {
      child.style.opacity = '0';
    });
    const socket = socketOf(source, socketAttr);
    if (socket) {
      socket.style.transition = `opacity 150ms ${DRAG_EASE_OUT}`;
      socket.style.opacity = '1';
    }
    config.onBegin?.(drag.origin, source, shiftMs());
    config.onActiveChange?.(true);

    retarget(drag);
    animate(values.shadow, 1, { duration: 0.2, ease: DRAG_EASE_OUT_CURVE });
    updateIntent(drag);
    if (config.autoScroll) frameRef.current = requestAnimationFrame(autoScroll);
    return true;
  };

  const teardown = (drag: DockDragState): void => {
    cancelAnimationFrame(frameRef.current);
    const wasDragging = drag.phase !== 'press';
    pointer.finish(drag);
    if (layerRef.current) layerRef.current.style.display = 'none';
    store.set(null);
    if (wasDragging) latest.current.config.onActiveChange?.(false);
  };

  const finishAll = (drag: DockDragState): void => {
    resetAll(drag);
    teardown(drag);
  };

  const settle = (drag: DockDragState, commit: boolean): void => {
    cancelAnimationFrame(frameRef.current);
    const { config, reduceMotion: reduce } = latest.current;
    const { axis } = config;
    if (!commit || drag.intent.kind === 'refuse' || !config.dock()?.isConnected) {
      const resting: DockIntent =
        drag.origin === 'dock' ? { kind: 'dock', index: drag.fromIndex } : { kind: 'none' };
      if (!sameIntent(resting, drag.intent)) {
        drag.intent = resting;
        applyIntent(drag);
      }
    }

    const scrolled = scrollOf(config.scroller?.() ?? null, axis) - drag.startScroll;
    const point = (main: number, cross: number): { left: number; top: number } =>
      axis === 'x' ? { left: main, top: cross } : { left: cross, top: main };
    const crossOf = (rect: DOMRect): number => (axis === 'x' ? rect.top : rect.left);
    const { intent, sourceRect } = drag;
    let drop: DockDrop | null = null;
    let target = {
      left: sourceRect?.left ?? 0,
      top: sourceRect?.top ?? 0,
      morph: drag.origin === 'dock' ? 1 : 0,
    };
    let absorb = false;

    if (intent.kind === 'hide') {
      drop = { kind: 'remove', id: drag.id };
      drag.button?.removeAttribute('data-drop-target');
      place(drag, true);
      const slot = intoSlot(drag) ? drag.slotEl?.getBoundingClientRect() : null;
      const box = drag.buttonRect;
      if (slot) {
        target = { left: slot.left, top: slot.top, morph: 0 };
      } else if (intent.via === 'button' && box) {
        absorb = true;
        const tileMain = axis === 'x' ? drag.tileWidth : drag.tileHeight;
        const tileCross = axis === 'x' ? drag.tileHeight : drag.tileWidth;
        const boxCross = axis === 'x' ? box.height : box.width;
        target = {
          ...point(
            startOf(box, axis) + drag.buttonShift - scrolled + (sizeOf(box, axis) - tileMain) / 2,
            crossOf(box) + (boxCross - tileCross) / 2,
          ),
          morph: 1,
        };
      } else {
        absorb = true;
        target = {
          left: values.px.get() - values.tileGrabX.get(),
          top: values.py.get() - values.tileGrabY.get(),
          morph: 1,
        };
      }
    } else if (intent.kind === 'dock' && drag.origin === 'panel') {
      drop = {
        kind: 'add',
        id: drag.id,
        index: intent.index,
        before: drag.ids[intent.index] ?? null,
      };
      target = { ...point((drag.gapAt ?? drag.end) - scrolled, drag.cross), morph: 1 };
      const row = drag.handle;
      if (!config.isLastRow?.(row)) {
        row.style.height = `${row.offsetHeight}px`;
        row.style.overflow = 'hidden';
        void row.offsetHeight;
        row.style.transition = `height 200ms ${DRAG_EASE_OUT}, padding 200ms ${DRAG_EASE_OUT}, opacity 150ms ${DRAG_EASE_OUT}`;
        row.style.height = '0px';
        row.style.paddingTop = '0px';
        row.style.paddingBottom = '0px';
        row.style.opacity = '0';
      }
    } else if (intent.kind === 'dock') {
      const to = drag.ids[intent.index];
      if (intent.index !== drag.fromIndex && to) {
        drop = { kind: 'move', id: drag.id, index: intent.index, target: to };
      }
      if (sourceRect) {
        target = {
          ...point(startOf(sourceRect, axis) + drag.sourceShift - scrolled, crossOf(sourceRect)),
          morph: 1,
        };
      }
    } else if (sourceRect && drag.origin === 'dock') {
      target = { ...point(startOf(sourceRect, axis) - scrolled, crossOf(sourceRect)), morph: 1 };
    }

    const grabX = target.morph === 1 ? values.tileGrabX.get() : values.rowGrabX.get();
    const grabY = target.morph === 1 ? values.tileGrabY.get() : values.rowGrabY.get();
    const landing = reduce ? REDUCED_EASE : absorb ? DRAG_ABSORB_SPRING : DRAG_LANDING_SPRING;
    const animations = [
      animate(values.px, target.left + grabX, landing),
      animate(values.py, target.top + grabY, landing),
      animate(values.morph, target.morph, reduce ? REDUCED_EASE : DRAG_MORPH_SPRING),
      animate(values.scale, absorb && !reduce ? DRAG_ABSORB_SCALE : 1, landing),
      animate(values.shadow, 0, { duration: 0.3, ease: DRAG_EASE_OUT_CURVE }),
      animate(values.hint, 0, { duration: 0.12, ease: DRAG_EASE_OUT_CURVE }),
      animate(values.snapX, 0, landing),
      animate(values.snapY, 0, landing),
    ];
    if (absorb) {
      animations.push(animate(values.opacity, 0, { duration: 0.2, ease: DRAG_EASE_OUT_CURVE }));
    }

    void Promise.all(animations).then(() => {
      if (pointer.current() !== drag) return;
      if (!drop) {
        finishAll(drag);
        return;
      }
      if (drag.slotEl) {
        drag.slotEl.style.transition = 'none';
        drag.slotEl.style.height = '0px';
      }
      const committed = drop;
      const current = latest.current.config;
      if (current.ids) {
        const key = orderAfter(drag.ids, committed).join('|');
        pendingRef.current = key;
        flushSync(() => current.onDrop(committed));
        requestAnimationFrame(() => {
          if (pendingRef.current !== key) return;
          pendingRef.current = null;
          finishAll(drag);
        });
        return;
      }
      flushSync(() => current.onDrop(committed));
      finishAll(drag);
    });
  };

  const pointer = usePointerDrag<DockDragState>({
    begin,
    move: drag => {
      values.px.set(drag.lastX);
      values.py.set(drag.lastY);
      updateIntent(drag);
    },
    settle,
    scroller: () => latest.current.config.scroller?.() ?? null,
  });

  const startPress = (
    origin: DockOrigin,
    id: string,
    event: React.PointerEvent<HTMLElement>,
  ): void => {
    if (flightRef.current) return;
    pointer.start(event, {
      origin,
      id,
      ids: [],
      tiles: [],
      rects: [],
      sourceRect: null,
      dockRect: null,
      button: null,
      buttonRect: null,
      panelRect: null,
      slotEl: null,
      empty: null,
      ghost: null,
      ghostX: 0,
      ghostY: 0,
      ghostSize: 0,
      cross: 0,
      start: 0,
      end: 0,
      gap: 0,
      incoming: 0,
      tileWidth: 0,
      tileHeight: 0,
      rowHeight: 0,
      fromIndex: -1,
      hint: null,
      refuse: null,
      canAdd: true,
      intent: { kind: 'none' },
      sourceShift: 0,
      buttonShift: 0,
      gapAt: null,
      startScroll: 0,
      morphTarget: 1,
      scaleTarget: 1,
      hintTarget: 0,
      snapXTarget: 0,
      snapYTarget: 0,
    });
  };

  const flyIn = (id: string, row: HTMLElement, commit: () => void): void => {
    if (pointer.current() || flightRef.current || latest.current.reduceMotion) {
      flushSync(commit);
      return;
    }
    const { config } = latest.current;
    const rowRect = row.getBoundingClientRect();
    const { geometry, face } = config.lift({
      origin: 'panel',
      id,
      source: row,
      sourceRect: rowRect,
      panel: null,
      tiles: config.tiles().map(entry => entry.element),
    });
    values.px.jump(rowRect.left);
    values.py.jump(rowRect.top);
    values.rowGrabX.jump(0);
    values.rowGrabY.jump(0);
    values.tileGrabX.jump(0);
    values.tileGrabY.jump(0);
    values.rowWidth.jump(rowRect.width);
    values.tileWidth.jump(rowRect.width);
    values.rowHeight.jump(geometry.rowHeight);
    values.tileHeight.jump(geometry.tileHeight);
    values.morph.jump(0);
    values.scale.jump(1);
    values.shadow.jump(0);
    values.opacity.jump(1);
    values.hint.jump(0);
    values.snapX.jump(0);
    values.snapY.jump(0);
    flushSync(() => store.set({ ...face, origin: 'panel', slot: null } as S));
    flushSync(commit);

    const tile = config.tiles().find(entry => entry.id === id)?.element;
    if (!tile) {
      store.set(null);
      return;
    }
    tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const tileRect = tile.getBoundingClientRect();
    const content = contentOf(tile, config.socketAttr);
    content.forEach(child => {
      child.style.opacity = '0';
    });
    values.tileWidth.jump(tileRect.width);

    const flight = {};
    flightRef.current = flight;
    void Promise.all([
      animate(values.px, tileRect.left, DRAG_FLY_SPRING),
      animate(values.py, tileRect.top, DRAG_FLY_SPRING),
      animate(values.morph, 1, DRAG_SNAP_SPRING),
      animate(values.shadow, [0, 1, 0], { duration: 0.35, ease: DRAG_EASE_OUT_CURVE }),
    ]).then(() => {
      if (flightRef.current !== flight) return;
      flightRef.current = null;
      content.forEach(child => {
        child.style.opacity = '';
      });
      if (layerRef.current) layerRef.current.style.display = 'none';
      store.set(null);
    });
  };

  const orderKey = config.ids ? config.ids.join('|') : null;
  React.useLayoutEffect(() => {
    if (orderKey === null) return;
    const drag = pointer.current();
    const pending = pendingRef.current;
    if (pending !== null) {
      if (pending !== orderKey) return;
      pendingRef.current = null;
      if (drag) finishAll(drag);
      return;
    }
    if (drag && drag.phase !== 'press') finishAll(drag);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on order changes only
  }, [orderKey]);

  React.useEffect(
    () => (): void => {
      cancelAnimationFrame(frameRef.current);
      flightRef.current = null;
      pendingRef.current = null;
      store.set(null);
    },
    [store],
  );

  return {
    startDockPress: (id, event) => startPress('dock', id, event),
    startPanelPress: (id, event) => startPress('panel', id, event),
    flyIn,
    cancel: pointer.cancel,
    session: store,
    layer: (
      <DockLayer
        store={store}
        values={values}
        layerRef={layerRef}
        hintRef={hintRef}
        reduceMotion={reduceMotion}
        chip={config.chip}
      />
    ),
  };
};
