import React from 'react';
import { AudioLines } from 'lucide-react';
import { ChevronRight } from '@xyne/icons';
import { formatElapsedTime } from '../../../utils/recordingUtils';

interface RecordingSharePillProps {
  title: string;
  durationMs: number | null;
  onOpen?: (() => void) | undefined;
}

export const RecordingSharePill: React.FC<RecordingSharePillProps> = ({
  title,
  durationMs,
  onOpen,
}) => (
  <button
    type='button'
    onClick={event => {
      event.stopPropagation();
      onOpen?.();
    }}
    disabled={!onOpen}
    className='group flex w-full max-w-lg items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-1.5 text-left shadow-sm disabled:cursor-default'
    aria-label={`Open recording ${title}`}
    data-track-category='MESSAGE'
    data-track-name='OPEN_SHARED_RECORDING'
  >
    <span
      className='flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors'
      aria-hidden='true'
    >
      <AudioLines size={14} strokeWidth={2.5} />
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
