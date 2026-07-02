/**
 * Recording Overlay - Floating UI for active audio recording
 * Persists across all screens while a recording is active.
 * Displays recording status, elapsed time, and controls.
 * Draggable across the screen.
 */

import { createPortal } from 'react-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Square, Pause, Play, Mic, GripVertical } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  useRecordingStore,
  sendRecordingEvent,
  useTranscriptStream,
} from '../../../hooks/useRecordingStore';
import { formatRecordingDuration, generateRecordingTitle } from '../../../utils/recordingUtils';
import { recordingService } from '../../../services/Recording/recordingService';
import { SaveTitleModal } from '../../../routes/RecordingsScreen/components/SaveTitleModal';
import { toast } from 'sonner';
import { Waveform } from '../../../utils/recordingWaveform';

interface DragState {
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
}

interface Position {
  x: number;
  y: number;
}

/**
 * Custom hook for draggable overlay functionality
 * Handles mouse and touch events for dragging the overlay
 */
const useDraggableOverlay = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  initialPosition: Position,
): {
  position: Position;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
} => {
  const [position, setPosition] = useState<Position>(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const startDrag = useCallback(
    (clientX: number, clientY: number): void => {
      setIsDragging(true);
      dragRef.current = {
        startX: clientX,
        startY: clientY,
        initialX: position.x,
        initialY: position.y,
      };
    },
    [position],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    },
    [startDrag],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent): void => {
      const touch = e.touches[0];
      if (touch) {
        startDrag(touch.clientX, touch.clientY);
      }
    },
    [startDrag],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (clientX: number, clientY: number): void => {
      if (!dragRef.current || !containerRef.current) return;

      const dx = clientX - dragRef.current.startX;
      const dy = clientY - dragRef.current.startY;
      const rect = containerRef.current.getBoundingClientRect();

      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - rect.width, dragRef.current.initialX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - rect.height, dragRef.current.initialY - dy)),
      });
    };

    const onMouseMove = (e: MouseEvent): void => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (touch) {
        handleMove(touch.clientX, touch.clientY);
      }
    };

    const endDrag = (): void => {
      setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', endDrag);

    return (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', endDrag);
    };
  }, [isDragging, containerRef]);

  return { position, isDragging, handleMouseDown, handleTouchStart };
};

/**
 * Custom hook for elapsed time tracking
 * Updates every second while recording is active
 */
const useElapsedTime = (isActive: boolean, isPaused: boolean, startTime: number | null): number => {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!isActive || !startTime || isPaused) {
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    return (): void => clearInterval(interval);
  }, [isActive, isPaused, startTime]);

  return elapsedTime;
};

