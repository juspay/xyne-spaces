// Canonical metadata for the offline-first note-taker recorder.
//
// A single long-lived MediaRecorder records the WHOLE call into one continuous
// `recording.webm` on the user's local disk. The sidecar `chunk_manifest.json`
// is just a tiny metadata record describing that file — enough to know its size,
// whether the call hit an outage, and whether recording finished. There is NO
// windowing: an outage is a sticky boolean. When it is set, the whole file is
// uploaded and re-transcribed server-side (see recordingRepairController).

export const RECORDING_REPAIR_MANIFEST_VERSION = 2;

/** Why a stretch of the live/transcription path was lost. Client-side UI only. */
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

/**
 * `chunk_manifest.json` — the sidecar metadata for a single local capture.
 * Deliberately minimal: the local `recording.webm` is the durable artifact, and
 * the server redo re-decodes the whole file, so nothing here describes byte
 * ranges or transcript windows.
 */
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
  /** True when the call began with no connectivity → the whole call needs redo. */
  offlineAtStart: boolean;
  /** Sticky: set once any outage signal fires during the call. Triggers the redo. */
  hadOutage: boolean;
  /** Total durably-recorded bytes of recording.webm (the whole-file upload length). */
  byteLength: number;
  /** True once recording has stopped (MediaRecorder finished). */
  completed: boolean;
}

/** Whether this capture needs a server-side whole-file redo. */
export function captureNeedsRedo(manifest: RecordingCaptureManifest): boolean {
  return manifest.hadOutage || manifest.offlineAtStart;
}
