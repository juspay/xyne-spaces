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

const DRAG_THRESHOLD = 4;
const PRESS_SCALE = 0.985;
const LIFT_SCALE = 1.03;
const MAX_TILT = 4;
const EDGE_ZONE = 80;
const EDGE_SPEED = 22;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_OUT_CURVE = [0.23, 1, 0.32, 1] as const;
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

interface PointerDrag {
  phase: 'press' | 'drag' | 'settle';
  sourceId: string;
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startScroll: number;
  ids: string[];
  rects: DOMRect[];
  gap: number;
  fromIndex: number;
  targetIndex: number;
  sourceShift: number;
  stripRect: DOMRect | null;
  frame: number;
}

interface SessionStore {
  get: () => DragSession | null;
  set: (session: DragSession | null) => void;
  subscribe: (listener: () => void) => () => void;
}

const createSessionStore = (): SessionStore => {
  let session: DragSession | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): DragSession | null => session,
    set: (next): void => {
      session = next;
      listeners.forEach(listener => listener());
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
};

const socketOf = (column: HTMLElement): HTMLElement | null =>
  column.querySelector<HTMLElement>(':scope > [data-column-socket]');

const contentOf = (column: HTMLElement): HTMLElement[] =>
  Array.from(column.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.hasAttribute('data-column-socket'),
  );

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
  store: SessionStore;
  values: DragValues;
  layerRef: React.RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
}> = ({ store, values, layerRef, reduceMotion }) => {
  const session = React.useSyncExternalStore(store.subscribe, store.get);
  const velocity = useVelocity(values.x);
  const tiltTarget = useTransform(velocity, [-1800, 0, 1800], [-MAX_TILT, 0, MAX_TILT], {
    clamp: true,
  });
  const tilt = useSpring(tiltTarget, { stiffness: 320, damping: 24, mass: 0.6 });
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
  const [store] = React.useState(createSessionStore);
  const [values] = React.useState<DragValues>(() => ({
    x: motionValue(0),
    y: motionValue(0),
    scale: motionValue(1),
    shadow: motionValue(0),
  }));
  const dragRef = React.useRef<PointerDrag | null>(null);
  const pendingRef = React.useRef<{
    key: string;
    scrolled: Array<[HTMLElement, number]>;
  } | null>(null);
  const latest = React.useRef({ stageIds, onReorder, reduceMotion });
  latest.current = { stageIds, onReorder, reduceMotion };
  const listenersRef = React.useRef<(() => void) | null>(null);

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
      contentOf(column).forEach(child => {
        child.style.opacity = '';
      });
      const socket = socketOf(column);
      if (socket) {
        socket.style.transition = '';
        socket.style.opacity = '';
      }
    });
  };

  const teardown = (): void => {
    const drag = dragRef.current;
    if (drag) {
      cancelAnimationFrame(drag.frame);
      drag.handle.style.cursor = '';
    }
    listenersRef.current?.();
    listenersRef.current = null;
    dragRef.current = null;
    if (layerRef.current) layerRef.current.style.display = 'none';
    store.set(null);
    values.x.jump(0);
    values.y.jump(0);
    values.scale.jump(1);
    values.shadow.jump(0);
  };

  const shiftDuration = (): number => (latest.current.reduceMotion ? 120 : 320);

  const applyShifts = (drag: PointerDrag): void => {
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

  const updateTarget = (drag: PointerDrag): void => {
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
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag || drag.phase !== 'drag' || !strip || !drag.stripRect) return;
    const fromLeft = drag.lastX - drag.stripRect.left;
    const fromRight = drag.stripRect.right - drag.lastX;
    const speed = (distance: number): number =>
      EDGE_SPEED * Math.pow((EDGE_ZONE - Math.max(distance, 0)) / EDGE_ZONE, 2);
    if (fromLeft < EDGE_ZONE) strip.scrollLeft -= speed(fromLeft);
    else if (fromRight < EDGE_ZONE) strip.scrollLeft += speed(fromRight);
    drag.frame = requestAnimationFrame(autoScroll);
  };

  const beginDrag = (drag: PointerDrag): void => {
    const strip = stripRef.current;
    const source = columnsRef.current.get(drag.sourceId);
    if (!strip || !source) return;
    const { reduceMotion: reduce } = latest.current;

    source.style.transition = 'none';
    source.style.transform = '';
    const ids = latest.current.stageIds;
    const rects = ids.map(
      id => columnsRef.current.get(id)?.getBoundingClientRect() ?? new DOMRect(),
    );
    const fromIndex = ids.indexOf(drag.sourceId);
    const sourceRect = rects[fromIndex];
    if (fromIndex === -1 || !sourceRect) return;

    drag.phase = 'drag';
    drag.ids = ids;
    drag.rects = rects;
    drag.gap = rects.length > 1 && rects[0] && rects[1] ? rects[1].left - rects[0].right : 0;
    drag.fromIndex = fromIndex;
    drag.targetIndex = fromIndex;
    drag.startScroll = strip.scrollLeft;
    drag.stripRect = strip.getBoundingClientRect();
    drag.handle.style.cursor = 'grabbing';

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
    socketOf(clone)?.remove();
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
    animate(values.shadow, 1, { duration: 0.2, ease: EASE_OUT_CURVE });

    const transition = `transform ${shiftDuration()}ms ${EASE_OUT}, opacity 200ms ${EASE_OUT}`;
    ids.forEach(id => {
      const column = columnsRef.current.get(id);
      if (!column) return;
      column.style.transition = transition;
      if (id === drag.sourceId) return;
      column.style.opacity = '0.9';
    });
    source.style.backgroundColor = 'transparent';
    contentOf(source).forEach(child => {
      child.style.opacity = '0';
    });
    const socket = socketOf(source);
    if (socket) {
      socket.style.transition = `opacity 150ms ${EASE_OUT}`;
      socket.style.opacity = '1';
    }

    drag.frame = requestAnimationFrame(autoScroll);
  };

  const settle = (commit: boolean): void => {
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag || !strip) return;
    if (drag.phase === 'press') {
      const source = columnsRef.current.get(drag.sourceId);
      if (source) {
        source.style.transform = '';
        window.setTimeout(() => {
          if (dragRef.current) return;
          source.style.transition = '';
          source.style.transformOrigin = '';
        }, 200);
      }
      listenersRef.current?.();
      listenersRef.current = null;
      dragRef.current = null;
      return;
    }
    if (drag.phase !== 'drag') return;
    drag.phase = 'settle';
    cancelAnimationFrame(drag.frame);
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
      ? { duration: 0.18, ease: EASE_OUT_CURVE }
      : ({ type: 'spring', duration: 0.5, bounce: 0.2 } as const);
    const targetX = drag.sourceShift - (strip.scrollLeft - drag.startScroll);
    void Promise.all([
      animate(values.x, targetX, landing),
      animate(values.y, 0, landing),
      animate(values.scale, 1, landing),
      animate(values.shadow, 0, { duration: 0.3, ease: EASE_OUT_CURVE }),
    ]).then(() => {
      if (dragRef.current !== drag) return;
      if (drag.targetIndex === drag.fromIndex) {
        resetColumns();
        teardown();
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
        teardown();
      });
    });
  };

  const startPress = (stageId: string, event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || event.pointerType === 'touch' || dragRef.current) return;
    if ((event.target as Element).closest('button, a, input, [role="menuitem"]')) return;
    if (latest.current.stageIds.length < 2) return;
    const source = columnsRef.current.get(stageId);
    const strip = stripRef.current;
    if (!source || !strip) return;

    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const drag: PointerDrag = {
      phase: 'press',
      sourceId: stageId,
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startScroll: strip.scrollLeft,
      ids: [],
      rects: [],
      gap: 0,
      fromIndex: -1,
      targetIndex: -1,
      sourceShift: 0,
      stripRect: null,
      frame: 0,
    };
    dragRef.current = drag;

    if (!latest.current.reduceMotion) {
      const sourceRect = source.getBoundingClientRect();
      source.style.transformOrigin = `${event.clientX - sourceRect.left}px ${event.clientY - sourceRect.top}px`;
      source.style.transition = `transform 160ms ${EASE_OUT}`;
      source.style.transform = `scale(${PRESS_SCALE})`;
    }

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      drag.lastX = moveEvent.clientX;
      drag.lastY = moveEvent.clientY;
      if (drag.phase === 'press') {
        const distance = Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY);
        if (distance >= DRAG_THRESHOLD) beginDrag(drag);
        return;
      }
      if (drag.phase !== 'drag') return;
      const dy = drag.lastY - drag.startY;
      values.x.set(drag.lastX - drag.startX);
      values.y.set(Math.sign(dy) * Math.min(Math.abs(dy) * 0.25, 24));
      updateTarget(drag);
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === drag.pointerId) settle(true);
    };
    const onCancel = (): void => settle(false);
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      settle(false);
    };
    const onScroll = (): void => {
      if (drag.phase === 'drag') updateTarget(drag);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey, true);
    strip.addEventListener('scroll', onScroll, { passive: true });
    listenersRef.current = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey, true);
      strip.removeEventListener('scroll', onScroll);
    };
  };

  const orderKey = stageIds.join('|');
  React.useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (pending) {
      if (pending.key !== orderKey) return;
      pendingRef.current = null;
      resetColumns();
      pending.scrolled.forEach(([element, top]) => {
        element.scrollTop = top;
      });
      teardown();
      return;
    }
    if (dragRef.current && dragRef.current.phase !== 'press') {
      resetColumns();
      teardown();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on order changes only
  }, [orderKey]);

  React.useEffect(
    () => (): void => {
      listenersRef.current?.();
      listenersRef.current = null;
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
