import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { gmail_v1 } from 'googleapis';
import { gcsService } from '@/services/gcsService';
import { fileValidationService } from '@/services/fileValidationService';
import { logger } from '@/utils/logger';
import type { DownloadedAttachment } from '@/services/externalAttachmentService';

interface GmailAttachmentPart {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

const decodeBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
};

const collectAttachmentParts = (
  payload?: gmail_v1.Schema$MessagePart
): GmailAttachmentPart[] => {
  if (!payload) {
    return [];
  }

  const collected: GmailAttachmentPart[] = [];

  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) {
      return;
    }

    if (part.filename && part.body?.attachmentId) {
      collected.push({
        attachmentId: part.body.attachmentId,
        fileName: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      });
    }

    for (const child of part.parts || []) {
      walk(child);
    }
  };

  walk(payload);
  return collected;
};

const buildStoredFilename = (originalName: string, mimeType: string): string => {
  const extension = path.extname(originalName);
  const baseName = extension ? path.basename(originalName, extension) : originalName;
  const safeBaseName = baseName || 'attachment';
  const safeExtension = extension || getExtensionFromMimeType(mimeType);
  return `${safeBaseName}-${uuidv4().slice(0, 8)}${safeExtension}`;
};

const getExtensionFromMimeType = (mimeType: string): string => {
  const mapping: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/html': '.html',
    'text/csv': '.csv',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
  };

  return mapping[mimeType] || '';
};

export const downloadGmailAttachments = async (
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
  mailboxEmail: string
): Promise<DownloadedAttachment[]> => {
  const messageId = message.id;
  const threadId = message.threadId;

  if (!messageId) {
    return [];
  }

  const attachmentParts = collectAttachmentParts(message.payload);
  const downloaded: DownloadedAttachment[] = [];

  for (const attachment of attachmentParts) {
    try {
      const response = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachment.attachmentId,
      });

      if (!response.data.data) {
        continue;
      }

      const buffer = decodeBase64Url(response.data.data);
      if (buffer.length === 0) {
        continue;
      }

      const validation = await fileValidationService.validateFile({
        buffer,
        originalName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: buffer.length,
      });

      if (!validation.isValid) {
        logger.warn('[GOOGLE_MAIL] Skipping invalid Gmail attachment', {
          messageId,
          threadId,
          fileName: attachment.fileName,
          errors: validation.errors,
        });
        continue;
      }

      const upload = await gcsService.uploadFile(buffer, {
        filename: validation.sanitizedFilename || buildStoredFilename(attachment.fileName, attachment.mimeType),
        contentType: attachment.mimeType,
        metadata: {
          originalName: attachment.fileName,
          gmailMessageId: messageId,
          gmailThreadId: threadId || '',
          gmailAttachmentId: attachment.attachmentId,
          mailboxEmail,
        },
        scopeType: 'EXTERNAL_MESSAGE',
        scopeId: threadId || messageId,
      });

      downloaded.push({
        originalName: attachment.fileName,
        fileName: upload.filename,
        fileSize: upload.size,
        mimeType: attachment.mimeType,
        fileUrl: upload.gcsPath,
        metadata: {
          gmailMessageId: messageId,
          gmailThreadId: threadId,
          gmailAttachmentId: attachment.attachmentId,
          mailboxEmail,
          source: 'google_mail',
        },
      });
    } catch (error) {
      logger.error('[GOOGLE_MAIL] Failed to download Gmail attachment', {
        messageId,
        threadId,
        fileName: attachment.fileName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return downloaded;
};
