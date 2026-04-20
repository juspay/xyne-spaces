import { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';

type AudioPlayState = 'idle' | 'loading' | 'playing' | 'paused';

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface AudioPlayerProps {
  /**
   * Called once on first play. Should resolve to the audio Blob to stream.
   * Receives an AbortSignal so the fetch can be cancelled on unmount.
   */
  onLoad: (signal: AbortSignal) => Promise<Blob>;
  /** Pre-known duration in seconds (e.g. derived from durationMs). Defaults to 0. */
  initialDurationSec?: number | undefined;
  /** Call stopPropagation on all interactions (needed when rendered inside a clickable parent). */
  stopPropagation?: boolean;
  /** Value for data-track-category analytics attribute. */
  trackCategory: string;
  /** Extra classes applied to the root wrapper element. */
  className?: string;
  /** Show a toast notification when the audio fails to load. */
  showToastOnError?: boolean;
}

/**
 * Compact inline audio player for recordings.
 *
 * State machine:
 *   idle → (click) → loading → playing ↔ paused
 *                  → idle (on error)
 */
export function AudioPlayer({
  onLoad,
  initialDurationSec = 0,
  stopPropagation = false,
  trackCategory,
  className,
  showToastOnError = false,
}: AudioPlayerProps): React.ReactElement {
  const [state, setState] = useState<AudioPlayState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDurationSec);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return (): void => {
      abortRef.current?.abort();
      audioRef.current?.pause();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const stop = (e: { stopPropagation(): void }): void => {
    if (stopPropagation) e.stopPropagation();
  };

  const handleToggle = async (e: React.MouseEvent): Promise<void> => {
    stop(e);

    if (state === 'playing') {
      audioRef.current?.pause();
      setState('paused');
      return;
    }
    if (state === 'paused') {
      void audioRef.current?.play();
      setState('playing');
      return;
    }
    if (state !== 'idle') return;

    setState('loading');
    try {
      abortRef.current = new AbortController();
      const blob = await onLoad(abortRef.current.signal);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration)) setDuration(audio.duration);
      });
      audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
      audio.addEventListener('playing', () => setState('playing'));
      audio.addEventListener('pause', () => {
        if (!audio.ended) setState('paused');
      });
      audio.addEventListener('ended', () => {
        setState('idle');
        setCurrentTime(0);
      });

      await audio.play();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setState('idle');
      if (showToastOnError) toast.error('Failed to load recording');
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>): void => {
    stop(e);
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const isReady = state === 'playing' || state === 'paused';
  const totalLabel = duration > 0 ? formatSecs(duration) : '--:--';

  if (isReady) {
    return (
      <div
        className={cn('inline-flex items-center gap-1.5', className)}
        style={{ color: 'var(--call-action-button-color)' }}
      >
        <button
          type='button'
          onClick={e => void handleToggle(e)}
          data-track-category={trackCategory}
          data-track-name={state === 'playing' ? 'pause_recording' : 'play_recording'}
          className='flex-shrink-0'
        >
          {state === 'playing' ? (
            <Pause className='w-4 h-4' />
          ) : (
            <Play className='w-4 h-4 translate-x-[0.5px]' />
          )}
        </button>
        <input
          type='range'
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          onClick={stopPropagation ? e => e.stopPropagation() : undefined}
          data-track-category={trackCategory}
          data-track-name='seek_recording'
          className='w-24 h-1 accent-current cursor-pointer'
        />
        <span className='font-mono text-sm'>
          {formatSecs(currentTime)}&thinsp;/&thinsp;{totalLabel}
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type='button'
        onClick={e => void handleToggle(e)}
        disabled={state === 'loading'}
        data-track-category={trackCategory}
        data-track-name='play_recording'
        className='inline-flex items-center gap-1.5 text-sm font-medium hover:underline transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline'
        style={{ color: 'var(--call-action-button-color)' }}
      >
        <Play className='w-4 h-4 flex-shrink-0 translate-x-[0.5px]' />
        <span>Play Recording</span>
      </button>
    </div>
  );
}
