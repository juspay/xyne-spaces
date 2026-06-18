// Stable integration surface for the rest of xyne-spaces.
//
// Keep this file intentionally small. Other modules may import ingestion
// behavior from here, but must not reach into ingestion services,
// repositories, storage, processors, workers, Docling internals, or
// indexing modules directly.

export { IngestionUploadError } from './domain/errors'
export type {
  IngestionUploadActor,
  IngestionUploadCollection,
  UploadBatchInput,
  UploadBatchResult,
  UploadResult,
} from './domain/types'
export {
  enqueueKbMetadataSync,
  type KbMetadataSyncTarget,
} from './services/metadataSyncService'
export { uploadKbFiles } from './services/uploadService'
