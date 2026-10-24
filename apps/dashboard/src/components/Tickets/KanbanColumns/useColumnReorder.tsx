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
import { DRAG_EASE_OUT, DRAG_EASE_OUT_CURVE, DRAG_TILT_SPRING } from '../../../constants/drag';
import {
  contentOf,
  createValueStore,
  edgeScroll,
  socketOf,
  type ValueStore,
} from '../../../utils/drag';
import { usePointerDrag, type PointerSession } from '../../../hooks/usePointerDrag';

const PRESS_SCALE = 0.985;
const LIFT_SCALE = 1.03;
const MAX_TILT = 4;
const TILT_VELOCITY = 1800;
const EDGE_ZONE = 80;
const EDGE_SPEED = 22;
const SOCKET = 'data-column-socket';
const SCROLLABLE = '[class*="overflow-"]';

interface DragSession {
  rect: { left: number; top: number; width: number; height: number };
  grabX: number;
  grabY: number;
  clone: HTMLElement;
  cloneScrollTops: Array<[number, number]>;
}

interface DragValues {
  x: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
  shadow: MotionValue<number>;
}

interface ColumnDrag extends PointerSession {
  sourceId: string;
  startScroll: number;
  ids: string[];
  rects: DOMRect[];
  gap: number;
  fromIndex: number;
  targetIndex: number;
  sourceShift: number;
  stripRect: DOMRect | null;
}

const scrolledWithin = (root: HTMLElement): Array<[HTMLElement, number]> =>
  Array.from(root.querySelectorAll<HTMLElement>(SCROLLABLE))
    .filter(element => element.scrollTop > 0)
    .map(element => [element, element.scrollTop]);

const moveTo = (ids: string[], from: number, to: number): string[] => {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
};

const ColumnDragLayer: React.FC<{
  store: ValueStore<DragSession>;
  values: DragValues;
  layerRef: React.RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
}> = ({ store, values, layerRef, reduceMotion }) => {
  const session = React.useSyncExternalStore(store.subscribe, store.get);
  const velocity = useVelocity(values.x);
  const tiltTarget = useTransform(
    velocity,
    [-TILT_VELOCITY, 0, TILT_VELOCITY],
    [-MAX_TILT, 0, MAX_TILT],
    {
      clamp: true,
    },
  );
  const tilt = useSpring(tiltTarget, DRAG_TILT_SPRING);
  const transform = useMotionTemplate`translate3d(${values.x}px, ${values.y}px, 0) rotate(${
    reduceMotion ? '0' : tilt
  }deg) scale(${values.scale})`;
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!session || !host) return;
    host.replaceChildren(session.clone);
    const scrollables = session.clone.querySelectorAll<HTMLElement>(SCROLLABLE);
    session.cloneScrollTops.forEach(([index, top]) => {
      const element = scrollables[index];
      if (element) element.scrollTop = top;
    });
  }, [session]);

  if (!session) return null;

  return createPortal(
    <div
      ref={layerRef}
      aria-hidden
      className='pointer-events-none fixed z-[60]'
      style={{
        left: session.rect.left,
        top: session.rect.top,
        width: session.rect.width,
        height: session.rect.height,
      }}
    >
      <motion.div
        className='relative h-full w-full'
        style={{ transform, transformOrigin: `${session.grabX}px ${session.grabY}px` }}
      >
        <motion.div
          className='absolute inset-0 rounded-lg shadow-[0_0_0_1px_hsl(var(--foreground)/0.06),0_2px_4px_-1px_rgb(0_0_0/0.06),0_12px_24px_-6px_rgb(0_0_0/0.16),0_32px_64px_-16px_rgb(0_0_0/0.24)]'
          style={{ opacity: values.shadow }}
        />
        <div ref={hostRef} className='relative h-full w-full' />
      </motion.div>
    </div>,
    document.body,
  );
};

export interface ColumnReorder {
  stripRef: React.RefObject<HTMLDivElement | null>;
  columnRef: (stageId: string) => (node: HTMLDivElement | null) => void;
  startPress: (stageId: string, event: React.PointerEvent<HTMLElement>) => void;
  layer: React.ReactNode;
}

