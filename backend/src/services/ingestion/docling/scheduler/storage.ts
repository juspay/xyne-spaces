/**
 * Staging storage for the async OCR scheduler — on the LOCAL filesystem (a tmp
 * folder in the container), NOT GCS. Parts and per-part result JSON are written
 * under DOCLING_ASYNC_STORAGE_ROOT.
 *
 * NOTE: local-disk staging only works while the scheduler runs as a SINGLE pod.
 * If roles split across pods, move staging to GCS or a shared RWX volume.
 *
 * The SOURCE PDF still lives in GCS — read it with readSourceBuffer().
 *
 * Layout:
 *   <root>/<fileId>/parts/00000.pdf      ← splitter writes, submitter reads
 *   <root>/<fileId>/results/00000.json   ← result writes, writer reads
 *   <root>/<fileId>/manifest.json
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getStorageService } from '@/services/storage/storageServiceFactory'
import { config } from '@/config/env'
import { logger } from '@/utils/logger'

const pad = (n: number) => String(n).padStart(5, '0')
const root = (fileId: string) => path.join(config.doclingScheduler.storageRoot, fileId)

export const stagingPaths = (fileId: string) => {
  const stageDir = root(fileId)
  return {
    stageDir,
    partsDir: path.join(stageDir, 'parts'),
    resultsDir: path.join(stageDir, 'results'),
    manifestPath: path.join(stageDir, 'manifest.json'),
  }
}

export const partKey = (fileId: string, partIndex: number) =>
  path.join(root(fileId), 'parts', `${pad(partIndex)}.pdf`)

export const resultKey = (fileId: string, partIndex: number) =>
  path.join(root(fileId), 'results', `${pad(partIndex)}.json`)

export const writePartBuffer = async (filePath: string, buffer: Buffer): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, buffer)
  await fs.rename(tmp, filePath)
}

export const readBuffer = async (filePath: string): Promise<Buffer> => {
  return fs.readFile(filePath)
}

export const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value), 'utf-8')
  await fs.rename(tmp, filePath)
}

export const readJson = async <T = unknown>(filePath: string): Promise<T> => {
  const buffer = await fs.readFile(filePath)
  return JSON.parse(buffer.toString('utf-8')) as T
}

export const cleanupStage = async (fileId: string): Promise<void> => {
  try {
    await fs.rm(root(fileId), { recursive: true, force: true })
  } catch (error) {
    logger.warn('[DOCLING_SCHEDULER] Stage cleanup failed', {
      fileId, error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The source PDF lives in GCS — fetch it from the default bucket. */
export const readSourceBuffer = async (gcsKey: string): Promise<Buffer> => {
  return getStorageService().getFileBuffer(gcsKey)
}
