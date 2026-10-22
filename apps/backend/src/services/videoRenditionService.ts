import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { isPreconditionFailed, normalizeStoragePath } from '@xyne/storage';
import { logger } from '@/utils/logger';
import { storageService } from '@/services/storage';
import { MediaTimeoutError, probeVideo, transcodeToCompatMp4 } from '@/utils/ffmpeg';
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_DURATION_SECONDS,
  compatPath,
  decideCompat,
  isTerminalStatus,
  statusPath,
  transcodeTimeoutMs,
  CACHE_PREFIX,
  type CompatDecision,
  type VideoRenditionLookup,
  type VideoRenditionStatus,
  type VideoRenditionStatusRecord,
} from './videoRenditionPolicy';

export * from './videoRenditionPolicy';

/**
 * Server-side "compatible" renditions for chat video attachments.
 *
 * iPhones record HEVC 10-bit HDR (HLG) with a Dolby Vision layer by default.
 * Many Android devices (e.g. MediaTek `c2.mtk.hevc.decoder`) and non-Safari
 * browsers cannot decode that, so the player fails with "Failed to load video".
 *
 * Same model as HEIC → WebP (heicRenditionService): the original stays
 * byte-exact and is what downloads and the default stream return; a derived
 * H.264 8-bit SDR MP4 is generated OFF the API by a dedicated worker, cached
 * in storage keyed by the original's storage path, and served only when a
 * client explicitly asks for `/stream?variant=compat`. Clients that never ask
 * see no change at all.
 *
 * Unlike HEIC, video is never buffered in memory: the original is streamed to
 * a temp file, ffmpeg reads/writes local files only, and the output is
 * streamed back to storage.
 *
 * Generation status is a small JSON object next to the rendition (no DB
 * writes), mirroring HEIC's failure markers.
 */

type Storage = typeof storageService;

/** Cache folder for an original, keyed by its normalized storage path (as for HEIC). */
export function videoRenditionCacheBase(storagePath: string): string {
  const normalized = normalizeStoragePath(storagePath);
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `${CACHE_PREFIX}/${hash}`;
}

async function renditionObjectExists(storage: Storage, base: string): Promise<boolean> {
  try {
    return await storage.fileExists(compatPath(base));
  } catch {
    // Unknown — assume present so a storage blip does not trigger a re-encode.
    return true;
  }
}