export const useColumnReorder = ({
  stageIds,
  onReorder,
}: {
  stageIds: string[];
  onReorder: (stageIds: string[]) => void;
}): ColumnReorder => {
  const reduceMotion = useReducedMotion() ?? false;
  const stripRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const columnsRef = React.useRef(new Map<string, HTMLDivElement>());
  const columnRefCallbacks = React.useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const [store] = React.useState(() => createValueStore<DragSession>());
  const [values] = React.useState<DragValues>(() => ({
    x: motionValue(0),
    y: motionValue(0),
    scale: motionValue(1),
    shadow: motionValue(0),
  }));
  const frameRef = React.useRef(0);
  const pendingRef = React.useRef<{
    key: string;
    scrolled: Array<[HTMLElement, number]>;
  } | null>(null);
  const latest = React.useRef({ stageIds, onReorder, reduceMotion });
  latest.current = { stageIds, onReorder, reduceMotion };

  const columnRef = React.useCallback((stageId: string) => {
    let callback = columnRefCallbacks.current.get(stageId);
    if (!callback) {
      callback = (node: HTMLDivElement | null): void => {
        if (node) columnsRef.current.set(stageId, node);
        else columnsRef.current.delete(stageId);
      };
      columnRefCallbacks.current.set(stageId, callback);
    }
    return callback;
  }, []);

  const resetColumns = (): void => {
    columnsRef.current.forEach(column => {
      column.style.transition = '';
      column.style.transform = '';
      column.style.transformOrigin = '';
      column.style.opacity = '';
      column.style.backgroundColor = '';
      contentOf(column, SOCKET).forEach(child => {
        child.style.opacity = '';
      });
      const socket = socketOf(column, SOCKET);
      if (socket) {
        socket.style.transition = '';
        socket.style.opacity = '';
      }
    });
  };

  const teardown = (drag: ColumnDrag): void => {
    cancelAnimationFrame(frameRef.current);
    pointer.finish(drag);
    if (layerRef.current) layerRef.current.style.display = 'none';
    store.set(null);
    values.x.jump(0);
    values.y.jump(0);
    values.scale.jump(1);
    values.shadow.jump(0);
  };

  const shiftDuration = (): number => (latest.current.reduceMotion ? 120 : 320);

  const applyShifts = (drag: ColumnDrag): void => {
    const { ids, rects, gap, fromIndex: from, targetIndex: to } = drag;
    const sourceWidth = rects[from]?.width ?? 0;
    let sourceShift = 0;
    ids.forEach((id, index) => {
      if (index === from) return;
      const column = columnsRef.current.get(id);
      const width = (rects[index]?.width ?? 0) + gap;
      let shift = 0;
      if (from < to && index > from && index <= to) {
        shift = -(sourceWidth + gap);
        sourceShift += width;
      } else if (to < from && index >= to && index < from) {
        shift = sourceWidth + gap;
        sourceShift -= width;
      }
      if (column) column.style.transform = shift ? `translate3d(${shift}px, 0, 0)` : '';
    });
    drag.sourceShift = sourceShift;
    const source = columnsRef.current.get(drag.sourceId);
    if (source) source.style.transform = sourceShift ? `translate3d(${sourceShift}px, 0, 0)` : '';
  };

  const updateTarget = (drag: ColumnDrag): void => {
    const strip = stripRef.current;
    const source = drag.rects[drag.fromIndex];
    if (!strip || !source) return;
    const scrollDelta = strip.scrollLeft - drag.startScroll;
    const center = source.left + source.width / 2 + (drag.lastX - drag.startX) + scrollDelta;
    let target = 0;
    drag.rects.forEach((rect, index) => {
      if (index !== drag.fromIndex && rect.left + rect.width / 2 < center) target += 1;
    });
    if (target === drag.targetIndex) return;
    drag.targetIndex = target;
    applyShifts(drag);
  };

  const autoScroll = (): void => {
    const drag = pointer.current();
    const strip = stripRef.current;
    if (!drag || drag.phase !== 'drag' || !strip || !drag.stripRect) return;
    edgeScroll(strip, 'x', drag.lastX, drag.stripRect, EDGE_ZONE, EDGE_SPEED);
    frameRef.current = requestAnimationFrame(autoScroll);
  };

  const begin = (drag: ColumnDrag): boolean => {
    const strip = stripRef.current;
    const source = columnsRef.current.get(drag.sourceId);
    if (!strip || !source) return false;
    const { reduceMotion: reduce } = latest.current;

    source.style.transition = 'none';
    source.style.transform = '';
    const ids = latest.current.stageIds;
    const rects = ids.map(
      id => columnsRef.current.get(id)?.getBoundingClientRect() ?? new DOMRect(),
    );
    const fromIndex = ids.indexOf(drag.sourceId);
    const sourceRect = rects[fromIndex];
    if (fromIndex === -1 || !sourceRect) return false;

    drag.ids = ids;
    drag.rects = rects;
    drag.gap = rects.length > 1 && rects[0] && rects[1] ? rects[1].left - rects[0].right : 0;
    drag.fromIndex = fromIndex;
    drag.targetIndex = fromIndex;
    drag.startScroll = strip.scrollLeft;
    drag.stripRect = strip.getBoundingClientRect();

    const scrollables = Array.from(source.querySelectorAll<HTMLElement>(SCROLLABLE));
    const cloneScrollTops: Array<[number, number]> = [];
    scrollables.forEach((element, index) => {
      if (element.scrollTop > 0) cloneScrollTops.push([index, element.scrollTop]);
    });
    const clone = source.cloneNode(true) as HTMLElement;
    clone.style.width = `${sourceRect.width}px`;
    clone.style.height = `${sourceRect.height}px`;
    clone.style.transition = '';
    clone.style.transform = '';
    clone.style.transformOrigin = '';
    socketOf(clone, SOCKET)?.remove();
    const grabber = clone.querySelector<HTMLElement>('[data-column-grabber]');
    if (grabber) grabber.style.opacity = '1';

    values.x.jump(drag.lastX - drag.startX);
    values.y.jump(0);
    values.scale.jump(reduce ? 1 : PRESS_SCALE);
    values.shadow.jump(0);
    const session: DragSession = {
      rect: {
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      },
      grabX: drag.startX - sourceRect.left,
      grabY: drag.startY - sourceRect.top,
      clone,
      cloneScrollTops,
    };
    flushSync(() => store.set(session));
    animate(
      values.scale,
      reduce ? 1 : LIFT_SCALE,
      reduce ? { duration: 0 } : { type: 'spring', duration: 0.35, bounce: 0.25 },
    );
    animate(values.shadow, 1, { duration: 0.2, ease: DRAG_EASE_OUT_CURVE });

    const transition = `transform ${shiftDuration()}ms ${DRAG_EASE_OUT}, opacity 200ms ${DRAG_EASE_OUT}`;
    ids.forEach(id => {
      const column = columnsRef.current.get(id);
      if (!column) return;
      column.style.transition = transition;
      if (id === drag.sourceId) return;
      column.style.opacity = '0.9';
    });
    source.style.backgroundColor = 'transparent';
    contentOf(source, SOCKET).forEach(child => {
      child.style.opacity = '0';
    });
    const socket = socketOf(source, SOCKET);
    if (socket) {
      socket.style.transition = `opacity 150ms ${DRAG_EASE_OUT}`;
      socket.style.opacity = '1';
    }

    frameRef.current = requestAnimationFrame(autoScroll);
    return true;
  };

  const settle = (drag: ColumnDrag, commit: boolean): void => {
    const strip = stripRef.current;
    if (!strip) return;
    cancelAnimationFrame(frameRef.current);
    if (!commit && drag.targetIndex !== drag.fromIndex) {
      drag.targetIndex = drag.fromIndex;
      applyShifts(drag);
    }
    drag.ids.forEach(id => {
      if (id !== drag.sourceId) {
        const column = columnsRef.current.get(id);
        if (column) column.style.opacity = '';
      }
    });

    const { reduceMotion: reduce } = latest.current;
    const landing = reduce
      ? { duration: 0.18, ease: DRAG_EASE_OUT_CURVE }
      : ({ type: 'spring', duration: 0.5, bounce: 0.2 } as const);
    const targetX = drag.sourceShift - (strip.scrollLeft - drag.startScroll);
    void Promise.all([
      animate(values.x, targetX, landing),
      animate(values.y, 0, landing),
      animate(values.scale, 1, landing),
      animate(values.shadow, 0, { duration: 0.3, ease: DRAG_EASE_OUT_CURVE }),
    ]).then(() => {
      if (pointer.current() !== drag) return;
      if (drag.targetIndex === drag.fromIndex) {
        resetColumns();
        teardown(drag);
        return;
      }
      const next = moveTo(drag.ids, drag.fromIndex, drag.targetIndex);
      const scrolled: Array<[HTMLElement, number]> = [];
      columnsRef.current.forEach(column => scrolled.push(...scrolledWithin(column)));
      pendingRef.current = { key: next.join('|'), scrolled };
      flushSync(() => latest.current.onReorder(next));
      requestAnimationFrame(() => {
        if (pendingRef.current?.key !== next.join('|')) return;
        pendingRef.current = null;
        resetColumns();
        teardown(drag);
      });
    });
  };

  const pointer = usePointerDrag<ColumnDrag>({
    begin,
    move: drag => {
      const dy = drag.lastY - drag.startY;
      values.x.set(drag.lastX - drag.startX);
      values.y.set(Math.sign(dy) * Math.min(Math.abs(dy) * 0.25, 24));
      updateTarget(drag);
    },
    settle,
    abandon: drag => {
      const source = columnsRef.current.get(drag.sourceId);
      if (!source) return;
      source.style.transform = '';
      window.setTimeout(() => {
        if (pointer.current()) return;
        source.style.transition = '';
        source.style.transformOrigin = '';
      }, 200);
    },
    scroller: () => stripRef.current,
  });

  const startPress = (stageId: string, event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || event.pointerType === 'touch' || pointer.current()) return;
    if ((event.target as Element).closest('button, a, input, [role="menuitem"]')) return;
    if (latest.current.stageIds.length < 2) return;
    const source = columnsRef.current.get(stageId);
    const strip = stripRef.current;
    if (!source || !strip) return;

    const drag = pointer.start(
      event,
      {
        sourceId: stageId,
        startScroll: strip.scrollLeft,
        ids: [],
        rects: [],
        gap: 0,
        fromIndex: -1,
        targetIndex: -1,
        sourceShift: 0,
        stripRect: null,
      },
      { captureOnPress: true },
    );
    if (!drag || latest.current.reduceMotion) return;
    const sourceRect = source.getBoundingClientRect();
    source.style.transformOrigin = `${event.clientX - sourceRect.left}px ${event.clientY - sourceRect.top}px`;
    source.style.transition = `transform 160ms ${DRAG_EASE_OUT}`;
    source.style.transform = `scale(${PRESS_SCALE})`;
  };

  const orderKey = stageIds.join('|');
  React.useLayoutEffect(() => {
    const pending = pendingRef.current;
    const drag = pointer.current();
    if (pending) {
      if (pending.key !== orderKey) return;
      pendingRef.current = null;
      resetColumns();
      pending.scrolled.forEach(([element, top]) => {
        element.scrollTop = top;
      });
      if (drag) teardown(drag);
      return;
    }
    if (drag && drag.phase !== 'press') {
      resetColumns();
      teardown(drag);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on order changes only
  }, [orderKey]);

  React.useEffect(
    () => (): void => {
      cancelAnimationFrame(frameRef.current);
      store.set(null);
    },
    [store],
  );

  return {
    stripRef,
    columnRef,
    startPress,
    layer: (
      <ColumnDragLayer
        store={store}
        values={values}
        layerRef={layerRef}
        reduceMotion={reduceMotion}
      />
    ),
  };
};
