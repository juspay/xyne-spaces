import React, { type ReactNode } from 'react';
import { ChevronRight } from '@xyne/icons';
import { formatElapsedTime } from '../../../utils/recordingUtils';

export interface EntitySharePillProps {
  title: string;
  durationMs: number | null;
  /** Leading glyph naming what was shared. */
  icon: ReactNode;
  /** Screen-reader label for the whole card, e.g. 'Open recording Standup'. */
  ariaLabel: string;
  /** Omit to render the card inert — the viewer has no access to open it. */
  onOpen?: (() => void) | undefined;
  trackName?: string;
}

/**
 * The card a shared call or recording renders as inside a channel message. One
 * component so "a recording in a message" and "a call in a message" stay visually
 * identical; RecordingSharePill and CallSharePill are the per-entity bindings.
 */
export const EntitySharePill: React.FC<EntitySharePillProps> = ({
  title,
  durationMs,
  icon,
  ariaLabel,
  onOpen,
  trackName = 'OPEN_SHARED_ENTITY',
}) => (
  <button
    type='button'
    onClick={event => {
      event.stopPropagation();
      onOpen?.();
    }}
    disabled={!onOpen}
    className='group flex w-full max-w-lg items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-1.5 text-left shadow-sm disabled:cursor-default'
    aria-label={ariaLabel}
    data-track-category='MESSAGE'
    data-track-name={trackName}
  >
    <span
      className='flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors'
      aria-hidden='true'
    >
      {icon}
    </span>

    <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>{title}</span>

    {durationMs !== null && (
      <span className='shrink-0 font-mono text-xs tabular-nums text-muted-foreground'>
        {formatElapsedTime(durationMs)}
      </span>
    )}

    {onOpen && (
      <ChevronRight
        size={16}
        strokeWidth={2.5}
        className='shrink-0 text-muted-foreground transition-transform'
        aria-hidden='true'
      />
    )}
  </button>
);
