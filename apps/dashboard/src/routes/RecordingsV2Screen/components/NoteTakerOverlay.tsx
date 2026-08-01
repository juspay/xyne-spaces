import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type TransitionEvent,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  Flag,
  PauseBig,
  PlayBig,
  Spinner,
  StopBig,
  CloudDisabled,
} from '@xyne/icons';
import { Maximize2, Minimize2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useWorkspaceNavigate } from '../../../hooks/useWorkspaceNavigate';
import { Button } from '../../../components/ui/Button/Button';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor';
import { LiveTranscriptList } from '../../../components/Notetaker/LiveTranscriptList';
import { useDraggableOverlay } from '../../../hooks/useDraggableOverlay';
import type { MarkedMoment, RecordingState, TranscriptEntry } from '../../../stores/recordingStore';
import { DEFAULT_RECORDING_TITLE } from '../../../stores/recordingStore';
import { cn } from '../../../utils/classNames';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../../utils/recordingUtils';
import { getRecordingV2Tab, setRecordingV2Tab } from '../../../utils/recordingTabPreference';
import { canvasService } from '../../../services/Canvas/canvasService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NoteTakerOverlayProps {
  status: RecordingState['status'];
  startTime: number | null;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
  transcripts: TranscriptEntry[];
  markedMoments: MarkedMoment[];
  channelId: string | null;
  recordingId: string | null;
  notesCanvasId: string | null;
  isCreatingNotes: boolean;
  notesCreationFailed: boolean;
  onCreateNotes: () => void;
  isOffline: boolean;
  title?: string | undefined;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onMarkMoment: () => void;
}

type TabId = 'notes' | 'transcript';

interface RecordingPanelHeaderProps {
  isPaused: boolean;
  displayTitle: string;
  isCollapsed: boolean;
  recordingId: string | null;
  onToggleCollapsed: () => void;
}

interface RecordingControlBarProps {
  elapsed: number;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onMarkMoment: () => void;
}

interface NotesTabProps {
  notesCanvasId: string | null;
  channelId: string | null;
  isCreatingNotes: boolean;
  notesCreationFailed: boolean;
  onCreateNotes: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TRACK_CATEGORY = 'NoteTakerOverlay';
/** Matches the `h-8` inner row; needed as a number so the bar can animate open. */
const OFFLINE_BAR_HEIGHT_PX = 32;

// ─── Sub-components ─────────────────────────────────────────────────────────

const RecordingPanelHeader = ({
  isPaused,
  displayTitle,
  isCollapsed,
  recordingId,
  onToggleCollapsed,
}: RecordingPanelHeaderProps): ReactElement => {
  const navigate = useWorkspaceNavigate();

  const handleOpenDetails = (): void => {
    if (!recordingId) return;
    void navigate(`/recordings/${recordingId}`);
  };

  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-2.5 border-b pr-3 pl-3.5 transition-colors duration-150',
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
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        onClick={handleOpenDetails}
        disabled={!recordingId}
        className='size-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35'
        aria-label='Open recording details'
        title='Open recording details'
        data-track-category={TRACK_CATEGORY}
        data-track-name='open_recording_details'
      >
        <Maximize2 size={15} strokeWidth={2.2} />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        onClick={onToggleCollapsed}
        className='size-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground'
        aria-label={isCollapsed ? 'Expand live transcript' : 'Collapse live transcript'}
        title={isCollapsed ? 'Expand live transcript' : 'Collapse live transcript'}
        data-track-category={TRACK_CATEGORY}
        data-track-name={isCollapsed ? 'expand_transcript' : 'collapse_transcript'}
      >
        {isCollapsed ? (
          <ChevronUp size={16} strokeWidth={2.5} />
        ) : (
          <ChevronDown size={16} strokeWidth={2.5} />
        )}
      </Button>
    </header>
  );
};

