/**
 * Sequential playback across a call's recordings, driven by the call's own clock.
 *
 * The playhead is a position on the timeline, not an offset into any one file, so a
 * stretch nobody recorded still takes its real time to cross — in silence. What you
 * hear stays aligned with when it happened.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
  /**
   * Where the video spans are mounted. Attach it to a visible surface or they play
   * unseen; whatever sits behind it shows through wherever no video is on screen.
   */
  videoContainerRef: RefObject<HTMLDivElement | null>;
}

export type RecordingLoader = (recordingId: string, signal: AbortSignal) => Promise<Blob>;

/** How often the playhead is recomputed. Fine enough to look continuous. */
const TICK_MS = 100;

/** Index of the span containing `seconds`, or -1 between them. */
function spanIndexAt(spans: readonly RecordedSpan[], seconds: number): number {
  return spans.findIndex(span => seconds >= span.startSeconds && seconds < span.endSeconds);
}

/**
 * Audio plays fine detached; video has to be in the document to be seen, so it is
 * mounted into the caller's surface and kept hidden until the playhead reaches it.
 *
 * A screen recording asked for without its picture becomes an audio element: the
 * sound of the call is in that file too, and skipping it would leave the timeline
 * silent over a stretch where people were talking.
 */
function createMediaElement(
  span: RecordedSpan,
  url: string,
  container: HTMLElement | null,
  showVideo: boolean,
): HTMLMediaElement {
  if (span.kind === 'audio' || !showVideo) return new Audio(url);

  const video = document.createElement('video');
  video.src = url;
  video.preload = 'auto';
  video.playsInline = true;
  video.hidden = true;
  container?.appendChild(video);
  return video;
}

/** Resolves once the element can be seeked, and on error too — a dud must not hang play. */
function whenSeekable(media: HTMLMediaElement): Promise<void> {
  if (media.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise(resolve => {
    const done = (): void => {
      media.removeEventListener('loadedmetadata', done);
      media.removeEventListener('error', done);
      resolve();
    };
    media.addEventListener('loadedmetadata', done);
    media.addEventListener('error', done);
  });
}

/**
 * @param showVideo Whether the screen recordings render their picture. Either way
 *   their audio is played, so the call is heard end to end in both modes.
 */
export function useTimelinePlayback(
  spans: readonly RecordedSpan[],
  spanSeconds: number,
  loadRecording: RecordingLoader | undefined,
  showVideo: boolean,
): TimelinePlayback {
  const [state, setState] = useState<TimelinePlaybackState>('idle');
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [isInGap, setIsInGap] = useState(false);

  const [measuredAt, setMeasuredAt] = useState(0);
  const durationsRef = useRef(new Map<string, number>());
  const mediaRef = useRef(new Map<string, HTMLMediaElement>());
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
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
    for (const media of mediaRef.current.values()) {
      media.pause();
      if (media instanceof HTMLVideoElement) media.hidden = true;
    }
    activeRef.current = -1;
  }, []);

  /** Frees every element and blob. A blob URL pins the whole recording in memory. */
  const release = useCallback((): void => {
    stopTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    for (const media of mediaRef.current.values()) {
      media.pause();
      media.removeAttribute('src');
      media.load();
      // Detaches the video elements from the surface; a no-op for the audio ones.
      media.remove();
    }
    mediaRef.current.clear();
    durationsRef.current.clear();
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    activeRef.current = -1;
  }, [stopTimer]);

  // Nothing survives a change of call, of the spans, or of the mode — the elements
  // themselves differ between the two.
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
  }, [showVideo, spans]);

  const step = useCallback((): void => {
    const now = performance.now();
    const elapsed = Math.max(0, (now - lastTickRef.current) / 1000);
    lastTickRef.current = now;

    const index = spanIndexAt(effectiveSpans, positionRef.current);

    // Entered or left a recording: hand over to the right element.
    if (index !== activeRef.current) {
      const leaving = effectiveSpans[activeRef.current];
      const leavingMedia = leaving ? mediaRef.current.get(leaving.recordingId) : undefined;
      if (leavingMedia) {
        leavingMedia.pause();
        if (leavingMedia instanceof HTMLVideoElement) leavingMedia.hidden = true;
      }
      activeRef.current = index;

      const entering = effectiveSpans[index];
      const media = entering ? mediaRef.current.get(entering.recordingId) : undefined;
      if (entering && media) {
        if (media instanceof HTMLVideoElement) media.hidden = false;
        media.currentTime = Math.max(0, positionRef.current - entering.startSeconds);
        void media.play().catch(() => undefined);
      }
    }

    const current = effectiveSpans[index];
    const media = current ? mediaRef.current.get(current.recordingId) : undefined;
    const isSounding = Boolean(media && !media.paused && !media.ended);

    // The file is the clock while it plays. Between files — and after one that ran
    // short of its span — real time is, so the silence lasts as long as it did.
    const next = isSounding
      ? current!.startSeconds + media!.currentTime
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
          if (mediaRef.current.has(span.recordingId)) return;
          const blob = await loadRecording(span.recordingId, controller.signal);
          if (controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          const media = createMediaElement(span, url, videoContainerRef.current, showVideo);
          await whenSeekable(media);
          if (Number.isFinite(media.duration) && media.duration > 0) {
            durationsRef.current.set(span.recordingId, media.duration);
          }
          mediaRef.current.set(span.recordingId, media);
        }),
      );
      if (controller.signal.aborted) return false;
      // Redraws the bands at their true length.
      setMeasuredAt(Date.now());
      return true;
    } catch {
      return false;
    }
  }, [loadRecording, showVideo, spans]);

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

  return {
    spans: effectiveSpans,
    state,
    positionSeconds,
    isInGap,
    toggle,
    seek,
    canPlay,
    videoContainerRef,
  };
}
