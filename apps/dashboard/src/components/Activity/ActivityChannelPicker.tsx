import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { ChannelVisibility } from '@xyne/shared';
import { ChevronLeft, Hashtag, Lock02Close, SearchDefault } from '@xyne/icons';
import { useAllChannels, useUserChannelStatuses } from '../../hooks/useChannels';
import { usePlatform } from '../../hooks/usePlatform';
import { stateMachineActor } from '../../machines/stateMachine';
import { isAllVisibleActivity } from '../../utils/activityVisibility';
import { isDMChannel } from '../Chat/ChatDirectory/ChatDirectory.utils';
import { cn } from '../../utils/classNames';

interface ActivityChannelPickerProps {
  selectedChannelIds: string[];
  onChange: (channelIds: string[]) => void;
  onBack: () => void;
}

const CHANNEL_LIMIT = 50;

export const ActivityChannelPicker = ({
  selectedChannelIds,
  onChange,
  onBack,
}: ActivityChannelPickerProps): ReactElement => {
  const [query, setQuery] = useState('');
  const [pinnedIds] = useState(() => new Set(selectedChannelIds));
  const searchRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();
  const channels = useAllChannels();
  const channelStatuses = useUserChannelStatuses();
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => searchRef.current?.focus());
    return (): void => cancelAnimationFrame(rafId);
  }, [isMobile]);

  const unreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    unreadActivities?.forEach(activity => {
      if (activity.channelId && isAllVisibleActivity(activity)) {
        counts.set(activity.channelId, (counts.get(activity.channelId) ?? 0) + 1);
      }
    });
    return counts;
  }, [unreadActivities]);

  const pool = useMemo(() => {
    const memberIds = new Set(channelStatuses.map(status => status.channelId));
    return channels
      .filter(
        channel =>
          memberIds.has(channel.id) && !isDMChannel(channel.scopeType) && !channel.isArchived,
      )
      .sort(
        (a, b) =>
          Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) ||
          (unreadCounts.get(b.id) ?? 0) - (unreadCounts.get(a.id) ?? 0) ||
          b.lastActivityAt - a.lastActivityAt,
      );
  }, [channels, channelStatuses, pinnedIds, unreadCounts]);

  const candidates = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const matched = trimmed
      ? pool.filter(channel => channel.name.toLowerCase().includes(trimmed))
      : pool;
    return matched.slice(0, CHANNEL_LIMIT);
  }, [pool, query]);

  return (
    <div
      className='flex flex-col p-1 animate-in slide-in-from-right-2 duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none'
      data-testid='activity-channel-picker'
    >
      <div className='flex items-center justify-between gap-2'>
        <button
          type='button'
          onClick={onBack}
          className='flex h-8 items-center gap-1 rounded-sm pl-1 pr-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[6%] focus-visible:bg-foreground/[6%] focus-visible:outline-none'
          aria-label='Back to activity options'
          data-track-category='ACTIVITY'
          data-track-name='CHANNEL_FILTER_BACK'
          data-testid='activity-channel-picker-back'
        >
          <ChevronLeft size={16} className='text-muted-foreground' />
          Channels
        </button>
        <button
          type='button'
          onClick={() => onChange([])}
          tabIndex={selectedChannelIds.length > 0 ? 0 : -1}
          aria-hidden={selectedChannelIds.length === 0}
          className={cn(
            'h-8 rounded-sm px-2 text-xs font-medium text-muted-foreground transition-[color,background-color,opacity] duration-150 hover:bg-foreground/[6%] hover:text-foreground focus-visible:bg-foreground/[6%] focus-visible:outline-none',
            selectedChannelIds.length === 0 && 'pointer-events-none opacity-0',
          )}
          data-track-category='ACTIVITY'
          data-track-name='CHANNEL_FILTER_CLEAR'
          data-testid='activity-channel-picker-clear'
        >
          Clear
        </button>
      </div>

      <div className='mt-1 flex h-8 items-center gap-2 rounded-sm bg-foreground/[6%] px-2.5'>
        <SearchDefault size={14} className='shrink-0 text-muted-foreground' />
        <input
          ref={searchRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') onBack();
          }}
          placeholder='Search channels'
          aria-label='Search channels'
          className='min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
          data-track-category='ACTIVITY'
          data-track-name='CHANNEL_FILTER_SEARCH'
          data-testid='activity-channel-picker-search'
        />
      </div>

      <div className='mt-1 max-h-[296px] overflow-y-auto overscroll-contain'>
        {candidates.map(channel => {
          const isSelected = selectedChannelIds.includes(channel.id);
          const unread = unreadCounts.get(channel.id) ?? 0;
          const ChannelGlyph =
            channel.visibility === ChannelVisibility.PRIVATE ? Lock02Close : Hashtag;
          return (
            <button
              key={channel.id}
              type='button'
              role='checkbox'
              aria-checked={isSelected}
              onClick={() =>
                onChange(
                  isSelected
                    ? selectedChannelIds.filter(id => id !== channel.id)
                    : [...selectedChannelIds, channel.id],
                )
              }
              className='flex h-9 w-full items-center gap-2.5 rounded-sm px-2 text-sm text-foreground transition-colors hover:bg-foreground/[6%] focus-visible:bg-foreground/[6%] focus-visible:outline-none'
              data-track-category='ACTIVITY'
              data-track-name='CHANNEL_FILTER_TOGGLE'
              data-track-metadata={JSON.stringify({
                channel_id: channel.id,
                selected: !isSelected,
              })}
              data-testid={`activity-channel-picker-option-${channel.id}`}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-150',
                  isSelected ? 'border-primary bg-primary' : 'border-border bg-card',
                )}
              >
                <svg
                  viewBox='0 0 10 8'
                  fill='none'
                  className={cn(
                    'h-2 w-2.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
                    isSelected
                      ? 'scale-100 opacity-100 blur-0'
                      : 'scale-[0.25] opacity-0 blur-[4px]',
                  )}
                >
                  <path
                    d='M1 4L3.5 6.5L9 1'
                    stroke='hsl(var(--primary-foreground))'
                    strokeWidth='1.6'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </span>
              <ChannelGlyph size={14} className='shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1 truncate text-left'>{channel.name}</span>
              {unread > 0 && (
                <span className='shrink-0 rounded-md bg-foreground/[6%] px-1 text-[0.625rem] font-bold tabular-nums text-muted-foreground'>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          );
        })}

        {candidates.length === 0 && (
          <div className='px-2 py-6 text-center text-sm text-muted-foreground text-pretty'>
            {query.trim() ? `No channels match “${query.trim()}”` : 'No channels yet'}
          </div>
        )}
      </div>
    </div>
  );
};
