import * as crypto from 'crypto'
import { extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { logger } from '@/utils/logger'
import {
  createUploadedFileItem,
  createUploadIdentifiers,
  assertValidUploadParent,
} from '../repositories/kbUploadRepository'
import { sanitizeFileName } from '../storage/paths'
import { removeUploadedBytes, writeUploadedBytes } from '../storage/uploadStorage'
import { admitUploadedKbFile } from './admissionService'
import {
  MAX_KB_UPLOAD_FILE_SIZE_BYTES,
  type UploadBatchInput,
  type UploadBatchResult,
  type UploadResult,
} from '../domain/types'

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const detectMime = async (fileName: string, buf: Buffer, browserType?: string): Promise<string> => {
  try {
    const sniffed = await fileTypeFromBuffer(buf)
    if (sniffed?.mime) return sniffed.mime
  } catch { /* ignore */ }
  const ext = extname(fileName).toLowerCase()
  if (EXT_MIME[ext]) return EXT_MIME[ext]!
  if (browserType && browserType !== 'application/octet-stream') return browserType
  return 'application/octet-stream'
}

const checksum = (buf: ArrayBuffer): string =>
  crypto.createHash('sha256').update(new Uint8Array(buf)).digest('hex')

export const uploadKbFiles = async (input: UploadBatchInput): Promise<UploadBatchResult> => {
  await assertValidUploadParent(input.collection.rootCollectionId, input.parentId)

  const results: UploadResult[] = []

  for (const file of input.files) {
    const originalName = sanitizeFileName(file.name)
    if (file.size > MAX_KB_UPLOAD_FILE_SIZE_BYTES) {
      results.push({
        success: false,
        name: originalName,
        error: `File too large (max ${String(MAX_KB_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024)} MB)`,
      })
      continue
    }

    let storagePath = ''
    try {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      checksum(arrayBuffer) // compute for future dedup
      const mime = await detectMime(originalName, buffer, file.type)
      const { storageKey, vespaDocId } = createUploadIdentifiers()

      storagePath = await writeUploadedBytes({
        workspaceId: input.actor.workspaceId,
        collectionId: input.collection.id,
        storageKey,
        fileName: originalName,
        buffer,
        mimeType: mime,
      })

      const item = await createUploadedFileItem({
        rootCollectionId: input.collection.rootCollectionId,
        collectionId: input.parentId || input.collection.id,
        name: originalName,
        vespaDocId,
        storagePath,
        storageKey,
        mimeType: mime,
        fileSize: file.size,
        uploadedById: input.actor.id,
        workspaceId: input.actor.workspaceId,
      })

      try {
        await admitUploadedKbFile({
          item,
          collectionName: input.collection.name,
          mimeType: mime,
        })
      } catch (err) {
        logger.error('[ingestion/upload] queue enqueue failed', { err, fileId: item.id })
      }

      results.push({ success: true, itemId: item.id, name: originalName })
      logger.info('[ingestion/upload] uploaded file', {
        fileId: item.id, clId: input.collection.id, ownerEmail: input.actor.email,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'upload failed'
      if (storagePath) {
        try { await removeUploadedBytes(storagePath) } catch { /* ignore */ }
      }
      logger.error('[ingestion/upload] upload failed', { err, name: originalName })
      results.push({ success: false, name: originalName, error: msg })
    }
  }

  return {
    results,
    summary: {
      total: input.files.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    },
  }
}
