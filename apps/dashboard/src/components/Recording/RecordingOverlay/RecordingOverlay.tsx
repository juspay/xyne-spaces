/**
 * Recording Overlay - Floating UI for active audio recording
 * Persists across all screens while a recording is active.
 * Displays recording status, elapsed time, and controls.
 * Draggable across the screen.
 */

import { createPortal } from 'react-dom';
import { useEffect, useState, useRef } from 'react';
import { Square, Pause, Play, Mic, ArrowUpRight } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  useRecordingStore,
  sendRecordingEvent,
  useTranscriptStream,
} from '../../../hooks/useRecordingStore';
import { useAudioAmplitude } from '../../../hooks/useAudioAmplitude';
import {
  calculateRecordingElapsedMs,
  formatRecordingDuration,
  generateRecordingTitle,
} from '../../../utils/recordingUtils';
import { recordingService } from '../../../services/Recording/recordingService';
import { SaveTitleModal } from '../../../routes/RecordingsScreen/components/SaveTitleModal';
import Button from '../../../components/ui/Button';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { useDraggableOverlay } from '../../../hooks/useDraggableOverlay';

/**
 * Custom hook for elapsed time tracking
 * Updates every second while recording is active
 */
const useElapsedTime = (
  isActive: boolean,
  isPaused: boolean,
  startTime: number | null,
  pauseStartedAt: number | null,
  accumulatedPausedMs: number,
): number => {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!isActive || !startTime) {
      // No active timer — clear the stale value so the next recording doesn't flash the previous
      // one's duration.
      setElapsedTime(0);
      return;
    }

    // Recompute immediately (don't wait up to 1s for the first tick), matching RecordingControlBar.
    setElapsedTime(calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs));
    if (isPaused) return;

    const interval = setInterval(() => {
      setElapsedTime(calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs));
    }, 1000);

    return (): void => clearInterval(interval);
  }, [isActive, isPaused, startTime, pauseStartedAt, accumulatedPausedMs]);

  return elapsedTime;
};

