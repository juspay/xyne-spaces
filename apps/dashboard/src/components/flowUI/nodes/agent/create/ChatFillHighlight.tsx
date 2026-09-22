import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { cn } from '@/utils/classNames';
import type { AgentCreateField } from './types';

interface ChatFillHighlightProps {
  active: boolean;
  children: ReactNode;
  className?: string;
  /** inline = identity row; block = description / instructions. */
  placement?: 'inline' | 'block';
  field?: AgentCreateField;
}

const SHIMMER_TEXT =
  '[&_input]:bg-[length:220%_100%] [&_textarea]:bg-[length:220%_100%] [&_label]:bg-[length:220%_100%] ' +
  '[&_input]:bg-clip-text [&_textarea]:bg-clip-text [&_label]:bg-clip-text ' +
  '[&_input]:[-webkit-text-fill-color:transparent] [&_textarea]:[-webkit-text-fill-color:transparent] [&_label]:[-webkit-text-fill-color:transparent] ' +
  '[&_input]:[caret-color:hsl(var(--foreground))] [&_textarea]:[caret-color:hsl(var(--foreground))] ' +
  '[&_input]:[background-image:linear-gradient(90deg,hsl(var(--foreground))_0%,hsl(var(--foreground)/0.38)_48%,hsl(var(--foreground))_100%)] ' +
  '[&_textarea]:[background-image:linear-gradient(90deg,hsl(var(--foreground))_0%,hsl(var(--foreground)/0.38)_48%,hsl(var(--foreground))_100%)] ' +
  '[&_label]:[background-image:linear-gradient(90deg,hsl(var(--muted-foreground))_0%,hsl(var(--muted-foreground)/0.35)_48%,hsl(var(--muted-foreground))_100%)] ' +
  '[&_input]:[background-position:var(--create-shimmer)_50%] [&_textarea]:[background-position:var(--create-shimmer)_50%] [&_label]:[background-position:var(--create-shimmer)_50%]';

/**
 * Marks the field being written. No bounding box — the pointer plus a
 * Motion text shimmer are the only write cues.
 */
export function ChatFillHighlight({
  active,
  children,
  className,
  placement = 'block',
  field,
}: ChatFillHighlightProps): ReactElement {
  const reduceMotion = useReducedMotion() === true;
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!active || reduceMotion) {
      host.style.removeProperty('--create-shimmer');
      return;
    }
    const playback = animate(0, 100, {
      duration: 1.35,
      ease: 'linear',
      repeat: Infinity,
      onUpdate: (latest: number): void => {
        host.style.setProperty('--create-shimmer', `${latest}%`);
      },
    });
    return (): void => {
      playback.stop();
    };
  }, [active, reduceMotion]);

  return (
    <div
      ref={hostRef}
      className={cn('relative', active && !reduceMotion && SHIMMER_TEXT, className)}
      data-agent-writing={active ? 'true' : 'false'}
      data-create-placement={placement}
      data-create-shimmer={active ? 'true' : 'false'}
      {...(field ? { 'data-create-field': field } : {})}
      {...(active ? { 'data-testid': 'create-writing-shimmer' } : {})}
    >
      {children}
    </div>
  );
}
