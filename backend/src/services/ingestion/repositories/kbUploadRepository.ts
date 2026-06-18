import { randomUUID } from 'node:crypto'
import { db } from '@/database/client'
import { IngestionStatus, AttachmentEntityType } from '@prisma/client'
import { IngestionUploadError } from '../domain/errors'

export type UploadIdentifiers = {
  storageKey: string
  vespaDocId: string
}

export const createUploadIdentifiers = (): UploadIdentifiers => {
  const storageKey = randomUUID()
  return { storageKey, vespaDocId: storageKey }
}

export const assertValidUploadParent = async (
  rootCollectionId: string,
  parentFolderId: string | null,
): Promise<void> => {
  if (!parentFolderId) return
  const parent = await db.collection.findFirst({
    where: { id: parentFolderId, rootCollectionId },
    select: { id: true },
  })
  if (!parent) {
    throw new IngestionUploadError('INVALID_PARENT', 'Parent folder not found', 400)
  }
}

export type CreateUploadedFileItemInput = {
  rootCollectionId: string
  collectionId: string
  name: string
  vespaDocId: string
  storagePath: string
  storageKey: string
  mimeType: string
  fileSize: number
  uploadedById: string
  workspaceId: string
}

export const createUploadedFileItem = async (input: CreateUploadedFileItemInput) => {
  const item = await db.collectionItem.create({
    data: {
      rootCollectionId: input.rootCollectionId,
      collectionId: input.collectionId,
      fileId: input.vespaDocId,
      ownerId: input.uploadedById,
      name: input.name,
      uploadedById: input.uploadedById,
      ingestionStatus: IngestionStatus.PROCESSING,
      versionNumber: 1,
      isLatest: true,
      createdAt: new Date(),
    },
  })

  await db.messageAttachment.create({
    data: {
      entityType: AttachmentEntityType.COLLECTION,
      entityId: item.id,
      workspaceId: input.workspaceId,
      storageProvider: 'GCS',
      originalFilename: input.name,
      mimetype: input.mimeType,
      size: input.fileSize,
      url: input.storagePath,
      uploadedByUserId: input.uploadedById,
      createdBy: input.uploadedById,
    },
  })

  return item
}
