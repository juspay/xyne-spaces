/**
 * Sequential playback across a call's recordings, driven by the call's own clock.
 *
 * The playhead is a position on the timeline, not an offset into any one file, so a
 * stretch nobody recorded still takes its real time to cross — in silence. What you
 * hear stays aligned with when it happened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordedSpan } from './recordingSpans';

export type TimelinePlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface TimelinePlayback {
  /**
   * The spans as they actually sound. `endedAt` counts the flush, webhook and stitch
   * that follow the last sample, so a band read from it claims a second or two of
   * silence; once a file is loaded its own duration replaces that guess.
   */
  spans: readonly RecordedSpan[];
  state: TimelinePlaybackState;
  /** Seconds along the track. */
  positionSeconds: number;
  /** The playhead is past the end of one recording and not yet inside the next. */
  isInGap: boolean;
  /** Play from the top, resume, or pause. No-op without a loader or any audio. */
  toggle: () => void;
  /** Move the playhead. Landing between recordings is allowed — it plays out silent. */
  seek: (seconds: number) => void;
  canPlay: boolean;
}

export type RecordingLoader = (recordingId: string, signal: AbortSignal) => Promise<Blob>;

/** How often the playhead is recomputed. Fine enough to look continuous. */
const TICK_MS = 100;

/** Index of the span containing `seconds`, or -1 between them. */
function spanIndexAt(spans: readonly RecordedSpan[], seconds: number): number {
  return spans.findIndex(span => seconds >= span.startSeconds && seconds < span.endSeconds);
}

/** Resolves once the element can be seeked, and on error too — a dud must not hang play. */
function whenSeekable(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise(resolve => {
    const done = (): void => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('error', done);
      resolve();
    };
    audio.addEventListener('loadedmetadata', done);
    audio.addEventListener('error', done);
  });
}

