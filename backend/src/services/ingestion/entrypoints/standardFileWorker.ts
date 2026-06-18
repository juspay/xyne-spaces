import { logger } from '@/utils/logger'
import { processJob, type ProcessingJob } from '../processors/standardFileProcessor'

/** Initialize the standard file processing worker for KB files. */
export const initFileProcessingWorker = async (): Promise<void> => {
  logger.info('[ingestion/standardFileWorker] Initializing file processing worker...')
  // In xyne-spaces, file processing is driven by the VespaFileWorker
  // (src/workers/vespaFileWorker.ts) which calls processJob directly.
  // This function is the hook point for setting up the worker pipeline.
  logger.info('[ingestion/standardFileWorker] File processing worker initialized')
}

export { processJob, type ProcessingJob }
