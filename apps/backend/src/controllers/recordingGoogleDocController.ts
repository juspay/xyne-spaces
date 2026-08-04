import type { Request, Response } from 'express';
import { CallType } from '@prisma/client';
import { google } from 'googleapis';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { callShareService } from '@/services/callShareService';
import { decrypt, encrypt } from '@/services/encryptionService';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { readFromYSweet } from '@/utils/ysweetUtils';
import { logger } from '@/utils/logger';

const RECORDING_DOC_SOURCE_TYPE = 'google-recording-doc';

function recordingTitle(value: string | null): string {
  return (value?.trim() || 'Untitled Recording').slice(0, 240);
}

/** Google Docs receives plain text here, so turn Markdown into readable text first. */
function markdownToDocumentText(markdown: string): string {
  const text = markdown
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => {
      if (/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/.test(line)) return '';

      const heading = /^(\s*)#{1,6}\s+(.+)$/.exec(line);
      if (heading) return `${heading[1]}${heading[2]}`;

      const unorderedItem = /^(\s*)[*+-]\s+(.+)$/.exec(line);
      if (unorderedItem) return `${unorderedItem[1]}• ${unorderedItem[2]}`;

      const quote = /^(\s*)>\s?(.+)$/.exec(line);
      if (quote) return `${quote[1]}${quote[2]}`;

      return line;
    })
    .join('\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

async function getRecordingDocAccessToken(userId: string): Promise<string | null> {
  const source = await db.externalSource.findFirst({
    where: { ownerUserId: userId, sourceType: RECORDING_DOC_SOURCE_TYPE, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!source) return null;

  const credentials = JSON.parse(decrypt(source.credentials)) as {
    accessToken?: string;
    refreshToken?: string;
    email?: string;
  };
  if (!credentials.refreshToken) return null;
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
  const accessToken = (await client.getAccessToken()).token;
  if (!accessToken) return null;

  await db.externalSource.update({
    where: { id: source.id },
    data: { credentials: encrypt(JSON.stringify({ ...credentials, accessToken })) },
  });
  return accessToken;
}

async function readDetailedSummary(
  canvasId: string | null,
  workspaceId: string
): Promise<string | null> {
  if (!canvasId) return null;

  const canvas = await db.canvas.findFirst({
    where: { id: canvasId, workspaceId },
    select: { id: true, content: true },
  });
  if (!canvas) return null;

  const ySweetBlocks = await readFromYSweet(canvas.id);
  const storedBlocks = Array.isArray(canvas.content) ? canvas.content : [];
  const blocks = ySweetBlocks.length > 0 ? ySweetBlocks : storedBlocks;
  return blocks.length > 0 ? convertBlockNoteToMarkdown(blocks) : null;
}

export class RecordingGoogleDocController {
  context = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      const { callId } = req.params;
      if (!userId || !workspaceId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const call = await repositories.calls.findByExternalId(callId);
      if (
        !call ||
        call.callType !== CallType.HEADLESS ||
        (call.workspaceId !== null && call.workspaceId !== workspaceId)
      ) {
        res.status(404).json({ success: false, error: 'Recording not found' });
        return;
      }
      if (
        call.createdByUserId !== userId ||
        !(await callShareService.canView(call, userId, workspaceId))
      ) {
        res.status(403).json({ success: false, error: 'Only the recording owner can export it' });
        return;
      }

      const accessToken = await getRecordingDocAccessToken(userId);
      const canExport = !!accessToken;
      const metadata = call.metadata as Record<string, unknown> | null;
      const detailedSummaryCanvasId =
        typeof metadata?.detailedSummaryCanvasId === 'string'
          ? metadata.detailedSummaryCanvasId
          : null;
      const detailedSummary = await readDetailedSummary(detailedSummaryCanvasId, workspaceId).catch(
        () => null,
      );
      const summary = detailedSummary?.trim() || call.aiSummary?.trim();
      res.json({
        success: true,
        canExport,
        summary: summary ? markdownToDocumentText(summary) : null,
        unavailableReason: 'Connect Google Docs to create a document from this recording.',
      });
    } catch (error) {
      logger.error('[RecordingGoogleDoc] Failed to prepare export context', { error });
      res.status(500).json({ success: false, error: 'Failed to prepare Google Docs export' });
    }
  };

  export = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    const { callId } = req.params;

    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (
        !call ||
        call.callType !== CallType.HEADLESS ||
        (call.workspaceId !== null && call.workspaceId !== workspaceId)
      ) {
        res.status(404).json({ success: false, error: 'Recording not found' });
        return;
      }

      if (
        call.createdByUserId !== userId ||
        !(await callShareService.canView(call, userId, workspaceId))
      ) {
        res.status(403).json({ success: false, error: 'Only the recording owner can export it' });
        return;
      }

      const accessToken = await getRecordingDocAccessToken(userId);
      if (!accessToken) {
        res.status(409).json({
          success: false,
          error: 'Connect Google Docs before exporting a recording',
        });
        return;
      }

      const metadata = call.metadata as Record<string, unknown> | null;
      const detailedSummaryCanvasId =
        typeof metadata?.detailedSummaryCanvasId === 'string'
          ? metadata.detailedSummaryCanvasId
          : null;
      const detailedSummary = await readDetailedSummary(detailedSummaryCanvasId, workspaceId).catch(
        (error) => {
          logger.warn('[RecordingGoogleDoc] Could not read detailed summary canvas', {
            callId,
            error,
          });
          return null;
        }
      );
      const summary = detailedSummary?.trim() || call.aiSummary?.trim();
      if (!summary) {
        res
          .status(400)
          .json({ success: false, error: 'Generate a recording summary before exporting' });
        return;
      }

      const title = recordingTitle(call.title);
      const content = markdownToDocumentText(summary).slice(0, 900_000);
      const createResponse = await fetch('https://docs.googleapis.com/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
        signal: AbortSignal.timeout(20_000),
      });
      const created = (await createResponse.json()) as {
        documentId?: string;
        error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
      };
      if (!createResponse.ok || !created.documentId) {
        const googleError = created.error;
        const errorText = [
          googleError?.message,
          googleError?.status,
          ...(googleError?.errors?.map((error) => error.reason) ?? []),
        ]
          .filter(Boolean)
          .join(' ');
        const missingDocsScope =
          createResponse.status === 401 ||
          /insufficient authentication scopes|insufficientpermissions|insufficient permission/i.test(
            errorText,
          );
        const status = missingDocsScope ? 409 : 502;
        res.status(status).json({
          success: false,
          error:
            missingDocsScope
              ? 'Google Docs access is required. Reconnect Google Docs and grant access to create files.'
              : googleError?.message || 'Failed to create Google Doc',
        });
        return;
      }

      const updateResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(created.documentId)}:batchUpdate`,
        {
          method: 'POST',
          headers: {
          Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [{ insertText: { location: { index: 1 }, text: content } }],
          }),
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!updateResponse.ok) {
        const response = (await updateResponse.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        res
          .status(updateResponse.status === 401 || updateResponse.status === 403 ? 409 : 502)
          .json({
            success: false,
            error:
              response?.error?.message ||
              'Google Doc was created but its content could not be exported',
          });
        return;
      }

      res.json({
        success: true,
        documentId: created.documentId,
        documentUrl: `https://docs.google.com/document/d/${created.documentId}/edit`,
      });
    } catch (error) {
      logger.error('[RecordingGoogleDoc] Failed to export recording', { callId, userId, error });
      res.status(500).json({ success: false, error: 'Failed to export recording to Google Docs' });
    }
  };
}

export const recordingGoogleDocController = new RecordingGoogleDocController();
