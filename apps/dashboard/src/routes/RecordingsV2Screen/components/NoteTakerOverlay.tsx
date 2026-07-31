import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type TransitionEvent,
  type UIEvent,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  PauseBig,
  PlayBig,
  SearchBig,
  Spinner,
  StopBig,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '../../../components/ui/Button/Button';
import Input from '../../../components/ui/Input';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor';
import { useDraggableOverlay } from '../../../hooks/useDraggableOverlay';
import { useTextSearch } from '../../../hooks/useTextSearch';
import type { RecordingState, TranscriptEntry } from '../../../stores/recordingStore';
import { DEFAULT_RECORDING_TITLE } from '../../../stores/recordingStore';
import { cn } from '../../../utils/classNames';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../../utils/recordingUtils';
import { canvasService } from '../../../services/Canvas/canvasService';
import { HighlightedText } from '../../RecordingsScreen/components/HighlightedText';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NoteTakerOverlayProps {
  status: RecordingState['status'];
  startTime: number | null;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
  transcripts: TranscriptEntry[];
  channelId: string | null;
  notesCanvasId: string | null;
  isCreatingNotes: boolean;
  notesCreationFailed: boolean;
  onCreateNotes: () => void;
  title?: string | undefined;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

type TabId = 'notes' | 'transcript';

interface RecordingPanelHeaderProps {
  elapsed: number;
  isPaused: boolean;
  displayTitle: string;
  isCollapsed: boolean;
  onPause: () => void;
  onResume: () => void;
  onToggleCollapsed: () => void;
  onStop: () => void;
}

interface TranscriptSearchBarProps {
  query: string;
  matchCount: number;
  currentIndex: number;
  onQueryChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
}

interface TranscriptTabProps {
  transcripts: TranscriptEntry[];
  isPaused: boolean;
  isCollapsed: boolean;
  isPanelTransitioning: boolean;
}

interface NotesTabProps {
  notesCanvasId: string | null;
  channelId: string | null;
  isCreatingNotes: boolean;
  notesCreationFailed: boolean;
  onCreateNotes: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FOLLOW_THRESHOLD_PX = 40;
const TRACK_CATEGORY = 'NoteTakerOverlay';

// ─── Sub-components ─────────────────────────────────────────────────────────

const RecordingPanelHeader = ({
  elapsed,
  isPaused,
  displayTitle,
  isCollapsed,
  onPause,
  onResume,
  onToggleCollapsed,
  onStop,
}: RecordingPanelHeaderProps): ReactElement => (
  <header
    className={cn(
      'flex h-14 shrink-0 items-center gap-3 border-b pr-3 pl-4 transition-colors duration-150',
      isCollapsed ? 'border-transparent' : 'border-border',
    )}
    aria-label='Recording status and controls'
  >
    <span
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        isPaused ? 'bg-muted-foreground' : 'bg-destructive',
      )}
      aria-hidden='true'
    />
    <span className='sr-only' role='status'>
      {isPaused ? 'Recording paused' : 'Recording'}
    </span>
    <h2
      className='min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground'
      title={displayTitle}
    >
      {displayTitle}
    </h2>
    <span
      className='w-14 shrink-0 text-center font-mono text-xs font-semibold tabular-nums text-muted-foreground'
      role='timer'
      aria-label={`Elapsed time ${formatElapsedTime(elapsed)}`}
    >
      {formatElapsedTime(elapsed)}
    </span>
    <div className='flex items-center gap-0.5 rounded-xl bg-muted p-0.5'>
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        onClick={isPaused ? onResume : onPause}
        className='rounded-xl text-muted-foreground hover:bg-background hover:text-foreground'
        aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
        title={isPaused ? 'Resume recording' : 'Pause recording'}
        data-track-category={TRACK_CATEGORY}
        data-track-name={isPaused ? 'resume_recording' : 'pause_recording'}
      >
        {isPaused ? (
          <PlayBig size={17} variant='Solid' />
        ) : (
          <PauseBig size={17} strokeWidth={4} variant='Solid' />
        )}
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        onClick={onToggleCollapsed}
        className='rounded-xl text-muted-foreground hover:bg-background hover:text-foreground'
        aria-label={isCollapsed ? 'Expand live transcript' : 'Collapse live transcript'}
        title={isCollapsed ? 'Expand live transcript' : 'Collapse live transcript'}
        data-track-category={TRACK_CATEGORY}
        data-track-name={isCollapsed ? 'expand_transcript' : 'collapse_transcript'}
      >
        {isCollapsed ? (
          <ChevronUp size={17} strokeWidth={2.5} />
        ) : (
          <ChevronDown size={17} strokeWidth={2.5} />
        )}
      </Button>
    </div>
    <Button
      type='button'
      variant='destructive'
      size='icon'
      onClick={onStop}
      className='size-9 rounded-xl shadow-sm transition-transform active:scale-95 motion-reduce:transform-none'
      aria-label='Stop recording'
      title='Stop recording'
      data-track-category={TRACK_CATEGORY}
      data-track-name='stop_recording'
    >
      <StopBig size={16} variant='Solid' />
    </Button>
  </header>
);

