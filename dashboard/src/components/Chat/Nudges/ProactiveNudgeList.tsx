import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import XyneAIStar from '../../icons/xyne-ai/XyneAIStar';
import { MessageType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { ProactiveNudgeCard } from './ProactiveNudgeCard';

interface ProactiveNudgeListProps {
  messageId: string;
  channelId?: string | undefined;
  contentOnly?: boolean | undefined;
  isMobile?: boolean;
  messageType?: MessageType;
  isDeleted?: boolean;
  nudgeCount?: number;
  className?: string;
}

export const ProactiveNudgeList: React.FC<ProactiveNudgeListProps> = ({
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

  const nudgesEnabled = enabled && hasNudges && expanded;
  const [nudgesResult] = useCachedQuery(
    queries.messageNudges({ messageId, states: ['ACTIVE', 'ACTED_ON'] }),
    nudgesEnabled ? { enabled: nudgesEnabled } : false,
  );
  const nudges = useMemo(() => nudgesResult ?? [], [nudgesResult]);

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

  // Clamp activeIndex if entries shrink
  useEffect(() => {
    if (entries.length > 0 && activeIndex >= entries.length) {
      setActiveIndex(entries.length - 1);
    }
  }, [activeIndex, entries.length]);

  if (!enabled || !hasNudges) return null;

  const suggestionLabel = actionableCount === 1 ? '1 Suggestion' : `${actionableCount} Suggestions`;

  const currentNudge = entries[activeIndex];

  return (
    <div className={cn('mt-3 w-full', !isMobile && 'max-w-[640px]', className)}>
      {/* Collapsed pill trigger */}
      <button
        type='button'
        onClick={() => setExpanded(prev => !prev)}
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

      {/* Expanded: single card + carousel pagination */}
      {expanded && currentNudge && (
        <div className='mt-2'>
          <ProactiveNudgeCard
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