export function RecordingOverlay(): React.ReactElement | null {
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const status = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const pauseStartedAt = useRecordingStore(ctx => ctx.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(ctx => ctx.accumulatedPausedMs);
  const externalId = useRecordingStore(ctx => ctx.externalId);
  const agentLeft = useRecordingStore(ctx => ctx.agentLeft);
  const room = useRecordingStore(ctx => ctx.room);

  // Subscribe to transcript stream so transcripts are captured even when overlay is visible
  const { transcripts } = useTranscriptStream();

  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isStarting = status === 'starting';
  const isActive = isRecording || isPaused || isStarting;
  const isOnRecordingsPage = location.pathname.split('/').includes('recordings');

  // Use custom hooks
  const elapsedTime = useElapsedTime(
    isActive,
    isPaused,
    startTime,
    pauseStartedAt,
    accumulatedPausedMs,
  );
  const { position, isDragging, handleMouseDown, handleTouchStart } = useDraggableOverlay(
    containerRef,
    { x: 64, y: 32 },
  );
  const amplitudeBars = useAudioAmplitude(room, isRecording || isPaused, isPaused);

  // Title modal state — same pattern as RecordingsScreen
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  // True when the title modal opened because the agent dropped (auto-end).
  const [endedByAgentDrop, setEndedByAgentDrop] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const lastExternalIdRef = useRef<string | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync so it survives the store reset on stopRecording
  useEffect(() => {
    if (externalId) {
      lastExternalIdRef.current = externalId;
    }
  }, [externalId]);

  // Auto-scroll transcript preview to bottom when new transcripts arrive
  useEffect(() => {
    if (transcriptScrollRef.current && showTranscript) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcripts, showTranscript]);

  // Agent dropped mid-recording → auto-end and show the save-title modal with a
  // notice. Gated to when the overlay owns the UI (RecordingsScreen handles the
  // /recordings route itself), so the recording is ended exactly once.
  useEffect(() => {
    if (!isOnRecordingsPage && agentLeft && (status === 'recording' || status === 'paused')) {
      lastExternalIdRef.current = externalId;
      setEndedByAgentDrop(true);
      sendRecordingEvent({ type: 'stopRecording' }); // clears agentLeft in the store
      setShowTitleModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentLeft, status, isOnRecordingsPage]);

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
      setEndedByAgentDrop(false);
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
        endedByAgentDrop={endedByAgentDrop}
      />
      <div
        ref={containerRef}
        className={cn(
          'fixed z-[60] pointer-events-auto rec-overlay-container',
          isDragging && 'is-dragging',
        )}
        style={
          {
            '--rec-overlay-x': `${position.x}px`,
            '--rec-overlay-y': `${position.y}px`,
          } as React.CSSProperties
        }
      >
        {/* Transcript preview — above the card, transparent, slide-down animation */}
        <div
          className={cn(
            'overflow-hidden transition-all duration-300 ease-in-out w-[280px] rec-overlay-transcript-preview',
            showTranscript && 'is-open',
          )}
        >
          <div className='relative'>
            <div
              ref={transcriptScrollRef}
              className='no-scrollbar overflow-y-auto h-[96px] text-center flex flex-col justify-end rec-overlay-transcript-mask'
            >
              {transcripts.length > 0 ? (
                <div className='space-y-1 mx-auto flex-shrink-0'>
                  {transcripts.map(entry => (
                    <p
                      key={entry.id}
                      className='text-sm leading-snug text-foreground text-center break-words'
                    >
                      {entry.text}
                    </p>
                  ))}
                </div>
              ) : (
                <div className='flex items-center justify-center h-[60px]'>
                  <p className='text-xs text-muted-foreground '>Listening...</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card */}
        <div className='relative bg-background rounded-2xl shadow-2xl border border-border pt-2 pb-4 px-4 w-[280px]'>
          {/* Drag Handle — top grip bar like a bottom sheet */}
          <button
            type='button'
            className='w-full flex items-center justify-center pb-2 cursor-grab active:cursor-grabbing bg-transparent border-none'
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            aria-label='Drag overlay'
            data-track-category='RecordingOverlay'
            data-track-name='drag_handle'
          >
            <div className='w-10 h-1 bg-muted-foreground/40 rounded-full' />
          </button>

          {/* Top row: status/time + controls */}
          <div className='flex items-start justify-between gap-4 mb-4'>
            <div className='flex items-center gap-3 min-w-0'>
              <div className='relative mt-0.5'>
                {isRecording && (
                  <span className='flex h-3.5 w-3.5'>
                    <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75' />
                    <span className='relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500' />
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

              <Button
                variant='ghost'
                onClick={handleStop}
                disabled={isStarting}
                className='flex items-center justify-center w-10 h-10 rounded-full bg-destructive hover:bg-destructive/85 transition-colors'
                data-track-category='RecordingOverlay'
                data-track-name='stop_recording'
                trackId='stop_recording'
              >
                <Square className='w-4 h-4 text-destructive-foreground fill-current' />
              </Button>
            </div>
          </div>

          {/* Waveform — scrolling amplitude, newest on right */}
          {(isRecording || isPaused) && (
            <div
              className='flex items-center justify-between gap-[3px] h-10 mb-4'
              role='img'
              aria-label={isPaused ? 'Audio paused' : 'Audio waveform visualization'}
            >
              {amplitudeBars.map((amplitude, i) => (
                <div
                  key={i}
                  className='flex-1 bg-emerald-500 rounded-full rec-overlay-waveform-bar'
                  style={
                    {
                      '--rec-wave-height': `${Math.max(6, amplitude * 100)}%`,
                      '--rec-wave-opacity': isPaused ? '0.3' : `${0.4 + amplitude * 0.6}`,
                    } as React.CSSProperties
                  }
                  aria-hidden='true'
                />
              ))}
            </div>
          )}

          {/* Link */}
          <div className='flex gap-2 w-full'>
            <Button
              className='flex-1 gap-1.5 text-xs rounded-lg'
              variant='outline'
              size='sm'
              onClick={() => setShowTranscript(prev => !prev)}
              data-track-category='RecordingOverlay'
              data-track-name='toggle_live_transcript'
            >
              <Mic className='size-3.5' />
              {showTranscript ? 'Hide Live Transcript' : 'View Live Transcript'}
            </Button>
            <Button
              className='w-8 bg-action-primary hover:bg-action-primary/80 text-primary-foreground hover:text-primary-foreground transition-colors rounded-lg'
              variant='outline'
              size='sm'
              onClick={() => void navigate('/recordings')}
              data-track-category='RecordingOverlay'
              data-track-name='go_to_recordings'
            >
              <ArrowUpRight />
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
