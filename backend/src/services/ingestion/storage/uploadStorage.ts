import { getStorageService } from '@/services/storage/storageServiceFactory'
import { getUploadStoragePath } from './paths'

export type WriteUploadedBytesInput = {
  workspaceId: string
  collectionId: string
  storageKey: string
  fileName: string
  buffer: Buffer
  mimeType?: string
}

export const writeUploadedBytes = async (input: WriteUploadedBytesInput): Promise<string> => {
  const storagePath = getUploadStoragePath(
    input.workspaceId,
    input.collectionId,
    input.storageKey,
    input.fileName,
  )
  await getStorageService().uploadFileV2(input.buffer, {
    path: storagePath,
    contentType: input.mimeType || 'application/octet-stream',
  })
  return storagePath
}

export const removeUploadedBytes = async (storagePath: string): Promise<void> => {
  await getStorageService().deleteFile(storagePath)
}
