/**
 * RecordingWorkspaceHeader - Unified header for the active recording workspace.
 */

import { ReactElement, useEffect, useState } from 'react';
import { Podcast, Plus, ChevronDown, Columns2, Layers, AlignLeft } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { RecordingLayout } from '../../../stores/recordingStore';
import { formatTime12Hour, formatElapsedTime } from '../../../utils/recordingUtils';

const layoutTabClassName = (isActive: boolean): string =>
  [
    'flex h-8 items-center gap-1.5 rounded-lg border-0 px-3 text-[12.5px] font-semibold leading-none transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    isActive
      ? 'bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
      : 'bg-transparent text-muted-foreground hover:text-foreground',
  ].join(' ');

interface RecordingWorkspaceHeaderProps {
  /** Recording start timestamp */
  startTime: number | null;
  /** Whether recording is paused */
  isPaused: boolean;
  /** Whether a notes canvas exists */
  hasCanvas: boolean;
  /** Current layout of the recording workspace */
  activeLayout: RecordingLayout;
  /** Whether canvas is being created */
  isCreatingCanvas?: boolean;
  /** Callback to create a notes canvas */
  onCreateCanvas?: () => void;
  /** Callback to change the layout */
  onLayoutChange?: (layout: RecordingLayout) => void;
  /** Callback to minimize the transcript view */
  onMinimize?: () => void;
}

export function RecordingWorkspaceHeader({
  startTime,
  isPaused,
  hasCanvas,
  activeLayout,
  isCreatingCanvas = false,
  onCreateCanvas,
  onLayoutChange,
  onMinimize,
}: RecordingWorkspaceHeaderProps): ReactElement {
  const [elapsedTime, setElapsedTime] = useState('00:00');

  // Update elapsed time every second
  useEffect(() => {
    if (!startTime) return;

    const updateElapsed = (): void => {
      const elapsed = Date.now() - startTime;
      setElapsedTime(formatElapsedTime(elapsed));
    };

    updateElapsed();
    if (isPaused) return;

    const interval = setInterval(updateElapsed, 1000);
    return (): void => clearInterval(interval);
  }, [startTime, isPaused]);

  return (
    <div className='flex-none flex items-center justify-between gap-4 px-5 py-3 border-b border-input'>
      {/* Left side: Icon + Title + Status + Time */}
      <div className='flex items-center gap-3 min-w-0 flex-1'>
        {/* Podcast icon */}
        <span className='relative size-10 flex-none rounded-xl bg-destructive/10 flex items-center justify-center'>
          <Podcast className='size-5 text-destructive' strokeWidth={2} />
        </span>

        <div className='min-w-0'>
          {/* Title row with REC/PAUSED badge */}
          <div className='flex items-center gap-2'>
            <span className='font-semibold text-[15px] text-foreground tracking-tight whitespace-nowrap'>
              Note Taker Recording
            </span>
            {!isPaused && (
              <span className='inline-flex items-center gap-1.5 bg-destructive/10 text-destructive font-semibold font-mono text-[10px] tracking-wide px-2 py-0.5 rounded-md'>
                <span className='size-[5px] rounded-full bg-destructive animate-[rec-blink_1.1s_step-end_infinite]' />
                REC
              </span>
            )}
            {isPaused && (
              <span className='inline-flex items-center gap-1.5 bg-muted text-yellow-600 font-semibold text-[10px] tracking-wide px-2 py-0.5 rounded-md'>
                <span className='size-[5px] rounded-full bg-yellow-500' />
                PAUSED
              </span>
            )}
          </div>

          {/* Metadata row: elapsed · started */}
          <div className='flex items-center gap-2 text-xs text-muted-foreground mt-0.5 whitespace-nowrap'>
            <span className='font-semibold font-mono text-foreground/70 tracking-wide'>
              {elapsedTime}
            </span>
            <span className='size-[3px] rounded-full bg-muted-foreground/40' />
            {startTime && <span>Started {formatTime12Hour(startTime)}</span>}
          </div>
        </div>
      </div>

      {/* Right side: View switcher + Minimize */}
      <div className='flex items-center gap-2.5 flex-none'>
        {/* Layout switcher */}
        {hasCanvas ? (
          /* Three-tab switcher when canvas exists */
          <div className='flex items-center gap-0.5 rounded-[11px] bg-muted p-[3px]'>
            <button
              type='button'
              onClick={() => onLayoutChange?.('transcript')}
              className={layoutTabClassName(activeLayout === 'transcript')}
              data-track-category='RecordingsScreen'
              data-track-name='switch_to_transcript'
              title='Transcript only'
            >
              <AlignLeft className='size-[15px]' />
              Transcript
            </button>
            <button
              type='button'
              onClick={() => onLayoutChange?.('split')}
              className={layoutTabClassName(activeLayout === 'split')}
              data-track-category='RecordingsScreen'
              data-track-name='switch_to_split'
              title='Split view'
            >
              <Columns2 className='size-[15px]' />
              Split
            </button>
            <button
              type='button'
              onClick={() => onLayoutChange?.('notes')}
              className={layoutTabClassName(activeLayout === 'notes')}
              data-track-category='RecordingsScreen'
              data-track-name='switch_to_notes'
              title='Notes only'
            >
              <Layers className='size-[15px]' />
              Notes
            </button>
          </div>
        ) : (
          /* Transcript label + Create Notes button when no canvas */
          <div className='flex items-center gap-1 rounded-[11px] bg-muted p-[3px]'>
            <span className='flex h-8 items-center gap-1.5 rounded-lg bg-background px-3 text-[12.5px] font-semibold leading-none text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]'>
              <AlignLeft className='size-[15px]' />
              Transcript
            </span>
            {onCreateCanvas && (
              <Button
                variant='ghost'
                size='sm'
                onClick={onCreateCanvas}
                disabled={isCreatingCanvas}
                loading={isCreatingCanvas}
                className='h-8 gap-1 rounded-lg px-3 text-[12.5px] font-semibold text-muted-foreground hover:bg-action-primary hover:text-action-primary-foreground'
                data-track-category='RecordingsScreen'
                data-track-name='create_notes_canvas'
              >
                {!isCreatingCanvas && <Plus className='size-4' strokeWidth={2.2} />}
                Create Notes
              </Button>
            )}
          </div>
        )}

        {/* Minimize button */}
        {onMinimize && (
          <Button
            variant='outline'
            size='iconSm'
            onClick={onMinimize}
            title='Minimize recording'
            aria-label='Minimize recording'
            className='size-[34px] rounded-[9px] border-border bg-background text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground/70'
            data-track-category='RecordingsScreen'
            data-track-name='minimize_transcript'
          >
            <ChevronDown className='size-[15px]' strokeWidth={2} />
          </Button>
        )}
      </div>
    </div>
  );
}