const TranscriptSearchBar = ({
  query,
  matchCount,
  currentIndex,
  onQueryChange,
  onFocus,
  onKeyDown,
  onPrevious,
  onNext,
  onClear,
}: TranscriptSearchBarProps): ReactElement => (
  <div className='shrink-0 p-2.5'>
    <div className='flex h-8 items-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 text-muted-foreground shadow-xs'>
      <SearchBig size={12} strokeWidth={2.2} className='shrink-0 text-muted-foreground/75 mb-0.5' />
      <Input
        id='floating-transcript-search'
        type='text'
        value={query}
        onFocus={onFocus}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder='Search transcript…'
        className='h-auto min-w-0 flex-1 rounded-none border-0 p-0 text-xs md:text-xs shadow-none placeholder:text-muted-foreground/75 focus-visible:border-transparent focus-visible:ring-0'
        aria-label='Search transcript'
        data-track-category={TRACK_CATEGORY}
        data-track-name='transcript_search_input'
      />
      {query && (
        <>
          <span className='shrink-0 text-[10px] tabular-nums text-muted-foreground'>
            {matchCount > 0 ? `${currentIndex + 1} of ${matchCount}` : 'No matches'}
          </span>
          <Button
            type='button'
            variant='ghost'
            size='iconSm'
            onClick={onPrevious}
            disabled={matchCount === 0}
            className='size-5 rounded-full hover:bg-muted disabled:opacity-35'
            aria-label='Previous match'
            data-track-category={TRACK_CATEGORY}
            data-track-name='transcript_search_previous'
          >
            <ChevronUp size={14} />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='iconSm'
            onClick={onNext}
            disabled={matchCount === 0}
            className='size-5 rounded-full hover:bg-muted disabled:opacity-35'
            aria-label='Next match'
            data-track-category={TRACK_CATEGORY}
            data-track-name='transcript_search_next'
          >
            <ChevronDown size={14} />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='iconSm'
            onClick={onClear}
            className='size-5 rounded-full hover:bg-muted'
            aria-label='Clear transcript search'
            data-track-category={TRACK_CATEGORY}
            data-track-name='transcript_search_clear'
          >
            <MultipleCrossCancelDefault className='size-3' />
          </Button>
        </>
      )}
    </div>
  </div>
);

