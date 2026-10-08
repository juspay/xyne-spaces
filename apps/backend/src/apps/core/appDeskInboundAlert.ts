import type { NextFunction, Request, Response } from 'express';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { postAlertToChannel } from '@/services/channelAlertService';
import { escapeHtml } from '@/utils/htmlEscape';
import { logger } from '@/utils/logger';

const TAG = '[AppDeskInboundAlert]';
const MAX_PAYLOAD_CHARS = 3000;

const truncate = (text: string): string =>
  text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… (truncated)` : text;

function failureReason(responseBody: unknown, internalError: unknown): string {
  const body = (responseBody ?? {}) as { error?: unknown; details?: unknown };
  const parts = [typeof body.error === 'string' ? body.error : 'Unknown error'];
  if (body.details) parts.push(JSON.stringify(body.details));
  // The 500 response hides the cause from the caller; the alert is internal, so include it.
  if (internalError) parts.push(internalError instanceof Error ? internalError.message : String(internalError));
  return parts.join(' — ');
}

async function postFailureAlert(
  req: Request,
  status: number,
  responseBody: unknown,
  internalError: unknown,
): Promise<void> {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) {
    logger.warn(`${TAG} Not posted: request has no workspace`, { status });
    return;
  }

  const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : undefined;
  const desk = channelId
    ? await db.channel.findFirst({ where: { id: channelId, workspaceId }, select: { name: true } })
    : null;
  const installedAppId = (req as { auth?: { installedAppId?: string } }).auth?.installedAppId;
  const code = (responseBody as { code?: unknown } | undefined)?.code;
  const files = Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat();

  const lines = [
    '🚨 <strong>App desk inbound API failed</strong>',
    '',
    `<strong>Status:</strong> ${status}${typeof code === 'string' ? ` ${escapeHtml(code)}` : ''}`,
    `<strong>Reason:</strong> ${escapeHtml(truncate(failureReason(responseBody, internalError)))}`,
  ];
  if (channelId) {
    lines.push(`<strong>Desk:</strong> ${escapeHtml(desk ? `${desk.name} (${channelId})` : channelId)}`);
  }
  if (installedAppId) lines.push(`<strong>App:</strong> ${escapeHtml(installedAppId)}`);
  if (files.length > 0) {
    lines.push(`<strong>Files:</strong> ${escapeHtml(files.map((file) => file.originalname).join(', '))}`);
  }
  lines.push(
    '',
    '<strong>Payload:</strong>',
    `<pre><code>${escapeHtml(truncate(JSON.stringify(req.body ?? {}, null, 2)))}</code></pre>`,
  );

  const posted = await postAlertToChannel({
    channelId: config.deskAlertChannelId,
    workspaceId,
    mentionUserIds: config.deskAlertMentionUserIds,
    content: lines.join('<br/>'),
  });
  if (!posted) {
    logger.warn(`${TAG} Not posted: no alert channel configured for this workspace`, {
      status,
      workspaceId,
      alertChannelId: config.deskAlertChannelId,
    });
  }
}

/**
 * Route middleware: posts to the alerts channel when the appDeskInbound request ends in an error
 * response, whichever later middleware or handler exit produced it. Set
 * `res.locals.appDeskInboundError` to add the cause of an unhandled error.
 */
export function alertOnAppDeskInboundFailure(req: Request, res: Response, next: NextFunction): void {
  let responseBody: unknown;
  const sendJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    responseBody = body;
    return sendJson(body);
  }) as Response['json'];

  res.on('finish', () => {
    if (res.statusCode < 400) return;
    // The ticket already exists, typically an app retrying a call that did succeed.
    if ((responseBody as { code?: unknown } | undefined)?.code === 'DUPLICATE') return;
    postFailureAlert(req, res.statusCode, responseBody, res.locals.appDeskInboundError).catch(
      (error) => logger.error(`${TAG} Failed to post inbound failure alert`, { error }),
    );
  });
  next();
}
