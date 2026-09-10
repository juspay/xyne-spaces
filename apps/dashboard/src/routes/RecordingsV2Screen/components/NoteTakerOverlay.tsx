import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { ChevronDown, Flag, PauseBig, PlayBig, Spinner, StopBig, CloudDisabled } from '@xyne/icons';
import { Maximize2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useWorkspaceNavigate } from '../../../hooks/useWorkspaceNavigate';
import { Button } from '../../../components/ui/Button/Button';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor';
import { LiveTranscriptList } from '../../../components/Notetaker/LiveTranscriptList';
import { useDraggableOverlay } from '../../../hooks/useDraggableOverlay';
import { useEditableRecordingTitle } from '../../RecordingDetailV2Screen/useEditableRecordingTitle';
import { EditableTitleInput } from '../../RecordingDetailV2Screen/components/RecordingDetailV2Header';
import { RecordingVisualizer } from '../../RecordingDetailV2Screen/components/LiveRecordingControlBar';
import type { MarkedMoment, RecordingState, TranscriptEntry } from '../../../stores/recordingStore';
import { cn } from '../../../utils/classNames';
import { calculateRecordingElapsedMs, formatElapsedTime } from '../../../utils/recordingUtils';
import {
  getLiveRecordingV2Tab,
  setLiveRecordingV2Tab,
} from '../../../utils/recordingTabPreference';
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
  isOffline: boolean;
  title?: string | undefined;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onMarkMoment: () => void;
  isMinimized: boolean;
  onMinimize?: (() => void) | undefined;
  onExpand: () => void;
  onTitleUpdated?: ((title: string) => void) | undefined;
}

type TabId = 'notes' | 'transcript';

interface RecordingPanelHeaderProps {
  recordingId: string | null;
  isPaused: boolean;
  title: string | undefined;
  elapsed: number;
  onMinimize?: (() => void) | undefined;
  onTitleUpdated?: ((title: string) => void) | undefined;
}

interface RecordingControlBarProps {
  recordingId: string | null;
  isPaused: boolean;
  markedCount: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onMarkMoment: () => void;
}

interface NotesTabProps {
  notesCanvasId: string | null;
  channelId: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TRACK_CATEGORY = 'NoteTakerOverlay';
/** Default (never-dragged) corner anchor, shared by the panel and pill layers. */
const DEFAULT_CORNER_POSITION_CLASS =
  'bottom-[calc(85px+env(safe-area-inset-bottom))] right-4 min-[700px]:bottom-6 min-[700px]:right-6';
/** Matches the `h-8` inner row; needed as a number so the bar can animate open. */
const OFFLINE_BAR_HEIGHT_PX = 32;

const MARK_FEEDBACK_MS = 1400;

const PILL_CLICK_THRESHOLD_PX = 4;

// ─── Sub-components ─────────────────────────────────────────────────────────

const RecordingPanelHeader = ({
  recordingId,
  isPaused,
  title,
  elapsed,
  onMinimize,
  onTitleUpdated,
}: RecordingPanelHeaderProps): ReactElement => {
  const {
    currentTitle,
    isEditingTitle,
    editedTitle,
    isSavingTitle,
    handleStartEdit,
    handleSaveTitle,
    handleTitleChange,
    handleTitleKeyDown,
  } = useEditableRecordingTitle({
    recordingId,
    title,
    onTitleUpdated,
    context: 'NoteTakerOverlay',
  });

  const stopPointerPropagation = (event: ReactMouseEvent | ReactTouchEvent): void => {
    event.stopPropagation();
  };

  return (
    <header
      className='flex h-12 shrink-0 items-center gap-2.5 border-b border-border pr-3 pl-3.5'
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
      {isEditingTitle ? (
        <EditableTitleInput
          value={editedTitle}
          onChange={handleTitleChange}
          onSave={() => void handleSaveTitle()}
          onKeyDown={handleTitleKeyDown}
          onMouseDown={stopPointerPropagation}
          onTouchStart={stopPointerPropagation}
          disabled={isSavingTitle}
          className='min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-sm font-semibold tracking-tight text-foreground focus:outline-none focus:ring-0 disabled:opacity-50'
          trackCategory={TRACK_CATEGORY}
        />
      ) : (
        <div className='w-full'>
          <div
            role='button'
            tabIndex={0}
            onClick={handleStartEdit}
            onMouseDown={stopPointerPropagation}
            onTouchStart={stopPointerPropagation}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleStartEdit();
              }
            }}
            className='min-w-0 w-min cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
            data-track-category={TRACK_CATEGORY}
            data-track-name='edit_title_click_title'
          >
            <h2
              className='truncate text-sm font-semibold tracking-tight text-foreground w-min max-w-64'
              title={currentTitle}
            >
              {currentTitle}
            </h2>
          </div>
        </div>
      )}
      {isSavingTitle && (
        <span
          className='flex shrink-0 items-center justify-center text-muted-foreground'
          role='status'
          aria-label='Saving title'
        >
          <Spinner size={13} className='animate-spin' />
        </span>
      )}
      <span
        className='shrink-0 font-mono text-xs font-thin tabular-nums text-muted-foreground'
        role='timer'
        aria-label={`Elapsed time ${formatElapsedTime(elapsed)}`}
      >
        {formatElapsedTime(elapsed)}
      </span>
      {onMinimize && (
        <Button
          type='button'
          variant='ghost'
          size='iconSm'
          onClick={onMinimize}
          onMouseDown={stopPointerPropagation}
          onTouchStart={stopPointerPropagation}
          className='shrink-0 rounded-xl text-muted-foreground hover:bg-background hover:text-foreground'
          aria-label='Minimize to floating pill'
          title='Minimize to floating pill'
          data-track-category={TRACK_CATEGORY}
          data-track-name='minimize_panel'
        >
          <ChevronDown size={16} strokeWidth={2.2} />
        </Button>
      )}
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

