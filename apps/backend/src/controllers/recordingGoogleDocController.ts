import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { google } from 'googleapis';
import z from 'zod';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { callShareService } from '@/services/callShareService';
import { decrypt, encrypt } from '@/services/encryptionService';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { GoogleDocsApiError, googleDocsService } from '@/services/googleDocsService';
import { readFromYSweet } from '@/utils/ysweetUtils';
import {
  appendRecordingGoogleDocLink,
  readRecordingGoogleDocLinks,
  recordingGoogleDocUrl,
  type RecordingGoogleDocLink,
} from '@/utils/recordingGoogleDocs';
import { markdownToPlainText } from '@/utils/markdownToPlainText';
import { logger } from '@/utils/logger';

const RECORDING_DOC_SOURCE_TYPE = 'google-recording-doc';
const HEADLESS_CALL_TYPE = 'HEADLESS';
const RecordingGoogleDocParamsSchema = z.object({
  callId: z.string().trim().min(1, 'Recording ID is required'),
});

/** The export modal lets the owner rename the doc before it is created. */
const RecordingGoogleDocExportBodySchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
});

function recordingTitle(value: string | null): string {
  return (value?.trim() || 'Untitled Recording').slice(0, 240);
}

async function getRecordingDocAccessToken(userId: string): Promise<string | null> {
  const source = await repositories.externalSources.findActiveByOwnerAndSourceType(
    userId,
    RECORDING_DOC_SOURCE_TYPE,
  );
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

  await repositories.externalSources.update(source.id, {
    credentials: encrypt(JSON.stringify({ ...credentials, accessToken })),
  });
  return accessToken;
}

async function readDetailedSummary(
  canvasId: string | null,
  workspaceId: string,
  userId: string
): Promise<string | null> {
  if (!canvasId) return null;

  const canvas = await db.canvas.findFirst({
    where: { id: canvasId, workspaceId },
    select: { id: true, content: true },
  });
  if (!canvas) return null;

  const ySweetBlocks = await readFromYSweet(canvas.id, userId);
  const storedBlocks = Array.isArray(canvas.content) ? canvas.content : [];
  const blocks = ySweetBlocks.length > 0 ? ySweetBlocks : storedBlocks;
  return blocks.length > 0 ? convertBlockNoteToMarkdown(blocks) : null;
}

/**
 * Appends a created doc to `calls.metadata.googleDocs`.
 *
 * Metadata is re-read here rather than reused from the request-scoped call row:
 * summary generation and ticket linking write to the same JSON blob, and the
 * export can take several seconds, so a stale copy would silently drop their keys.
 */
async function recordCreatedGoogleDoc(
  callId: string,
  link: RecordingGoogleDocLink,
): Promise<void> {
  const current = await db.call.findUnique({ where: { id: callId }, select: { metadata: true } });
  const metadata =
    current?.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
      ? (current.metadata as Prisma.InputJsonObject)
      : {};

  await db.call.update({
    where: { id: callId },
    data: {
      metadata: {
        ...metadata,
        googleDocs: appendRecordingGoogleDocLink(
          readRecordingGoogleDocLinks(current?.metadata ?? null),
          link,
        ),
      } as Prisma.InputJsonValue,
    },
  });
}

export class RecordingGoogleDocController {
  context = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const parsedParams = RecordingGoogleDocParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({ success: false, error: 'Recording ID is required' });
        return;
      }
      const { callId } = parsedParams.data;

      const call = await repositories.calls.findByExternalId(callId);
      if (
        !call ||
        call.callType !== HEADLESS_CALL_TYPE ||
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
      const detailedSummary = await readDetailedSummary(detailedSummaryCanvasId, workspaceId, userId).catch(
        () => null,
      );
      const summary = detailedSummary?.trim() || call.aiSummary?.trim();
      res.json({
        success: true,
        canExport,
        summary: summary ? markdownToPlainText(summary) : null,
        // Docs already exported from this recording, newest first — the preview
        // modal lists them so a second export is a deliberate choice, not a
        // duplicate someone makes because the earlier doc is out of sight.
        documents: readRecordingGoogleDocLinks(call.metadata),
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

    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const parsedParams = RecordingGoogleDocParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ success: false, error: 'Recording ID is required' });
      return;
    }
    const { callId } = parsedParams.data;

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (
        !call ||
        call.callType !== HEADLESS_CALL_TYPE ||
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
      const detailedSummary = await readDetailedSummary(detailedSummaryCanvasId, workspaceId, userId).catch(
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

      const parsedBody = RecordingGoogleDocExportBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        res.status(400).json({ success: false, error: 'Document title is invalid' });
        return;
      }
      const title = recordingTitle(parsedBody.data.title ?? call.title);
      const content = markdownToPlainText(summary).slice(0, 900_000);
      let documentId: string;
      try {
        documentId = await googleDocsService.createDocument(accessToken, title);
      } catch (error) {
        if (!(error instanceof GoogleDocsApiError)) throw error;
        const errorText = [error.message, ...error.reasons].join(' ');
        const missingDocsScope =
          error.status === 401 ||
          /insufficient authentication scopes|insufficientpermissions|insufficient permission/i.test(
            errorText,
          );
        res.status(missingDocsScope ? 409 : 502).json({
          success: false,
          error:
            missingDocsScope
              ? 'Google Docs access is required. Reconnect Google Docs and grant access to create files.'
              : error.message,
        });
        return;
      }

      try {
        await googleDocsService.insertText(accessToken, documentId, content);
      } catch (error) {
        if (!(error instanceof GoogleDocsApiError)) throw error;
        res.status(error.status === 401 || error.status === 403 ? 409 : 502).json({
          success: false,
          error: error.message || 'Google Doc was created but its content could not be exported',
        });
        return;
      }

      const document: RecordingGoogleDocLink = {
        documentId,
        title,
        url: recordingGoogleDocUrl(documentId),
        createdAt: new Date().toISOString(),
        createdByUserId: userId,
      };
      // Best effort: the doc exists either way, so a metadata write failure must not
      // fail the export — it only costs this doc its place in the recording's list.
      await recordCreatedGoogleDoc(call.id, document).catch((error) => {
        logger.error('[RecordingGoogleDoc] Failed to record created document on the call', {
          callId,
          documentId,
          error,
        });
      });

      res.json({
        success: true,
        documentId,
        documentUrl: document.url,
        document,
      });
    } catch (error) {
      logger.error('[RecordingGoogleDoc] Failed to export recording', { callId, userId, error });
      res.status(500).json({ success: false, error: 'Failed to export recording to Google Docs' });
    }
  };
}

export const recordingGoogleDocController = new RecordingGoogleDocController();
