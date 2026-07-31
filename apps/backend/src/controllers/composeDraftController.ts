import { Request, Response } from 'express';
import { z } from 'zod';
import { AttachmentEntityType, Prisma } from '@prisma/client';
import { DraftMessageRepository } from '../database/repositories/draftMessageRepository';
import { DatabaseClient } from '../database/client';
import { uploadFiles, UploadedFileResult } from '../services/fileUploadService';
import { config } from '@/config/env';
import { logger } from '../utils/logger';

/** Placeholder channel-id prefix for compose-DM drafts that have no real channel yet. */
const COMPOSE_CHANNEL_PREFIX = 'composedm-';
const MAX_CONTENT_LENGTH = 50_000;
const MAX_RECIPIENTS = 9;

/**
 * Coerce a multipart form value (which arrives as a JSON string, a single string,
 * or an array) into a string[]. Used for `attachmentIds` and `recipientIds`.
 */
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

const upsertComposeDraftSchema = z.object({
  draftId: z.string().min(1).max(64),
  channelId: z
    .string()
    .max(64)
    .refine((value) => value.startsWith(COMPOSE_CHANNEL_PREFIX), {
      message: `channelId must start with "${COMPOSE_CHANNEL_PREFIX}"`,
    }),
  content: z.string().max(MAX_CONTENT_LENGTH),
  recipientIds: z.array(z.string().min(1)).max(MAX_RECIPIENTS),
});

export class ComposeDraftController {
  private draftMessageRepository = new DraftMessageRepository();
  private db = DatabaseClient.getInstance();