const MarkMomentButton = ({
  markedCount,
  onMarkMoment,
}: {
  markedCount: number;
  onMarkMoment: () => void;
}): ReactElement => {
  const shouldReduceMotion = useReducedMotion();
  const [justMarked, setJustMarked] = useState(false);
  const previousCount = useRef(markedCount);

  useEffect(() => {
    const grew = markedCount > previousCount.current;
    previousCount.current = markedCount;
    if (!grew) return;

    setJustMarked(true);
    const timer = window.setTimeout(() => setJustMarked(false), MARK_FEEDBACK_MS);
    return (): void => window.clearTimeout(timer);
  }, [markedCount]);

  return (
    <>
      <Button
        type='button'
        variant='ghost'
        size='iconSm'
        onClick={onMarkMoment}
        className={cn(
          'relative rounded-xl border transition-colors',
          justMarked
            ? 'border-status-success text-status-success hover:bg-transparent hover:text-status-success'
            : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        aria-label='Mark moment'
        title={justMarked ? 'Moment marked' : 'Mark moment'}
        data-track-category={TRACK_CATEGORY}
        data-track-name='mark_moment'
      >
        {justMarked && (
          <span
            className='pointer-events-none absolute inset-0 rounded-xl bg-status-success opacity-10'
            aria-hidden='true'
          />
        )}
        <AnimatePresence>
          {justMarked && !shouldReduceMotion && (
            <motion.span
              className='pointer-events-none absolute inset-0 rounded-xl ring-2 ring-status-success'
              initial={{ opacity: 0.8, scale: 0.92 }}
              animate={{ opacity: 0, scale: 1.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              aria-hidden='true'
            />
          )}
        </AnimatePresence>

        <motion.span
          className='flex items-center justify-center'
          animate={shouldReduceMotion || !justMarked ? { scale: 1 } : { scale: [1, 1.28, 1] }}
          transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1], times: [0, 0.4, 1] }}
        >
          <Flag size={17} strokeWidth={2} {...(justMarked ? { variant: 'Solid' as const } : {})} />
        </motion.span>
      </Button>

      <span className='sr-only' role='status'>
        {justMarked ? 'Moment marked' : ''}
      </span>
    </>
  );
};

const RecordingControlBar = ({
  recordingId,
  isPaused,
  markedCount,
  onPause,
  onResume,
  onStop,
  onMarkMoment,
}: RecordingControlBarProps): ReactElement => {
  const navigate = useWorkspaceNavigate();

  const handleOpenDetails = (): void => {
    if (!recordingId) return;
    void navigate(`/recordings/${recordingId}`);
  };

  return (
    <div
      className='flex shrink-0 items-center gap-1.5 border-t border-border px-4 py-2'
      aria-label='Recording controls'
    >
      <Button
        type='button'
        variant='ghost'
        size='sm'
        onClick={handleOpenDetails}
        disabled={!recordingId}
        className='h-auto rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-35 gap-2'
        aria-label='Open recording details'
        title='Open recording details'
        data-track-category={TRACK_CATEGORY}
        data-track-name='open_recording_details'
      >
        <Maximize2 strokeWidth={2.8} className='size-3' />
        <span>Full screen</span>
      </Button>
      <div className='flex flex-1 shrink-0 items-center justify-end gap-1.5'>
        <MarkMomentButton markedCount={markedCount} onMarkMoment={onMarkMoment} />
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
};

const PillWaveform = ({ isPaused }: { isPaused: boolean }): ReactElement => (
  <span
    role='img'
    aria-label={isPaused ? 'Audio paused' : 'Audio waveform visualization'}
    className='inline-flex items-center'
  >
    <RecordingVisualizer isAnimated={!isPaused} size='sm' colorClassName='bg-status-success' />
  </span>
);

const PILL_COLLAPSED_WIDTH_PX = 40;
const PILL_EXPANDED_WIDTH_PX = 92;
const PILL_COLLAPSE_DELAY_MS = 200;
const PILL_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Shared max-width/opacity reveal transition for a row's label — electron's own timing. */
const pillLabelStyle = (expanded: boolean): CSSProperties => ({
  maxWidth: expanded ? '3rem' : 0,
  opacity: expanded ? 1 : 0,
  transition: `max-width 240ms ${PILL_EASE}, opacity 160ms ease`,
});

interface RecordingMiniPillProps {
  isPaused: boolean;
  isDragging: boolean;
  elapsed: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onExpand: () => void;
  onDragMouseDown: (event: ReactMouseEvent) => void;
  onDragTouchStart: (event: ReactTouchEvent) => void;
  onDragClick: () => void;
}

const RecordingMiniPill = ({
  isPaused,
  isDragging,
  elapsed,
  onPause,
  onResume,
  onStop,
  onExpand,
  onDragMouseDown,
  onDragTouchStart,
  onDragClick,
}: RecordingMiniPillProps): ReactElement => {
  const [isHovered, setIsHovered] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);

  const clearCollapseTimer = (): void => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  };

  const handleMouseEnter = (): void => {
    clearCollapseTimer();
    setIsHovered(true);
  };

  const handleMouseLeave = (): void => {
    if (isDragging) return;
    clearCollapseTimer();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setIsHovered(false);
    }, PILL_COLLAPSE_DELAY_MS);
  };

  // A drag that started while hovered shouldn't collapse out from under the cursor.
  useEffect(() => {
    if (isDragging) clearCollapseTimer();
  }, [isDragging]);

  useEffect(() => clearCollapseTimer, []);

  const stopPointerPropagation = (event: ReactMouseEvent | ReactTouchEvent): void => {
    event.stopPropagation();
  };

  const isExpanded = isHovered && !isDragging;

  return (
    <div
      role='button'
      tabIndex={0}
      onMouseDown={onDragMouseDown}
      onTouchStart={onDragTouchStart}
      onClick={onDragClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onExpand();
        }
      }}
      style={{
        width: isExpanded ? PILL_EXPANDED_WIDTH_PX : PILL_COLLAPSED_WIDTH_PX,
        borderRadius: isExpanded ? 14 : PILL_COLLAPSED_WIDTH_PX / 2,
        transition: `width 240ms ${PILL_EASE}, border-radius 240ms ${PILL_EASE}`,
      }}
      className='flex touch-none cursor-grab flex-col items-stretch gap-[5px] border border-border bg-card p-1.5 shadow-2xl ring-1 ring-foreground/5 outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring'
      aria-label='Live recording. Click to expand, drag to move.'
      title='Click to expand'
      data-track-category={TRACK_CATEGORY}
      data-track-name='expand_pill'
    >
      <span className='pointer-events-none flex h-6 shrink-0 items-center'>
        <span className='flex w-7 shrink-0 items-center justify-center'>
          <PillWaveform isPaused={isPaused} />
        </span>
        <span
          className='overflow-hidden whitespace-nowrap font-mono text-xs font-semibold tabular-nums text-status-success'
          style={pillLabelStyle(isExpanded)}
          role='timer'
          aria-label={`Elapsed time ${formatElapsedTime(elapsed)}`}
        >
          {formatElapsedTime(elapsed)}
        </span>
      </span>
      <span className='sr-only' role='status'>
        {isPaused ? 'Recording paused' : 'Recording'}
      </span>

      <button
        type='button'
        onClick={event => {
          event.stopPropagation();
          (isPaused ? onResume : onPause)();
        }}
        onMouseDown={stopPointerPropagation}
        onTouchStart={stopPointerPropagation}
        className='flex h-6 shrink-0 items-center rounded-lg text-foreground transition-[background-color,transform] hover:bg-muted active:scale-[0.96]'
        aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
        title={isPaused ? 'Resume recording' : 'Pause recording'}
        data-track-category={TRACK_CATEGORY}
        data-track-name={isPaused ? 'resume_recording' : 'pause_recording'}
      >
        <span className='flex w-7 shrink-0 items-center justify-center'>
          {isPaused ? (
            <PlayBig size={14} variant='Solid' />
          ) : (
            <PauseBig size={14} strokeWidth={4} variant='Solid' />
          )}
        </span>
        <span
          className='overflow-hidden whitespace-nowrap text-xs font-medium'
          style={pillLabelStyle(isExpanded)}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </span>
      </button>

      <button
        type='button'
        onClick={event => {
          event.stopPropagation();
          onStop();
        }}
        onMouseDown={stopPointerPropagation}
        onTouchStart={stopPointerPropagation}
        className={cn(
          'flex h-7 shrink-0 items-center rounded-lg transition-[background-color,transform] active:scale-[0.96]',
          isExpanded && 'bg-destructive',
        )}
        aria-label='Stop recording'
        title='Stop recording'
        data-track-category={TRACK_CATEGORY}
        data-track-name='stop_recording'
      >
        <span className='flex w-7 shrink-0 items-center justify-center'>
          <span
            className={cn(
              'flex size-[22px] items-center justify-center rounded-lg transition-colors',
              isExpanded ? 'bg-transparent' : 'bg-destructive',
            )}
          >
            <span className='size-[11px] rounded-[3px] bg-white' aria-hidden='true' />
          </span>
        </span>
        <span
          className='overflow-hidden whitespace-nowrap text-xs font-semibold text-white'
          style={pillLabelStyle(isExpanded)}
        >
          Stop
        </span>
      </button>
    </div>
  );
};

