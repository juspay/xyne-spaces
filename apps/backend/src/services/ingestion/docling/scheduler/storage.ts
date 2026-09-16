/**
 * Staging storage for the async OCR scheduler.
 *
 * Split parts, per-part result JSON and the manifest live in the DEFAULT
 * storage bucket (GCS/S3/Azure via the storage-service factory), so any
 * scheduler pod can read what another pod staged. The roles (splitter /
 * submitter / result / writer) run on different pods in production — staging
 * on pod-local disk made the submitter and the writer fail with ENOENT
 * whenever they picked up a file some other pod had staged.
 *
 * Layout (object keys in the default bucket):
 *   docling-staging/<fileId>/parts/00000.pdf     ← splitter writes, submitter reads
 *   docling-staging/<fileId>/results/00000.json  ← result worker writes, writer reads
 *   docling-staging/<fileId>/manifest.json
 *
 * The prefix is a constant, not a config knob: these keys are persisted on
 * docling_async_files / docling_async_parts rows, so a per-environment prefix
 * would strand every in-flight file the moment it changed. Environments are
 * already separated by bucket.
 *
 * The source PDF lives in the same bucket outside the staging prefix — read it
 * with readSourceBuffer().
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getStorageService } from '@/services/storage/storageServiceFactory'
import { logger } from '@/utils/logger'

const STAGING_PREFIX = 'docling-staging'

/** Deletes issued in parallel while cleaning up a file's staged objects. */
const CLEANUP_CONCURRENCY = 16

const pad = (n: number) => String(n).padStart(5, '0')

/** Object key under a file's staging prefix — always relative, never absolute. */
const stagingKey = (fileId: string, ...segments: string[]) =>
  [STAGING_PREFIX, fileId, ...segments].join('/')

export const stagingPaths = (fileId: string) => ({
  stageDir: stagingKey(fileId),
  partsDir: stagingKey(fileId, 'parts'),
  resultsDir: stagingKey(fileId, 'results'),
  manifestPath: stagingKey(fileId, 'manifest.json'),
})

export const partKey = (fileId: string, partIndex: number) =>
  stagingKey(fileId, 'parts', `${pad(partIndex)}.pdf`)

export const resultKey = (fileId: string, partIndex: number) =>
  stagingKey(fileId, 'results', `${pad(partIndex)}.json`)

const upload = async (key: string, buffer: Buffer, contentType: string): Promise<void> => {
  await getStorageService().uploadFileV2(buffer, { path: key, contentType })
}

export const writePartBuffer = (key: string, buffer: Buffer): Promise<void> =>
  upload(key, buffer, 'application/pdf')

export const writeJson = (key: string, value: unknown): Promise<void> =>
  upload(key, Buffer.from(JSON.stringify(value), 'utf-8'), 'application/json')

/**
 * Rows staged before this moved to object storage carry an ABSOLUTE local
 * path; read those from disk, which resolves only on the pod that staged them.
 * Anywhere else the read throws and the caller re-stages from the source PDF
 * (see readStagedPartBuffer in workers/scheduler.ts). New rows always carry a
 * staging key.
 */
export const readBuffer = (ref: string): Promise<Buffer> =>
  path.isAbsolute(ref) ? fs.readFile(ref) : getStorageService().getFileBuffer(ref)

export const readJson = async <T = unknown>(ref: string): Promise<T> =>
  JSON.parse((await readBuffer(ref)).toString('utf-8')) as T

export const readSourceBuffer = (storageKey: string): Promise<Buffer> =>
  getStorageService().getFileBuffer(storageKey)

/**
 * "The object isn't there", across every provider plus the legacy local reads:
 * GCS ("File does not exist in GCS"), S3 (NoSuchKey), Azure (BlobNotFound) and
 * the filesystem (ENOENT). The storage services rethrow a plain Error that
 * carries the cause in its message, so this has to match on the message —
 * matched narrowly, since a false positive fails a file terminally (and a bare
 * /does not exist/ would also catch Postgres errors).
 */
const MISSING_OBJECT_PATTERN =
  /does not exist in GCS|NoSuchKey|specified key does not exist|BlobNotFound|specified blob does not exist|ENOENT|No such file or directory/i

export const isMissingObjectError = (error: unknown): boolean =>
  MISSING_OBJECT_PATTERN.test(error instanceof Error ? error.message : String(error))

/** Drop every staged object for a file — best effort, never fails the caller. */
export const cleanupStage = async (fileId: string): Promise<void> => {
  try {
    const service = getStorageService()
    const staged = await service.listFiles(`${stagingKey(fileId)}/`)
    let failed = 0
    for (let i = 0; i < staged.length; i += CLEANUP_CONCURRENCY) {
      const batch = staged.slice(i, i + CLEANUP_CONCURRENCY)
      const results = await Promise.allSettled(batch.map((file) => service.deleteFile(file.name)))
      failed += results.filter((result) => result.status === 'rejected').length
    }
    if (failed > 0) {
      logger.warn('[DOCLING_SCHEDULER] Stage cleanup left objects behind', {
        fileId,
        staged: staged.length,
        failed,
      })
    }
  } catch (error) {
    logger.warn('[DOCLING_SCHEDULER] Stage cleanup failed', {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
