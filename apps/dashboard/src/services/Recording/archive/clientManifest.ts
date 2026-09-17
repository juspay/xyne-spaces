import { RECORDING_REPAIR_MANIFEST_VERSION, type RecordingCaptureManifest } from '@xyne/shared';
import type { RecordingCaptureCreate } from './types';

export const MANIFEST_FILE = 'chunk_manifest.json';
export const RECORDING_FILE = 'recording.webm';

/**
 * Human-friendly folder name for a capture: `recording_YYYY-MM-DD_HH-MM-SS_<4hex>`
 * in the user's local time. The short captureId-derived suffix keeps two recordings
 * started in the same second from colliding on one folder. Only `[A-Za-z0-9_-]` so it
 * passes the store path-segment guards on every backend.
 */
export function recordingDirName(startedAtMs: number, captureId: string): string {
  const date = new Date(startedAtMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const suffix = captureId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || '0000';
  return `recording_${stamp}_${suffix}`;
}

export function createManifest(meta: RecordingCaptureCreate): RecordingCaptureManifest {
  return {
    version: RECORDING_REPAIR_MANIFEST_VERSION,
    callId: meta.callId,
    captureId: meta.captureId,
    startedAt: meta.startedAt,
    endedAt: null,
    mimeType: meta.mimeType,
    audioBitsPerSecond: meta.audioBitsPerSecond,
    offlineAtStart: meta.offlineAtStart,
    hadOutage: false,
    byteLength: 0,
    completed: false,
  };
}

/** Total durably-recorded bytes; the length of the whole-file upload. */
export function manifestByteLength(manifest: RecordingCaptureManifest): number {
  return manifest.byteLength;
}
