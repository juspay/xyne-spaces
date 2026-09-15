import {
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/utils/classNames';

export const PROSE_BOX_HEIGHT = 298;

interface ScrollFadeBoxProps {
  children: ReactNode;
  height?: number;
  className?: string;
  /** Re-measures when the content behind these changes. */
  resetKeys?: DependencyList;
}

/**
 * Fixed-height scroll area with a bottom fade that only appears while there is
 * more to scroll — so a short body doesn't sit under a pointless gradient.
 */
export function ScrollFadeBox({
  children,
  height = PROSE_BOX_HEIGHT,
  className,
  resetKeys = [],
}: ScrollFadeBoxProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  const sync = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    setShowFade(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(sync, [height, ...resetKeys]);

  return (
    <div className='relative w-full' style={{ height }}>
      <div
        ref={scrollRef}
        onScroll={sync}
        className={cn(
          'h-full w-full overflow-y-auto rounded-2xl border-[0.8px] border-border bg-muted/30 p-4',
          className,
        )}
      >
        {children}
      </div>
      {showFade && (
        <span
          className='pointer-events-none absolute inset-x-px bottom-px h-16 rounded-b-2xl bg-gradient-to-t from-card to-transparent'
          aria-hidden
        />
      )}
    </div>
  );
}

export function ProseBox({
  children,
  height = PROSE_BOX_HEIGHT,
  className,
}: {
  children: string;
  height?: number;
  className?: string;
}): ReactElement {
  return (
    <ScrollFadeBox height={height} {...(className ? { className } : {})} resetKeys={[children]}>
      <p className='whitespace-pre-wrap break-words text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
        {children}
      </p>
    </ScrollFadeBox>
  );
}
