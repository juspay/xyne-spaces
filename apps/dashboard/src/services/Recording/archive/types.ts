import type { RecordingCaptureManifest } from '@xyne/shared';

// Storage abstraction for the offline-first recorder. A single long-lived
// MediaRecorder appends timeslice fragments to one continuous `recording.webm`;
// the store persists those bytes plus a byte-range `chunk_manifest.json`. Three
// backends implement this: Electron native FS (IPC), the web File System Access
// API, and OPFS as a last-resort fallback. Audio bytes never enter IndexedDB.

export type RecordingArchiveKind = 'electron' | 'fsa' | 'opfs';

export interface RecordingArchiveInit {
  /** Whether the browser/OS will keep the files across storage pressure. */
  persistent: boolean;
  /** True when the destination is outside browser origin quota (native disk). */
  quotaBypassed: boolean;
}

export interface RecordingCaptureCreate {
  callId: string;
  captureId: string;
  mimeType: string;
  audioBitsPerSecond: number;
  startedAt: number;
  offlineAtStart: boolean;
}

/** An open capture being actively recorded into. */
export interface OpenArchiveCapture {
  readonly captureId: string;
  /**
   * Durably append one MediaRecorder fragment to `recording.webm` and return its
   * byte range. Must resolve only after the bytes are flushed to disk so crash
   * recovery never sees a manifest chunk whose bytes are missing.
   */
  appendFragment(bytes: Blob): Promise<{ byteOffset: number; byteLength: number }>;
  /** Overwrite `chunk_manifest.json`. Call AFTER the fragment append it describes. */
  writeManifest(manifest: RecordingCaptureManifest): Promise<void>;
  /** Read a slice of `recording.webm` (for direct-to-GCS upload). */
  readRange(byteOffset: number, byteLength: number): Promise<Blob>;
  /** Recording finished: mark the archive complete (e.g. move out of `.pending/`). */
  finalize(): Promise<void>;
  close(): Promise<void>;
}

/** A previously-recorded capture reopened for recovery/upload. */
export interface StoredArchiveCapture {
  readonly captureId: string;
  readonly manifest: RecordingCaptureManifest;
  readRange(byteOffset: number, byteLength: number): Promise<Blob>;
  writeManifest(manifest: RecordingCaptureManifest): Promise<void>;
}

export interface RecordingArchiveStore {
  readonly kind: RecordingArchiveKind;
  /** One-time setup (permission/persistence request, open the recordings dir). */
  init(): Promise<RecordingArchiveInit>;
  /**
   * Begin a capture. For fsa/electron this may prompt for a directory and MUST be
   * called from within the user gesture that starts recording (a saved directory
   * handle is reused on later launches without re-prompting).
   */
  createCapture(meta: RecordingCaptureCreate): Promise<OpenArchiveCapture>;
  /** Incomplete or not-yet-uploaded captures found on disk (crash/restart recovery). */
  listPendingCaptures(): Promise<StoredArchiveCapture[]>;
  deleteCapture(captureId: string): Promise<void>;
  /** Best-effort free space at the destination; null when unknowable. */
  freeSpace(): Promise<{ availableBytes: number | null }>;
}
