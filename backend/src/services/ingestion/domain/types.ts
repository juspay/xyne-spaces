import type { CollectionItem } from '@prisma/client'

export const MAX_KB_UPLOAD_FILE_SIZE_BYTES = 100 * 1024 * 1024

export type IngestionUploadActor = {
  id: string
  email: string
  workspaceId: string
}

export type IngestionUploadCollection = {
  id: string
  rootCollectionId: string
  name: string
}

export type UploadBatchInput = {
  actor: IngestionUploadActor
  collection: IngestionUploadCollection
  parentId: string | null
  files: File[]
}

export type UploadResult =
  | { success: true; itemId: string; name: string }
  | { success: false; name: string; error: string }

export type UploadBatchResult = {
  results: UploadResult[]
  summary: {
    total: number
    successful: number
    failed: number
  }
}

export type UploadedKbFile = CollectionItem