const TranscriptTab = ({
  transcripts,
  isPaused,
  isCollapsed,
  isPanelTransitioning,
}: TranscriptTabProps): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const transcriptViewportRef = useRef<HTMLDivElement>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const getTranscriptText = useCallback((entry: TranscriptEntry) => entry.text, []);
  const search = useTextSearch({ items: transcripts, getText: getTranscriptText });

  const scrollToCurrent = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const viewport = transcriptViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  /** Auto-scroll to the latest transcript entry when following is active. */
  useEffect(() => {
    if (!isCollapsed && !isPanelTransitioning && isFollowing && !search.query.trim()) {
      scrollToCurrent('auto');
    }
  }, [isCollapsed, isFollowing, isPanelTransitioning, scrollToCurrent, search.query, transcripts]);

  const handleTranscriptScroll = (event: UIEvent<HTMLDivElement>): void => {
    const viewport = event.currentTarget;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setIsFollowing(distanceFromBottom <= FOLLOW_THRESHOLD_PX);
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <TranscriptSearchBar
        query={search.query}
        matchCount={search.matchCount}
        currentIndex={search.currentIndex}
        onQueryChange={search.setQuery}
        onFocus={search.open}
        onKeyDown={search.handleKeyDown}
        onPrevious={search.goToPrevious}
        onNext={search.goToNext}
        onClear={search.close}
      />

      <div className='relative min-h-0 flex-1 overflow-hidden'>
        <div
          ref={transcriptViewportRef}
          onScroll={handleTranscriptScroll}
          className='thin-scrollbar h-full scroll-smooth overflow-y-auto px-4 pb-5 '
        >
          <div className='flex min-h-full flex-col'>
            {transcripts.length > 0 && (
              <div className='mt-auto space-y-2.5 text-sm leading-[21px] text-foreground/85'>
                {transcripts.map((entry, index) => (
                  <p key={entry.id}>
                    <HighlightedText
                      text={entry.text}
                      matches={search.matches}
                      itemIndex={index}
                      currentMatchIndex={search.currentIndex}
                      matchRefs={search.matchRefs}
                      currentMatchClassName='bg-primary text-background [[data-theme=midnight]_&]:text-foreground py-0.5'
                      otherMatchClassName='bg-yellow-200 [[data-theme=midnight]_&]:bg-yellow-300 text-yellow-950 py-0.5'
                    />
                  </p>
                ))}
              </div>
            )}

            <div
              className={cn(
                'flex items-center gap-1 pt-3 text-xs italic text-muted-foreground/65',
                transcripts.length === 0 && 'mt-auto',
              )}
            >
              <span
                className='relative h-4 w-[2px] shrink-0 overflow-hidden rounded-full bg-muted'
                aria-hidden='true'
              >
                <span
                  className={cn(
                    'absolute inset-0 motion-reduce:animate-none',
                    isPaused
                      ? 'bg-muted'
                      : 'animate-[rec-blink_800ms_steps(1,end)_infinite] bg-primary',
                  )}
                />
              </span>
              <span>{isPaused ? 'paused' : 'transcribing...'}</span>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {!isCollapsed && !isPanelTransitioning && !isFollowing && transcripts.length > 0 && (
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.12 }}
              className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center'
            >
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => scrollToCurrent()}
                className='pointer-events-auto flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-foreground px-3 text-xs font-medium text-background shadow-lg backdrop-blur-sm outline-none transition-colors hover:bg-foregorund hover:text-background'
                data-track-category={TRACK_CATEGORY}
                data-track-name='return_to_current'
              >
                Return to current
                <ChevronDown size={13} strokeWidth={2.5} />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const NotesTab = ({
  notesCanvasId,
  channelId,
  isCreatingNotes,
  notesCreationFailed,
  onCreateNotes,
}: NotesTabProps): ReactElement => {
  const handleFileUpload = useCallback(
    (file: File): Promise<string> => canvasService.uploadCanvasFile(notesCanvasId!, file),
    [notesCanvasId],
  );

  if (notesCanvasId) {
    return (
      <CollaborativeCanvasEditor
        canvasId={notesCanvasId}
        channelId={channelId ?? undefined}
        editable
        autoFocus
        onFileUpload={handleFileUpload}
        className='floating-recording-notes h-full w-full
          [&_.bn-side-menu]:!hidden
          [&_.thin-scrollbar]:!pt-2
          [&_.bn-editor]:!px-2
          [&_.bn-block-content:has(.ProseMirror-trailingBreak:only-child):after]:!text-sm
          [&_.bn-suggestion-menu]:!w-auto [&_.bn-suggestion-menu]:!no-scrollbar [&_.bn-suggestion-menu]:!max-h-60 [&_.bn-suggestion-menu]:!max-w-[calc(100vw-2rem)]
          [&_.bn-suggestion-menu-item]:!h-8 [&_.bn-suggestion-menu-item]:!px-2 [&_.bn-suggestion-menu-item]:!py-1
          [&_.bn-mt-suggestion-menu-item-title]:!text-xs [&_.bn-mt-suggestion-menu-item-title]:!leading-4
          [&_.bn-mt-suggestion-menu-item-title]:!whitespace-nowrap [&_.bn-mt-suggestion-menu-item-title]:!overflow-hidden [&_.bn-mt-suggestion-menu-item-title]:!text-ellipsis
          [&_.bn-mt-suggestion-menu-item-section_svg]:!size-4
          [&_.bn-suggestion-menu-item]:!flex-nowrap
          [&_.bn-suggestion-menu-item_kbd]:!shrink-0 [&_.bn-suggestion-menu-item_kbd]:!text-[9px] [&_.bn-suggestion-menu-item_kbd]:!px-1'
      />
    );
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
      {isCreatingNotes ? (
        <>
          <Spinner size={20} className='animate-spin text-muted-foreground' />
          <p className='text-xs text-muted-foreground'>Creating collaborative notes…</p>
        </>
      ) : (
        <>
          <p className='text-xs text-muted-foreground'>
            {notesCreationFailed
              ? 'Notes could not be created.'
              : 'Collaborative notes are not ready yet.'}
          </p>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={onCreateNotes}
            className='rounded-lg'
            data-track-category={TRACK_CATEGORY}
            data-track-name='retry_create_notes'
          >
            Try again
          </Button>
        </>
      )}
    </div>
  );
};

