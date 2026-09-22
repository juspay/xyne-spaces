import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentCreateField } from './types';
import {
  caretTrackDurationMs,
  mouseTravelDurationMs,
  mouseTravelTimes,
  pickTravelPath,
  pointerCaretPoint,
  pointerEntryPoint,
  pointerParkPoint,
  type FieldBox,
  type PointerPoint,
  type TravelKind,
} from './writingPointerPath';

const LIGHT_SRC = '/svgs/icons/pointer-cursor-light.svg';
const DARK_SRC = '/svgs/icons/pointer-cursor-dark.svg';
const SIZE = 20;
const TRAVEL_EASE = [0.42, 0, 0.2, 1] as const;
const FADE_SECONDS = 0.16;

function measureBox(origin: HTMLElement, field: AgentCreateField): FieldBox | null {
  const host = origin.querySelector(`[data-create-field="${field}"]`);
  if (!host) return null;
  const box = host.getBoundingClientRect();
  const root = origin.getBoundingClientRect();
  return {
    left: box.left - root.left,
    top: box.top - root.top,
    width: box.width,
    height: box.height,
    inline: field === 'name' || field === 'slug',
  };
}

function fieldControl(
  origin: HTMLElement,
  field: AgentCreateField,
): HTMLInputElement | HTMLTextAreaElement | null {
  const host = origin.querySelector(`[data-create-field="${field}"]`);
  return host?.querySelector('input, textarea') ?? null;
}

function pathArrays(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind,
): { xs: number[]; ys: number[] } {
  const path = pickTravelPath(from, to, kind);
  return {
    xs: path.map(p => p.x),
    ys: path.map(p => p.y),
  };
}

interface WritingFieldPointerProps {
  field: AgentCreateField | null;
  originRef: RefObject<HTMLDivElement | null>;
}

/**
 * Figma write pointer (Codex-style): travel once onto the active field, stay
 * put while text fills (subtle caret tracking), travel again only when the
 * write target changes.
 */
export function WritingFieldPointer({
  field,
  originRef,
}: WritingFieldPointerProps): ReactElement | null {
  const reduceMotion = useReducedMotion() === true;
  const { theme } = useTheme();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(0);
  const lastPointRef = useRef<PointerPoint | null>(null);
  const activeFieldRef = useRef<AgentCreateField | null>(null);
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const origin = originRef.current;
    let cancelled = false;
    let frame = 0;

    const stopTravel = (): void => {
      x.stop();
      y.stop();
      opacity.stop();
    };

    if (!field || !origin) {
      activeFieldRef.current = field;
      setSettled(false);
      if (lastPointRef.current === null) {
        opacity.set(0);
        setShown(false);
        return;
      }
      if (reduceMotion) {
        opacity.set(0);
        setShown(false);
        return;
      }
      animate(opacity, 0, {
        duration: FADE_SECONDS,
        ease: 'easeOut',
        onComplete: (): void => {
          if (!cancelled) {
            setShown(false);
          }
        },
      });
      return (): void => {
        cancelled = true;
        opacity.stop();
      };
    }

    setShown(true);
    setSettled(false);

    const travelKind = (): TravelKind => {
      if (reduceMotion) return 'reduced';
      if (activeFieldRef.current && activeFieldRef.current !== field && lastPointRef.current) {
        return 'field-down';
      }
      if (!lastPointRef.current) return 'entry';
      return 'field-down';
    };

    const moveTo = (
      from: PointerPoint,
      to: PointerPoint,
      kind: TravelKind,
      onDone: () => void,
    ): void => {
      const { xs, ys } = pathArrays(from, to, kind);
      const times = mouseTravelTimes(xs.length);
      const duration = mouseTravelDurationMs(from, to, kind) / 1000;
      lastPointRef.current = to;
      animate(x, xs, {
        duration,
        ease: TRAVEL_EASE,
        times,
        onComplete: (): void => {
          if (!cancelled) {
            onDone();
          }
        },
      });
      animate(y, ys, { duration, ease: TRAVEL_EASE, times });
    };

    const arrive = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field);
      if (!box) {
        frame = window.requestAnimationFrame(arrive);
        return;
      }
      stopTravel();
      const control = fieldControl(origin, field);
      const target = pointerCaretPoint(control, box, control?.value ?? '');
      const kind = travelKind();
      const from =
        kind === 'entry' || !lastPointRef.current
          ? pointerEntryPoint(target)
          : lastPointRef.current;

      if (reduceMotion) {
        const park = pointerParkPoint(box);
        x.set(park.x);
        y.set(park.y);
        opacity.set(1);
        lastPointRef.current = park;
        activeFieldRef.current = field;
        setSettled(true);
        return;
      }

      if (kind === 'entry' || !lastPointRef.current) {
        x.set(from.x);
        y.set(from.y);
      }
      animate(opacity, 1, { duration: FADE_SECONDS, ease: 'easeOut' });
      moveTo(from, target, kind, (): void => {
        activeFieldRef.current = field;
        setSettled(true);
      });
    };

    frame = window.requestAnimationFrame(arrive);
    return (): void => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stopTravel();
    };
  }, [field, originRef, opacity, reduceMotion, x, y]);

  useEffect(() => {
    if (!field || !settled || reduceMotion) return;
    const origin = originRef.current;
    if (!origin) return;

    let cancelled = false;
    let frame = 0;
    let lastValue = '';

    const syncCaret = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field);
      if (!box) return;
      const control = fieldControl(origin, field);
      const value = control?.value ?? '';
      if (value === lastValue) return;
      lastValue = value;
      const next = pointerCaretPoint(control, box, value);
      const prev = lastPointRef.current ?? next;
      const deltaX = next.x - prev.x;
      if (Math.abs(deltaX) < 0.5 && Math.abs(next.y - prev.y) < 0.5) return;
      lastPointRef.current = next;
      if (Math.abs(deltaX) < 2) {
        x.set(next.x);
        y.set(next.y);
        return;
      }
      const duration = caretTrackDurationMs(deltaX);
      animate(x, next.x, { duration, ease: TRAVEL_EASE });
      animate(y, next.y, { duration, ease: TRAVEL_EASE });
    };

    const tick = (): void => {
      syncCaret();
      if (!cancelled) {
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);

    return (): void => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      x.stop();
      y.stop();
    };
  }, [field, settled, reduceMotion, originRef, x, y]);

  if (!field && !shown) return null;

  const src = theme === 'midnight' ? DARK_SRC : LIGHT_SRC;

  return (
    <motion.img
      src={src}
      width={SIZE}
      height={SIZE}
      alt=''
      aria-hidden
      draggable={false}
      {...(field ? { 'data-testid': 'chat-fill-caret' } : {})}
      data-pointer-wandering='false'
      data-pointer-settled={settled && Boolean(field) ? 'true' : 'false'}
      className='pointer-events-none absolute top-0 left-0 z-20'
      style={{
        x,
        y,
        opacity,
        willChange: field ? 'transform' : 'auto',
      }}
    />
  );
}
