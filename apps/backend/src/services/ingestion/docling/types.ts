/**
 * Shared types + status constants for the async OCR (Docling/LightOn) scheduler.
 * These status strings are the lanes a file/part moves through and MUST match
 * the raw-SQL comparisons in `scheduler/store.ts`.
 */

export const DOCLING_FILE_STATUS = {
  PendingSplit: 'pending_split',
  Splitting: 'splitting',
  QueuedForOcr: 'queued_for_ocr',
  OcrActive: 'ocr_active',
  ReadyToWrite: 'ready_to_write',
  Writing: 'writing',
  Completed: 'completed',
  Failed: 'failed',
} as const

export const DOCLING_PART_STATUS = {
  Queued: 'queued',
  Submitting: 'submitting',
  Submitted: 'submitted',
  Ready: 'ready',
  Written: 'written',
  Failed: 'failed',
} as const

export interface DoclingFile {
  fileId: string
  workspaceId: string | null
  collectionId: string
  sourcePath: string
  sourceStorageKey: string | null
  stageDir: string | null
  resultsDir: string | null
  basePriority: number
  priorityOverride: number | null
  status: string
  totalPages: number
  totalParts: number
  pageChunkSize: number
  readyPartsCount: number
  writeAttemptCount: number
  splitAttemptCount: number
  availableAt: Date
  leaseOwner: string | null
  leaseToken: string | null
  leaseUntil: Date | null
  ocrActivatedAt: Date | null
  completedAt: Date | null
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export interface DoclingPart {
  fileId: string
  partIndex: number
  docId: string
  currentJobId: string | null
  partPath: string
  resultPath: string | null
  startPage: number
  endPage: number
  pageCount: number
  partSizeBytes: number
  status: string
  attemptCount: number
  availableAt: Date
  submittedAt: Date | null
  readyAt: Date | null
  writtenAt: Date | null
  leaseOwner: string | null
  leaseUntil: Date | null
  submitPermitId: string | null
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export interface DoclingStagedPart {
  partIndex: number
  partDocId: string
  partPath: string
  startPage: number
  endPage: number
  partSizeBytes: number
}

export interface DoclingStagedParts {
  stageDir: string
  partsDir: string
  manifestPath: string
  totalPages: number
  partsTotal: number
  pageChunkSize: number
  parts: DoclingStagedPart[]
}

export interface SchedulerChunkMeta {
  chunk_index: number
  page_numbers: number[]
  block_labels: string[]
}

export interface ProcessingResult {
  chunks: string[]
  chunks_pos: number[]
  image_chunks: string[]
  image_chunks_pos: number[]
  toc_chunks: string[]
  chunks_map: SchedulerChunkMeta[]
  image_chunks_map: SchedulerChunkMeta[]
  processingMethod?: string
}

export interface QueueFileForSplitInput {
  fileId: string
  collectionId: string
  sourcePath: string
  sourceStorageKey?: string | null
  basePriority?: number
  priorityOverride?: number | null
  totalPages?: number
  totalParts?: number
  pageChunkSize?: number
}
