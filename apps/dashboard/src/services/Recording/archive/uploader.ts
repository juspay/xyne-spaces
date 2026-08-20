import type { RecordingCaptureManifest } from '@xyne/shared';

// Seam between the recorder and the upload path. The recorder only knows "this
// capture hit an outage and needs a server-side redo"; the concrete uploader
// streams the whole recording.webm through the backend (which writes it to GCS)
// and calls finalize to kick off the redo. Registered at app init via
// setRecordingRepairUploader.

export interface RecordingUploadInput {
  callId: string;
  captureId: string;
  manifest: RecordingCaptureManifest;
  /** Read a byte range of the capture's recording.webm (used to read the whole file). */
  readRange: (byteOffset: number, byteLength: number) => Promise<Blob>;
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
