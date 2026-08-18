import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';

export const PROSE_BOX_HEIGHT = 298;

interface ProseBoxProps {
  children: string;
  height?: number;
  className?: string;
}

export function ProseBox({
  children,
  height = PROSE_BOX_HEIGHT,
  className,
}: ProseBoxProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  const sync = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowFade(remaining > 1);
  };

  useLayoutEffect(sync, [children, height]);

  return (
    <div className='relative w-full' style={{ height }}>
      <div
        ref={scrollRef}
        onScroll={sync}
        className={cn(
          'dt-details-text-field h-full w-full overflow-y-auto rounded-2xl border border-[#e8e8e8] bg-[#fcfcfc] p-4',
          className,
        )}
      >
        <p className='whitespace-pre-wrap break-words text-[14px] font-[450] leading-5 tracking-[-0.28px] text-foreground'>
          {children}
        </p>
      </div>
      {showFade && (
        <span
          className='dt-details-text-fade pointer-events-none absolute inset-x-px bottom-px h-16 rounded-b-2xl bg-gradient-to-t from-[#fcfcfc] to-transparent'
          aria-hidden
        />
      )}
    </div>
  );
}
