import { randomUUID } from "node:crypto";
import { errMsg } from "../lib/errors.js";
import { gcsService } from "./storageService.js";
import { chatAttachmentRepository } from "../repositories/chatAttachmentRepository.js";
import { createLogger } from "../logger.js";

const log = createLogger("chat-attachment-service");

export interface FileMeta {
  hasThumbnail?: boolean;
  width?: number;
  height?: number;
}

export interface UploadedAttachment {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  originalFilename: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface Base64Attachment {
  fileName: string;
  mimeType: string;
  data: string;
}

export interface PersistedAttachmentRef {
  id: string;
  originalFilename: string;
  mimeType: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
}

function pathFor(uploaderUserId: string, filename: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `chat-attachments/${uploaderUserId}/${year}/${month}/${Date.now()}-${randomUUID()}-${sanitizeFilename(filename)}`;
}

export async function uploadChatAttachments(
  files: Express.Multer.File[],
  thumbnails: Express.Multer.File[] | undefined,
  fileMetadata: FileMeta[],
  uploaderUserId: string,
): Promise<UploadedAttachment[]> {
  const results: UploadedAttachment[] = [];
  let thumbCursor = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const meta = fileMetadata[i] ?? {};
    const destPath = pathFor(uploaderUserId, f.originalname);
    await gcsService.uploadFile(f.buffer, destPath, f.mimetype);

    let thumbnailUrl: string | null = null;
    if (meta.hasThumbnail && thumbnails && thumbnails[thumbCursor]) {
      const tf = thumbnails[thumbCursor]!;
      const thumbPath = `${destPath}_thumb.jpg`;
      await gcsService.uploadFile(tf.buffer, thumbPath, tf.mimetype || "image/jpeg");
      thumbnailUrl = thumbPath;
      thumbCursor++;
    }

    const row = await chatAttachmentRepository.create({
      uploaderUserId,
      url: destPath,
      thumbnailUrl,
      originalFilename: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      width: meta.width ?? null,
      height: meta.height ?? null,
    });

    results.push({
      id: row.id,
      url: row.url,
      thumbnailUrl: row.thumbnailUrl,
      mimeType: row.mimeType,
      originalFilename: row.originalFilename,
      size: row.size,
      width: row.width,
      height: row.height,
    });
  }

  return results;
}

/** Persist trusted internal-run callback attachments and bind them to a message. */
export async function persistBase64ChatAttachments(
  chatMessageId: string,
  uploaderUserId: string,
  attachments: Base64Attachment[] | undefined,
): Promise<PersistedAttachmentRef[]> {
  const results: PersistedAttachmentRef[] = [];
  for (const attachment of attachments ?? []) {
    try {
      const buffer = Buffer.from(attachment.data, "base64");
      const destPath = pathFor(uploaderUserId, attachment.fileName);
      await gcsService.uploadFile(buffer, destPath, attachment.mimeType);
      const row = await chatAttachmentRepository.create({
        chatMessageId,
        uploaderUserId,
        url: destPath,
        originalFilename: attachment.fileName,
        mimeType: attachment.mimeType,
        size: buffer.length,
      });
      results.push({ id: row.id, originalFilename: row.originalFilename, mimeType: row.mimeType });
    } catch (err) {
      log.warn(`[callback] failed to persist attachment ${attachment.fileName}: ${errMsg(err)}`);
    }
  }
  return results;
}
