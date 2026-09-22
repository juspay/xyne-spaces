import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentCreateField } from './types';
import {
  mouseTravelDurationMs,
  mouseTravelPath,
  mouseTravelTimes,
  pointerEntryPoint,
  pointerParkPoint,
  pointerWanderStops,
  wanderHopDurationMs,
  type FieldBox,
  type PointerPoint,
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

function pathArrays(from: PointerPoint, to: PointerPoint): { xs: number[]; ys: number[] } {
  const path = mouseTravelPath(from, to);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i];
    if (!point) continue;
    xs.push(point.x);
    ys.push(point.y);
  }
  return { xs, ys };
}

interface WritingFieldPointerProps {
  field: AgentCreateField | null;
  originRef: RefObject<HTMLDivElement | null>;
}

/**
 * Figma write pointer. Travels into the field, then wanders left and right
 * across it with Motion `animate()` — never parks on the title’s left edge.
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
  const hopRef = useRef(0);
  const [shown, setShown] = useState(false);
  const [wandering, setWandering] = useState(false);

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
      setWandering(false);
      hopRef.current = 0;
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
    setWandering(false);

    const moveTo = (
      from: PointerPoint,
      to: PointerPoint,
      duration: number,
      onDone: () => void,
    ): void => {
      const { xs, ys } = pathArrays(from, to);
      const times = mouseTravelTimes(xs.length);
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

    const wander = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field);
      if (!box) {
        frame = window.requestAnimationFrame(wander);
        return;
      }
      const stops = pointerWanderStops(box);
      if (stops.length === 0) return;
      hopRef.current += 1;
      const next = stops[hopRef.current % stops.length];
      if (!next) return;
      const from = lastPointRef.current ?? next;
      moveTo(from, next, wanderHopDurationMs(from, next) / 1000, wander);
    };

    const arrive = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field);
      if (!box) {
        frame = window.requestAnimationFrame(arrive);
        return;
      }
      stopTravel();
      const park = pointerParkPoint(box);
      const first = pointerWanderStops(box)[0] ?? park;
      const from = lastPointRef.current ?? pointerEntryPoint(first);
      if (reduceMotion) {
        x.set(park.x);
        y.set(park.y);
        opacity.set(1);
        lastPointRef.current = park;
        setWandering(true);
        return;
      }
      x.set(from.x);
      y.set(from.y);
      animate(opacity, 1, { duration: FADE_SECONDS, ease: 'easeOut' });
      moveTo(from, first, mouseTravelDurationMs(from, first) / 1000, (): void => {
        setWandering(true);
        wander();
      });
    };

    frame = window.requestAnimationFrame(arrive);
    return (): void => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      stopTravel();
    };
  }, [field, originRef, opacity, reduceMotion, x, y]);

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
      data-pointer-wandering={wandering && Boolean(field) ? 'true' : 'false'}
      data-pointer-settled={wandering && Boolean(field) ? 'true' : 'false'}
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
