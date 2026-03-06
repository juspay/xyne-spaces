import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import XyneAIStar from '../../icons/xyne-ai/XyneAIStar';
import { MessageType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { SurfaceNudgeCard } from './SurfaceNudgeCard';

interface SurfaceNudgeListProps {
  messageId: string;
  channelId?: string | undefined;
  contentOnly?: boolean | undefined;
  isMobile?: boolean;
  messageType?: MessageType;
  isDeleted?: boolean;
  nudgeCount?: number;
  className?: string;
}

interface ScrollElements {
  nudgeContainer: Element;
  parentMessageBubble: Element;
  scrollContainer: Element;
}

// Helper: Get scroll-related DOM elements for a message
const getScrollElements = (messageId: string): ScrollElements | null => {
  const nudgeContainer = document.querySelector(`[data-nudge-container="${messageId}"]`);
  if (!nudgeContainer) return null;

  const parentMessageBubble = nudgeContainer.closest('[data-component="MessageBubble"]');
  if (!parentMessageBubble) return null;

  const scrollContainer = parentMessageBubble.closest(
    '.overflow-y-auto, .overflow-y-scroll, [style*="overflow-y"]',
  );
  if (!scrollContainer) return null;

  return { nudgeContainer, parentMessageBubble, scrollContainer };
};

// Helper: Calculate distance from bottom of viewport
const getDistanceFromBottom = (elements: ScrollElements): number => {
  const messageRect = elements.parentMessageBubble.getBoundingClientRect();
  const containerRect = elements.scrollContainer.getBoundingClientRect();
  return containerRect.bottom - messageRect.bottom;
};

// Helper: Smooth scroll to a position
const smoothScrollTo = (scrollContainer: Element, scrollTop: number): void => {
  scrollContainer.scrollTo({
    top: scrollTop,
    behavior: 'smooth',
  });
};

export const SurfaceNudgeList: React.FC<SurfaceNudgeListProps> = ({
  messageId,
  channelId,
  contentOnly,
  isMobile,
  messageType,
  isDeleted,
  nudgeCount,
  className,
}) => {
  const isEligibleMessage = messageType
    ? messageType !== MessageType.SYSTEM && messageType !== MessageType.BOT
    : true;
  const enabled = !contentOnly && !isDeleted && isEligibleMessage;

  const actionableCount = nudgeCount ?? 0;
  const hasNudges = actionableCount > 0;
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const savedScrollPositionRef = useRef<number | null>(null);
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const shouldScrollOnExpandRef = useRef<boolean>(false);

  // Handler: Save scroll position before expanding
  const handleToggleExpand = useCallback(() => {
    if (!expanded) {
      const elements = getScrollElements(messageId);
      if (elements) {
        savedScrollPositionRef.current = elements.scrollContainer.scrollTop;

        // Check if we're near the bottom BEFORE expanding
        const distanceFromBottom = getDistanceFromBottom(elements);
        shouldScrollOnExpandRef.current = distanceFromBottom < 150;
      }
    }
    setExpanded(prev => !prev);
  }, [expanded, messageId]);

  const nudgesEnabled = enabled && hasNudges && expanded;
  const [nudgesResult, nudgesDetails] = useCachedQuery(
    queries.entityNudges({
      sourceId: messageId,
      states: ['ACTIVE', 'ACTED_ON'],
    }),
    nudgesEnabled ? { enabled: nudgesEnabled } : false,
  );
  const isLoading = nudgesEnabled && nudgesDetails.type === 'unknown';
  const hasFetched = useRef(false);
  if (nudgesDetails.type === 'complete') {
    hasFetched.current = true;
  }

  const nudges = useMemo(() => {
    const raw = nudgesResult ?? [];
    const kindOrder: Record<string, number> = {
      FIND_RELATED_MESSAGE_FROM_MESSAGE: 0,
      FIND_RELATED_TICKET_FROM_MESSAGE: 1,
      CREATE_TICKET_FROM_MESSAGE: 2,
    };
    return [...raw].sort((a, b) => {
      const ka = kindOrder[a.nudgeKind] ?? 99;
      const kb = kindOrder[b.nudgeKind] ?? 99;
      return ka - kb;
    });
  }, [nudgesResult]);

  const entries = useMemo(() => {
    if (!enabled || !hasNudges || !expanded || nudges.length === 0) return [];
    return nudges;
  }, [enabled, expanded, hasNudges, nudges]);

  // Reset activeIndex when nudges change
  useEffect(() => {
    setActiveIndex(0);
  }, [nudges.length]);

  useEffect(() => {
    if (!hasNudges && expanded) {
      setExpanded(false);
    }
  }, [expanded, hasNudges]);

  // Auto-collapse when all nudges are resolved after initial fetch
  useEffect(() => {
    if (expanded && hasFetched.current && entries.length === 0) {
      setExpanded(false);
    }
  }, [expanded, entries.length]);

  // Clamp activeIndex if entries shrink
  useEffect(() => {
    if (entries.length > 0 && activeIndex >= entries.length) {
      setActiveIndex(entries.length - 1);
    }
  }, [activeIndex, entries.length]);

  // Auto-scroll when nudge button appears for the first time
  useEffect(() => {
    // Reset when nudges disappear
    if (!hasNudges) {
      setHasAutoScrolled(false);
      return;
    }

    if (hasAutoScrolled) {
      return;
    }

    const timer = setTimeout(() => {
      const elements = getScrollElements(messageId);
      if (!elements) return;

      const distanceFromBottom = getDistanceFromBottom(elements);

      // If the nudge button is near the bottom (might be hidden), scroll up
      if (distanceFromBottom < 100) {
        const currentScroll = elements.scrollContainer.scrollTop;
        smoothScrollTo(elements.scrollContainer, currentScroll + 80);
      }

      setHasAutoScrolled(true);
    }, 100);

    return () => clearTimeout(timer);
  }, [hasNudges, hasAutoScrolled, messageId]);

  // Auto-scroll when expanding/collapsing the nudge
  useEffect(() => {
    if (!expanded && savedScrollPositionRef.current === null) {
      return;
    }

    const timer = setTimeout(() => {
      const elements = getScrollElements(messageId);
      if (!elements) return;

      if (expanded) {
        // Use the pre-calculated flag from BEFORE expansion
        if (shouldScrollOnExpandRef.current) {
          const currentScroll = elements.scrollContainer.scrollTop;
          smoothScrollTo(elements.scrollContainer, currentScroll + 250);

          // Second scroll after content fully renders to adjust for actual height
          setTimeout(() => {
            const updatedElements = getScrollElements(messageId);
            if (updatedElements) {
              const finalDistance = getDistanceFromBottom(updatedElements);

              // If still too close to bottom, scroll more
              if (finalDistance < 100) {
                const additionalScroll = 150 - finalDistance;
                const currentPos = updatedElements.scrollContainer.scrollTop;
                smoothScrollTo(updatedElements.scrollContainer, currentPos + additionalScroll);
              }
            }
            shouldScrollOnExpandRef.current = false; // Reset after use
          }, 300);
        }
      } else if (savedScrollPositionRef.current !== null) {
        // Collapsing - always restore original position
        smoothScrollTo(elements.scrollContainer, savedScrollPositionRef.current);
        savedScrollPositionRef.current = null;
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [expanded, messageId]);

  if (!enabled || !hasNudges) return null;

  const suggestionLabel = actionableCount === 1 ? '1 Suggestion' : `${actionableCount} Suggestions`;

  const currentNudge = entries[activeIndex];

  return (
    <div
      className={cn('mt-3 w-full', !isMobile && 'max-w-[640px]', className)}
      data-nudge-container={messageId}
    >
      {/* Collapsed pill trigger */}
      <button
        type='button'
        data-nudge-button={messageId}
        onClick={handleToggleExpand}
        className={cn(
          'inline-flex items-center gap-1 rounded-[8px] border border-[#e4e6e7] bg-[#f2f2f3]',
          'px-[6px] py-[3px]',
          'transition-colors hover:bg-[#ededee]',
        )}
        data-track-category='NUDGES'
        data-track-name={expanded ? 'CollapseNudgeList' : 'ExpandNudgeList'}
      >
        <XyneAIStar size={14} />
        <span className='text-sm tracking-[-0.1px] text-[#646464]'>{suggestionLabel}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[#646464] transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded content */}
      {expanded && isLoading && (
        <div className='mt-2 flex items-center justify-center py-4'>
          <Loader2 className='h-4 w-4 animate-spin text-[#9aa0a5]' />
        </div>
      )}

      {expanded && !isLoading && entries.length === 0 && hasFetched.current && (
        <div className='mt-2 flex items-center justify-center py-3'>
          <span className='text-xs text-[#9aa0a5]'>No suggestions</span>
        </div>
      )}

      {expanded && currentNudge && (
        <div className='mt-2'>
          <SurfaceNudgeCard
            key={currentNudge.id}
            nudge={currentNudge}
            channelId={channelId}
            onActionCompleted={() => {
              if (activeIndex < entries.length - 1) {
                setActiveIndex(prev => prev + 1);
              }
            }}
          />

          {/* Carousel pagination */}
          {entries.length > 1 && (
            <div className='mt-2 flex items-center justify-center gap-3'>
              <button
                type='button'
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex(prev => prev - 1)}
                className={cn(
                  'flex items-center justify-center rounded-[6px] border border-[#eeeeee] bg-white p-1',
                  'transition-colors',
                  activeIndex === 0
                    ? 'cursor-not-allowed text-[#d5d7d9]'
                    : 'text-[#9aa0a5] hover:bg-gray-50',
                )}
                data-track-category='NUDGES'
                data-track-name='PreviousNudge'
              >
                <ChevronLeft className='h-3.5 w-3.5' />
              </button>

              <p className='text-[12px] font-medium tracking-[0.36px] text-[#838383]'>
                {activeIndex + 1} / {entries.length}
              </p>

              <button
                type='button'
                disabled={activeIndex === entries.length - 1}
                onClick={() => setActiveIndex(prev => prev + 1)}
                className={cn(
                  'flex items-center justify-center rounded-[6px] border border-[#eeeeee] bg-white p-1',
                  'transition-colors',
                  activeIndex === entries.length - 1
                    ? 'cursor-not-allowed text-[#d5d7d9]'
                    : 'text-[#9aa0a5] hover:bg-gray-50',
                )}
                data-track-category='NUDGES'
                data-track-name='NextNudge'
              >
                <ChevronRight className='h-3.5 w-3.5' />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
