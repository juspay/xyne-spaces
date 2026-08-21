import { useEffect, useState, type ReactElement } from 'react';
import type { User } from '@xyne/shared/machines';
import { ChevronRight, MicOn } from '@xyne/icons';
import { AudioLines } from 'lucide-react';
import { Button } from '../../../components/ui/Button/Button';
import Avatar from '../../../components/ui/Avatar/Avatar';
import type { OatsRecordingEntry } from '../../../hooks/usePaginatedOatsRecordings';
import {
  calculateRecordingElapsedMs,
  formatElapsedTime,
  formatRecordingDuration,
  getRecordingTagDotColor,
  normalizeRecordingTags,
} from '../../../utils/recordingUtils';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { TextShimmer } from '../../../components/ui/ShimmerText';
import { useRecordingTitleState } from '../../../hooks/useRecordingTitleState';
import { formatRecordingTimestamp, toRecordingTitleInput } from '../utils/RecordingsV2.utils';

export interface RecordingsV2PillProps {
  recording: Pick<
    OatsRecordingEntry,
    'id' | 'externalId' | 'title' | 'startedAt' | 'endedAt' | 'status' | 'aiSummary' | 'transcript'
  >;
  creator: User | null;
  tags?: string[];
  /** Resolves a tag value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: (label: string) => string;
  onOpen: (recordingId: string) => void;
}

export interface RecordingsV2LivePillProps {
  title?: string;
  startedAt: number;
  isPaused?: boolean;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
  onOpenWindow?: () => void;
}

export const RecordingsV2LivePill = ({
  title,
  startedAt,
  isPaused = false,
  pauseStartedAt,
  accumulatedPausedMs,
  onOpenWindow,
}: RecordingsV2LivePillProps): ReactElement => {
  const [elapsedMs, setElapsedMs] = useState(() =>
    calculateRecordingElapsedMs(startedAt, pauseStartedAt, accumulatedPausedMs),
  );
  const normalizedTitle = title?.trim();
  const displayTitle =
    !normalizedTitle || normalizedTitle === 'Untitled Recording'
      ? 'Impromptu recording'
      : normalizedTitle;

  useEffect(() => {
    const updateElapsed = (): void => {
      setElapsedMs(calculateRecordingElapsedMs(startedAt, pauseStartedAt, accumulatedPausedMs));
    };

    updateElapsed();
    if (isPaused) return;

    const interval = window.setInterval(() => {
      updateElapsed();
    }, 1000);

    return (): void => window.clearInterval(interval);
  }, [accumulatedPausedMs, isPaused, pauseStartedAt, startedAt]);

  return (
    <section
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 shadow-sm',
        'transition-[border-color,box-shadow] duration-200 hover:border-primary/50 hover:shadow-[0_5px_20px_rgb(0,0,0,0.08)]',
      )}
      aria-label={`${displayTitle}, recording in progress`}
    >
      <span className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'>
        <MicOn size={16} strokeWidth={2} variant='Contrast' />
      </span>

      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-semibold text-foreground'>{displayTitle}</span>
        <span className='mt-0.5 flex min-w-0 items-center gap-2 text-xs text-primary'>
          <span className='size-2 shrink-0 rounded-full bg-primary' aria-hidden='true' />
          <span>{isPaused ? 'Recording paused' : 'Recording in progress'}</span>
          <span aria-hidden='true'>·</span>
          <span className='font-mono tabular-nums'>{formatElapsedTime(elapsedMs)}</span>
        </span>
      </span>

      <Button
        type='button'
        variant='ghost'
        onClick={onOpenWindow}
        className='h-9 shrink-0 rounded-xl bg-foreground px-3 text-sm text-background hover:bg-foreground/90 hover:text-background'
        data-track-category='RecordingsV2'
        data-track-name='open_live_recording_window'
      >
        <span className='hidden sm:inline'>Open window</span>
        <ChevronRight size={16} />
      </Button>
    </section>
  );
};

const RecordingsV2Pill = ({
  recording,
  creator,
  tags = [],
  resolveLabel = (label: string) => label,
  onOpen,
}: RecordingsV2PillProps): ReactElement => {
  const titleState = useRecordingTitleState(toRecordingTitleInput(recording));
  const durationMs = recording.endedAt
    ? Math.max(0, recording.endedAt - recording.startedAt)
    : null;
  const visibleTags = normalizeRecordingTags(tags);
  const handleOpen = (): void => {
    onOpen(recording.externalId);
  };

  return (
    <button
      type='button'
      onClick={handleOpen}
      className='group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      aria-label={
        titleState.kind === 'generating'
          ? 'Open recording — title is being generated'
          : `Open recording ${titleState.text}`
      }
      data-track-category='RecordingsV2'
      data-track-name='open_recording'
      data-track-metadata={JSON.stringify({ recordingId: recording.id })}
    >
      <div className='relative mt-0.5 shrink-0'>
        <span className='flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors duration-150 group-hover:bg-border group-hover:text-foreground'>
          <AudioLines size={20} strokeWidth={2.2} />
        </span>
        {creator && (
          <span className='absolute -bottom-1 -right-1 flex rounded-full bg-background p-0.5'>
            <Avatar
              userId={creator.id}
              size='sm'
              rounded
              showActiveStatus={false}
              className='ring-1 ring-background'
            />
          </span>
        )}
      </div>

      <span className='flex min-w-0 flex-1 flex-col gap-2'>
        <span className='flex min-w-0 items-start justify-between gap-4'>
          <span className='min-w-0 flex-1'>
            {titleState.kind === 'generating' ? (
              <TextShimmer
                as='span'
                glassEffect={false}
                className='shimmer-text-themed block truncate text-sm font-semibold'
              >
                Generating title…
              </TextShimmer>
            ) : (
              <span className='block truncate text-sm font-semibold text-foreground'>
                {titleState.text}
              </span>
            )}
            <span className='mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
              <span className='truncate'>
                {creator ? getUserDisplayName(creator) : 'Unknown creator'}
              </span>
              <span aria-hidden='true'>·</span>
              <span className='shrink-0'>{formatRecordingTimestamp(recording.startedAt)}</span>
            </span>
          </span>

          <span className='flex shrink-0 items-center gap-1 text-right font-mono text-xs leading-5 text-muted-foreground'>
            <span>{formatRecordingDuration(durationMs)}</span>
            <span
              className='flex size-4 shrink-0 -translate-x-1 items-center justify-center opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transform-none'
              aria-hidden='true'
            >
              <ChevronRight className='text-muted-foreground/70' />
            </span>
          </span>
        </span>

        {visibleTags.length > 0 && (
          <span className='flex flex-wrap items-center gap-1.5'>
            {visibleTags.map(tag => (
              <span
                key={tag}
                className='inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors'
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    getRecordingTagDotColor(resolveLabel(tag)),
                  )}
                  aria-hidden='true'
                />
                <span className='max-w-32 truncate'>{resolveLabel(tag)}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
};

export default RecordingsV2Pill;
