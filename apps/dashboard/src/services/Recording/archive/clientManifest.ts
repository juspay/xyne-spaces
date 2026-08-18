import {
  RECORDING_REPAIR_MANIFEST_VERSION,
  serializeManifestForHash,
  type RecordingCaptureManifest,
} from '@xyne/shared';
import type { RecordingCaptureCreate } from './types';

export const MANIFEST_FILE = 'chunk_manifest.json';
export const RECORDING_FILE = 'recording.webm';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Lowercase hex SHA-256 of a fragment/blob, computed in the browser via WebCrypto. */
export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  return toHex(await crypto.subtle.digest('SHA-256', buffer));
}

/**
 * SHA-256 over the immutable recorded content (the exact pre-image the worker
 * re-hashes at finalize). Uses the shared serializer so client and server agree.
 */
export async function computeManifestHash(manifest: RecordingCaptureManifest): Promise<string> {
  const bytes = new TextEncoder().encode(serializeManifestForHash(manifest));
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
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
    chunks: [],
    outages: [],
    markedMoments: [],
    uploadedSequences: [],
    completed: false,
    manifestHash: null,
  };
}

/** Total durably-recorded bytes (end of the last chunk); also the next byteOffset. */
export function manifestByteLength(manifest: RecordingCaptureManifest): number {
  const last = manifest.chunks[manifest.chunks.length - 1];
  return last ? last.byteOffset + last.byteLength : 0;
}

/** Wall-clock epoch ms at the end of the last durably-recorded fragment. */
export function lastDurableEndedAtMs(manifest: RecordingCaptureManifest): number {
  const last = manifest.chunks[manifest.chunks.length - 1];
  return last ? last.endedAtMs : manifest.startedAt;
}
