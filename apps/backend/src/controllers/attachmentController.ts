import { Request, Response } from 'express';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '../database/repositories/messageAttachmentRepository';
import { ConversationRepository } from '../database/repositories/conversationRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { storageService, getStorageService } from '../services/storage/index';
import { normalizeStoragePath } from '@xyne/storage';
import { logger } from '../utils/logger';
import { setSafeDownloadHeaders } from '../utils/safeAttachmentDownload';
import { MessageAttachment } from '@prisma/client';
import { AttachmentEntityType, ChannelVisibility } from '@xyne/shared';
import { canvasAuthService } from '../services/canvasAuthService';
import { uploadFiles } from '../services/fileUploadService';
import { config } from '../config/env';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { DatabaseClient } from '../database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { isSupportedMimeType } from '@/services/fileProcessor';

const db = DatabaseClient.getInstance();

export class AttachmentController {
  private messageAttachmentRepository: MessageAttachmentRepository;
  private conversationRepository: ConversationRepository;
  private channelParticipantRepository: ChannelParticipantRepository;

  constructor() {
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.conversationRepository = new ConversationRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
  }

  private async pushVespaJobForAttachments(
    attachments: Array<{ id: string; mimetype: string }>,
    userId: string,
    workspaceId?: string
  ): Promise<void> {
    if (attachments.length === 0) return;

    // Filter only supported MIME types (PDF, DOCX, TXT, MD, etc.)
    const supportedAttachments = attachments.filter(att => isSupportedMimeType(att.mimetype));

    for (const attachment of supportedAttachments) {
      const base: Parameters<typeof vespaQueue.addJob>[0] = {
        schema: fileSchema,
        jobType: "feed",
        docId: attachment.id,
        app: SubApp.CHAT_ATTACHMENT,
        ...(workspaceId ? { workspaceId } : {}),
      };

      const logEnqueueFailure = async (error: any) => {
        logger.error(`[AttachmentController] Error queuing Vespa job for attachment ${attachment.id}:`, error);
        // Log failed insertion to Postgres
        try {
          if (db.vespaInsertionLogs && workspaceId) {
            await db.vespaInsertionLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: attachment.id,
                entityType: fileSchema,
                workspaceId,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                createdAt: new Date(),
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      };

      // Job A — name-only feed (highest priority): makes the file searchable by
      // name in cmd+K within seconds, before the slow content parse finishes.
      // Gated by FILE_NAME_ONLY_FEED_ENABLED.
      if (config.fileNameOnlyFeed.enabled) {
        vespaQueue.addJob({ ...base, nameOnly: true }).catch(logEnqueueFailure);
      }
      // Job B — full-content feed: today's heavy parse + insert, enriches the
      // same docId with content.
      vespaQueue.addJob(base).catch(logEnqueueFailure);
    }
  }

  /**
   * Authorization for attachment reads (download / thumbnail).
   *
   * Layered and safe for every AttachmentEntityType:
   *  1. Tenant isolation — the attachment must belong to the caller's workspace.
   *  2. DRAFT / DELAYED_MESSAGE — only the creator may read it.
   *  3. Chat attachments (those carrying a conversationId) — the caller must be
   *     a participant of the owning channel. Mirrors streamAttachment.
   * Non-chat types without a conversation (TICKET, EMAIL, FORM_ENTITY_VALUE,
   * IMPACT, …) are bounded by the workspace check only, preserving existing
   * in-workspace access.
   */
  private async assertAttachmentAccess(
    attachment: MessageAttachment,
    userId: string,
    workspaceId?: string,
  ): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, string> }> {
    // 1) Workspace isolation — never serve another workspace's file.
    //    Require a workspace context; an absent one is rejected rather than
    //    allowed through.
    if (!workspaceId || attachment.workspaceId !== workspaceId) {
      logger.warn(
        `Cross-workspace attachment access blocked: user ${userId} (ws ${workspaceId ?? 'none'}) -> attachment ${attachment.id} (ws ${attachment.workspaceId})`,
      );
      return { ok: false, status: 404, body: { error: 'Attachment not found' } };
    }

    // 2) Draft / scheduled message attachments — creator only.
    if (
      attachment.entityType === AttachmentEntityType.DRAFT ||
      attachment.entityType === AttachmentEntityType.DELAYED_MESSAGE
    ) {
      if (attachment.createdBy !== userId) {
        logger.warn(
          `Unauthorized draft attachment access: user ${userId} -> ${attachment.id} (creator ${attachment.createdBy})`,
        );
        return {
          ok: false,
          status: 403,
          body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
        };
      }
      return { ok: true };
    }

    // 2.5) Canvas attachments carry a synthetic conversationId (`canvas_<id>`)
    //      and are not backed by a real conversation row. Authorize via canvas
    //      view access (mirrors CanvasController's edit-access check on upload)
    //      rather than channel participation.
    if (attachment.entityType === AttachmentEntityType.CANVAS) {
      try {
        await canvasAuthService.requireViewAccess(attachment.entityId, userId);
        return { ok: true };
      } catch (error) {
        logger.warn(
          `Unauthorized canvas attachment access: user ${userId} -> ${attachment.id} (canvas ${attachment.entityId}): ${error instanceof Error ? error.message : 'denied'}`,
        );
        return {
          ok: false,
          status: 403,
          body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
        };
      }
    }

    // 3) Conversation-backed (chat/DM/transcript) attachments — must participate.
    if (attachment.conversationId) {
      const conversation = await this.conversationRepository.findById(attachment.conversationId);
      if (!conversation) {
        logger.warn(
          `Attachment access denied: conversation ${attachment.conversationId} not found for attachment ${attachment.id} (user ${userId})`,
        );
        return { ok: false, status: 404, body: { error: 'Attachment not found' } };
      }

      const isParticipant = await this.channelParticipantRepository.isParticipant(
        conversation.channelId,
        userId,
      );
      if (!isParticipant) {
        logger.warn(
          `Unauthorized attachment access: user ${userId} -> ${attachment.id} in channel ${conversation.channelId}`,
        );
        return {
          ok: false,
          status: 403,
          body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
        };
      }
    }

    // 4) Impact / stage-form DOC attachments (conversationId is null) — resolve the
    //    owning ticket's channel and require the same access the ticket needs: a PUBLIC
    //    channel is readable by any workspace member, a PRIVATE channel only by its
    //    participants. Without this, any workspace member could download a private
    //    channel ticket's impact/form documents by guessing the attachment id.
    if (
      attachment.entityType === AttachmentEntityType.IMPACT ||
      attachment.entityType === AttachmentEntityType.FORM_ENTITY_VALUE
    ) {
      const ticketId = await this.resolveTicketIdForAttachmentEntity(
        attachment.entityType,
        attachment.entityId,
      );
      // Not ticket-scoped (e.g. a USER-scoped form value) — no channel to gate on;
      // keep the workspace-bounded behavior rather than over-block a legitimate read.
      if (ticketId) {
        const ticket = await db.ticket.findUnique({
          where: { id: ticketId },
          select: { channelId: true, workspaceId: true },
        });
        if (!ticket || ticket.workspaceId !== workspaceId) {
          return { ok: false, status: 404, body: { error: 'Attachment not found' } };
        }
        const channel = await db.channel.findUnique({
          where: { id: ticket.channelId },
          select: { visibility: true },
        });
        if (!channel) {
          return { ok: false, status: 404, body: { error: 'Attachment not found' } };
        }
        if (channel.visibility !== ChannelVisibility.PUBLIC) {
          const isParticipant = await this.channelParticipantRepository.isParticipant(
            ticket.channelId,
            userId,
          );
          if (!isParticipant) {
            logger.warn(
              `Unauthorized ${attachment.entityType} attachment access: user ${userId} -> ${attachment.id} (private channel ${ticket.channelId})`,
            );
            return {
              ok: false,
              status: 403,
              body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
            };
          }
        }
      }
    }

    return { ok: true };
  }

  /**
   * Resolve the ticket that owns an IMPACT or FORM_ENTITY_VALUE attachment so its
   * download can be gated by the ticket's channel access. Returns null when the
   * entity is not ticket-scoped (e.g. a non-TICKET form entity), in which case the
   * caller keeps the workspace-bounded default.
   */
  private async resolveTicketIdForAttachmentEntity(
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<string | null> {
    if (entityType === AttachmentEntityType.IMPACT) {
      const impact = await db.impact.findUnique({
        where: { id: entityId },
        select: { ticketId: true },
      });
      return impact?.ticketId ?? null;
    }
    // FORM_ENTITY_VALUE — only ticket-scoped values map to a channel.
    const formValue = await db.formEntityValues.findUnique({
      where: { id: entityId },
      select: { entityId: true, entityType: true },
    });
    if (formValue && formValue.entityType === 'TICKET') {
      return formValue.entityId;
    }
    return null;
  }

  /**
   * GET /api/attachments/:attachmentId/download
   * Stream file from GCS to client
   */
  downloadAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found'});
        return;
      }

      // Authorization: tenant + participant/creator checks
      const access = await this.assertAttachmentAccess(attachment, userId, req.user?.workspaceId);
      if (!access.ok) {
        res.status(access.status).json(access.body);
        return;
      }

      const filePath = normalizeStoragePath(attachment.url);
      if (!filePath) {
        res.status(404).json({ error: 'Attachment not yet uploaded' });
        return;
      }

      // Transcripts live in a separate bucket
      const meta = attachment.metadata as { type?: string };
      const service = meta?.type === 'transcript' || meta?.type === 'identified_transcript'
        ? getStorageService(config.gcs.transcriptionBucketName)
        : storageService;

      logger.info(`Streaming attachment ${attachmentId} from path: ${filePath}`);

      const buffer = await service.getFileBuffer(filePath);

      // Guard: a zero-byte / empty storage object must never be served as a valid
      // 200. Otherwise the client builds a 0-byte File, the image decoder fails,
      // and the viewer shows "Failed to load image" (XYNE-61758). Treat an empty
      // object as a missing/corrupt file so the client can show a clear error and
      // retry, instead of silently caching a broken preview.
      if (!buffer || buffer.length === 0) {
        logger.error(
          `Empty storage object for attachment ${attachmentId} at path: ${filePath} (0 bytes)`,
        );
        res.status(404).json({ error: 'Attachment file is empty or unavailable' });
        return;
      }

      // Set response headers (safe disposition/type to prevent stored XSS)
      res.setHeader('Content-Length', buffer.length);
      setSafeDownloadHeaders(res, {
        mimetype: attachment.mimetype,
        filename: attachment.originalFilename,
      });

      // Disable caching for transcripts (they can be updated), cache other files
      if (meta?.type === 'transcript' || meta?.type === 'identified_transcript') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'private, max-age=3600');
      }

      // Stream the file
      res.send(buffer);

    } catch (error) {
      logger.error('Error downloading attachment:', error);
      res.status(500).json({ error: 'Failed to download attachment' });
    }
  };

  /**
   * GET /api/attachments/:attachmentId/thumbnail
   * Download thumbnail for an attachment (if available)
   */
  downloadThumbnail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      // Authorization: tenant + participant/creator checks
      const access = await this.assertAttachmentAccess(attachment, userId, req.user?.workspaceId);
      if (!access.ok) {
        res.status(access.status).json(access.body);
        return;
      }

      // Check if thumbnail exists
      if (!attachment.thumbnailUrl) {
        res.status(404).json({ error: 'Thumbnail not available for this attachment' });
        return;
      }

      const thumbnailPath = normalizeStoragePath(attachment.thumbnailUrl);

      logger.info(`Streaming thumbnail ${attachmentId} from path: ${thumbnailPath}`);

      const fileExists = await storageService.fileExists(thumbnailPath);
      if (!fileExists) {
        logger.error(`Thumbnail file not found: ${thumbnailPath}`);
        res.status(404).json({ error: 'Thumbnail file not found in storage' });
        return;
      }

      const metadata = await storageService.getFileMetadata(thumbnailPath);
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="thumbnail.jpg"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const stream = await storageService.createReadStream(thumbnailPath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('Thumbnail stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream thumbnail' });
        }
      });
    } catch (error) {
      logger.error('Error downloading thumbnail:', error);
      res.status(500).json({ error: 'Failed to download thumbnail' });
    }
  };

  /**
   * GET /api/attachments/:attachmentId/stream
   * Stream video/audio files with range request support (HTTP 206 Partial Content)
   * This enables seeking in video players
   */
  streamAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user?.id;

      // Verify user is authenticated
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      // Authorization: tenant + participant/creator checks
      const access = await this.assertAttachmentAccess(attachment, userId, req.user?.workspaceId);
      if (!access.ok) {
        res.status(access.status).json(access.body);
        return;
      }

      const filePath = normalizeStoragePath(attachment.url);
      if (!filePath) {
        res.status(404).json({ error: 'Attachment not yet uploaded' });
        return;
      }

      // Route transcript/recording attachments to their dedicated bucket
      const meta = attachment.metadata as { type?: string };
      const service = meta?.type === 'transcript' || meta?.type === 'identified_transcript' || meta?.type === 'recording'
        ? getStorageService(config.gcs.transcriptionBucketName)
        : storageService;

      const fileExists = await service.fileExists(filePath);
      if (!fileExists) {
        logger.error(`File not found in storage: ${filePath}`);
        res.status(404).json({ error: 'File not found in storage' });
        return;
      }

      const metadata = await service.getFileMetadata(filePath);
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Parse Range header (e.g., "bytes=0-1023")
      const range = req.headers.range;

      if (!range) {
        // No range requested - send entire file
        logger.info(`Streaming entire file: ${filePath}`);

        setSafeDownloadHeaders(res, {
          mimetype: attachment.mimetype,
          filename: attachment.originalFilename,
        });
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        if (meta?.type === 'transcript' || meta?.type === 'identified_transcript') {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          res.setHeader('Cache-Control', 'private, max-age=3600');
        }

        const stream = await service.createReadStream(filePath);
        stream.pipe(res);

        stream.on('error', (error) => {
          logger.error('Stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          }
        });

        return;
      }

      // Parse range header
      const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB

      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);

      // Validate start value
      if (isNaN(start) || start < 0) {
        res.status(400).json({ error: 'Invalid Range header' });
        return;
      }

      // If client didn't specify an end, limit it to CHUNK_SIZE
      let end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

      // Validate end value if it was parsed
      if (parts[1] && isNaN(end)) {
        res.status(400).json({ error: 'Invalid Range header' });
        return;
      }

      if (end >= fileSize) {
        end = fileSize - 1;
      }

      const chunkSize = end - start + 1;

      logger.info(`Streaming range for ${filePath}: bytes ${start}-${end}/${fileSize}`);

      // Set headers for partial content
      res.status(206); // Partial Content
      setSafeDownloadHeaders(res, {
        mimetype: attachment.mimetype,
        filename: attachment.originalFilename,
      });
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      if (meta?.type === 'transcript' || meta?.type === 'identified_transcript') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'private, max-age=3600');
      }

      const stream = await service.createReadStream(filePath, { start, end });
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
    } catch (error) {
      logger.error('Error streaming attachment:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream attachment' });
      }
    }
  };

  /**
   * POST /api/attachments/upload
   * Upload multiple attachments for an entity. Allowed entityTypes are limited
   * to surfaces that have explicitly opted in (currently IMPACT and
   * FORM_ENTITY_VALUE for stage-form DOC fields). The response includes the
   * created attachment IDs so callers can wire them into subsequent mutations
   * (e.g. FormEntityValues.actualFieldValue).
   */
  uploadAttachments = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { entityId, entityType, fileMetadata: fileMetadataJson } = req.body;
      if (!entityId || !entityType) {
        res.status(400).json({ error: 'entityId and entityType are required' });
        return;
      }

      const allowedEntityTypes: AttachmentEntityType[] = [
        AttachmentEntityType.IMPACT,
        AttachmentEntityType.FORM_ENTITY_VALUE,
      ];
      if (!allowedEntityTypes.includes(entityType)) {
        res.status(400).json({
          error: `entityType '${entityType}' not supported by this endpoint`,
        });
        return;
      }

      // entityId is client-supplied. Confirm it references an entity in the caller's
      // workspace BEFORE writing attachments onto it and before the response returns any
      // pre-existing attachment ids/mimetypes for that entity.
      const callerWorkspaceId = req.user?.workspaceId;
      if (!callerWorkspaceId) {
        res.status(400).json({ error: 'Missing workspaceId' });
        return;
      }
      const entityWorkspaceId =
        entityType === AttachmentEntityType.IMPACT
          ? (await db.impact.findUnique({ where: { id: entityId }, select: { workspaceId: true } }))?.workspaceId
          : (await db.formEntityValues.findUnique({ where: { id: entityId }, select: { workspaceId: true } }))?.workspaceId;
      if (!entityWorkspaceId || entityWorkspaceId !== callerWorkspaceId) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }

      const reqFiles = req.files as { [fieldname: string]: Express.Multer.File[] };
      const files = reqFiles?.['files'];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'Files are required' });
        return;
      }

      let parsedFileMetadata: Array<{ fileIndex: number; hasThumbnail?: boolean; width?: number; height?: number }> = [];
      if (fileMetadataJson) {
        try {
          parsedFileMetadata = JSON.parse(fileMetadataJson);
        } catch (error) {
          logger.warn('Failed to parse fileMetadata:', error);
        }
      }

      const fileMetadataArray = parsedFileMetadata.map((metadata, index) => ({
        fileIndex: metadata.fileIndex ?? index,
        hasThumbnail: metadata.hasThumbnail ?? false,
        thumbnailIndex: metadata.hasThumbnail ? index : undefined,
        width: metadata.width,
        height: metadata.height,
      }));

      const uploadedFiles = await uploadFiles(files, undefined, fileMetadataArray);

      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        throw new Error('workspaceId required: no authenticated workspace');
      }
      const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map(file => ({
        entityId,
        entityType,
        originalFilename: file.originalName,
        size: file.fileSize,
        mimetype: file.mimeType,
        url: file.fileUrl,
        thumbnailUrl: file.thumbnailUrl ?? undefined,
        width: file.width,
        height: file.height,
        uploadedByUserId: userId,
        createdBy: userId,
        storageProvider: config.fileStorage.provider,
        conversationId: null,
        workspaceId,
        metadata: file.metadata || {},
      }));

      await this.messageAttachmentRepository.createMany(attachmentData);

      // Fetch the attachments we just created for this entity. Used to return
      // IDs to the caller and to enqueue Vespa indexing.
      const savedAttachments = await this.messageAttachmentRepository.findByEntityIdAndType(entityId, entityType);

      const responseAttachments =
        entityType === AttachmentEntityType.FORM_ENTITY_VALUE
          ? [...savedAttachments]
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, files.length)
          : savedAttachments;

      if (responseAttachments.length > 0) {
        const attachments = responseAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        this.pushVespaJobForAttachments(attachments, userId, req.user?.workspaceId).catch(error => {
          logger.error(`[AttachmentController] Error pushing Vespa job for attachments for entity ${entityId}:`, error);
        });
      }

      res.status(200).json({
        success: true,
        count: attachmentData.length,
        attachments: responseAttachments.map(a => ({
          id: a.id,
          originalFilename: a.originalFilename,
          mimetype: a.mimetype,
          size: a.size,
          url: a.url,
          thumbnailUrl: a.thumbnailUrl,
        })),
      });
    } catch (error) {
      logger.error('Error uploading attachments:', error);
      res.status(500).json({ error: 'Failed to upload attachments' });
    }
  };
}
