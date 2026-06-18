import { logger } from '@/utils/logger'
import { queuePdfForDocling, queueStandardFileProcessing } from '../queue/producer'
import type { CollectionItem } from '@prisma/client'

export type AdmitUploadedKbFileInput = {
  item: CollectionItem
  collectionName: string
  mimeType: string
}

export const admitUploadedKbFile = async (input: AdmitUploadedKbFileInput): Promise<void> => {
  if (input.mimeType === 'application/pdf') {
    const result = await queuePdfForDocling({
      item: input.item,
      collectionName: input.collectionName,
      mimeType: input.mimeType,
    })
    logger.info('[ingestion/admission] queued PDF', {
      fileId: input.item.id,
      queuedThroughDoclingScheduler: Boolean(result?.schedulerFile),
    })
    return
  }

  await queueStandardFileProcessing(input.item.id)
}