export function RecordingOverlay(): React.ReactElement | null {
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const status = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const externalId = useRecordingStore(ctx => ctx.externalId);

  // Subscribe to transcript stream so transcripts are captured even when overlay is visible
  useTranscriptStream();

  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isStarting = status === 'starting';
  const isActive = isRecording || isPaused || isStarting;
  const isOnRecordingsPage = location.pathname.startsWith('/recordings');

  // Use custom hooks
  const elapsedTime = useElapsedTime(isActive, isPaused, startTime);
  const { position, isDragging, handleMouseDown, handleTouchStart } = useDraggableOverlay(
    containerRef,
    { x: 64, y: 32 },
  );

  // Title modal state — same pattern as RecordingsScreen
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const lastExternalIdRef = useRef<string | null>(null);

  // Keep ref in sync so it survives the store reset on stopRecording
  useEffect(() => {
    if (externalId) {
      lastExternalIdRef.current = externalId;
    }
  }, [externalId]);

  const handleStop = (): void => {
    // Capture externalId before stopRecording resets the store
    lastExternalIdRef.current = externalId;
    sendRecordingEvent({ type: 'stopRecording' });
    setShowTitleModal(true);
  };

  const handleSaveTitle = async (title: string): Promise<void> => {
    setSavingTitle(true);
    try {
      if (lastExternalIdRef.current) {
        await recordingService.updateRecordingTitle(lastExternalIdRef.current, title);
      }
      setShowTitleModal(false);
      sendRecordingEvent({ type: 'clearTranscripts' });
      toast.success('Recording saved', { description: title });
    } catch {
      toast.error('Failed to save title');
    } finally {
      setSavingTitle(false);
    }
  };

  const handlePauseResume = (): void => {
    sendRecordingEvent({ type: isPaused ? 'resumeRecording' : 'pauseRecording' });
  };

  // Visibility guards — but keep rendering if modal is open so user can save
  if ((!isActive && !showTitleModal) || isOnRecordingsPage) {
    return null;
  }

  return createPortal(
    <>
      <SaveTitleModal
        isOpen={showTitleModal}
        defaultTitle={generateRecordingTitle(startTime)}
        onSave={handleSaveTitle}
        isSaving={savingTitle}
      />
      <div
        ref={containerRef}
        className='fixed z-[60] pointer-events-auto'
        style={{
          left: `${position.x}px`,
          bottom: `${position.y}px`,
          cursor: isDragging ? 'grabbing' : 'default',
        }}
      >
        {/* Drag Handle */}
        <button
          type='button'
          className='absolute -top-6 left-0 right-0 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent border-none'
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          aria-label='Drag recording overlay'
          data-track-category='RecordingOverlay'
          data-track-name='drag_handle'
        >
          <div className='bg-muted rounded-full px-3 py-0.5 shadow-sm pointer-events-none'>
            <GripVertical className='w-3 h-3 text-muted-foreground' />
          </div>
        </button>

        {/* Card */}
        <div className='bg-card rounded-2xl shadow-2xl border border-border p-4 w-[280px]'>
          {/* Top row: status/time + controls */}
          <div className='flex items-start justify-between gap-4 mb-4'>
            <div className='flex items-center gap-3 min-w-0'>
              <div className='relative mt-0.5'>
                {isRecording && (
                  <span className='flex h-3 w-3'>
                    <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75' />
                    <span className='relative inline-flex rounded-full h-3 w-3 bg-red-500' />
                  </span>
                )}
                {isPaused && (
                  <span className='relative inline-flex rounded-full h-3 w-3 bg-amber-500' />
                )}
                {isStarting && (
                  <span className='animate-pulse relative inline-flex rounded-full h-3 w-3 bg-blue-500' />
                )}
              </div>

              <div className='min-w-0'>
                <div className='font-semibold text-sm text-foreground leading-tight'>
                  {isStarting ? 'Starting...' : isPaused ? 'Paused' : 'Recording'}
                </div>
                <div className='text-xs text-muted-foreground tabular-nums'>
                  {isStarting ? 'Connecting...' : formatRecordingDuration(elapsedTime)}
                </div>
              </div>
            </div>

            <div className='flex items-center gap-2 shrink-0'>
              <button
                onClick={handlePauseResume}
                disabled={isStarting}
                className='flex items-center justify-center w-9 h-9 rounded-full border border-border bg-foreground/15 hover:bg-foreground/25 transition-colors'
                data-track-category='RecordingOverlay'
                data-track-name={isPaused ? 'resume_recording' : 'pause_recording'}
              >
                {isPaused ? (
                  <Play className='w-4 h-4 text-foreground' />
                ) : (
                  <Pause className='w-4 h-4 text-foreground' />
                )}
              </button>

              <button
                onClick={handleStop}
                disabled={isStarting}
                className='flex items-center justify-center w-10 h-10 rounded-full bg-destructive hover:bg-destructive/85 transition-colors'
                data-track-category='RecordingOverlay'
                data-track-name='stop_recording'
              >
                <Square className='w-4 h-4 text-destructive-foreground fill-current' />
              </button>
            </div>
          </div>

          {/* Waveform */}
          {(isRecording || isPaused) && (
            <Waveform variant='overlay' paused={isPaused} className='mb-4' />
          )}

          {/* Link */}
          <button
            onClick={() => void navigate('/recordings')}
            className='w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors'
            data-track-category='RecordingOverlay'
            data-track-name='go_to_recordings'
          >
            <Mic className='w-3 h-3' />
            Go to Recording
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
