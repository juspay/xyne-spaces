/**
 * Marker vocabulary shared by every call timeline.
 *
 * One `Call.markedItems` column holds three kinds: `decision` and `action` sit as
 * dots ON the track, `moment` gets a flag ABOVE it. Both the Scribe player bar
 * and the call detail bar draw them, so the glyphs live here rather than either.
 */

import type { ReactElement } from 'react';
import { Flag } from '@xyne/icons';
import { cn } from '../../utils/classNames';
import type { MarkedItemType } from './markedItems';
import type { ParticipantEvent, ParticipantEventType } from './participantEvents';

/** Decisions and actions sit on the track itself — moments get a flag instead. */
export const MARKER_DOT_COLOR: Record<Exclude<MarkedItemType, 'moment'>, string> = {
  decision: 'bg-yellow-500',
  action: 'bg-orange-500',
};

/** Names the marker in its tooltip, so the three kinds read apart without the legend. */
export const MARKER_NOUN: Record<MarkedItemType, string> = {
  decision: 'Decision',
  action: 'Action',
  moment: 'Marked moment',
};

const MARKER_INTERACTIVE =
  "cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2 after:content-[''] motion-reduce:transform-none";

interface MomentFlagProps {
  percent: number;
  title: string;
  onSelect?: () => void;
}

/** Flag pinned to a point on the track — a button only when it can be acted on. */
export const MomentFlag = ({ percent, title, onSelect }: MomentFlagProps): ReactElement => {
  const className = cn(
    'absolute bottom-1.5 z-10 flex -translate-x-0.5',
    onSelect && MARKER_INTERACTIVE,
  );
  const glyph = <Flag size={14} variant='Solid' className='text-primary' aria-hidden='true' />;

  if (!onSelect) {
    return (
      <span className={className} style={{ left: `${percent}%` }} title={title}>
        {glyph}
      </span>
    );
  }

  return (
    <button
      type='button'
      onClick={onSelect}
      data-track-category='CallTimeline'
      data-track-name='marker_open_transcript_moment'
      className={className}
      style={{ left: `${percent}%` }}
      title={title}
      aria-label={title}
    >
      {glyph}
    </button>
  );
};

interface MarkerDotProps {
  percent: number;
  type: Exclude<MarkedItemType, 'moment'>;
  title: string;
  onSelect?: () => void;
}

export const MarkerDot = ({ percent, type, title, onSelect }: MarkerDotProps): ReactElement => {
  const className = cn(
    'absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background',
    MARKER_DOT_COLOR[type],
    onSelect && MARKER_INTERACTIVE,
  );

  if (!onSelect) {
    return <span className={className} style={{ left: `${percent}%` }} title={title} />;
  }

  return (
    <button
      type='button'
      onClick={onSelect}
      data-track-category='CallTimeline'
      data-track-name='marker_open_transcript_item'
      className={className}
      style={{ left: `${percent}%` }}
      title={title}
      aria-label={title}
    />
  );
};

/** Arrival points up and out of the track, departure down and away from it. */
const JOIN_LEAVE_COLOR: Record<ParticipantEventType, string> = {
  join: 'text-emerald-600',
  leave: 'text-muted-foreground',
};

/**
 * Drawn rather than lettered: an arrow glyph would inherit the font's optical
 * weight and stop matching the dots beside it at small sizes.
 */
export const JoinLeaveGlyph = ({
  type,
  size = 9,
}: {
  type: ParticipantEventType;
  size?: number;
}): ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 9 9'
    aria-hidden='true'
    className={cn('shrink-0', JOIN_LEAVE_COLOR[type])}
  >
    <polygon points={type === 'join' ? '4.5,0 9,9 0,9' : '0,0 9,0 4.5,9'} fill='currentColor' />
  </svg>
);

/** One row of a cluster's tooltip: who, what, and when. */
export const JoinLeaveRow = ({
  event,
  timeLabel,
}: {
  event: ParticipantEvent;
  timeLabel: string;
}): ReactElement => (
  <div className='flex items-center gap-2 whitespace-nowrap'>
    <JoinLeaveGlyph type={event.type} />
    <span className='flex-1'>
      {event.name} {event.type === 'join' ? 'joined' : 'left'}
    </span>
    <span className='font-mono text-[11px] opacity-70'>{timeLabel}</span>
  </div>
);

/** Reads the marker vocabulary of the track above it — only the kinds actually on it. */
export const MarkerLegend = ({
  types,
  hasParticipantEvents = false,
  className,
}: {
  types: ReadonlySet<MarkedItemType>;
  /** Joins and leaves are not MarkedItems, so they announce themselves separately. */
  hasParticipantEvents?: boolean;
  className?: string;
}): ReactElement => (
  <div className={cn('flex items-center gap-5 pl-1 text-xs text-muted-foreground', className)}>
    {types.has('decision') && (
      <span className='flex items-center gap-1.5'>
        <span className={cn('size-2 rounded-full', MARKER_DOT_COLOR.decision)} aria-hidden='true' />
        Decisions
      </span>
    )}
    {types.has('action') && (
      <span className='flex items-center gap-1.5'>
        <span className={cn('size-2 rounded-full', MARKER_DOT_COLOR.action)} aria-hidden='true' />
        Actions
      </span>
    )}
    {types.has('moment') && (
      <span className='flex items-center gap-1.5'>
        <Flag size={12} variant='Solid' className='text-primary' aria-hidden='true' />
        Marked moments
      </span>
    )}
    {hasParticipantEvents && (
      <span className='flex items-center gap-1.5'>
        <span className='flex items-center gap-0.5'>
          <JoinLeaveGlyph type='join' size={8} />
          <JoinLeaveGlyph type='leave' size={8} />
        </span>
        Joins &amp; leaves
      </span>
    )}
  </div>
);
