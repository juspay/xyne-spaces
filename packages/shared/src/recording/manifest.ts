// Canonical schema for the offline-first note-taker recorder.
//
// A single long-lived MediaRecorder records the WHOLE call into one continuous
// `recording.webm` on the user's local disk. Every ~10s timeslice fragment is
// appended to that file and described here as a byte range. These fragments are
// MediaRecorder pieces and are NOT independently playable — the repair worker
// concatenates them in `sequence` order to reconstruct the original WebM before
// decoding. `chunk_manifest.json` is the durable source of truth for one capture;
// it is uploaded to GCS LAST, as the commit marker, after all referenced chunks.

export const RECORDING_REPAIR_MANIFEST_VERSION = 1;

/** Why a stretch of the live/transcription path was lost and must be repaired. */
export type RecordingRepairReason =
  | 'browser_offline'
  | 'livekit_disconnected'
  | 'reconnect_timeout'
  | 'agent_left'
  | 'stt_failed';

export const RECORDING_REPAIR_REASONS: readonly RecordingRepairReason[] = [
  'browser_offline',
  'livekit_disconnected',
  'reconnect_timeout',
  'agent_left',
  'stt_failed',
];

export function isRecordingRepairReason(value: unknown): value is RecordingRepairReason {
  return (
    typeof value === 'string' &&
    (RECORDING_REPAIR_REASONS as readonly string[]).includes(value)
  );
}

/** Server-side control-plane status for a finalized capture (lives in Redis). */
export type RecordingRepairStatus = 'FINALIZED' | 'PROCESSING' | 'MERGED' | 'FAILED';

/**
 * One MediaRecorder fragment, described as a byte range of `recording.webm`.
 * All wall-clock times are epoch ms; recording-relative offsets are derived as
 * `startedAtMs - manifest.startedAt` (the audio's t=0 is `manifest.startedAt`).
 */
export interface RecordingChunkDescriptor {
  /** 0-based, strictly contiguous across the capture. */
  sequence: number;
  /** Byte offset of this fragment within `recording.webm`. */
  byteOffset: number;
  /** Byte length of this fragment. */
  byteLength: number;
  /** Wall-clock epoch ms of the fragment's first sample. */
  startedAtMs: number;
  /** Wall-clock epoch ms of the fragment's last sample. */
  endedAtMs: number;
  /** Lowercase hex SHA-256 of the fragment bytes. */
  sha256: string;
}

/** A window of the call whose transcript must be repaired from local audio. */
export interface RecordingOutageWindow {
  startedAtMs: number;
  endedAtMs: number;
  reasons: RecordingRepairReason[];
}

/** A user "marked moment"; persisted locally first, then reconciled via Zero. */
export interface RecordingMarkedMoment {
  id: string;
  /** Seconds relative to recording start. */
  timestampSeconds: number;
  text: string;
  serverAcknowledged: boolean;
}

/** `chunk_manifest.json` — durable source of truth for a single local capture. */
export interface RecordingCaptureManifest {
  version: number;
  callId: string;
  /** UUID; also the GCS `recording-repairs/{callId}/{captureId}/` prefix segment. */
  captureId: string;
  /** Wall-clock epoch ms of recording start; the audio timeline's t=0. */
  startedAt: number;
  /** Wall-clock epoch ms of recording stop; null while still recording. */
  endedAt: number | null;
  /** e.g. 'audio/webm;codecs=opus'. */
  mimeType: string;
  audioBitsPerSecond: number;
  /** True when the call began with no connectivity → the whole call needs repair. */
  offlineAtStart: boolean;
  chunks: RecordingChunkDescriptor[];
  outages: RecordingOutageWindow[];
  markedMoments: RecordingMarkedMoment[];
  /** Sequences already durably uploaded to GCS (upload-resume progress). */
  uploadedSequences: number[];
  /** True once recording has stopped (MediaRecorder finished). */
  completed: boolean;
  /** SHA-256 over the immutable recorded content (see serializeManifestForHash). */
  manifestHash: string | null;
}

