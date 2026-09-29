import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentCreateField, AgentCreateHubRow } from './types';
import {
  caretTrackDurationMs,
  flightControlPoint,
  flightScale,
  headingDegrees,
  hermiteSmoothstep,
  mouseTravelDurationMs,
  pointerCaretPoint,
  pointerEntryPoint,
  pointerHubRowPoint,
  pointerParkPoint,
  quadraticPoint,
  quadraticTangent,
  type FieldBox,
  type PointerPoint,
  type TravelKind,
} from './writingPointerPath';

const LIGHT_SRC = '/svgs/icons/pointer-cursor-light.svg';
const DARK_SRC = '/svgs/icons/pointer-cursor-dark.svg';
const SIZE = 20;
const FADE_SECONDS = 0.16;
/** Soft land — short spring settle on scale after snap (Clicky-ish). */
const LAND_SCALE_SECONDS = 0.1;

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

interface WritingFieldPointerProps {
  field: AgentCreateField | null;
  hubRow?: AgentCreateHubRow | null;
  originRef: RefObject<HTMLDivElement | null>;
}

/**
 * Figma write pointer (Codex-style + Clicky flight): 60fps quadratic bezier
 * hop onto the active field, sin scale pulse + tangent heading mid-flight,
 * then upright caret track while text fills. No wander loops.
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
  const rotate = useMotionValue(0);
  const lastPointRef = useRef<PointerPoint | null>(null);
  const activeFieldRef = useRef<AgentCreateField | null>(null);
  const activeHubRowRef = useRef<AgentCreateHubRow | null>(null);
  const flightFrameRef = useRef(0);
  const [shown, setShown] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const origin = originRef.current;
    let cancelled = false;
    let frame = 0;

    const stopTravel = (): void => {
      if (flightFrameRef.current !== 0) {
        window.cancelAnimationFrame(flightFrameRef.current);
        flightFrameRef.current = 0;
      }
      x.stop();
      y.stop();
      opacity.stop();
      scale.stop();
      rotate.stop();
    };

    if (!field || !origin) {
      activeFieldRef.current = field;
      activeHubRowRef.current = null;
      setSettled(false);
      if (lastPointRef.current === null) {
        opacity.set(0);
        scale.set(1);
        rotate.set(0);
        setShown(false);
        return;
      }
      if (reduceMotion) {
        opacity.set(0);
        scale.set(1);
        rotate.set(0);
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
            rotate.set(0);
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
        rotate.set(0);
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

    const softLand = (onDone: () => void): void => {
      scale.set(1);
      rotate.set(0);
      animate(scale, [1.04, 1], {
        duration: LAND_SCALE_SECONDS,
        ease: hermiteSmoothstep,
        onComplete: (): void => {
          if (!cancelled) onDone();
        },
      });
    };

    /** Clicky-style 60fps bezier flight: Hermite on path, sin pulse on scale, tangent heading. */
    const moveTo = (
      from: PointerPoint,
      to: PointerPoint,
      kind: TravelKind,
      onDone: () => void,
    ): void => {
      lastPointRef.current = to;

      if (kind === 'reduced') {
        x.set(to.x);
        y.set(to.y);
        scale.set(1);
        rotate.set(0);
        onDone();
        return;
      }

      const control = flightControlPoint(from, to, kind);
      const durationMs = mouseTravelDurationMs(from, to, kind);
      const startTime = performance.now();

      const tick = (now: number): void => {
        if (cancelled) return;
        const linear = Math.min(1, Math.max(0, (now - startTime) / durationMs));
        const t = hermiteSmoothstep(linear);
        const point = quadraticPoint(from, control, to, t);
        const tangent = quadraticTangent(from, control, to, t);

        x.set(point.x);
        y.set(point.y);
        scale.set(flightScale(linear));
        rotate.set(headingDegrees(tangent));

        if (linear < 1) {
          flightFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        flightFrameRef.current = 0;
        x.set(to.x);
        y.set(to.y);
        softLand(onDone);
      };

      flightFrameRef.current = window.requestAnimationFrame(tick);
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
        rotate.set(0);
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
        rotate.set(0);
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
  }, [field, hubRow, originRef, opacity, reduceMotion, rotate, scale, x, y]);

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
      rotate.set(0);
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
  }, [field, settled, reduceMotion, hubRow, originRef, rotate, x, y]);

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
        rotate,
        willChange: field ? 'transform' : 'auto',
      }}
    />
  );
}
