import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useTheme } from '@/hooks/useTheme';
import type { AgentCreateField } from './types';
import {
  mouseTravelDurationMs,
  mouseTravelPath,
  mouseTravelTimes,
  pointerEntryPoint,
  type PointerPoint,
} from './writingPointerPath';

const LIGHT_SRC = '/svgs/icons/pointer-cursor-light.svg';
const DARK_SRC = '/svgs/icons/pointer-cursor-dark.svg';
const SIZE = 20;
const TRAVEL_EASE = [0.42, 0, 0.2, 1] as const;
const FADE_SECONDS = 0.16;

function measureField(origin: HTMLElement, field: AgentCreateField): PointerPoint | null {
  const host = origin.querySelector(`[data-create-field="${field}"]`);
  if (!host) return null;
  const box = host.getBoundingClientRect();
  const root = origin.getBoundingClientRect();
  const inline = field === 'name' || field === 'slug';
  return {
    x: box.left - root.left + (inline ? 6 : 4),
    y: box.top - root.top + (inline ? 4 : 22),
  };
}

interface WritingFieldPointerProps {
  field: AgentCreateField | null;
  originRef: RefObject<HTMLDivElement | null>;
}

/**
 * Canvas overlay pointer. Motion `animate()` drives x/y/opacity motion values
 * along a curved human-like path. Visible only while `writingField` is set.
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

    const run = (): void => {
      if (cancelled) return;
      const target = measureField(origin, field);
      if (!target) {
        frame = window.requestAnimationFrame(run);
        return;
      }
      const from = lastPointRef.current ?? pointerEntryPoint(target);
      lastPointRef.current = target;
      stopTravel();
      if (reduceMotion) {
        x.set(target.x);
        y.set(target.y);
        opacity.set(1);
        setSettled(true);
        return;
      }
      const path = mouseTravelPath(from, target);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < path.length; i += 1) {
        const point = path[i];
        if (!point) continue;
        xs.push(point.x);
        ys.push(point.y);
      }
      const duration = mouseTravelDurationMs(from, target) / 1000;
      const times = mouseTravelTimes(xs.length);
      x.set(from.x);
      y.set(from.y);
      animate(x, xs, {
        duration,
        ease: TRAVEL_EASE,
        times,
        onComplete: (): void => {
          if (!cancelled) {
            setSettled(true);
          }
        },
      });
      animate(y, ys, { duration, ease: TRAVEL_EASE, times });
      animate(opacity, 1, { duration: FADE_SECONDS, ease: 'easeOut' });
    };

    frame = window.requestAnimationFrame(run);
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
      data-pointer-settled={settled && Boolean(field) ? 'true' : 'false'}
      className='pointer-events-none absolute top-0 left-0 z-20'
      style={{
        x,
        y,
        opacity,
        willChange: settled || !field ? 'auto' : 'transform',
      }}
    />
  );
}