// ─── Main component ─────────────────────────────────────────────────────────

export function NoteTakerOverlay({
  status,
  startTime,
  pauseStartedAt,
  accumulatedPausedMs,
  transcripts,
  channelId,
  notesCanvasId,
  isCreatingNotes,
  notesCreationFailed,
  onCreateNotes,
  title,
  onStop,
  onPause,
  onResume,
}: NoteTakerOverlayProps): ReactElement | null {
  const shouldReduceMotion = useReducedMotion();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('transcript');
  const [isPanelTransitioning, setIsPanelTransitioning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPaused = status === 'paused';
  const isActive = status === 'recording' || isPaused;
  const trimmedTitle = title?.trim();
  const displayTitle = trimmedTitle || DEFAULT_RECORDING_TITLE;
  const { position, isDragging, hasDragged, handleMouseDown, handleTouchStart } =
    useDraggableOverlay(containerRef, { x: 0, y: 0 });

  useEffect(() => {
    if (!isActive || !startTime) {
      setElapsed(0);
      return;
    }

    const updateElapsed = (): void => {
      setElapsed(calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs));
    };

    updateElapsed();
    if (isPaused) return;

    const interval = window.setInterval(() => {
      updateElapsed();
    }, 1000);

    return (): void => window.clearInterval(interval);
  }, [accumulatedPausedMs, isActive, isPaused, pauseStartedAt, startTime]);

  const handleToggleCollapsed = (): void => {
    setIsPanelTransitioning(true);
    setIsCollapsed(current => !current);

    if (shouldReduceMotion) {
      window.requestAnimationFrame(() => {
        setIsPanelTransitioning(false);
      });
    }
  };

  const handlePanelTransitionEnd = (event: TransitionEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget || event.propertyName !== 'height') return;
    setIsPanelTransitioning(false);
  };

  if (!isActive || !startTime) return null;

  return (
    <motion.div
      ref={containerRef}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        shouldReduceMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: 8,
              scale: 0.98,
              transition: { duration: 0.14, ease: 'easeOut' },
            }
      }
      transition={{
        duration: shouldReduceMotion ? 0 : 0.24,
        delay: shouldReduceMotion ? 0 : 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={
        hasDragged
          ? {
              left: position.x,
              bottom: position.y,
              transformOrigin: 'right bottom',
            }
          : { transformOrigin: 'right bottom' }
      }
      className={cn(
        'pointer-events-none z-50 fixed flex w-[calc(100vw-2rem)] max-w-[25rem] flex-col',
        !hasDragged &&
          'bottom-[calc(85px+env(safe-area-inset-bottom))] right-4 min-[700px]:bottom-6 min-[700px]:right-6',
        isDragging && 'cursor-grabbing select-none',
      )}
    >
      <button
        type='button'
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className='pointer-events-auto flex h-3 w-full shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing'
        aria-label='Drag live recording transcript'
        data-track-category={TRACK_CATEGORY}
        data-track-name='drag_handle'
      />
      <section
        onTransitionEnd={handlePanelTransitionEnd}
        className={cn(
          'pointer-events-auto flex w-full max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ring-1 ring-foreground/5 transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none',
          isCollapsed ? 'h-14' : 'h-[min(70vh,600px)] min-[700px]:h-[min(40rem,calc(100vh-3rem))]',
        )}
        aria-label={isCollapsed ? 'Collapsed recording controls' : 'Live recording transcript'}
      >
        <RecordingPanelHeader
          elapsed={elapsed}
          isPaused={isPaused}
          displayTitle={displayTitle}
          isCollapsed={isCollapsed}
          onPause={onPause}
          onResume={onResume}
          onToggleCollapsed={handleToggleCollapsed}
          onStop={onStop}
        />

        <div
          inert={isCollapsed}
          aria-hidden={isCollapsed}
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity motion-reduce:transition-none',
            isCollapsed
              ? 'pointer-events-none opacity-0 duration-100'
              : 'opacity-100 duration-150 delay-100',
          )}
        >
          <div
            className='flex h-9 shrink-0 items-stretch gap-1.5 border-b border-border px-4'
            role='tablist'
            aria-label='Recording content'
          >
            <Button
              type='button'
              variant='ghost'
              role='tab'
              aria-selected={activeTab === 'notes'}
              onClick={() => setActiveTab('notes')}
              className={cn(
                'h-full rounded-none border-b-2 px-3 text-xs font-semibold shadow-none',
                activeTab === 'notes'
                  ? 'border-foreground text-foreground hover:bg-transparent hover:text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
              )}
              data-track-category={TRACK_CATEGORY}
              data-track-name='open_notes'
            >
              Notes
            </Button>
            <Button
              type='button'
              variant='ghost'
              role='tab'
              aria-selected={activeTab === 'transcript'}
              onClick={() => setActiveTab('transcript')}
              className={cn(
                'h-full rounded-none border-b-2 px-3 text-xs font-semibold shadow-none',
                activeTab === 'transcript'
                  ? 'border-foreground text-foreground hover:bg-transparent hover:text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
              )}
              data-track-category={TRACK_CATEGORY}
              data-track-name='open_transcript'
            >
              Transcript
            </Button>
          </div>

          <div
            className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'transcript' && 'hidden')}
          >
            <TranscriptTab
              transcripts={transcripts}
              isPaused={isPaused}
              isCollapsed={isCollapsed}
              isPanelTransitioning={isPanelTransitioning}
            />
          </div>

          <div className={cn('min-h-0 flex-1 overflow-hidden', activeTab !== 'notes' && 'hidden')}>
            <NotesTab
              notesCanvasId={notesCanvasId}
              channelId={channelId}
              isCreatingNotes={isCreatingNotes}
              notesCreationFailed={notesCreationFailed}
              onCreateNotes={onCreateNotes}
            />
          </div>
        </div>
      </section>
    </motion.div>
  );
}

export default NoteTakerOverlay;
