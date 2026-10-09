import { memo, type ReactElement } from 'react';
import { format } from 'date-fns';
import { ChatDefault, Hashtag, Lock02Close } from '@xyne/icons';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import {
  getCallPillVariantClasses,
  HATCH_BACKGROUND,
} from '../../../routes/CallHistoryScreen/CalenderViewUtils';
import type { XyneCalendarChannelPresentation } from './xyneCalendarSidebar.utils';

export type XyneCalendarCallPillVariant =
  | 'joinable'
  | 'highlighted'
  | 'scheduled'
  | 'declined'
  | 'past';

type CalendarCallTime = Date | number | string;

export interface XyneCalendarCallPillProps {
  callId: string;
  title: string;
  variant: XyneCalendarCallPillVariant;
  startsAt?: CalendarCallTime | null;
  endsAt?: CalendarCallTime | null;
  channel?: XyneCalendarChannelPresentation;
  onSelect: (callId: string) => void;
  onJoin?: (callId: string) => void;
  joinable?: boolean;
  showJoinByDefault?: boolean;
  joinDisabled?: boolean;
  past?: boolean;
  compact?: boolean;
  showCompactMetadata?: boolean;
  /** Call started before the day being rendered — clipped at the top edge. */
  continuesFromPreviousDay?: boolean;
  /** Call ends after the day being rendered — clipped at the bottom edge. */
  continuesToNextDay?: boolean;
  className?: string;
}

const formatTime = (value: CalendarCallTime | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'h:mm a');
};

const getTimeRange = (
  startsAt: CalendarCallTime | null | undefined,
  endsAt: CalendarCallTime | null | undefined,
): string => {
  const startTime = formatTime(startsAt);
  const endTime = formatTime(endsAt);

  if (startTime && endTime) return `${startTime} – ${endTime}`;
  return startTime || endTime;
};

/** Chat/lock/hashtag icon for a call pill's channel chip, by scope + visibility. */
export const ChannelScopeIcon = ({
  channel,
}: {
  channel: Pick<XyneCalendarChannelPresentation, 'scopeType' | 'visibility'>;
}): ReactElement => {
  if (
    channel.scopeType === ChannelScopeType.DM ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  ) {
    return <ChatDefault className='size-3 shrink-0' aria-hidden='true' />;
  }
  if (channel.visibility === ChannelVisibility.PRIVATE) {
    return <Lock02Close className='size-3 shrink-0' aria-hidden='true' />;
  }
  return <Hashtag className='size-3 shrink-0' aria-hidden='true' />;
};

const XyneCalendarCallPillComponent = ({
  callId,
  title,
  variant,
  startsAt,
  endsAt,
  channel,
  onSelect,
  onJoin,
  joinable = false,
  showJoinByDefault = false,
  joinDisabled = false,
  past = false,
  compact = false,
  showCompactMetadata = false,
  continuesFromPreviousDay = false,
  continuesToNextDay = false,
  className,
}: XyneCalendarCallPillProps): ReactElement => {
  const timeRange = getTimeRange(startsAt, endsAt);
  const accessibleMetadata = [timeRange, channel?.label ?? ''].filter(Boolean).join(' · ');
  const isPast = past || variant === 'past';
  const accessibleLabel = [joinable ? 'Active call' : '', title, accessibleMetadata]
    .filter(Boolean)
    .join(', ');
  const showSecondaryInformation = !compact || showCompactMetadata;
  const hasSecondaryInformation = showSecondaryInformation && Boolean(timeRange || channel);
  const secondaryTextClass =
    variant === 'highlighted' ? 'text-primary-foreground/90' : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'group relative flex w-full cursor-pointer items-center overflow-hidden rounded-xl border transition-all',
        getCallPillVariantClasses(variant),
        isPast && variant !== 'past' && 'opacity-60 hover:opacity-90',
        'hover:shadow-sm',
        continuesFromPreviousDay && 'rounded-t-none border-t-0',
        continuesToNextDay && 'rounded-b-none border-b-0',
        className,
      )}
    >
      {continuesFromPreviousDay && (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 top-0 h-3'
          style={{ backgroundImage: HATCH_BACKGROUND }}
        />
      )}
      {continuesToNextDay && (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 bottom-0 h-3'
          style={{ backgroundImage: HATCH_BACKGROUND }}
        />
      )}
      <Button
        type='button'
        variant='ghost'
        onClick={() => onSelect(callId)}
        title={accessibleLabel}
        aria-label={accessibleLabel}
        data-track-category='Calendar'
        data-track-name='SELECT_CALL_PILL'
        className={cn(
          'h-full min-w-0 flex-1 justify-start overflow-hidden whitespace-normal rounded-none px-2.5 py-1 text-left hover:bg-transparent',
          variant === 'highlighted' && 'text-primary-foreground hover:text-primary-foreground',
          variant === 'declined' && 'text-muted-foreground hover:text-muted-foreground',
          variant === 'past' && 'text-muted-foreground hover:text-foreground/80',
        )}
      >
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-x-2 gap-y-0.5 overflow-hidden',
            compact ? 'flex-nowrap' : 'flex-wrap',
          )}
        >
          <span className='flex min-w-24 flex-1 basis-40 items-center gap-1.5 overflow-hidden'>
            {joinable && (
              <span className='flex shrink-0 items-center gap-1' aria-hidden='true'>
                <span
                  className={cn(
                    'block size-2 flex-none rounded-full motion-safe:animate-pulse',
                    variant === 'highlighted' ? 'bg-primary-foreground' : 'bg-status-success',
                  )}
                />
                {showJoinByDefault && !compact && (
                  <span
                    className={cn(
                      'text-xs font-semibold leading-none',
                      variant === 'highlighted' ? 'text-primary-foreground/90' : 'text-primary',
                    )}
                  >
                    Live
                  </span>
                )}
              </span>
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs font-semibold leading-tight',
                variant === 'declined' && 'line-through',
              )}
            >
              {title}
            </span>
          </span>

          {hasSecondaryInformation && (
            <span className='flex min-w-0 max-w-full shrink items-center gap-2 overflow-hidden whitespace-nowrap'>
              {showSecondaryInformation && timeRange && (
                <span
                  className={cn('shrink-0 text-xs font-normal leading-tight', secondaryTextClass)}
                >
                  {timeRange}
                </span>
              )}

              {showSecondaryInformation && channel && (
                <span
                  className={cn(
                    'flex min-w-0 shrink items-center gap-1 text-xs font-normal leading-tight',
                    secondaryTextClass,
                  )}
                >
                  <ChannelScopeIcon channel={channel} />
                  <span className='truncate'>{channel.label}</span>
                </span>
              )}
            </span>
          )}
        </span>
      </Button>

      {joinable && onJoin && (
        <Button
          type='button'
          size='sm'
          onClick={() => onJoin(callId)}
          disabled={joinDisabled}
          data-track-category='Calendar'
          data-track-name='JOIN_CALL_PILL'
          className={cn(
            'mr-2 h-6 rounded-full px-3 text-xs',
            joinDisabled
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-foreground text-background hover:bg-foreground/90',
            !showJoinByDefault &&
              !joinDisabled &&
              'hidden group-hover:inline-flex group-focus-within:inline-flex',
          )}
        >
          {joinDisabled ? 'Joined' : 'Join'}
        </Button>
      )}
    </div>
  );
};

export const XyneCalendarCallPill = memo(XyneCalendarCallPillComponent);

XyneCalendarCallPill.displayName = 'XyneCalendarCallPill';
