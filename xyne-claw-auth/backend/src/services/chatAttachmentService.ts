import { randomUUID } from "node:crypto";
import { gcsService } from "./gcsService.js";
import { chatAttachmentRepository } from "../repositories/chatAttachmentRepository.js";

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
