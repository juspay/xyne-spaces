import { neededChunkSequences, type RecordingCaptureManifest } from '@xyne/shared';
import { recordingService } from '../recordingService';
import { computeManifestHash } from './clientManifest';
import type { RecordingRepairUploader, RecordingUploadInput } from './uploader';

// Uploads the repair-relevant chunk parts + manifest THROUGH the backend, which
// writes them to GCS server-side (no direct-to-GCS PUT, no bucket CORS). Byte
// ranges are read from the local recording.webm via the archive store and POSTed
// with bounded concurrency; the manifest is sent last via finalize as the commit
// marker. Identical in web and Electron — both POST to the authenticated backend.

const UPLOAD_CONCURRENCY = 4;

async function mapConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

class BackendProxyUploader implements RecordingRepairUploader {
  async uploadCapture(input: RecordingUploadInput): Promise<void> {
    const { callId, captureId, manifest } = input;
    const needed = neededChunkSequences(manifest);
    if (needed.length === 0) return;

    const chunkBySequence = new Map(manifest.chunks.map(chunk => [chunk.sequence, chunk]));
    await mapConcurrent(needed, UPLOAD_CONCURRENCY, async sequence => {
      const chunk = chunkBySequence.get(sequence);
      if (!chunk) throw new Error(`Manifest is missing chunk ${sequence}`);
      const blob = await input.readRange(chunk.byteOffset, chunk.byteLength);
      await recordingService.uploadRecordingRepairChunk(callId, captureId, sequence, blob);
    });

    // Stamp the manifest with what we uploaded, persist it locally, then send it to
    // the backend as the commit marker. The hash excludes uploadedSequences, so the
    // server recomputes the exact value the manifest carries.
    const manifestHash = await computeManifestHash(manifest);
    const finalManifest: RecordingCaptureManifest = {
      ...manifest,
      uploadedSequences: needed,
      manifestHash,
    };
    await input.persistManifest(finalManifest);
    await recordingService.finalizeRecordingRepair(callId, captureId, finalManifest);
  }
}

export const backendProxyUploader = new BackendProxyUploader();
