/**
 * Staging storage for the async OCR scheduler — object storage (GCS/S3/Azure
 * via the storage-service factory), NOT pod-local disk. Parts, per-part result
 * JSON and the manifest are written under DOCLING_SCHEDULER_STAGING_PREFIX in
 * the default storage bucket, so ANY scheduler pod can read what ANY other pod
 * staged. The scheduler roles (splitter / submitter / result / writer) run on
 * different pods in production — pod-local staging made the writer fail with
 * ENOENT whenever it stitched a file whose results another pod had written.
 *
 * Rollout compatibility: rows written by the old pod-local code carry ABSOLUTE
 * filesystem paths in docling_async_parts.part_path / result_path (under
 * DOCLING_ASYNC_STORAGE_ROOT). readBuffer/readJson detect those and fall back
 * to the local filesystem, so in-flight files staged before the deploy can
 * still be read when the staging happens to be on the same pod. New rows
 * always carry relative staging keys.
 *
 * The SOURCE PDF always lived in GCS — read it with readSourceBuffer().
 *
 * Layout (object keys in the default bucket):
 *   <prefix>/<fileId>/parts/00000.pdf      ← splitter writes, submitter reads
 *   <prefix>/<fileId>/results/00000.json   ← result worker writes, writer reads
 *   <prefix>/<fileId>/manifest.json
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getStorageService } from '@/services/storage/storageServiceFactory'
import { config } from '@/config/env'
import { logger } from '@/utils/logger'

const pad = (n: number) => String(n).padStart(5, '0')

/** Staging prefix for one file — a relative object key, never absolute. */
const rootKey = (fileId: string) =>
  path.posix.join(config.doclingScheduler.stagingPrefix, fileId)

/** Object key for a staged artifact under the file's staging prefix. */
const stagingKey = (fileId: string, rel: string) => path.posix.join(rootKey(fileId), rel)

/**
 * Legacy rows (written while staging was pod-local) store absolute filesystem
 * paths. Anything absolute — or under the configured local storage root — is
 * read from local disk; everything else is a staging object key in the default
 * bucket.
 */
const isLegacyLocalPath = (ref: string) =>
  path.isAbsolute(ref) || ref.startsWith(config.doclingScheduler.storageRoot)

export const stagingPaths = (fileId: string) => {
  const stageDir = rootKey(fileId)
  return {
    stageDir,
    partsDir: stagingKey(fileId, 'parts'),
    resultsDir: stagingKey(fileId, 'results'),
    manifestPath: stagingKey(fileId, 'manifest.json'),
  }
}

export const partKey = (fileId: string, partIndex: number) =>
  stagingKey(fileId, `parts/${pad(partIndex)}.pdf`)

export const resultKey = (fileId: string, partIndex: number) =>
  stagingKey(fileId, `results/${pad(partIndex)}.json`)

export const writePartBuffer = async (key: string, buffer: Buffer): Promise<void> => {
  await getStorageService().uploadFileV2(buffer, { path: key, contentType: 'application/pdf' })
}

export const readBuffer = async (ref: string): Promise<Buffer> => {
  if (isLegacyLocalPath(ref)) return fs.readFile(ref)
  return getStorageService().getFileBuffer(ref)
}

export const writeJson = async (key: string, value: unknown): Promise<void> => {
  await getStorageService().uploadFileV2(Buffer.from(JSON.stringify(value), 'utf-8'), {
    path: key,
    contentType: 'application/json',
  })
}

export const readJson = async <T = unknown>(ref: string): Promise<T> => {
  const buffer = await readBuffer(ref)
  return JSON.parse(buffer.toString('utf-8')) as T
}

export const cleanupStage = async (fileId: string): Promise<void> => {
  // Object-storage staging: delete every staged object under the file's prefix.
  try {
    const service = getStorageService()
    const staged = await service.listFiles(`${rootKey(fileId)}/`)
    for (const file of staged) {
      await service.deleteFile(file.name)
    }
  } catch (error) {
    logger.warn('[DOCLING_SCHEDULER] Stage cleanup (object storage) failed', {
      fileId, error: error instanceof Error ? error.message : String(error),
    })
  }
  // Legacy pod-local staging from pre-GCS rows: best-effort remove.
  try {
    await fs.rm(path.join(config.doclingScheduler.storageRoot, fileId), {
      recursive: true,
      force: true,
    })
  } catch (error) {
    logger.warn('[DOCLING_SCHEDULER] Stage cleanup (local staging) failed', {
      fileId, error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The source PDF lives in GCS — fetch it from the default bucket. */
export const readSourceBuffer = async (gcsKey: string): Promise<Buffer> => {
  return getStorageService().getFileBuffer(gcsKey)
}
