import { type ReactElement, useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '../../../../utils/classNames';
import type { RecapCard } from '../../../RecapPanel/RecapPanel.types';

interface RecapCardsListProps {
  cards: RecapCard[];
  isMobile?: boolean;
  className?: string;
  onView?: (card: RecapCard) => void;
}

export function RecapCardsList({
  cards,
  isMobile = false,
  className,
  onView,
}: RecapCardsListProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowTopFade(el.scrollTop > 4);
    setShowBottomFade(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    updateFades();
  }, [cards, updateFades]);

  const showFades = !isMobile;

  return (
    <div className={cn('relative', className)}>
      {showFades && showTopFade && (
        <div className='absolute top-0 inset-x-0 h-8 bg-gradient-to-b from-background to-transparent pointer-events-none z-10' />
      )}
      <div
        ref={scrollRef}
        onScroll={updateFades}
        className={cn(
          'flex flex-col gap-4',
          isMobile ? 'overflow-visible' : 'max-h-[260px] overflow-y-auto scrollbar-none',
        )}
      >
        {cards.map(card => (
          <div key={card.channelId} className='flex items-start gap-3 sm:gap-4'>
            <div className='w-[3px] self-stretch rounded-full bg-blue-500 shrink-0 mt-0.5' />
            <div className='flex flex-1 flex-col gap-1.5 min-w-0 py-0.5'>
              <p className='text-[14px] font-medium leading-[1.2] text-primary truncate'>
                #{card.channelName}
              </p>
              {card.summary[0] && (
                <p className='text-[12.5px] leading-[1.5] text-muted-foreground/80 line-clamp-2'>
                  {card.summary[0]}
                </p>
              )}
            </div>
            <button
              type='button'
              onClick={() => onView?.(card)}
              className='shrink-0 text-xs text-muted-foreground/60 hover:text-primary transition-colors mt-0.5'
              data-track-category='AILanding'
              data-track-name='ViewRecapChannel'
              data-track-metadata={JSON.stringify({ channelId: card.channelId })}
            >
              View
            </button>
          </div>
        ))}
      </div>
      {showFades && showBottomFade && (
        <div className='absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none z-10' />
      )}
    </div>
  );
}
