/**
 * Playback state machine for a lazily-loaded recording.
 *
 * Extracted from AudioPlayer so surfaces that need a different chrome — the recording
 * detail bar, which mirrors the live control bar's layout — can drive the same audio
 * without duplicating the load/release logic.
 *
 *   idle → (toggle) → loading → playing ↔ paused
 *                            → idle (on error / ended)
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type AudioPlayState = 'idle' | 'loading' | 'playing' | 'paused';

export interface UseAudioPlaybackOptions {
  /** Called once on first play. Resolves to the audio Blob; the signal cancels the fetch. */
  onLoad: (signal: AbortSignal) => Promise<Blob>;
  /** Pre-known duration in seconds, until the real one arrives with the metadata. */
  initialDurationSec?: number | undefined;
  showToastOnError?: boolean;
}

export interface UseAudioPlaybackReturn {
  state: AudioPlayState;
  currentTime: number;
  duration: number;
  /** True once the media exists, i.e. seeking is meaningful. */
  canSeek: boolean;
  /** Play, pause, or load-then-play depending on the current state. */
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
}

export function useAudioPlayback({
  onLoad,
  initialDurationSec = 0,
  showToastOnError = false,
}: UseAudioPlaybackOptions): UseAudioPlaybackReturn {
  const [state, setState] = useState<AudioPlayState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDurationSec);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Releases the current Audio element: stops playback, detaches the media
  // resource (removeAttribute('src')+load() frees the decoder and makes the
  // element + its listeners GC-able), and revokes the blob URL (which pins
  // the whole recording's bytes). Runs on unmount AND before creating a
  // replacement — otherwise each replay leaks the prior element + blob.
  const releaseAudio = (): void => {
    abortRef.current?.abort();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };
  const releaseRef = useRef(releaseAudio);
  releaseRef.current = releaseAudio;

  useEffect(() => {
    return (): void => releaseRef.current();
  }, []);

  const toggle = async (): Promise<void> => {
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
    releaseAudio(); // free the previous element + blob before creating new ones
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

  const seek = (seconds: number): void => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  };

  return {
    state,
    currentTime,
    duration,
    canSeek: state === 'playing' || state === 'paused',
    toggle,
    seek,
  };
}
