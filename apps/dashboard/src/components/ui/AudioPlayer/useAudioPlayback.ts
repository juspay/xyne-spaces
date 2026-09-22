/**
 * Playback state machine for a lazily-loaded recording.
 *
 * Extracted from AudioPlayer so surfaces that need a different chrome — the recording
 * detail bar, which mirrors the live control bar's layout — can drive the same audio
 * without duplicating the load/release logic.
 *
 * With `src` (a range-capable stream URL) playback starts without downloading the file;
 * if the stream can't play, it falls back to downloading it once through `onLoad`.
 *
 *   idle → (toggle) → loading → playing ↔ paused
 *                            → idle (on error / ended)
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type AudioPlayState = 'idle' | 'loading' | 'playing' | 'paused';

export interface UseAudioPlaybackOptions {
  onLoad: (signal: AbortSignal) => Promise<Blob>;
  src?: string | undefined;
  initialDurationSec?: number | undefined;
  showToastOnError?: boolean;
}

export interface UseAudioPlaybackReturn {
  state: AudioPlayState;
  currentTime: number;
  duration: number;
  canSeek: boolean;
  playbackRate: number;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
}

const isAbortError = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

export function useAudioPlayback({
  onLoad,
  src,
  initialDurationSec = 0,
  showToastOnError = false,
}: UseAudioPlaybackOptions): UseAudioPlaybackReturn {
  const [state, setState] = useState<AudioPlayState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDurationSec);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamFailedRef = useRef(false);

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

  const startAudio = async (url: string, isStream: boolean): Promise<void> => {
    const audio = new Audio();
    // Must be set before src so the credentialed range requests pass CORS.
    if (isStream) audio.crossOrigin = 'use-credentials';
    audio.src = url;
    audio.playbackRate = playbackRate;
    audioRef.current = audio;

    let hasStarted = false;
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    });
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('playing', () => {
      hasStarted = true;
      setState('playing');
    });
    audio.addEventListener('pause', () => {
      if (!audio.ended) setState('paused');
    });
    audio.addEventListener('ended', () => {
      setState('idle');
      setCurrentTime(0);
    });
    audio.addEventListener('error', () => {
      if (hasStarted) setState('idle');
    });

    await audio.play();
  };

  const loadAndPlay = async (): Promise<void> => {
    if (src && !streamFailedRef.current) {
      try {
        await startAudio(src, true);
        return;
      } catch (err: unknown) {
        if (isAbortError(err)) throw err;
        streamFailedRef.current = true;
        releaseAudio();
      }
    }

    abortRef.current = new AbortController();
    const blob = await onLoad(abortRef.current.signal);
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    await startAudio(url, false);
  };

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
      await loadAndPlay();
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      setState('idle');
      if (showToastOnError) toast.error('Failed to load recording');
    }
  };

  const seek = (seconds: number): void => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const setPlaybackRate = (rate: number): void => {
    setPlaybackRateState(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  return {
    state,
    currentTime,
    duration,
    canSeek: state === 'playing' || state === 'paused',
    playbackRate,
    toggle,
    seek,
    setPlaybackRate,
  };
}