/**
 * Deterministic serialization of the immutable recorded content, used as the
 * pre-image for `manifestHash`. Both the browser (WebCrypto) and the worker
 * (node crypto) hash THIS exact string so finalize can verify the uploaded
 * manifest matches what the client committed. Deliberately excludes
 * `manifestHash` and `uploadedSequences` (upload progress is not content).
 */
export function serializeManifestForHash(manifest: RecordingCaptureManifest): string {
  return JSON.stringify({
    version: manifest.version,
    callId: manifest.callId,
    captureId: manifest.captureId,
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt,
    mimeType: manifest.mimeType,
    audioBitsPerSecond: manifest.audioBitsPerSecond,
    offlineAtStart: manifest.offlineAtStart,
    chunks: manifest.chunks.map((c) => [
      c.sequence,
      c.byteOffset,
      c.byteLength,
      c.startedAtMs,
      c.endedAtMs,
      c.sha256,
    ]),
    outages: manifest.outages.map((o) => [
      o.startedAtMs,
      o.endedAtMs,
      [...o.reasons].sort(),
    ]),
    markedMoments: manifest.markedMoments.map((m) => [m.id, m.timestampSeconds, m.text]),
    completed: manifest.completed,
  });
}

/**
 * The chunk sequences that must be uploaded to GCS for transcript repair: a
 * CONTIGUOUS prefix [0 .. last-outage-overlapping-chunk], or every chunk when the
 * call began offline. Uploading from sequence 0 guarantees the worker can
 * concatenate a gap-free, decodable WebM (chunk 0 holds the init segment) and trim
 * each outage window by time offset. Client, finalize, and worker all use this so
 * they agree on what "fully uploaded" means. Empty ⇒ nothing needs repair.
 */
export function neededChunkSequences(manifest: RecordingCaptureManifest): number[] {
  if (manifest.chunks.length === 0) return [];
  if (manifest.offlineAtStart) return manifest.chunks.map((c) => c.sequence);
  let maxSeq = -1;
  for (const chunk of manifest.chunks) {
    const overlaps = manifest.outages.some(
      (o) => chunk.startedAtMs < o.endedAtMs && chunk.endedAtMs > o.startedAtMs,
    );
    if (overlaps) maxSeq = Math.max(maxSeq, chunk.sequence);
  }
  if (maxSeq < 0) return [];
  return manifest.chunks.filter((c) => c.sequence <= maxSeq).map((c) => c.sequence);
}

/**
 * Structural validation of a parsed manifest: shape, chunk contiguity (0-based,
 * ordered, non-overlapping byte ranges) and outage ordering. Returns the reason
 * on failure so callers can log it; null when valid. Pure (no hashing).
 */
export function validateManifestStructure(manifest: RecordingCaptureManifest): string | null {
  if (manifest.version !== RECORDING_REPAIR_MANIFEST_VERSION) {
    return `Unsupported manifest version ${manifest.version}`;
  }
  if (!manifest.callId || !manifest.captureId) return 'Missing callId/captureId';
  if (!Number.isFinite(manifest.startedAt)) return 'Invalid startedAt';
  let expectedOffset = 0;
  for (let i = 0; i < manifest.chunks.length; i += 1) {
    const c = manifest.chunks[i]!;
    if (c.sequence !== i) return `Non-contiguous chunk sequence at index ${i}`;
    if (c.byteOffset !== expectedOffset) return `Non-contiguous byte offset at sequence ${c.sequence}`;
    if (!(c.byteLength > 0)) return `Non-positive byteLength at sequence ${c.sequence}`;
    if (!(c.endedAtMs > c.startedAtMs)) return `Invalid chunk time span at sequence ${c.sequence}`;
    if (!/^[a-f0-9]{64}$/.test(c.sha256)) return `Invalid sha256 at sequence ${c.sequence}`;
    expectedOffset += c.byteLength;
  }
  for (let i = 0; i < manifest.outages.length; i += 1) {
    const o = manifest.outages[i]!;
    if (!(o.endedAtMs > o.startedAtMs)) return `Invalid outage window at index ${i}`;
    if (!Array.isArray(o.reasons) || o.reasons.length === 0) return `Outage ${i} has no reasons`;
    if (o.reasons.some((r) => !isRecordingRepairReason(r))) return `Outage ${i} has an invalid reason`;
  }
  return null;
}
