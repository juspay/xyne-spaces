import { neededChunkSequences, type RecordingCaptureManifest } from '@xyne/shared';
import { recordingService } from '../recordingService';
import { computeManifestHash, manifestByteLength } from './clientManifest';
import type { RecordingRepairUploader, RecordingUploadInput } from './uploader';

// Uploads the capture THROUGH the backend, which writes it to GCS server-side (no
// direct-to-GCS PUT, no bucket CORS). Because an outage always runs to the end of
// the call (terminal disconnect, or offline-from-start), the repair audio is the
// whole recording.webm — the client reads it as one contiguous range and sends it
// as a single stream. The transcription agent decodes + VAD/STT it as-is; there is
// no client-side or agent-side slicing/stitching beyond this single read.

class BackendProxyUploader implements RecordingRepairUploader {
  async uploadCapture(input: RecordingUploadInput): Promise<void> {
    const { callId, captureId, manifest } = input;
    // No outage to repair → nothing to upload.
    if (neededChunkSequences(manifest).length === 0) return;

    const totalBytes = manifestByteLength(manifest);
    if (totalBytes <= 0) return;

    const audio = await input.readRange(0, totalBytes);
    await recordingService.uploadRecordingRepairAudio(callId, captureId, audio);

    // Persist the manifest locally, then send it to the backend as the commit
    // marker. The hash excludes uploadedSequences, so the server recomputes the
    // exact value the manifest carries.
    const manifestHash = await computeManifestHash(manifest);
    const finalManifest: RecordingCaptureManifest = {
      ...manifest,
      uploadedSequences: manifest.chunks.map(chunk => chunk.sequence),
      manifestHash,
    };
    await input.persistManifest(finalManifest);
    await recordingService.finalizeRecordingRepair(callId, captureId, finalManifest);
  }
}

export const backendProxyUploader = new BackendProxyUploader();
