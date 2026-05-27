import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';

type AudioPlayState = 'idle' | 'loading' | 'playing' | 'paused';

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
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

  const canSeek = state === 'playing' || state === 'paused';
  const totalLabel = duration > 0 ? formatSecs(duration) : '--:--';
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={cn('flex items-center gap-2 w-full', className)}>
      {/* Play / Pause / Loading button */}
      <button
        type='button'
        onClick={e => void handleToggle(e)}
        disabled={state === 'loading'}
        data-track-category={trackCategory}
        data-track-name={state === 'playing' ? 'pause_recording' : 'play_recording'}
        className='shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
      >
        {state === 'loading' ? (
          <Loader2 className='w-4 h-4 animate-spin' />
        ) : state === 'playing' ? (
          <Pause className='w-4 h-4' />
        ) : (
          <Play className='w-4 h-4 translate-x-[0.5px]' />
        )}
      </button>

      {/* Current time */}
      <span className='font-foreground text-xs text-muted-foreground shrink-0 tabular-nums w-11'>
        {formatSecs(currentTime)}
      </span>

      {/* Progress track */}
      <div className='flex-1 relative flex items-center h-4'>
        {/* Visual track */}
        <div className='absolute inset-y-0 left-0 right-0 flex items-center pointer-events-none'>
          <div className='w-full h-1 rounded-full bg-muted overflow-hidden'>
            <div
              className='h-full bg-muted-foreground/70 rounded-full'
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {/* Invisible range input on top for interaction */}
        <input
          type='range'
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          disabled={!canSeek}
          onClick={stopPropagation ? e => e.stopPropagation() : undefined}
          data-track-category={trackCategory}
          data-track-name='seek_recording'
          className='absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default'
        />
      </div>

      {/* Total duration */}
      <span className='font-foreground text-xs text-muted-foreground shrink-0 tabular-nums w-11 text-right'>
        {totalLabel}
      </span>
    </div>
  );
}
