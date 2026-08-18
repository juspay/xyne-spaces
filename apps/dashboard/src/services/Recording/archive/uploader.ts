import type { RecordingCaptureManifest } from '@xyne/shared';

// Seam between the recorder and the upload path. The recorder only knows "this
// capture needs its outage audio repaired"; the concrete uploader streams the
// outage byte ranges + the manifest through the backend (which writes them to
// GCS) and calls finalize. Registered at app init via setRecordingRepairUploader.

export interface RecordingUploadInput {
  callId: string;
  captureId: string;
  manifest: RecordingCaptureManifest;
  /** Read a byte range of the capture's recording.webm. */
  readRange: (byteOffset: number, byteLength: number) => Promise<Blob>;
  /** Persist manifest mutations the uploader makes (e.g. uploadedSequences). */
  persistManifest: (manifest: RecordingCaptureManifest) => Promise<void>;
}

export interface RecordingRepairUploader {
  uploadCapture(input: RecordingUploadInput): Promise<void>;
}

let activeUploader: RecordingRepairUploader | null = null;

export function setRecordingRepairUploader(uploader: RecordingRepairUploader | null): void {
  activeUploader = uploader;
}

export function getRecordingRepairUploader(): RecordingRepairUploader | null {
  return activeUploader;
}
