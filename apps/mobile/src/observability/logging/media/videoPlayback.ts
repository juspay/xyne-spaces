/**
 * Pure builders for the `video_playback_ready` / `video_playback_failed`
 * structured log events. No React / React Native imports so the logic is
 * unit-testable under `node --test`.
 *
 * Why this exists: until now a failed video only rendered "Failed to load
 * video" on screen and sent nothing to telemetry, so playback RCAs (e.g. an
 * Android decoder that cannot handle an iPhone Dolby Vision/HEVC `.mov`) had
 * to be reconstructed from server range-request patterns. These events make
 * the client-side failure — and the decoder that raised it — queryable in
 * Grafana (`xyne-logging-bridge`, `platformName:"native"`).
 */

export type VideoPlaybackSurface = 'chat_viewer' | 'attachments_viewer' | 'call_recording';

/**
 * Where in the pipeline the failure surfaced.
 * - `stream_url`: the mTLS proxy could not produce a playable URL (never reached the player).
 * - `source_replace`: `player.replaceAsync(...)` rejected.
 * - `player_status`: the native player emitted `statusChange` → `error`
 *   (decoder init, HTTP, parse, network — see `errorCategory`).
 */
export type VideoPlaybackFailureStage = 'stream_url' | 'source_replace' | 'player_status';

export type VideoPlaybackErrorCategory =
  'decoder_unsupported' | 'http' | 'network' | 'container_parse' | 'stream_setup' | 'unknown';

export type VideoPlaybackSubject = Readonly<{
  attachmentId: string | null;
  mimetype: string | null;
  originalFilename?: string | null | undefined;
  sizeBytes?: number | null | undefined;
}>;

export type VideoPlaybackReadyFields = Readonly<{
  surface: VideoPlaybackSurface;
  attachmentId: string | null;
  mimetype: string | null;
  fileExtension: string | null;
  sizeBytes: number | null;
  timeToReadyMs: number | null;
  durationMs: number | null;
}>;

export type VideoPlaybackFailedFields = Readonly<{
  surface: VideoPlaybackSurface;
  stage: VideoPlaybackFailureStage;
  attachmentId: string | null;
  mimetype: string | null;
  fileExtension: string | null;
  sizeBytes: number | null;
  errorCategory: VideoPlaybackErrorCategory;
  /** ExoPlayer `ERROR_CODE_*` (Android) or `NSError` domain/code when present. */
  errorCode: string | null;
  /** Native decoder named in the error (e.g. `c2.mtk.hevc.decoder`), when present. */
  decoderName: string | null;
  errorMessage: string;
  msSinceOpen: number | null;
  /** True when the player had reached `readyToPlay` before failing (mid-playback error). */
  reachedReady: boolean;
}>;

const MAX_ERROR_MESSAGE_LENGTH = 500;

const DECODER_PATTERN =
  /decoder|codec|NO_EXCEEDS_CAPABILITIES|EXCEEDS_CAPABILITIES|MediaCodec|format_supported|FORMAT_UNSUPPORTED|DECODING_FORMAT|DECODER_INIT|dolby|hevc|cannot decode|AVFoundationErrorDomain.*-11828|-11829|-11833/i;
const HTTP_PATTERN = /response code|InvalidResponseCode|BAD_HTTP_STATUS|\bHTTP\b|\b(4|5)\d\d\b/i;
const NETWORK_PATTERN =
  /timeout|timed out|network|connection|unable to connect|ECONN|UnknownHost|NSURLErrorDomain|IO_NETWORK|not connected/i;
const PARSE_PATTERN =
  /ParserException|PARSING_CONTAINER|PARSING_MANIFEST|malformed|Unrecognized|UnrecognizedInputFormat|cannot open|-11850/i;

const ERROR_CODE_PATTERN = /ERROR_CODE_[A-Z_]+/;
const NS_ERROR_CODE_PATTERN = /([A-Za-z]+ErrorDomain)[^\d-]*(-?\d+)/;
const DECODER_NAME_PATTERN = /\b((?:c2|OMX)\.[A-Za-z0-9_.-]+)/;

export function getVideoFileExtension(subject: VideoPlaybackSubject): string | null {
  const name = subject.originalFilename;
  if (typeof name === 'string') {
    const dot = name.lastIndexOf('.');
    if (dot > -1 && dot < name.length - 1) {
      return name
        .slice(dot + 1)
        .toLowerCase()
        .slice(0, 10);
    }
  }
  return null;
}

