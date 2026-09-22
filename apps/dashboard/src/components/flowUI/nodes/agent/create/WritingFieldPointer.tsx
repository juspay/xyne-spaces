import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentCreateField } from './types';
import {
  mouseTravelDurationMs,
  mouseTravelTimes,
  pickTravelPath,
  pointerEntryPoint,
  pointerLandingPoint,
  pointerParkPoint,
  pointerSettlePath,
  pointerWanderStops,
  type FieldBox,
  type PointerPoint,
  type TravelKind,
} from './writingPointerPath';

const LIGHT_SRC = '/svgs/icons/pointer-cursor-light.svg';
const DARK_SRC = '/svgs/icons/pointer-cursor-dark.svg';
const SIZE = 20;
const TRAVEL_EASE = [0.42, 0, 0.2, 1] as const;
const HOVER_EASE = [0.33, 0, 0.2, 1] as const;
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

function pathArrays(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind,
): { xs: number[]; ys: number[] } {
  const path = pickTravelPath(from, to, kind);
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
 * Figma write pointer. Swishes onto field text, settles, hovers while typing,
 * then arcs down to the next field via Motion `animate()` on motion values.
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
  const prevFieldRef = useRef<AgentCreateField | null>(null);
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
      prevFieldRef.current = field;
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

    const travelKind = (): TravelKind => {
      if (reduceMotion) return 'reduced';
      const prev = prevFieldRef.current;
      if (prev && prev !== field && lastPointRef.current) return 'field-down';
      if (!lastPointRef.current) return 'entry';
      return 'field-down';
    };

    const moveAlong = (
      xs: number[],
      ys: number[],
      duration: number,
      kind: TravelKind,
      onDone: () => void,
    ): void => {
      const times = mouseTravelTimes(xs.length, kind);
      const ease = kind === 'wander' || kind === 'settle' ? HOVER_EASE : TRAVEL_EASE;
      const lastX = xs[xs.length - 1];
      const lastY = ys[ys.length - 1];
      if (lastX !== undefined && lastY !== undefined) {
        lastPointRef.current = { x: lastX, y: lastY };
      }
      animate(x, xs, {
        duration,
        ease,
        times,
        onComplete: (): void => {
          if (!cancelled) {
            onDone();
          }
        },
      });
      animate(y, ys, { duration, ease, times });
    };

    const moveTo = (
      from: PointerPoint,
      to: PointerPoint,
      kind: TravelKind,
      onDone: () => void,
    ): void => {
      const { xs, ys } = pathArrays(from, to, kind);
      moveAlong(xs, ys, mouseTravelDurationMs(from, to, kind) / 1000, kind, onDone);
    };

    const hover = (): void => {
      if (cancelled || reduceMotion) return;
      const box = measureBox(origin, field);
      if (!box) {
        frame = window.requestAnimationFrame(hover);
        return;
      }
      const stops = pointerWanderStops(box);
      if (stops.length === 0) return;
      hopRef.current += 1;
      const next = stops[hopRef.current % stops.length];
      if (!next) return;
      const from = lastPointRef.current ?? next;
      moveTo(from, next, 'wander', hover);
    };

    const settle = (at: PointerPoint): void => {
      if (cancelled) return;
      if (reduceMotion) {
        setWandering(true);
        return;
      }
      const wiggle = pointerSettlePath(at);
      moveAlong(
        wiggle.map(p => p.x),
        wiggle.map(p => p.y),
        mouseTravelDurationMs(at, at, 'settle') / 1000,
        'settle',
        (): void => {
          setWandering(true);
          hover();
        },
      );
    };

    const arrive = (): void => {
      if (cancelled) return;
      const box = measureBox(origin, field);
      if (!box) {
        frame = window.requestAnimationFrame(arrive);
        return;
      }
      stopTravel();
      const landing = pointerLandingPoint(box);
      const kind = travelKind();
      const from =
        kind === 'entry' || !lastPointRef.current
          ? pointerEntryPoint(landing)
          : lastPointRef.current;

      if (reduceMotion) {
        const park = pointerParkPoint(box);
        x.set(park.x);
        y.set(park.y);
        opacity.set(1);
        lastPointRef.current = park;
        prevFieldRef.current = field;
        setWandering(true);
        return;
      }

      if (kind === 'entry' || !lastPointRef.current) {
        x.set(from.x);
        y.set(from.y);
      }
      animate(opacity, 1, { duration: FADE_SECONDS, ease: 'easeOut' });
      moveTo(from, landing, kind, (): void => {
        prevFieldRef.current = field;
        settle(landing);
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
