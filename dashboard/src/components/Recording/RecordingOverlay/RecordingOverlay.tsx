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
import { formatRecordingDuration } from '../../../utils/recordingUtils';

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

  const handleStop = (): void => {
    sendRecordingEvent({ type: 'stopRecording' });
  };

  const handlePauseResume = (): void => {
    sendRecordingEvent({ type: isPaused ? 'resumeRecording' : 'pauseRecording' });
  };

  // Visibility guards
  if (!isActive || isOnRecordingsPage) {
    return null;
  }

  return createPortal(
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
        <div className='bg-gray-300 dark:bg-gray-600 rounded-full px-3 py-0.5 shadow-sm pointer-events-none'>
          <GripVertical className='w-3 h-3 text-gray-600 dark:text-gray-300' />
        </div>
      </button>

      {/* Card */}
      <div className='bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-4 w-[200px]'>
        {/* Header */}
        <div className='flex items-center gap-3 mb-3'>
          <div className='relative'>
            {isRecording && (
              <span className='flex h-3 w-3'>
                <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75' />
                <span className='relative inline-flex rounded-full h-3 w-3 bg-red-500' />
              </span>
            )}
            {isPaused && (
              <span className='relative inline-flex rounded-full h-3 w-3 bg-yellow-500' />
            )}
            {isStarting && (
              <span className='animate-pulse relative inline-flex rounded-full h-3 w-3 bg-blue-500' />
            )}
          </div>

          <div className='flex-1'>
            <div className='font-semibold text-sm text-gray-900 dark:text-gray-100'>
              {isStarting ? 'Starting...' : isPaused ? 'Paused' : 'Recording'}
            </div>
            <div className='text-xs text-gray-500 dark:text-gray-400'>
              {isStarting ? 'Connecting...' : formatRecordingDuration(elapsedTime)}
            </div>
          </div>
        </div>

        {/* Waveform */}
        {isRecording && (
          <div className='flex items-center justify-center gap-[3px] h-8 mb-3'>
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                className='w-1 bg-emerald-500 rounded-full'
                style={{
                  animation: `waveform 0.6s ease-in-out ${i * 0.05}s infinite alternate`,
                }}
              />
            ))}
          </div>
        )}

        {/* Controls */}
        <div className='flex items-center justify-center gap-2'>
          <button
            onClick={handlePauseResume}
            disabled={isStarting}
            className='flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700'
            data-track-category='RecordingOverlay'
            data-track-name={isPaused ? 'resume_recording' : 'pause_recording'}
          >
            {isPaused ? <Play /> : <Pause />}
          </button>

          <button
            onClick={handleStop}
            disabled={isStarting}
            className='flex items-center justify-center w-12 h-12 rounded-full bg-red-500'
            data-track-category='RecordingOverlay'
            data-track-name='stop_recording'
          >
            <Square className='text-white fill-current' />
          </button>
        </div>

        {/* Link */}
        <button
          onClick={() => void navigate('/recordings')}
          className='mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-blue-600'
          data-track-category='RecordingOverlay'
          data-track-name='go_to_recordings'
        >
          <Mic className='w-3 h-3' />
          Go to Recording
        </button>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes waveform {
          from { height: 20%; }
          to { height: 100%; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
