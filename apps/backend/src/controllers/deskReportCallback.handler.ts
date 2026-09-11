import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { uploadFiles } from '@/services/fileUploadService';
import { AttachmentEntityType, AttachmentUploadStatus } from '@xyne/shared';

const ATTACHMENT_MARKER_PREFIX = '[ATTACHMENT:';
const ATTACHMENT_HEADER_END = ']\n';

function parseAttachmentMarker(
  text: string,
): { fileName: string; mimeType: string; data: string } | null {
  const start = text.indexOf(ATTACHMENT_MARKER_PREFIX);
  if (start === -1) return null;
  const headerStart = start + ATTACHMENT_MARKER_PREFIX.length;
  const headerEnd = text.indexOf(ATTACHMENT_HEADER_END, headerStart);
  if (headerEnd === -1) return null;

  const header = text.slice(headerStart, headerEnd);
  const sep = header.indexOf(':');
  if (sep === -1) return null;

  const fileName = header.slice(0, sep);
  const mimeType = header.slice(sep + 1);

  const dataStart = headerEnd + ATTACHMENT_HEADER_END.length;
  const dataEnd = text.indexOf('\n', dataStart);
  const data = (dataEnd === -1 ? text.slice(dataStart) : text.slice(dataStart, dataEnd)).trim();
  if (!fileName || !mimeType || !data) return null;

  return { fileName, mimeType, data };
}

interface RawAttachment {
  fileName?: string;
  filename?: string;
  mimeType?: string;
  mimetype?: string;
  data?: string;
}

function extractHtmlAttachment(
  payload: Record<string, unknown>,
): { fileName: string; mimeType: string; data: string } | null {
  // Prefer a structured attachments array if the callback carries one
  // (the shape the S2S `/run` terminal callback uses — see
  // agent-attachment.service.ts's `resultAttachments`).
  const arrays = [payload['attachments'], payload['resultAttachments']];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const raw of arr as RawAttachment[]) {
      const mimeType = raw.mimeType ?? raw.mimetype ?? '';
      if (!mimeType.includes('html')) continue;
      const fileName = raw.fileName ?? raw.filename ?? 'desk-report.html';
      if (raw.data) return { fileName, mimeType, data: raw.data };
    }
  }

  // Fall back to scanning the plain-text result for the inline marker —
  // this is the format the tool actually returns from its own `execute()`.
  const result = payload['result'];
  if (typeof result === 'string') {
    const parsed = parseAttachmentMarker(result);
    if (parsed) return parsed;
  }
  return null;
}

export async function handleDeskReportCallback(
  req: Request<{ channelId: string; attachmentId: string }>,
  res: Response,
): Promise<void> {
  const { channelId, attachmentId } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined;
  const status = typeof payload['status'] === 'string' ? payload['status'] : undefined;

  logger.info('[DeskReport] callback received', { channelId, attachmentId, sessionId, status });

  try {
    const channel = await db.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } });
    if (!channel?.workspaceId) {
      logger.error('[DeskReport] callback: channel not found — cannot scope write', { channelId, sessionId });
      throw new Error(`Desk report callback: channel ${channelId} not found or has no workspaceId`);
    }
    const workspaceId = channel.workspaceId;
    const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
      runAsServiceActor('desk-report-callback', workspaceId, fn);

    // Matched by the exact row id embedded in the callback URL at dispatch time
    const pending = await runScoped(() =>
      db.messageAttachment.findFirst({
        where: {
          id: attachmentId,
          entityType: AttachmentEntityType.DESK_REPORT,
          entityId: channelId,
          isDeleted: false,
          uploadStatus: AttachmentUploadStatus.PENDING,
        },
      }),
    );
    if (!pending) {
      logger.warn('[DeskReport] callback: no matching pending row — dropping', { channelId, attachmentId, sessionId });
      res.json({ success: true, persisted: false });
      return;
    }
    const metadata = (pending.metadata as Record<string, unknown> | null) ?? {};

    const errorMessage = typeof payload['error'] === 'string' ? payload['error'] : undefined;
    const attachment = status === 'error' || errorMessage ? null : extractHtmlAttachment(payload);

    if (!attachment) {
      logger.warn('[DeskReport] callback: no report produced — marking failed', {
        channelId,
        sessionId,
        status,
        error: errorMessage,
      });
      await runScoped(() =>
        db.messageAttachment.update({
          where: { id: pending.id },
          data: {
            uploadStatus: AttachmentUploadStatus.FAILED,
            metadata: { ...metadata, error: errorMessage ?? 'No report produced' },
          },
        }),
      );
      res.json({ success: true, persisted: false });
      return;
    }

    const buffer = Buffer.from(attachment.data, 'base64');
    const [uploaded] = await uploadFiles([
      {
        originalname: attachment.fileName,
        mimetype: attachment.mimeType || 'text/html',
        size: buffer.byteLength,
        buffer,
      } as Express.Multer.File,
    ]);
    if (!uploaded) throw new Error('Desk report upload produced no result');

    await runScoped(() =>
      db.messageAttachment.update({
        where: { id: pending.id },
        data: {
          originalFilename: uploaded.originalName,
          size: uploaded.fileSize,
          mimetype: uploaded.mimeType,
          url: uploaded.fileUrl,
          uploadStatus: AttachmentUploadStatus.COMPLETED,
          metadata: { ...metadata, generatedAt: new Date().toISOString() },
        },
      }),
    );

    logger.info('[DeskReport] callback: report persisted', { channelId, sessionId, url: uploaded.fileUrl });
    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.error('[DeskReport] callback failed', { channelId, sessionId, error: err });
    res.status(500).json({ success: false, error: 'failed to persist desk report' });
  }
}