  /**
   * POST /api/drafts/compose
   *
   * Owner-scoped upsert of a compose-DM draft (placeholder `composedm-` channel).
   * Persists the draft body plus the sorted recipient user-id list so an unsent
   * compose DM survives reload and shows up in Drafts & Sent (Slack parity).
   *
   * Identity is taken exclusively from the authenticated session (`req.user`),
   * never from the request body, and all body fields are Zod-validated.
   */
  upsertComposeDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required to persist a draft' });
        return;
      }

      const parsed = upsertComposeDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
        return;
      }
      const { draftId, channelId, content, recipientIds } = parsed.data;

      // Store recipient ids sorted so the same recipient set always yields an
      // identical value regardless of the order the user selected them in.
      const sortedRecipientIds = [...recipientIds].sort();

      const { created } = await this.draftMessageRepository.upsertComposeDraft({
        draftId,
        channelId,
        userId,
        content,
        recipientIds: sortedRecipientIds,
        workspaceId,
      });

      res.status(200).json({ id: draftId, created });
    } catch (error) {
      logger.error('Failed to upsert compose draft', { error });
      res.status(500).json({ error: 'Failed to save compose draft' });
    }
  };

  /**
   * POST /api/drafts/compose/attachments
   *
   * Persist attachments for a compose-DM draft. Deliberately SEPARATE
   * from POST /api/drafts/attachments/upload: that endpoint is coupled to the Zero optimistic-insert+send 
   * flow.
   *
   * Identity comes from the session and attachments are owner-scoped to the caller's own draft.
   * MessageAttachment is polymorphic (entityType=DRAFT, entityId=<compose draft id>).
   */
  uploadComposeDraftAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const workspaceId = req.user?.workspaceId ?? null;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required to persist an attachment' });
        return;
      }

      const draftId = typeof req.body.draftId === 'string' ? req.body.draftId : '';
      const channelId = typeof req.body.channelId === 'string' ? req.body.channelId : '';
      if (!draftId || draftId.length > 64) {
        res.status(400).json({ error: 'draftId is required' });
        return;
      }
      if (!channelId.startsWith(COMPOSE_CHANNEL_PREFIX) || channelId.length > 64) {
        res.status(400).json({ error: `Invalid channelId` });
        return;
      }

      const reqFiles = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const files = reqFiles?.['files'] ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Files are required' });
        return;
      }

      const attachmentIds = parseStringArray(req.body.attachmentIds);
      if (attachmentIds.length !== files.length) {
        res.status(400).json({
          error: 'attachmentIds length must match files length',
          expected: files.length,
          received: attachmentIds.length,
        });
        return;
      }
      const recipientIds = parseStringArray(req.body.recipientIds);

      // Owner-scoped draft row. Create-if-missing because an attachment can be added
      // before the first content autosave fires. If the row exists but belongs to
      // someone else, refuse — never attach to another user's draft.
      const existingDraft = await this.db.draftMessage.findUnique({ where: { id: draftId } });
      if (existingDraft && existingDraft.userId !== userId) {
        res.status(403).json({ error: 'Draft does not belong to the requesting user' });
        return;
      }
      if (!existingDraft) {
        const now = new Date();
        try {
          await this.db.draftMessage.upsert({
            where: { id: draftId },
            update: {},
            create: {
              id: draftId,
              channelId,
              conversationId: null,
              userId,
              content: '',
              recipientIds: recipientIds.length > 0 ? [...recipientIds].sort().join(',') : null,
              hasAttachment: true,
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
          // Race: another request created the row first. Re-fetch and verify ownership
          // — a concurrent request with a different userId could have won the race, and
          // we must not attach to a row we don't own.
          const racedDraft = await this.db.draftMessage.findUnique({ where: { id: draftId } });
          if (!racedDraft || racedDraft.userId !== userId) {
            res.status(403).json({ error: 'Draft does not belong to the requesting user' });
            return;
          }
        }
      } else if (!existingDraft.hasAttachment) {
        await this.db.draftMessage.update({
          where: { id: draftId },
          data: { hasAttachment: true },
        });
      }

      const results: Array<{
        attachmentId: string;
        success: boolean;
        skipped?: boolean;
        error?: string;
      }> = [];

      // Forward frontend-generated thumbnails + metadata so video/document attachments
      // get a thumbnailUrl in the DB (without this, restored drafts lose their thumbnails).
      const thumbnailFiles = reqFiles?.['thumbnails'] ?? [];

      let fileMetadata: Array<{
        fileIndex: number;
        hasThumbnail: boolean;
        thumbnailIndex?: number;
        width?: number;
        height?: number;
        duration?: number;
      }> | undefined;
      
      const rawMetadata = req.body.fileMetadata;
      if (typeof rawMetadata === 'string') {
        try {
          const parsed = JSON.parse(rawMetadata);
          if (Array.isArray(parsed)) fileMetadata = parsed;
        } catch {
          // ignore — uploadFiles handles missing metadata gracefully
        }
      }

      const uploaded: UploadedFileResult[] = await uploadFiles(
        files,
        thumbnailFiles.length > 0 ? thumbnailFiles : undefined,
        fileMetadata,
      );

      for (let i = 0; i < attachmentIds.length; i++) {
        const id = attachmentIds[i];
        const file = files[i];
        const up = uploaded[i];
        try {
          const attachmentData = {
            url: up.fileUrl,
            size: file.size,
            originalFilename: up.originalName,
            width: up.width,
            height: up.height,
            thumbnailUrl: up.thumbnailUrl ?? undefined,
            storageProvider: config.fileStorage.provider,
            metadata: up.metadata || {},
          };

          try {
            await this.db.messageAttachment.upsert({
              where: { id },
              update: attachmentData,
              create: {
                id,
                entityId: draftId,
                entityType: AttachmentEntityType.DRAFT,
                mimetype: file.mimetype,
                uploadedByUserId: userId,
                createdBy: userId,
                workspaceId,
                ...attachmentData,
              },
            });
          } catch (upsertError) {
            // With relationMode="prisma", upsert is a non-atomic SELECT-then-write.
            // A concurrent insert of the same id can land between the SELECT and the
            // INSERT, so the create branch fails with P2002. The row already exists —
            // fall back to an update so the uploaded url is never lost.
            if (
              upsertError instanceof Prisma.PrismaClientKnownRequestError &&
              upsertError.code === 'P2002'
            ) {
              await this.db.messageAttachment.update({
                where: { id },
                data: attachmentData,
              });
            } else {
              throw upsertError;
            }
          }

          results.push({ attachmentId: id, success: true });
        } catch (error) {
          logger.error('Failed to persist compose draft attachment', { error, attachmentId: id });
          results.push({ attachmentId: id, success: false, error: 'persist_failed' });
        }
      }

      res.status(200).json({ draftId, results });
    } catch (error) {
      logger.error('Failed to upload compose draft attachments', { error });
      res.status(500).json({ error: 'Failed to upload compose draft attachments' });
    }
  };

  /**
   * DELETE /api/drafts/compose/attachments/:attachmentId
   *
   * Delete a single compose-DM draft attachment. Owner-scoped: only the
   * user who uploaded the attachment can delete it. The row must be a DRAFT attachment
   * (entityType=DRAFT) so this endpoint can never be used to delete CHAT/TICKET/etc.
   * attachments. Storage cleanup is best-effort — the DB row is deleted regardless.
   */
  deleteComposeDraftAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const attachmentId = req.params.attachmentId;
      if (!attachmentId || attachmentId.length > 64) {
        res.status(400).json({ error: 'Valid attachmentId is required' });
        return;
      }

      // Fetch the attachment first so we know which draft it belongs to (entityId =
      // draftId for DRAFT rows). Needed to clear hasAttachment on the draft row when
      // the last attachment is removed.
      const attachment = await this.db.messageAttachment.findFirst({
        where: {
          id: attachmentId,
          entityType: AttachmentEntityType.DRAFT,
          uploadedByUserId: userId,
        },
        select: { entityId: true },
      });
      if (!attachment) {
        // Not found or not owned — return 404 to avoid leaking existence.
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      const draftId = attachment.entityId;

      // Delete + recount + hasAttachment reconciliation must be atomic. Two concurrent
      // deletes of the last remaining attachments could otherwise each observe a stale
      // count and leave draft.hasAttachment inconsistent with the surviving rows. A
      // single interactive transaction serializes the delete, the remaining-count, and
      // the flag update for this draft.
      await this.db.$transaction(async tx => {
        await tx.messageAttachment.deleteMany({
          where: {
            id: attachmentId,
            entityType: AttachmentEntityType.DRAFT,
            uploadedByUserId: userId,
          },
        });

        // If no DRAFT attachments remain for this draft, clear hasAttachment so the
        // Drafts panel doesn't show an attachment icon for an empty draft.
        const remaining = await tx.messageAttachment.count({
          where: {
            entityId: draftId,
            entityType: AttachmentEntityType.DRAFT,
            uploadedByUserId: userId,
          },
        });
        if (remaining === 0) {
          await tx.draftMessage.updateMany({
            where: { id: draftId, userId },
            data: { hasAttachment: false },
          });
        }
      });

      res.status(200).json({ attachmentId, deleted: true });
    } catch (error) {
      logger.error('Failed to delete compose draft attachment', { error });
      res.status(500).json({ error: 'Failed to delete compose draft attachment' });
    }
  };

  /**
   * DELETE /api/drafts/compose/:draftId
   *
   * Delete a compose-DM draft row when the user has cleared all content. Owner-scoped.
   * Refuses to delete if the draft still has DRAFT attachments (hasAttachment=true) so
   * the user doesn't lose attachment rows by accidentally clearing text. In that case
   * the row is kept with empty content so the attachments remain reachable.
   */
  deleteComposeDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const draftId = req.params.draftId;
      if (!draftId) {
        res.status(400).json({ error: 'Valid draftId is required' });
        return;
      }

      // `force=true` is sent by an explicit user-initiated delete (DraftsPanel).
      // Without it, the autosave teardown path only clears content when the draft
      // still has attachments so they don't become orphaned.
      const force = req.query.force === 'true';

      const draft = await this.db.draftMessage.findUnique({ where: { id: draftId } });
      if (!draft) {
        // Already gone — idempotent.
        res.status(200).json({ id: draftId, deleted: true });
        return;
      }
      if (draft.userId !== userId) {
        res.status(403).json({ error: 'Draft does not belong to the requesting user' });
        return;
      }

      if (draft.hasAttachment && !force) {
        // Keep the row so DRAFT attachments remain reachable; just clear the content.
        await this.db.draftMessage.update({
          where: { id: draftId },
          data: { content: '' },
        });
        res.status(200).json({ id: draftId, deleted: false, contentCleared: true });
        return;
      }

      if (draft.hasAttachment) {
        await this.db.messageAttachment.deleteMany({
          where: {
            entityId: draftId,
            entityType: AttachmentEntityType.DRAFT,
            uploadedByUserId: userId,
          },
        });
      }

      await this.db.draftMessage.delete({ where: { id: draftId } });
      res.status(200).json({ id: draftId, deleted: true });
    } catch (error) {
      logger.error('Failed to delete compose draft', { error });
      res.status(500).json({ error: 'Failed to delete compose draft' });
    }
  };
}
