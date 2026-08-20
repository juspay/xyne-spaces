import { captureNeedsRedo } from '@xyne/shared';
import { recordingService } from '../recordingService';
import type { RecordingRepairUploader, RecordingUploadInput } from './uploader';

// Uploads the capture THROUGH the backend, which writes it to GCS server-side (no
// direct-to-GCS PUT, no bucket CORS). The repair audio is always the whole
// recording.webm — the client reads it as one contiguous range and sends it as a
// single stream, then calls finalize to trigger the server-side whole-file redo.
// The agent decodes + VAD/STT the file as-is; there is no client- or agent-side
// slicing/stitching beyond this single read.

class BackendProxyUploader implements RecordingRepairUploader {
  async uploadCapture(input: RecordingUploadInput): Promise<void> {
    const { callId, captureId, manifest } = input;
    // No outage → nothing to redo, nothing to upload.
    if (!captureNeedsRedo(manifest)) return;

    const totalBytes = manifest.byteLength;
    if (totalBytes <= 0) return;

    const audio = await input.readRange(0, totalBytes);
    await recordingService.uploadRecordingRepairAudio(callId, captureId, audio);
    await recordingService.finalizeRecordingRepair(callId, captureId);
  }
}

export const backendProxyUploader = new BackendProxyUploader();
