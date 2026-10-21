import { ReactElement } from 'react';
import { formatTime } from './CalenderViewUtils';
import { OtherUserCallDetails } from './OtherUserCallDetails';
import type { OtherUserBusySlot } from '../../hooks/useOtherUserCalls';
import { Popover } from '../../components/ui/Popover/Popover';

interface OtherUserEventBlockProps {
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  color: string;
  title: string | undefined;
  startsAt: number;
  endsAt: number | null;
  /**
   * The slot as the API returned it. A public calendar's slot carries a title and
   * participants and opens a details popover on click; a busy slot stays read-only.
   */
  details?: OtherUserBusySlot | undefined;
  /**
   * Controls the details popover. The day/week views drive it from their `openCallId`
   * so their slot cells know a popover is open and the closing click doesn't start a call.
   */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Inline offset around the 2px gutter (default 2px, use 1px for week view) */
  gutterPx?: number;
  /** z-index class (default 'z-[3]') */
  zClass?: string;
  /**
   * When true the outer div receives pointer events (cursor-default) so that
   * Tooltip hover works and click/pointer handlers can stop propagation.
   * When false (default) the block is pointer-events-none (read-only overlay).
   */
  interactive?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * Event block for another user's slot rendered in the time grid. Read-only for a busy
 * slot; a public calendar's slot opens its details on click.
 * Pass interactive=true + stopPropagation handlers when wrapping with a Tooltip.
 */
export function OtherUserEventBlock({
  top,
  height,
  leftPct,
  widthPct,
  color,
  title,
  startsAt,
  endsAt,
  details,
  open,
  onOpenChange,
  gutterPx = 2,
  zClass = 'z-[3]',
  interactive = false,
  onClick,
  onPointerDown,
}: OtherUserEventBlockProps): ReactElement {
  const timeLabel = endsAt
    ? `${formatTime(startsAt)} - ${formatTime(endsAt)}`
    : formatTime(startsAt);
  const showsDetails = details?.title !== undefined;
  const isInteractive = interactive || showsDetails;

  const block = (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      className={`absolute rounded overflow-hidden ${zClass} ${
        showsDetails ? 'cursor-pointer' : isInteractive ? 'cursor-default' : 'pointer-events-none'
      }`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${gutterPx}px)`,
        width: `calc(${widthPct}% - ${gutterPx * 2}px)`,
        backgroundColor: `${color}26`,
        borderLeft: `3px solid ${color}`,
      }}
      data-calendar-pill={showsDetails ? 'true' : undefined}
      data-track-category='CALENDAR'
      data-track-name='other-user-event-block'
      onClick={e => {
        // Keep the click off the grid underneath, which would start a new call there.
        if (showsDetails) e.stopPropagation();
        onClick?.(e);
      }}
      onKeyDown={
        showsDetails
          ? e => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.click();
            }
          : interactive && onClick
            ? e => {
                if (e.key === 'Enter' || e.key === ' ')
                  onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
              }
            : undefined
      }
      onPointerDown={e => {
        if (showsDetails) e.stopPropagation();
        onPointerDown?.(e);
      }}
    >
      <div className='px-1.5 py-1 h-full flex flex-col justify-start overflow-hidden pointer-events-none'>
        <span className='truncate text-[12px] leading-[18px] font-medium' style={{ color }}>
          {title ?? 'Busy'}
        </span>
        {height >= 40 && (
          <span
            className='mt-0.5 whitespace-nowrap text-[10px] leading-[14px] opacity-80'
            style={{ color }}
          >
            {timeLabel}
          </span>
        )}
      </div>
    </div>
  );

  if (!details || !showsDetails) return block;

  return (
    <Popover
      trigger={block}
      side='left'
      align='start'
      sideOffset={8}
      collisionPadding={8}
      {...(open !== undefined && { open })}
      {...(onOpenChange && { onOpenChange })}
    >
      <OtherUserCallDetails details={details} />
    </Popover>
  );
}
