import { memo, type ReactElement } from 'react';
import { format } from 'date-fns';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';

export type XyneCalendarCallPillVariant =
  | 'joinable'
  | 'highlighted'
  | 'scheduled'
  | 'declined'
  | 'past';

type CalendarCallTime = Date | number | string;

export interface XyneCalendarCallPillProps {
  title: string;
  variant: XyneCalendarCallPillVariant;
  startsAt?: CalendarCallTime | null;
  endsAt?: CalendarCallTime | null;
  channelName?: string;
  metadata?: string;
  onSelect: () => void;
  onJoin?: () => void;
  joinable?: boolean;
  showJoinByDefault?: boolean;
  joinDisabled?: boolean;
  past?: boolean;
  compact?: boolean;
  showCompactMetadata?: boolean;
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

const XyneCalendarCallPillComponent = ({
  title,
  variant,
  startsAt,
  endsAt,
  channelName,
  metadata,
  onSelect,
  onJoin,
  joinable = false,
  showJoinByDefault = false,
  joinDisabled = false,
  past = false,
  compact = false,
  showCompactMetadata = false,
  className,
}: XyneCalendarCallPillProps): ReactElement => {
  const timeRange = getTimeRange(startsAt, endsAt);
  const accessibleMetadata = [timeRange, channelName ? `#${channelName}` : '', metadata]
    .filter(Boolean)
    .join(' · ');
  const isPast = past || variant === 'past';
  const accessibleLabel = [joinable ? 'Active call' : '', title, accessibleMetadata]
    .filter(Boolean)
    .join(', ');
  const showSecondaryInformation = !compact || showCompactMetadata;
  const hasSecondaryInformation =
    (showSecondaryInformation && Boolean(timeRange || channelName)) ||
    (!compact && Boolean(metadata));
  const secondaryTextClass =
    variant === 'highlighted' ? 'text-primary-foreground/90' : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'group flex w-full cursor-pointer items-center overflow-hidden rounded-xl border transition-all',
        variant === 'past'
          ? 'border-border bg-muted/60 text-muted-foreground'
          : variant === 'highlighted'
            ? 'border-primary bg-primary text-primary-foreground'
            : variant === 'declined'
              ? 'border-border bg-background text-muted-foreground'
              : 'border-primary bg-background text-foreground',
        isPast && variant !== 'past' && 'opacity-60 hover:opacity-90',
        'hover:shadow-sm',
        className,
      )}
    >
      <Button
        type='button'
        variant='ghost'
        onClick={onSelect}
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

              {showSecondaryInformation && channelName && (
                <span
                  className={cn(
                    'min-w-0 shrink truncate text-xs font-normal leading-tight',
                    secondaryTextClass,
                  )}
                >
                  #{channelName}
                </span>
              )}

              {!compact && metadata && (
                <span
                  className={cn(
                    'min-w-0 shrink truncate text-xs font-normal leading-tight',
                    secondaryTextClass,
                  )}
                >
                  {metadata}
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
          onClick={onJoin}
          disabled={joinDisabled}
          data-track-category='Calendar'
          data-track-name='JOIN_CALL_PILL'
          className={cn(
            'mr-2 h-6 rounded-full bg-foreground px-3 text-xs text-background hover:bg-foreground/90',
            !showJoinByDefault && 'hidden group-hover:inline-flex group-focus-within:inline-flex',
          )}
        >
          Join
        </Button>
      )}
    </div>
  );
};

export const XyneCalendarCallPill = memo(XyneCalendarCallPillComponent);

XyneCalendarCallPill.displayName = 'XyneCalendarCallPill';
