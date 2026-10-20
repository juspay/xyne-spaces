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

/** Subset of expo-video's `VideoTrack` captured on `sourceLoad`. */
export type VideoTrackInput = Readonly<{
  mimeType: string | null;
  size?: Readonly<{ width: number; height: number }> | null | undefined;
  isSupported: boolean;
}>;

/** Primary video track as reported by the player; `null` until `sourceLoad`. */
export type VideoTrackFields = Readonly<{
  videoTrackMimeType: string | null;
  videoTrackWidth: number | null;
  videoTrackHeight: number | null;
  /** Player's own verdict on whether this device can decode the track. */
  videoTrackIsSupported: boolean | null;
}>;

export type VideoPlaybackReadyFields = Readonly<{
  surface: VideoPlaybackSurface;
  attachmentId: string | null;
  mimetype: string | null;
  fileExtension: string | null;
  sizeBytes: number | null;
  timeToReadyMs: number | null;
  durationMs: number | null;
}> &
  VideoTrackFields;

export type VideoPlaybackFailedFields = Readonly<{
  surface: VideoPlaybackSurface;
  stage: VideoPlaybackFailureStage;
  attachmentId: string | null;
  mimetype: string | null;
  fileExtension: string | null;
  sizeBytes: number | null;
  errorCategory: VideoPlaybackErrorCategory;
  /**
   * `NSError` `Domain:code` (iOS) when present in the message. Always `null`
   * on Android: expo-video's `PlaybackError` only forwards
   * `localizedMessage`, not ExoPlayer's `ERROR_CODE_*`.
   */
  errorCode: string | null;
  /** Native decoder named in the error (e.g. `c2.mtk.hevc.decoder`), when present. */
  decoderName: string | null;
  /** Player error message with URLs stripped, truncated to 500 chars. */
  errorMessage: string;
  msSinceOpen: number | null;
  /** True when the player had reached `readyToPlay` before failing (mid-playback error). */
  reachedReady: boolean;
}> &
  VideoTrackFields;

const MAX_ERROR_MESSAGE_LENGTH = 500;

const DECODER_PATTERN =
  /MediaCodec|Decoder (?:init )?failed|NO_EXCEEDS_CAPABILITIES|NO_UNSUPPORTED_TYPE|NO_UNSUPPORTED_DRM|format_supported=NO|dolby-vision|AVFoundationErrorDomain[^\d-]*-118(?:28|29|33)/i;
const PARSE_PATTERN =
  /ParserException|UnrecognizedInputFormat|malformed|AVFoundationErrorDomain[^\d-]*-11850/i;
const NETWORK_PATTERN =
  /Unable to connect|timed? ?out|network|connection (?:refused|reset|closed|abort)|UnknownHost|SocketException|SSLHandshake|NSURLErrorDomain|not connected/i;
/** Only an explicit HTTP status counts as an HTTP failure. */
const HTTP_PATTERN = /Response code:\s*[45]\d\d\b/i;

const NS_ERROR_CODE_PATTERN = /([A-Za-z]+ErrorDomain)[^\d-]*(-?\d+)/;
const DECODER_NAME_PATTERN = /\b((?:c2|OMX)\.[A-Za-z0-9_.-]+)/;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>),\]]+/gi;

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
  // Stream URLs carry the local proxy port, capability tokens and attachment
  // paths; never ship them in a log line.
  const trimmed =
    message.replace(URL_PATTERN, '[url]').replace(/\s+/g, ' ').trim() ||
    'Unknown video playback error';
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
  // Network before HTTP: "Unable to connect to http://127.0.0.1:…" contains
  // "http" but is a connectivity failure. HTTP only on an explicit status.
  if (NETWORK_PATTERN.test(message)) return 'network';
  if (HTTP_PATTERN.test(message)) return 'http';
  return 'unknown';
}

export function extractVideoErrorCode(message: string): string | null {
  const ns = NS_ERROR_CODE_PATTERN.exec(message);
  if (ns) return `${ns[1]}:${ns[2]}`;
  return null;
}

export function extractVideoDecoderName(message: string): string | null {
  const match = DECODER_NAME_PATTERN.exec(message);
  return match ? (match[1] ?? null) : null;
}

export const EMPTY_VIDEO_TRACK_FIELDS: VideoTrackFields = {
  videoTrackMimeType: null,
  videoTrackWidth: null,
  videoTrackHeight: null,
  videoTrackIsSupported: null,
};

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/** Picks the primary video track (first unsupported one wins, so a failure is explained). */
export function toVideoTrackFields(
  tracks: readonly VideoTrackInput[] | null | undefined,
): VideoTrackFields {
  if (!tracks || tracks.length === 0) return EMPTY_VIDEO_TRACK_FIELDS;
  const track = tracks.find(t => t.isSupported === false) ?? tracks[0];
  if (!track) return EMPTY_VIDEO_TRACK_FIELDS;
  return {
    videoTrackMimeType: typeof track.mimeType === 'string' ? track.mimeType.slice(0, 100) : null,
    videoTrackWidth: positiveInt(track.size?.width),
    videoTrackHeight: positiveInt(track.size?.height),
    videoTrackIsSupported: typeof track.isSupported === 'boolean' ? track.isSupported : null,
  };
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
  videoTrack?: VideoTrackFields | null | undefined;
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
    ...(input.videoTrack ?? EMPTY_VIDEO_TRACK_FIELDS),
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
  videoTrack?: VideoTrackFields | null | undefined;
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
    ...(input.videoTrack ?? EMPTY_VIDEO_TRACK_FIELDS),
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
  private track: VideoTrackFields = EMPTY_VIDEO_TRACK_FIELDS;

  open(nowMs: number): void {
    this.openedAtMs = nowMs;
    this.readyReported = false;
    this.failedReported = false;
    this.track = EMPTY_VIDEO_TRACK_FIELDS;
  }

  setVideoTrack(track: VideoTrackFields): void {
    this.track = track;
  }

  get videoTrack(): VideoTrackFields {
    return this.track;
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