export function toVideoErrorMessage(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message || error.name;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message: unknown }).message);
  } else {
    message = 'Unknown video playback error';
  }
  const trimmed = message.trim() || 'Unknown video playback error';
  return trimmed.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${trimmed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : trimmed;
}

export function classifyVideoPlaybackError(
  stage: VideoPlaybackFailureStage,
  message: string,
): VideoPlaybackErrorCategory {
  if (stage === 'stream_url') return 'stream_setup';
  if (DECODER_PATTERN.test(message)) return 'decoder_unsupported';
  if (PARSE_PATTERN.test(message)) return 'container_parse';
  if (HTTP_PATTERN.test(message)) return 'http';
  if (NETWORK_PATTERN.test(message)) return 'network';
  return 'unknown';
}

export function extractVideoErrorCode(message: string): string | null {
  const exo = ERROR_CODE_PATTERN.exec(message);
  if (exo) return exo[0];
  const ns = NS_ERROR_CODE_PATTERN.exec(message);
  if (ns) return `${ns[1]}:${ns[2]}`;
  return null;
}

export function extractVideoDecoderName(message: string): string | null {
  const match = DECODER_NAME_PATTERN.exec(message);
  return match ? (match[1] ?? null) : null;
}

function normalizeSize(size: number | null | undefined): number | null {
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null;
}

function elapsed(openedAtMs: number | null, nowMs: number): number | null {
  return openedAtMs === null ? null : Math.max(0, Math.round(nowMs - openedAtMs));
}

export function buildVideoPlaybackReady(input: {
  surface: VideoPlaybackSurface;
  subject: VideoPlaybackSubject;
  openedAtMs: number | null;
  nowMs: number;
  durationMs?: number | null | undefined;
}): VideoPlaybackReadyFields {
  const duration = input.durationMs;
  return {
    surface: input.surface,
    attachmentId: input.subject.attachmentId,
    mimetype: input.subject.mimetype,
    fileExtension: getVideoFileExtension(input.subject),
    sizeBytes: normalizeSize(input.subject.sizeBytes),
    timeToReadyMs: elapsed(input.openedAtMs, input.nowMs),
    durationMs:
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? Math.round(duration)
        : null,
  };
}

export function buildVideoPlaybackFailed(input: {
  surface: VideoPlaybackSurface;
  stage: VideoPlaybackFailureStage;
  subject: VideoPlaybackSubject;
  error: unknown;
  openedAtMs: number | null;
  nowMs: number;
  reachedReady: boolean;
}): VideoPlaybackFailedFields {
  const errorMessage = toVideoErrorMessage(input.error);
  return {
    surface: input.surface,
    stage: input.stage,
    attachmentId: input.subject.attachmentId,
    mimetype: input.subject.mimetype,
    fileExtension: getVideoFileExtension(input.subject),
    sizeBytes: normalizeSize(input.subject.sizeBytes),
    errorCategory: classifyVideoPlaybackError(input.stage, errorMessage),
    errorCode: extractVideoErrorCode(errorMessage),
    decoderName: extractVideoDecoderName(errorMessage),
    errorMessage,
    msSinceOpen: elapsed(input.openedAtMs, input.nowMs),
    reachedReady: input.reachedReady,
  };
}

/**
 * Per-player-session guard: at most one `ready` and one `failed` event per
 * opened source. `statusChange → error` and a rejected `replaceAsync` often
 * fire for the same failure; the first one wins.
 */
export class VideoPlaybackSession {
  private openedAtMs: number | null = null;
  private readyReported = false;
  private failedReported = false;

  open(nowMs: number): void {
    this.openedAtMs = nowMs;
    this.readyReported = false;
    this.failedReported = false;
  }

  close(): void {
    this.openedAtMs = null;
  }

  get openedAt(): number | null {
    return this.openedAtMs;
  }

  get hasReachedReady(): boolean {
    return this.readyReported;
  }

  /** Returns true when the caller should emit `video_playback_ready`. */
  markReady(): boolean {
    if (this.readyReported || this.failedReported) return false;
    this.readyReported = true;
    return true;
  }

  /** Returns true when the caller should emit `video_playback_failed`. */
  markFailed(): boolean {
    if (this.failedReported) return false;
    this.failedReported = true;
    return true;
  }
}
