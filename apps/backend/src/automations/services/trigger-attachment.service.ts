/**
 * Attachments on trigger payloads (`email.attachments`, `message.attachments`),
 * forwarded by messaging steps. Config carries only ids; rows are re-read scoped to
 * the automation's workspace, so a url or foreign id in config is never trusted.
 */
import { z } from 'zod';
import { AttachmentEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { config } from '@/config/env';
import { storageService } from '@/services/storage/index';
import { uploadFiles, type UploadedFileResult } from '@/services/fileUploadService';
import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';
import { logger } from '@/utils/logger';
import { variableRef } from '../engine/variable-ref';
import {
  AGENT_ATTACHMENT_MAX_FILES,
  AGENT_ATTACHMENT_MAX_TOTAL_BYTES,
} from './agent-attachment.service';

export const TriggerAttachmentSchema = z.object({
  id: z.string(),
  originalFilename: z.string(),
  mimetype: z.string(),
  size: z.number(),
  url: z.string(),
});

export type TriggerAttachment = z.infer<typeof TriggerAttachmentSchema>;

export const toTriggerAttachment = ({
  id,
  originalFilename,
  mimetype,
  size,
  url,
}: TriggerAttachment): TriggerAttachment => ({ id, originalFilename, mimetype, size, url });

export const fileAttachmentsField = variableRef(
  z
    .array(z.object({ id: z.string().min(1) }))
    .describe('Attachments to forward, e.g. the trigger email or message attachments.')
).optional();

export type AttachmentFile = OutgoingAttachment & { content: Buffer };

export async function loadAttachmentFiles(
  refs: Array<{ id: string }> | string | undefined,
  workspaceId: string
): Promise<AttachmentFile[]> {
  const ids = Array.isArray(refs) ? [...new Set(refs.map((ref) => ref.id))] : [];
  if (ids.length === 0) return [];

  const rows = await db.messageAttachment.findMany({
    where: {
      id: { in: ids },
      workspaceId,
      entityType: { in: [AttachmentEntityType.EMAIL, AttachmentEntityType.CHAT] },
      isDeleted: false,
    },
    orderBy: { createdAt: 'asc' },
  });

  const picked: typeof rows = [];
  let totalBytes = 0;
  for (const row of rows) {
    // Skip inline CID images (e.g. signature logos); only real attachments are forwarded.
    if ((row.metadata as { isInline?: boolean } | null)?.isInline === true) continue;
    if (
      picked.length >= AGENT_ATTACHMENT_MAX_FILES ||
      totalBytes + row.size > AGENT_ATTACHMENT_MAX_TOTAL_BYTES
    ) {
      logger.warn(
        `[trigger-attachments] skipping "${row.originalFilename}" — over the 10 file / 25MB limit`
      );
      continue;
    }
    totalBytes += row.size;
    picked.push(row);
  }

  return Promise.all(
    picked.map(async (row) => ({
      name: row.originalFilename,
      contentType: row.mimetype,
      content: await storageService.getFileBuffer(row.url),
    }))
  );
}

/** Records forwarded files on a sent email so Desk shows them under that message. */
export async function saveEmailAttachmentRows(params: {
  files: AttachmentFile[];
  emailId: string;
  conversationId: string;
  channelId: string;
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const uploaded = await uploadAttachmentFiles(params.files);
  if (uploaded.length === 0) return;
  await repositories.messageAttachments.createMany(
    uploaded.map((file) => ({
      entityId: params.emailId,
      entityType: AttachmentEntityType.EMAIL,
      originalFilename: file.originalName,
      size: file.fileSize,
      mimetype: file.mimeType,
      url: file.fileUrl,
      thumbnailUrl: file.thumbnailUrl,
      width: file.width,
      height: file.height,
      uploadedByUserId: params.userId,
      createdBy: params.userId,
      storageProvider: config.fileStorage.provider,
      conversationId: params.conversationId,
      channelId: params.channelId,
      workspaceId: params.workspaceId,
      metadata: file.metadata ?? {},
    }))
  );
}

/** Fresh storage objects per call, so the new message never shares the source's file. */
export async function uploadAttachmentFiles(
  files: AttachmentFile[]
): Promise<UploadedFileResult[]> {
  if (files.length === 0) return [];
  return uploadFiles(
    files.map(
      (file) =>
        ({
          originalname: file.name,
          mimetype: file.contentType,
          size: file.content.byteLength,
          buffer: file.content,
        }) as Express.Multer.File
    )
  );
}