async function readStatus(
  storage: Storage,
  base: string
): Promise<VideoRenditionStatusRecord | null> {
  try {
    const p = statusPath(base);
    if (!(await storage.fileExists(p))) return null;
    const raw = await storage.getFileBuffer(p);
    const parsed = JSON.parse(raw.toString('utf8')) as VideoRenditionStatusRecord;
    return parsed?.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function writeStatus(
  storage: Storage,
  base: string,
  record: Omit<VideoRenditionStatusRecord, 'v' | 'at'>
): Promise<void> {
  try {
    const full: VideoRenditionStatusRecord = { v: 1, at: Date.now(), ...record };
    await storage.uploadFileV2(Buffer.from(JSON.stringify(full)), {
      path: statusPath(base),
      contentType: 'application/json',
    });
  } catch (err) {
    logger.warn('[VideoRendition] Failed to write status', {
      base,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Generate (if needed) and cache the compatible rendition for the original at
 * `storagePath`. Runs only in the video rendition worker. Never throws for
 * deterministic outcomes — they become status records the read path reports.
 */
export async function generateVideoRendition(
  storage: Storage,
  storagePath: string
): Promise<VideoRenditionStatus | 'missing'> {
  const base = videoRenditionCacheBase(storagePath);
  const existing = await readStatus(storage, base);
  if (existing && isTerminalStatus(existing)) {
    // `ready` is only true if the rendition object still exists. The read path
    // reports `pending` (and re-enqueues) when compat.mp4 is gone, e.g. evicted
    // by a lifecycle rule while status.json survived; trusting the status here
    // would leave that attachment on 503 forever. Regenerate instead.
    if (existing.status !== 'ready' || (await renditionObjectExists(storage, base))) {
      return existing.status;
    }
    logger.warn('[VideoRendition] Status is ready but rendition object is missing; regenerating', {
      base,
    });
  }

  let sourceBytes: number;
  try {
    const meta = await storage.getFileMetadata(storagePath);
    sourceBytes = parseInt(String(meta.size || '0'), 10);
  } catch {
    // Original deleted while the job waited — nothing to do.
    return 'missing';
  }
  if (sourceBytes > MAX_SOURCE_BYTES) {
    await writeStatus(storage, base, { status: 'skipped', reasons: [], error: 'source_too_large' });
    return 'skipped';
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-rendition-'));
  const inputPath = path.join(workDir, 'input');
  const outputPath = path.join(workDir, 'compat.mp4');
  const startedAt = Date.now();
  try {
    await storage.downloadFile(storagePath, inputPath);

    let decision: CompatDecision;
    try {
      decision = decideCompat(await probeVideo(inputPath));
    } catch (err) {
      await writeStatus(storage, base, {
        status: 'skipped',
        reasons: [],
        error: `probe_failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`,
      });
      return 'skipped';
    }

    if (!decision.needed) {
      await writeStatus(storage, base, {
        status: 'not_needed',
        reasons: [],
        source: decision.source,
      });
      return 'not_needed';
    }
    if ((decision.source.durationSeconds ?? 0) > MAX_SOURCE_DURATION_SECONDS) {
      await writeStatus(storage, base, {
        status: 'skipped',
        reasons: decision.reasons,
        source: decision.source,
        error: 'source_too_long',
      });
      return 'skipped';
    }

    await transcodeToCompatMp4(inputPath, outputPath, {
      hdrTransfer: decision.hdrTransfer,
      timeoutMs: transcodeTimeoutMs(decision.source.durationSeconds),
    });
    const { size: outputBytes } = await fs.stat(outputPath);

    try {
      await storage.uploadStreamToPath(createReadStream(outputPath), {
        path: compatPath(base),
        contentType: 'video/mp4',
        ifNotExists: true,
        resumable: true,
      });
    } catch (err) {
      // Path-keyed: a collision means another worker already stored the identical rendition.
      if (!isPreconditionFailed(err)) throw err;
    }

    await writeStatus(storage, base, {
      status: 'ready',
      reasons: decision.reasons,
      source: decision.source,
      outputBytes,
    });
    logger.info('[VideoRendition] Compatible rendition ready', {
      base,
      reasons: decision.reasons,
      sourceCodec: decision.source.codec,
      sourceTransfer: decision.source.transfer,
      dolbyVision: decision.source.dolbyVision,
      durationSeconds: decision.source.durationSeconds,
      sourceBytes,
      outputBytes,
      elapsedMs: Date.now() - startedAt,
    });
    return 'ready';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[VideoRendition] Generation failed', {
      base,
      timedOut: err instanceof MediaTimeoutError,
      error: message.slice(0, 500),
      elapsedMs: Date.now() - startedAt,
    });
    await writeStatus(storage, base, {
      status: 'failed',
      reasons: [],
      error: message.slice(0, 300),
    });
    return 'failed';
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Read-path lookup for the stream endpoint. `pending` means no terminal status
 * yet (never generated, or a failure old enough to retry) — the caller
 * enqueues and answers 503.
 */
export async function getVideoRendition(
  storage: Storage,
  storagePath: string
): Promise<VideoRenditionLookup> {
  const base = videoRenditionCacheBase(storagePath);
  const record = await readStatus(storage, base);
  if (!record || !isTerminalStatus(record)) return { state: 'pending' };
  if (record.status !== 'ready') return { state: record.status };
  try {
    const meta = await storage.getFileMetadata(compatPath(base));
    const size = parseInt(String(meta.size || '0'), 10);
    if (size > 0) return { state: 'ready', path: compatPath(base), size };
  } catch {
    // Status says ready but the object is gone (e.g. lifecycle rule) — regenerate.
  }
  return { state: 'pending' };
}

/** Best-effort deletion of the rendition and its status for a deleted attachment. */
export async function deleteVideoRenditions(
  storagePath: string,
  storage: Storage = storageService
): Promise<void> {
  if (!storagePath) return;
  const base = videoRenditionCacheBase(storagePath);
  await Promise.all(
    [compatPath(base), statusPath(base)].map(async (p) => {
      try {
        await storage.deleteFile(p);
      } catch {
        // Missing entries are the common case; deletion is best-effort.
      }
    })
  );
}
