import React from 'react';
import { DRAG_THRESHOLD } from '../constants/drag';
import { lockDragCursor, swallowNextClicks } from '../utils/drag';

export interface PointerSession {
  phase: 'press' | 'drag' | 'settle';
  pointerId: number;
  handle: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

export interface PointerDragHandlers<S extends PointerSession> {
  begin: (session: S) => boolean;
  move: (session: S) => void;
  settle: (session: S, commit: boolean) => void;
  abandon?: (session: S) => void;
  scroller?: () => HTMLElement | null;
}

export interface PointerDrag<S extends PointerSession> {
  current: () => S | null;
  start: (
    event: React.PointerEvent<HTMLElement>,
    fields: Omit<S, keyof PointerSession>,
    options?: { captureOnPress?: boolean },
  ) => S | null;
  cancel: () => void;
  finish: (session: S) => boolean;
}

export const usePointerDrag = <S extends PointerSession>(
  handlers: PointerDragHandlers<S>,
): PointerDrag<S> => {
  const sessionRef = React.useRef<S | null>(null);
  const listenersRef = React.useRef<(() => void) | null>(null);
  const unlockRef = React.useRef<(() => void) | null>(null);
  const guardRef = React.useRef<(() => void) | null>(null);
  const latest = React.useRef(handlers);
  latest.current = handlers;

  const disarmGuard = (): void => {
    const release = guardRef.current;
    if (!release) return;
    window.setTimeout(() => {
      release();
      if (guardRef.current === release) guardRef.current = null;
    }, 60);
  };

  const detach = (): void => {
    listenersRef.current?.();
    listenersRef.current = null;
    sessionRef.current = null;
  };

  const abandon = (session: S): void => {
    detach();
    latest.current.abandon?.(session);
  };

  const finish = (session: S): boolean => {
    if (sessionRef.current !== session) return false;
    detach();
    disarmGuard();
    unlockRef.current?.();
    unlockRef.current = null;
    return true;
  };

  const settle = (session: S, commit: boolean): void => {
    if (session.phase === 'press') {
      abandon(session);
      return;
    }
    if (session.phase !== 'drag') return;
    session.phase = 'settle';
    disarmGuard();
    latest.current.settle(session, commit);
  };

  const capture = (session: S): boolean => {
    try {
      session.handle.setPointerCapture(session.pointerId);
      return true;
    } catch {
      return false;
    }
  };

  const begin = (session: S): void => {
    if (!capture(session)) {
      abandon(session);
      return;
    }
    session.phase = 'drag';
    if (!latest.current.begin(session)) {
      session.phase = 'press';
      abandon(session);
      return;
    }
    unlockRef.current = lockDragCursor();
    guardRef.current?.();
    guardRef.current = swallowNextClicks();
  };

  const start: PointerDrag<S>['start'] = (event, fields, options) => {
    if (event.button !== 0 || event.pointerType === 'touch' || sessionRef.current) return null;
    const session = {
      ...fields,
      phase: 'press',
      pointerId: event.pointerId,
      handle: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    } as S;
    sessionRef.current = session;
    if (options?.captureOnPress) capture(session);

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== session.pointerId) return;
      session.lastX = moveEvent.clientX;
      session.lastY = moveEvent.clientY;
      if (session.phase === 'press') {
        const distance = Math.hypot(session.lastX - session.startX, session.lastY - session.startY);
        if (distance >= DRAG_THRESHOLD) begin(session);
        return;
      }
      if (session.phase === 'drag') latest.current.move(session);
    };
    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === session.pointerId) settle(session, true);
    };
    const onCancel = (): void => settle(session, false);
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return;
      if (session.phase === 'press') {
        abandon(session);
        return;
      }
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      settle(session, false);
    };
    const onScroll = (): void => {
      if (session.phase === 'drag') latest.current.move(session);
    };
    const scroller = latest.current.scroller?.() ?? null;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey, true);
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    listenersRef.current = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey, true);
      scroller?.removeEventListener('scroll', onScroll);
    };
    return session;
  };

  const settleRef = React.useRef(settle);
  settleRef.current = settle;
  const cancel = React.useCallback((): void => {
    const session = sessionRef.current;
    if (session) settleRef.current(session, false);
  }, []);

  React.useEffect(
    () => (): void => {
      listenersRef.current?.();
      listenersRef.current = null;
      sessionRef.current = null;
      guardRef.current?.();
      guardRef.current = null;
      unlockRef.current?.();
      unlockRef.current = null;
    },
    [],
  );

  return { current: () => sessionRef.current, start, cancel, finish };
};
