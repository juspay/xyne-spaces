import { useCallback, useEffect, useRef } from 'react';

import {
  emitVideoPlaybackFailed,
  emitVideoPlaybackReady,
} from '@/src/observability/logging/media/emitVideoPlayback';
import {
  buildVideoPlaybackFailed,
  buildVideoPlaybackReady,
  VideoPlaybackSession,
  type VideoPlaybackFailureStage,
  type VideoPlaybackSubject,
  type VideoPlaybackSurface,
} from '@/src/observability/logging/media/videoPlayback';

interface UseVideoPlaybackTelemetryOptions {
  surface: VideoPlaybackSurface;
  subject: VideoPlaybackSubject;
  /** Identifies the opened source; a new key starts a new telemetry session. */
  sourceKey: string | null;
  /** Only an active (visible) player is measured. */
  active: boolean;
}

interface VideoPlaybackTelemetry {
  reportReady: (durationMs?: number | null) => void;
  reportFailure: (stage: VideoPlaybackFailureStage, error: unknown) => void;
}

/**
 * Emits `video_playback_ready` (time-to-first-frame-ready) and
 * `video_playback_failed` (stage, error category, ExoPlayer error code,
 * native decoder name) once per opened video source. Telemetry must never
 * break playback, so every emission is wrapped in try/catch.
 */
export function useVideoPlaybackTelemetry({
  surface,
  subject,
  sourceKey,
  active,
}: UseVideoPlaybackTelemetryOptions): VideoPlaybackTelemetry {
  const sessionRef = useRef(new VideoPlaybackSession());
  const subjectRef = useRef(subject);
  subjectRef.current = subject;

  useEffect(() => {
    const session = sessionRef.current;
    if (!active || !sourceKey) {
      session.close();
      return;
    }
    session.open(Date.now());
  }, [active, sourceKey]);

  const reportReady = useCallback(
    (durationMs?: number | null): void => {
      try {
        const session = sessionRef.current;
        if (session.openedAt === null || !session.markReady()) return;
        emitVideoPlaybackReady(
          buildVideoPlaybackReady({
            surface,
            subject: subjectRef.current,
            openedAtMs: session.openedAt,
            nowMs: Date.now(),
            durationMs,
          }),
        );
      } catch {
        // Telemetry is best-effort.
      }
    },
    [surface],
  );

  const reportFailure = useCallback(
    (stage: VideoPlaybackFailureStage, error: unknown): void => {
      try {
        const session = sessionRef.current;
        const reachedReady = session.hasReachedReady;
        if (!session.markFailed()) return;
        emitVideoPlaybackFailed(
          buildVideoPlaybackFailed({
            surface,
            stage,
            subject: subjectRef.current,
            error,
            openedAtMs: session.openedAt,
            nowMs: Date.now(),
            reachedReady,
          }),
        );
      } catch {
        // Telemetry is best-effort.
      }
    },
    [surface],
  );

  return { reportReady, reportFailure };
}
