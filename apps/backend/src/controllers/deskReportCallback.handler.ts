/**
 * Terminal callback for a Claw agent run triggered by
 * deskReportGenerationService. Mirrors autodraftCallback.handler.ts's shape,
 * but decodes the `[ATTACHMENT:<name>:<mime>]\n<base64>` marker
 * `create-desk-report` emits instead of treating the result as plain text,
 * and persists into MessageAttachment (entityType=DESK_REPORT).
 */
import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { uploadFiles } from '@/services/fileUploadService';
import { AttachmentEntityType } from '@xyne/shared';

// Matches the same marker create-desk-report emits and custom-tools.ts parses
// on the claw side: `[ATTACHMENT:<fileName>:<mimeType>]\n<base64>`.
const ATTACHMENT_RE = /\[ATTACHMENT:([^:\]]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)/;

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
    const match = ATTACHMENT_RE.exec(result);
    if (match) {
      const [, fileName, mimeType, data] = match;
      if (fileName && mimeType && data) return { fileName, mimeType, data };
    }
  }
  return null;
}

export async function handleDeskReportCallback(
  req: Request<{ channelId: string }>,
  res: Response,
): Promise<void> {
  const { channelId } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined;
  const status = typeof payload['status'] === 'string' ? payload['status'] : undefined;

  logger.info('[DeskReport] callback received', { channelId, sessionId, status });

  try {
    const channel = await db.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } });
    if (!channel?.workspaceId) {
      logger.error('[DeskReport] callback: channel not found — cannot scope write', { channelId, sessionId });
      throw new Error(`Desk report callback: channel ${channelId} not found or has no workspaceId`);
    }
    const workspaceId = channel.workspaceId;
    const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
      runAsServiceActor('desk-report-callback', workspaceId, fn);

    // Only ever matches a row still 'pending' — a stale/duplicated webhook
    // delivery arriving after the row already settled must never be able to
    // flip an already-completed (or failed) report with a different run's result.
    const recent = await runScoped(() =>
      db.messageAttachment.findMany({
        where: { entityType: AttachmentEntityType.DESK_REPORT, entityId: channelId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    );
    const pending = recent.find((row) => {
      const rowMetadata = (row.metadata as Record<string, unknown> | null) ?? {};
      return rowMetadata['status'] === 'pending';
    });
    if (!pending) {
      logger.warn('[DeskReport] callback: no pending row found for channel — dropping', { channelId, sessionId });
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
          data: { metadata: { ...metadata, status: 'failed', error: errorMessage ?? 'No report produced' } },
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
          metadata: { ...metadata, status: 'completed', generatedAt: new Date().toISOString() },
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
