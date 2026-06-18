/**
 * Standard file processor for Knowledge Base items.
 *
 * Mirrors xyne-search's `processors/standardFileProcessor.ts` — the unified
 * job handler that processes a file (PDF, DOCX, text, sheet, etc.) and
 * writes the result to Vespa. Adapted for xyne-spaces:
 *   - Prisma DB instead of Drizzle
 *   - xyne-spaces VespaFileDocument + crudService.insert via mapCollection
 *   - GCS storage instead of local filesystem
 *   - IngestionStatus instead of UploadStatus
 */
import { db } from '@/database/client'
import { IngestionStatus } from '@prisma/client'
import { logger } from '@/utils/logger'
import { recordWorkerPhase } from '../observability/diagnostics'

export interface FileProcessingJob {
  fileId: string
  useOCR?: boolean
}

export type ProcessingJob = FileProcessingJob

export async function processJob(job: { data: ProcessingJob }): Promise<void> {
  const startTime = Date.now()
  const jobData = job.data
  const fileId = jobData.fileId

  recordWorkerPhase('process_job_dispatch', { fileId, jobData })

  try {
    await processFileJob(jobData, startTime)
  } finally {
    recordWorkerPhase('process_job_finished', {
      fileId, elapsedMs: Date.now() - startTime,
    })
  }
}

async function processFileJob(jobData: ProcessingJob, startTime: number): Promise<void> {
  const { fileId } = jobData

  const item = await db.collectionItem.findFirst({
    where: { id: fileId, isLatest: true, deletedAt: null },
  })
  if (!item) {
    logger.warn('[ingestion/standardFileProcessor] collection item not found', { fileId })
    return
  }

  const attachment = await db.messageAttachment.findFirst({
    where: { entityId: fileId, entityType: 'COLLECTION' },
  })
  if (!attachment?.url) {
    logger.warn('[ingestion/standardFileProcessor] no attachment found for item', { fileId })
    return
  }

  recordWorkerPhase('process_file_start', { fileId, mimeType: attachment.mimetype })

  try {
    // Dispatch to the xyne-spaces mapper pipeline via lazy import (TDZ guard).
    const { mapCollection } = await import('@/zero/vespa-injection/core/mapper')
    await mapCollection(item)

    await db.collectionItem.updateMany({
      where: { id: fileId },
      data: { ingestionStatus: IngestionStatus.COMPLETED },
    })

    recordWorkerPhase('process_file_done', {
      fileId, elapsedMs: Date.now() - startTime,
    })

    logger.info('[ingestion/standardFileProcessor] ✅ file processed', {
      fileId, elapsedMs: Date.now() - startTime,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[ingestion/standardFileProcessor] ❌ file processing failed', {
      fileId, error: msg,
    })

    await db.collectionItem.updateMany({
      where: { id: fileId },
      data: { ingestionStatus: IngestionStatus.FAILED },
    }).catch(() => { /* best-effort */ })

    throw error
  }
}
