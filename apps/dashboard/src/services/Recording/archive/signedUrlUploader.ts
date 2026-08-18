import axios from 'axios';
import { neededChunkSequences, type RecordingCaptureManifest } from '@xyne/shared';
import { recordingService } from '../recordingService';
import { computeManifestHash } from './clientManifest';
import type { RecordingRepairUploader, RecordingUploadInput } from './uploader';

// The signed URL binds the Content-Type, so the PUT must echo it exactly.
// eslint-disable-next-line @typescript-eslint/naming-convention
const CHUNK_HEADERS = { 'Content-Type': 'application/octet-stream' };
// eslint-disable-next-line @typescript-eslint/naming-convention
const MANIFEST_HEADERS = { 'Content-Type': 'application/json' };

// Uploads the repair-relevant chunk parts + manifest straight to GCS via signed
// PUT URLs, then finalizes. Web uses fetch PUT of the byte range; Electron routes
// the PUT through the main process (window.electronAPI.recordingFs) to avoid CORS
// and keep large reads out of the renderer.

const CHUNK_CONTENT_TYPE = 'application/octet-stream';
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

class SignedUrlUploader implements RecordingRepairUploader {
  async uploadCapture(input: RecordingUploadInput): Promise<void> {
    const { callId, captureId, manifest } = input;
    const needed = neededChunkSequences(manifest);
    if (needed.length === 0) return;

    const manifestHash = await computeManifestHash(manifest);
    const { chunks: urls, manifestUrl } = await recordingService.requestRecordingRepairUploadUrls(
      callId,
      captureId,
      needed,
    );
    const urlBySequence = new Map(urls.map(entry => [entry.sequence, entry.url]));
    const chunkBySequence = new Map(manifest.chunks.map(chunk => [chunk.sequence, chunk]));
    const recordingFs = window.electronAPI?.recordingFs ?? null;

    await mapConcurrent(needed, UPLOAD_CONCURRENCY, async sequence => {
      const url = urlBySequence.get(sequence);
      const chunk = chunkBySequence.get(sequence);
      if (!url || !chunk) throw new Error(`Missing upload URL for chunk ${sequence}`);
      if (recordingFs) {
        const { status } = await recordingFs.putChunk({
          url,
          captureId,
          byteOffset: chunk.byteOffset,
          byteLength: chunk.byteLength,
          contentType: CHUNK_CONTENT_TYPE,
        });
        if (status < 200 || status >= 300)
          throw new Error(`Chunk ${sequence} upload failed (${status})`);
      } else {
        const blob = await input.readRange(chunk.byteOffset, chunk.byteLength);
        await axios.put(url, blob, { headers: CHUNK_HEADERS });
      }
    });

    // Persist the final manifest locally, then upload it LAST as the commit marker.
    const finalManifest: RecordingCaptureManifest = {
      ...manifest,
      uploadedSequences: needed,
      manifestHash,
    };
    await input.persistManifest(finalManifest);
    if (recordingFs) {
      const { status } = await recordingFs.putManifest(captureId, manifestUrl);
      if (status < 200 || status >= 300) throw new Error(`Manifest upload failed (${status})`);
    } else {
      await axios.put(manifestUrl, JSON.stringify(finalManifest), { headers: MANIFEST_HEADERS });
    }

    await recordingService.finalizeRecordingRepair(callId, captureId, manifestHash);
  }
}

export const signedUrlUploader = new SignedUrlUploader();