const OfflineStatusBar = (): ReactElement => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
      animate={{ height: OFFLINE_BAR_HEIGHT_PX, opacity: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
      className='shrink-0 overflow-hidden border-b border-border bg-muted/40'
    >
      <div className='flex h-8 items-center gap-2 px-3.5 text-xs' role='status'>
        <CloudDisabled size={14} strokeWidth={2} className='shrink-0 text-muted-foreground' />
        <span className='shrink-0 font-medium text-foreground'>Offline — saving locally</span>
        <span className='truncate text-muted-foreground'>· syncs when you reconnect</span>
      </div>
    </motion.div>
  );
};

const RecordingControlBar = ({
  elapsed,
  isPaused,
  onPause,
  onResume,
  onStop,
  onMarkMoment,
}: RecordingControlBarProps): ReactElement => (
  <div
    className='flex h-13 shrink-0 items-center gap-1.5 border-t border-border px-4 py-2'
    aria-label='Recording controls'
  >
    <span
      className='shrink-0 font-mono text-sm font-thin tabular-nums text-muted-foreground'
      role='timer'
      aria-label={`Elapsed time ${formatElapsedTime(elapsed)}`}
    >
      {formatElapsedTime(elapsed)}
    </span>
    <div className='flex flex-1 shrink-0 items-center justify-end gap-1.5'>
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        onClick={onMarkMoment}
        className='rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground'
        aria-label='Mark moment'
        title='Mark moment'
        data-track-category={TRACK_CATEGORY}
        data-track-name='mark_moment'
      >
        <Flag size={17} strokeWidth={2} />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        className='rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground'
        aria-label='Minimize panel'
        title='Minimize panel'
        data-track-category={TRACK_CATEGORY}
        data-track-name='minimize_panel'
      >
        <Minimize2 size={16} strokeWidth={2.2} />
      </Button>
      <Button
        type='button'
        variant='outline'
        size='icon'
        onClick={isPaused ? onResume : onPause}
        className='size-9 rounded-xl shadow-sm transition-transform active:scale-95 motion-reduce:transform-none'
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
    </div>
  </div>
);

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
  markedMoments,
  channelId,
  recordingId,
  notesCanvasId,
  isCreatingNotes,
  notesCreationFailed,
  onCreateNotes,
  isOffline,
  title,
  onStop,
  onPause,
  onResume,
  onMarkMoment,
}: NoteTakerOverlayProps): ReactElement | null {
  const shouldReduceMotion = useReducedMotion();
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Read once on mount: the panel stays up for the whole recording, so a preference
  // written by the detail screen mid-recording should not yank the pane out from under
  // whoever is typing here.
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    getRecordingV2Tab() === 'notes' ? 'notes' : 'transcript',
  );
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

  const handleTabSelect = (tab: TabId): void => {
    setActiveTab(tab);
    setRecordingV2Tab(tab === 'notes' ? 'notes' : 'secondary');
  };

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
          isCollapsed ? 'h-12' : 'h-[min(70vh,600px)] min-[700px]:h-[min(40rem,calc(100vh-3rem))]',
        )}
        aria-label={isCollapsed ? 'Collapsed recording controls' : 'Live recording transcript'}
      >
        <RecordingPanelHeader
          isPaused={isPaused}
          displayTitle={displayTitle}
          isCollapsed={isCollapsed}
          recordingId={recordingId}
          onToggleCollapsed={handleToggleCollapsed}
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
          <AnimatePresence initial={false}>{isOffline && <OfflineStatusBar />}</AnimatePresence>

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
              onClick={() => handleTabSelect('notes')}
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
              onClick={() => handleTabSelect('transcript')}
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
            <LiveTranscriptList
              variant='panel'
              transcripts={transcripts}
              markedMoments={markedMoments}
              isPaused={isPaused}
              isScrollSuspended={isCollapsed || isPanelTransitioning}
              trackCategory={TRACK_CATEGORY}
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

          <RecordingControlBar
            elapsed={elapsed}
            isPaused={isPaused}
            onPause={onPause}
            onResume={onResume}
            onStop={onStop}
            onMarkMoment={onMarkMoment}
          />
        </div>
      </section>
    </motion.div>
  );
}

export default NoteTakerOverlay;
