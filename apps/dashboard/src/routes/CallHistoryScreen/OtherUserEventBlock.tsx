import { ReactElement } from 'react';
import { formatTime } from './CalenderViewUtils';

interface OtherUserEventBlockProps {
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  color: string;
  title: string | undefined;
  startsAt: number;
  endsAt: number | null;
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
 * Read-only event block for another user's busy slot rendered in the time grid.
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
  gutterPx = 2,
  zClass = 'z-[3]',
  interactive = false,
  onClick,
  onPointerDown,
}: OtherUserEventBlockProps): ReactElement {
  const timeLabel = endsAt
    ? `${formatTime(startsAt)} - ${formatTime(endsAt)}`
    : formatTime(startsAt);

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`absolute rounded overflow-hidden ${zClass} ${interactive ? 'cursor-default' : 'pointer-events-none'}`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${gutterPx}px)`,
        width: `calc(${widthPct}% - ${gutterPx * 2}px)`,
        backgroundColor: `${color}26`,
        borderLeft: `3px solid ${color}`,
      }}
      data-track-category='CALENDAR'
      data-track-name='other-user-event-block'
      onClick={onClick}
      onKeyDown={
        interactive && onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ')
                onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
            }
          : undefined
      }
      onPointerDown={onPointerDown}
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
}
