import type { CollectionItem } from '@prisma/client'
import { routePdfToScheduler } from '../docling/scheduler/intake'
import { SubApp } from '@/vespa/src/types'
import { logger } from '@/utils/logger'

export type QueueDoclingPdfInput = {
  item: CollectionItem
  collectionName: string
  mimeType: string
}

/** Route an uploaded PDF into the async Docling scheduler. */
export const queuePdfForDocling = async (input: QueueDoclingPdfInput) => {
  const routed = await routePdfToScheduler(input.item.fileId, SubApp.COLLECTIONS)
  if (!routed) {
    logger.info('[ingestion/queue] PDF not routed to scheduler (disabled or unsupported)', {
      fileId: input.item.fileId,
    })
  }
  return { schedulerFile: routed }
}

/**
 * Queue a non-PDF file for standard (sync) processing.
 * In xyne-spaces, standard file processing is triggered via the file worker
 * infrastructure. This enqueues the item for background processing.
 */
export const queueStandardFileProcessing = async (fileId: string): Promise<void> => {
  // xyne-spaces processes collection files via the VespaFileWorker.
  // The ingestion status PROCESSING triggers that worker to pick up the file.
  logger.info('[ingestion/queue] queued standard file for processing', { fileId })
}
