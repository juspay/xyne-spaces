import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';

interface ClampedProps {
  maxHeight: number;
  resetKey: string;
  className?: string;
  fadeClassName?: string;
  children: ReactNode;
}

export function Clamped({
  maxHeight,
  resetKey,
  className,
  fadeClassName = 'from-card',
  children,
}: ClampedProps): ReactElement {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    setClampable(element ? element.scrollHeight > maxHeight : false);
    setExpanded(false);
  }, [resetKey, maxHeight]);

  const clipped = clampable && !expanded;

  return (
    <div className='flex w-full flex-col gap-4'>
      <div
        className={cn('relative w-full', className)}
        {...(clipped && { style: { maxHeight, overflow: 'hidden' } })}
      >
        <div ref={contentRef}>{children}</div>
        {clipped && (
          <span
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent',
              fadeClassName,
            )}
            aria-hidden
          />
        )}
      </div>
      {clampable && (
        <button
          type='button'
          onClick={() => setExpanded(value => !value)}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: toggle clamped block'
          className='self-start text-xs font-normal leading-4 tracking-[-0.24px] text-foreground underline underline-offset-2'
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