const NotesTab = ({ notesCanvasId, channelId }: NotesTabProps): ReactElement => {
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
        placeholder='Add your notes here, you can view the transcript live in the transcript tab'
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
    <div className='flex h-full items-center justify-center px-6 text-center'>
      <p className='text-xs text-muted-foreground'>Collaborative notes are unavailable.</p>
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
  isOffline,
  title,
  onStop,
  onPause,
  onResume,
  onMarkMoment,
  isMinimized,
  onMinimize,
  onExpand,
  onTitleUpdated,
}: NoteTakerOverlayProps): ReactElement | null {
  const shouldReduceMotion = useReducedMotion();

  const [activeTab, setActiveTab] = useState<TabId>(() =>
    getLiveRecordingV2Tab(recordingId) === 'notes' ? 'notes' : 'transcript',
  );
  const [elapsed, setElapsed] = useState(0);
  const isPaused = status === 'paused';
  const isActive = status === 'recording' || isPaused;
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const {
    position: panelPosition,
    isDragging: panelIsDragging,
    hasDragged: panelHasDragged,
    handleMouseDown: panelHandleMouseDown,
    handleTouchStart: panelHandleTouchStart,
  } = useDraggableOverlay(panelContainerRef, { x: 0, y: 0 });
  const {
    position: pillPosition,
    isDragging: pillIsDragging,
    hasDragged: pillHasDragged,
    handleMouseDown: pillHandleMouseDown,
    handleTouchStart: pillHandleTouchStart,
  } = useDraggableOverlay(pillContainerRef, { x: 0, y: 0 });

  const pillMovedRef = useRef(false);

  const trackPillGestureMovement = useCallback((startX: number, startY: number): void => {
    pillMovedRef.current = false;

    const checkMovement = (x: number, y: number): void => {
      if (Math.hypot(x - startX, y - startY) > PILL_CLICK_THRESHOLD_PX) {
        pillMovedRef.current = true;
      }
    };
    const onMouseMove = (event: MouseEvent): void => checkMovement(event.clientX, event.clientY);
    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch) checkMovement(touch.clientX, touch.clientY);
    };
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', cleanup);
    window.addEventListener('touchcancel', cleanup);
  }, []);

  const handlePillMouseDown = (event: ReactMouseEvent): void => {
    trackPillGestureMovement(event.clientX, event.clientY);
    pillHandleMouseDown(event);
  };

  const handlePillTouchStart = (event: ReactTouchEvent): void => {
    const touch = event.touches[0];
    if (touch) trackPillGestureMovement(touch.clientX, touch.clientY);
    pillHandleTouchStart(event);
  };

  const handlePillClick = (): void => {
    if (pillMovedRef.current) return;
    onExpand();
  };

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
    setLiveRecordingV2Tab(recordingId, tab === 'notes' ? 'notes' : 'secondary');
  };

  if (!isActive || !startTime) return null;

  return (
    <motion.div
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
      style={{ transformOrigin: 'right bottom' }}
      className='pointer-events-none z-50 fixed inset-0'
    >
      <div
        ref={panelContainerRef}
        style={
          panelHasDragged
            ? {
                left: panelPosition.x,
                bottom: panelPosition.y,
                transformOrigin: 'right bottom',
              }
            : { transformOrigin: 'right bottom' }
        }
        className={cn(
          'absolute flex w-[calc(100vw-2rem)] max-w-[25rem] flex-col transition-opacity duration-200 motion-reduce:transition-none',
          !panelHasDragged && DEFAULT_CORNER_POSITION_CLASS,
          panelIsDragging && 'cursor-grabbing select-none',
          isMinimized ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100',
        )}
      >
        <button
          type='button'
          onMouseDown={panelHandleMouseDown}
          onTouchStart={panelHandleTouchStart}
          className='flex h-3 w-full shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing'
          aria-label='Drag live recording transcript'
          data-track-category={TRACK_CATEGORY}
          data-track-name='drag_handle'
        />
        <section
          className='flex h-[min(70vh,600px)] max-h-[calc(100vh-3rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ring-1 ring-foreground/5 min-[700px]:h-[min(40rem,calc(100vh-3rem))] '
          aria-label='Live recording transcript'
        >
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            onMouseDown={panelHandleMouseDown}
            onTouchStart={panelHandleTouchStart}
            className='cursor-grab touch-none active:cursor-grabbing hover:bg-accent duration-150 ease-in-out'
          >
            <RecordingPanelHeader
              recordingId={recordingId}
              isPaused={isPaused}
              title={title}
              elapsed={elapsed}
              onMinimize={onMinimize}
              onTitleUpdated={onTitleUpdated}
            />
          </div>

          <div className='flex min-h-0 flex-1 flex-col'>
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
                trackCategory={TRACK_CATEGORY}
              />
            </div>

            <div
              className={cn('min-h-0 flex-1 overflow-hidden', activeTab !== 'notes' && 'hidden')}
            >
              <NotesTab notesCanvasId={notesCanvasId} channelId={channelId} />
            </div>

            <RecordingControlBar
              recordingId={recordingId}
              isPaused={isPaused}
              markedCount={markedMoments.length}
              onPause={onPause}
              onResume={onResume}
              onStop={onStop}
              onMarkMoment={onMarkMoment}
            />
          </div>
        </section>
      </div>

      <div
        ref={pillContainerRef}
        style={
          pillHasDragged
            ? {
                left: pillPosition.x,
                bottom: pillPosition.y,
                transformOrigin: 'right bottom',
              }
            : { transformOrigin: 'right bottom' }
        }
        className={cn(
          'absolute transition-opacity duration-200 motion-reduce:transition-none',
          !pillHasDragged && DEFAULT_CORNER_POSITION_CLASS,
          pillIsDragging && 'cursor-grabbing select-none',
          isMinimized ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <RecordingMiniPill
          isPaused={isPaused}
          isDragging={pillIsDragging}
          elapsed={elapsed}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
          onExpand={onExpand}
          onDragMouseDown={handlePillMouseDown}
          onDragTouchStart={handlePillTouchStart}
          onDragClick={handlePillClick}
        />
      </div>
    </motion.div>
  );
}

export default NoteTakerOverlay;
