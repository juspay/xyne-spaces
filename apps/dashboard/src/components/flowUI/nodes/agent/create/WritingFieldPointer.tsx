import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentCreateField, AgentCreateHubRow } from './types';
import {
  caretTrackDurationMs,
  hermiteSmoothstep,
  mouseTravelDurationMs,
  mouseTravelTimes,
  pickTravelPath,
  pointerCaretPoint,
  pointerEntryPoint,
  pointerHubRowPoint,
  pointerParkPoint,
  type FieldBox,
  type PointerPoint,
  type TravelKind,
} from './writingPointerPath';

const LIGHT_SRC = '/svgs/icons/pointer-cursor-light.svg';
const DARK_SRC = '/svgs/icons/pointer-cursor-dark.svg';
const SIZE = 20;
const FADE_SECONDS = 0.16;
const SCALE_PEAK = 1.15;

function measureBox(
  origin: HTMLElement,
  field: AgentCreateField,
  hubRow: AgentCreateHubRow | null,
): FieldBox | null {
  const host =
    (hubRow ? origin.querySelector(`[data-create-hub-row="${hubRow}"]`) : null) ??
    origin.querySelector(`[data-create-field="${field}"]`);
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
  hubRow?: AgentCreateHubRow | null;
  originRef: RefObject<HTMLDivElement | null>;
}

/**
 * Figma write pointer (Codex-style + Clicky flight): travel once onto the
 * active field along a distance-scaled upward arc, lightly pulse mid-flight,
 * then hold at the caret while text fills. No wander loops.
 */
export function WritingFieldPointer({
  field,
  hubRow = null,
  originRef,
}: WritingFieldPointerProps): ReactElement | null {
  const reduceMotion = useReducedMotion() === true;
  const { theme } = useTheme();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(0);
  const scale = useMotionValue(1);
  const lastPointRef = useRef<PointerPoint | null>(null);
  const activeFieldRef = useRef<AgentCreateField | null>(null);
  const activeHubRowRef = useRef<AgentCreateHubRow | null>(null);
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
      scale.stop();
    };

    if (!field || !origin) {
      activeFieldRef.current = field;
      activeHubRowRef.current = null;
      setSettled(false);
      if (lastPointRef.current === null) {
        opacity.set(0);
        scale.set(1);
        setShown(false);
        return;
      }
      if (reduceMotion) {
        opacity.set(0);
        scale.set(1);
        setShown(false);
        return;
      }
      animate(opacity, 0, {
        duration: FADE_SECONDS,
        ease: 'easeOut',
        onComplete: (): void => {
          if (!cancelled) {
            setShown(false);
            scale.set(1);
          }
        },
      });
      return (): void => {
        cancelled = true;
        opacity.stop();
      };
    }

    setShown(true);

    const sameTarget =
      activeFieldRef.current === field &&
      activeHubRowRef.current === hubRow &&
      lastPointRef.current;
    if (sameTarget) {
      const box = measureBox(origin, field, hubRow);
      if (box) {
        const target = hubRow
          ? pointerHubRowPoint(box)
          : pointerCaretPoint(
              fieldControl(origin, field),
              box,
              fieldControl(origin, field)?.value ?? '',
            );
        x.set(target.x);
        y.set(target.y);
        opacity.set(1);
        scale.set(1);
        lastPointRef.current = target;
        setSettled(true);
        return (): void => {
          cancelled = true;
        };
      }
    }

    setSettled(false);

    const travelKind = (): TravelKind => {
      if (reduceMotion) return 'reduced';
      if (!lastPointRef.current) return 'entry';
      return 'field-down';
    };

    const restPoint = (box: FieldBox): PointerPoint => {
      if (hubRow) {
        return pointerHubRowPoint(box);
      }
      const control = fieldControl(origin, field);
      return pointerCaretPoint(control, box, control?.value ?? '');
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
      // Path samples are already Hermite-spaced; keep Motion progress linear.
      animate(x, xs, {
        duration,
        ease: 'linear',
        times,
        onComplete: (): void => {
          if (!cancelled) {
            scale.set(1);
            onDone();
          }
        },
      });
      animate(y, ys, { duration, ease: 'linear', times });
      if (kind !== 'reduced') {
        animate(scale, [1, SCALE_PEAK, 1], {
          duration,
          ease: hermiteSmoothstep,
          times: [0, 0.5, 1],
        });
      } else {
        scale.set(1);
      }
    };

    const arrive = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field, hubRow);
      if (!box) {
        frame = window.requestAnimationFrame(arrive);
        return;
      }
      stopTravel();
      const target = restPoint(box);
      const kind = travelKind();
      const from =
        kind === 'entry' || !lastPointRef.current
          ? pointerEntryPoint(target)
          : lastPointRef.current;

      if (reduceMotion) {
        const park = hubRow ? pointerHubRowPoint(box) : pointerParkPoint(box);
        x.set(park.x);
        y.set(park.y);
        opacity.set(1);
        scale.set(1);
        lastPointRef.current = park;
        activeFieldRef.current = field;
        activeHubRowRef.current = hubRow;
        setSettled(true);
        return;
      }

      if (kind === 'entry' || !lastPointRef.current) {
        x.set(from.x);
        y.set(from.y);
        scale.set(1);
      }
      animate(opacity, 1, { duration: FADE_SECONDS, ease: 'easeOut' });
      moveTo(from, target, kind, (): void => {
        activeFieldRef.current = field;
        activeHubRowRef.current = hubRow;
        setSettled(true);
      });
    };

    frame = window.requestAnimationFrame(arrive);
    return (): void => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stopTravel();
    };
  }, [field, hubRow, originRef, opacity, reduceMotion, scale, x, y]);

  useEffect(() => {
    if (!field || !settled || reduceMotion || hubRow) return;
    const origin = originRef.current;
    if (!origin) return;

    let cancelled = false;
    let frame = 0;
    let lastValue = '';

    const syncCaret = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field, null);
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
      animate(x, next.x, { duration, ease: hermiteSmoothstep });
      animate(y, next.y, { duration, ease: hermiteSmoothstep });
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
        scale,
        willChange: field ? 'transform' : 'auto',
      }}
    />
  );
}