export function useTimelinePlayback(
  spans: readonly RecordedSpan[],
  spanSeconds: number,
  loadRecording: RecordingLoader | undefined,
): TimelinePlayback {
  const [state, setState] = useState<TimelinePlaybackState>('idle');
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [isInGap, setIsInGap] = useState(false);

  const [measuredAt, setMeasuredAt] = useState(0);
  const durationsRef = useRef(new Map<string, number>());
  const audiosRef = useRef(new Map<string, HTMLAudioElement>());
  const urlsRef = useRef<string[]>([]);
  const positionRef = useRef(0);
  const activeRef = useRef(-1);
  const lastTickRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveSpans = useMemo(() => {
    void measuredAt;
    return spans.map(span => {
      const duration = durationsRef.current.get(span.recordingId);
      if (duration === undefined) return span;
      return { ...span, endSeconds: Math.min(span.endSeconds, span.startSeconds + duration) };
    });
  }, [measuredAt, spans]);

  const canPlay = Boolean(loadRecording) && spans.length > 0 && spanSeconds > 0;

  const stopTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pauseAll = useCallback((): void => {
    for (const audio of audiosRef.current.values()) audio.pause();
    activeRef.current = -1;
  }, []);

  /** Frees every element and blob. A blob URL pins the whole recording in memory. */
  const release = useCallback((): void => {
    stopTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    for (const audio of audiosRef.current.values()) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audiosRef.current.clear();
    durationsRef.current.clear();
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    activeRef.current = -1;
  }, [stopTimer]);

  // Nothing survives a change of call or of the spans themselves.
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => {
    return (): void => {
      releaseRef.current();
      positionRef.current = 0;
      setPositionSeconds(0);
      setIsInGap(false);
      setState('idle');
    };
  }, [spans]);

  const step = useCallback((): void => {
    const now = performance.now();
    const elapsed = Math.max(0, (now - lastTickRef.current) / 1000);
    lastTickRef.current = now;

    const index = spanIndexAt(effectiveSpans, positionRef.current);

    // Entered or left a recording: hand over to the right element.
    if (index !== activeRef.current) {
      const leaving = effectiveSpans[activeRef.current];
      if (leaving) audiosRef.current.get(leaving.recordingId)?.pause();
      activeRef.current = index;

      const entering = effectiveSpans[index];
      const audio = entering ? audiosRef.current.get(entering.recordingId) : undefined;
      if (entering && audio) {
        audio.currentTime = Math.max(0, positionRef.current - entering.startSeconds);
        void audio.play().catch(() => undefined);
      }
    }

    const current = effectiveSpans[index];
    const audio = current ? audiosRef.current.get(current.recordingId) : undefined;
    const isSounding = Boolean(audio && !audio.paused && !audio.ended);

    // The file is the clock while it plays. Between files — and after one that ran
    // short of its span — real time is, so the silence lasts as long as it did.
    const next = isSounding
      ? current!.startSeconds + audio!.currentTime
      : positionRef.current + elapsed;

    if (next >= spanSeconds) {
      stopTimer();
      pauseAll();
      positionRef.current = spanSeconds;
      setPositionSeconds(spanSeconds);
      setIsInGap(false);
      setState('paused');
      return;
    }

    positionRef.current = next;
    setPositionSeconds(next);
    setIsInGap(!isSounding);
  }, [effectiveSpans, pauseAll, spanSeconds, stopTimer]);

  const stepRef = useRef(step);
  stepRef.current = step;

  const startTimer = useCallback((): void => {
    stopTimer();
    lastTickRef.current = performance.now();
    timerRef.current = setInterval(() => stepRef.current(), TICK_MS);
  }, [stopTimer]);

  /**
   * Every recording is fetched before the first tick. Playing to the call's clock
   * means never stalling mid-run to download, and audio-only files are small.
   */
  const preload = useCallback(async (): Promise<boolean> => {
    if (!loadRecording) return false;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await Promise.all(
        spans.map(async span => {
          if (audiosRef.current.has(span.recordingId)) return;
          const blob = await loadRecording(span.recordingId, controller.signal);
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          const audio = new Audio(url);
          await whenSeekable(audio);
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            durationsRef.current.set(span.recordingId, audio.duration);
          }
          audiosRef.current.set(span.recordingId, audio);
        }),
      );
      if (controller.signal.aborted) return false;
      // Redraws the bands at their true length.
      setMeasuredAt(Date.now());
      return true;
    } catch {
      return false;
    }
  }, [loadRecording, spans]);

  const seek = useCallback(
    (seconds: number): void => {
      if (!canPlay) return;
      const target = Math.min(Math.max(seconds, 0), spanSeconds);

      positionRef.current = target;
      setPositionSeconds(target);
      setIsInGap(spanIndexAt(effectiveSpans, target) < 0);
      // Forces the next tick to re-enter whichever span the playhead landed in, and
      // to seek that file rather than carry on from where it was.
      pauseAll();

      // Seeking is also how you start: a first click on the track plays from there.
      if (state === 'idle') {
        setState('loading');
        void (async (): Promise<void> => {
          const ready = await preload();
          if (!ready) {
            setState('idle');
            return;
          }
          setState('playing');
          startTimer();
        })();
      }
    },
    [canPlay, effectiveSpans, pauseAll, preload, spanSeconds, startTimer, state],
  );

  const toggle = useCallback((): void => {
    if (!canPlay) return;

    if (state === 'playing') {
      stopTimer();
      pauseAll();
      setState('paused');
      return;
    }

    if (state === 'paused') {
      // Finished last time: a second press starts over rather than sitting at the end.
      if (positionRef.current >= spanSeconds) {
        positionRef.current = 0;
        setPositionSeconds(0);
      }
      activeRef.current = -1;
      setState('playing');
      startTimer();
      return;
    }

    setState('loading');
    void (async (): Promise<void> => {
      const ready = await preload();
      if (!ready) {
        setState('idle');
        return;
      }
      positionRef.current = 0;
      setPositionSeconds(0);
      activeRef.current = -1;
      setState('playing');
      startTimer();
    })();
  }, [canPlay, pauseAll, preload, spanSeconds, startTimer, state, stopTimer]);

  return { spans: effectiveSpans, state, positionSeconds, isInGap, toggle, seek, canPlay };
}
