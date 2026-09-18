import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
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
import {
  isAllowedSdlcUpload,
  SDLC_CONTAINMENT_RELATION,
  SDLC_TRACK_FLAT_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
} from '@xyne/shared/sdlc';
import { canvasAuthService } from '../services/canvasAuthService';
import { uploadFiles } from '../services/fileUploadService';
import { config } from '../config/env';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { DatabaseClient } from '../database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { isSupportedMimeType } from '@/services/fileProcessor';
import { repositories } from '@/database/repositories';
import { callShareService } from '@/services/callShareService';
import { cacheManager } from '../utils/cacheManager';

const db = DatabaseClient.getInstance();

const TRANSCRIPTION_BUCKET_TYPES = new Set(['transcript', 'identified_transcript', 'recording']);
const NO_CACHE_TYPES = new Set(['transcript', 'identified_transcript']);

const getAttachmentType = (attachment: MessageAttachment): string =>
  (attachment.metadata as { type?: string } | null)?.type ?? '';

/** Transcripts and call recordings live in the transcription bucket. */
const getAttachmentStorage = (attachment: MessageAttachment): typeof storageService =>
  TRANSCRIPTION_BUCKET_TYPES.has(getAttachmentType(attachment))
    ? getStorageService(config.gcs.transcriptionBucketName)
    : storageService;

/** Transcripts can be rewritten, so they are never cached; other files are. */
const setAttachmentCacheHeaders = (res: Response, attachment: MessageAttachment): void => {
  if (NO_CACHE_TYPES.has(getAttachmentType(attachment))) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', 'private, max-age=3600');
  }
};

/**
 * Bytes served for an open-ended range (`bytes=N-`). The player aborts the
 * response as soon as it has buffered enough, so this bounds how much work one
 * connection may do rather than how much is read up front. At the previous 1MB
 * a 4K stream (25-45 Mbps) needed several requests per second of video, and
 * every one of them paid the full resolve cost below before a byte moved.
 */
const RANGE_CHUNK_SIZE = 16 * 1024 * 1024;

/**
 * How long a resolved stream target stays reusable. Access revoked during this
 * window keeps working until the entry expires, which is the price of not
 * re-authorizing every chunk of an in-flight playback.
 */
const STREAM_TARGET_TTL_SECONDS = 30;

interface ResolvedStreamTarget {
  attachment: MessageAttachment;
  filePath: string;
  fileSize: number;
}

type StreamTargetResult =
  | { ok: true; target: ResolvedStreamTarget }
  | { ok: false; status: number; body: Record<string, string> };

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
   *  4. RECORDING — the caller must be able to view the call's recordings.
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

    // 2.55) SDLC hub files have no conversation to authorize through: they are
    //       filed into a folder, and their entityId is the hub itself. Seeing the
    //       hub is what earns seeing the file, on the same terms as a private
    //       channel's ticket documents above.
    if (attachment.entityType === AttachmentEntityType.SDLC_HUB) {
      const channel = await db.channel.findUnique({
        where: { id: attachment.entityId },
        select: { visibility: true, workspaceId: true },
      });
      if (!channel || channel.workspaceId !== workspaceId) {
        return { ok: false, status: 404, body: { error: 'Attachment not found' } };
      }
      if (channel.visibility !== ChannelVisibility.PUBLIC) {
        const isParticipant = await this.channelParticipantRepository.isParticipant(
          attachment.entityId,
          userId,
        );
        if (!isParticipant) {
          logger.warn(
            `Unauthorized SDLC hub attachment access: user ${userId} -> ${attachment.id} (hub ${attachment.entityId})`,
          );
          return {
            ok: false,
            status: 403,
            body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
          };
        }
      }
      return { ok: true };
    }

    // 2.6) Note-taker recordings — same rule as the recording download endpoints.
    if (attachment.entityType === AttachmentEntityType.RECORDING) {
      const recording = await repositories.callRecordings.findById(attachment.entityId);
      const call = recording ? await repositories.calls.findById(recording.callId) : null;
      if (!call || call.workspaceId !== workspaceId) {
        return { ok: false, status: 404, body: { error: 'Attachment not found' } };
      }
      if (!(await callShareService.canViewRecordings(call, userId))) {
        logger.warn(
          `Unauthorized recording attachment access: user ${userId} -> ${attachment.id} (call ${call.id})`,
        );
        return {
          ok: false,
          status: 403,
          body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
        };
      }
      return { ok: true };
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

      const service = getAttachmentStorage(attachment);

      logger.info(`Streaming attachment ${attachmentId} from path: ${filePath}`);

      const buffer = await service.getFileBuffer(filePath);

      // Set response headers (safe disposition/type to prevent stored XSS)
      res.setHeader('Content-Length', buffer.length);
      setSafeDownloadHeaders(res, {
        mimetype: attachment.mimetype,
        filename: attachment.originalFilename,
      });

      setAttachmentCacheHeaders(res, attachment);

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
   * Look up, authorize and size an attachment for streaming.
   *
   * Playback is a stream of range requests — one every few seconds, and more
   * while the player fills its buffer. Doing the attachment lookup, the
   * workspace/participant authorization queries and two storage HEAD calls on
   * every one of them put database and storage latency in front of each chunk,
   * which starved the player and surfaced as mid-playback stalls on
   * high-bitrate files. The result is therefore memoised per (user, attachment)
   * for STREAM_TARGET_TTL_SECONDS. Only successful resolutions are cached, so a
   * denial is always recomputed.
   */
  private async resolveStreamTarget(
    attachmentId: string,
    userId: string,
    workspaceId: string | undefined,
  ): Promise<StreamTargetResult> {
    const cacheKey = `attachment-stream:${userId}:${workspaceId ?? 'none'}:${attachmentId}`;
    const cached = cacheManager.get<ResolvedStreamTarget>(cacheKey);
    if (cached) {
      return { ok: true, target: cached };
    }

    const attachment = await this.messageAttachmentRepository.findById(attachmentId);
    if (!attachment) {
      return { ok: false, status: 404, body: { error: 'Attachment not found' } };
    }

    // Authorization: tenant + participant/creator checks
    const access = await this.assertAttachmentAccess(attachment, userId, workspaceId);
    if (!access.ok) {
      return access;
    }

    const filePath = normalizeStoragePath(attachment.url);
    if (!filePath) {
      return { ok: false, status: 404, body: { error: 'Attachment not yet uploaded' } };
    }

    // getFileMetadata already fails on a missing object, so the fileExists()
    // HEAD that used to precede it was a second round trip for the same answer.
    let fileSize: number;
    try {
      const metadata = await getAttachmentStorage(attachment).getFileMetadata(filePath);
      fileSize = parseInt(String(metadata.size || '0'), 10);
    } catch (error) {
      logger.error(`File not found in storage: ${filePath}`, error);
      return { ok: false, status: 404, body: { error: 'File not found in storage' } };
    }

    logger.info(`Resolved attachment stream ${attachmentId} -> ${filePath} (${fileSize} bytes)`);

    const target: ResolvedStreamTarget = { attachment, filePath, fileSize };
    // Transcripts are rewritten in place, so a remembered size would go stale.
    if (!NO_CACHE_TYPES.has(getAttachmentType(attachment))) {
      cacheManager.set(cacheKey, target, STREAM_TARGET_TTL_SECONDS);
    }
    return { ok: true, target };
  }

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

      const resolved = await this.resolveStreamTarget(attachmentId, userId, req.user?.workspaceId);
      if (!resolved.ok) {
        res.status(resolved.status).json(resolved.body);
        return;
      }

      const { attachment, filePath, fileSize } = resolved.target;
      const service = getAttachmentStorage(attachment);

      const pipeToResponse = async (options?: { start: number; end: number }): Promise<void> => {
        const stream = await service.createReadStream(filePath, options);

        // Seeking (or a player that has buffered enough) aborts the response
        // mid-flight. Without this the storage stream stays open and keeps
        // pulling bytes nobody will read — a scrub through a long video leaks
        // one such stream per seek.
        res.on('close', () => {
          (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
        });

        stream.on('error', (error) => {
          logger.error('Stream error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error' });
          } else {
            res.destroy();
          }
        });

        stream.pipe(res);
      };

      // Parse Range header (e.g., "bytes=0-1023")
      const range = req.headers.range;

      if (!range) {
        // No range requested - send entire file
        setSafeDownloadHeaders(res, {
          mimetype: attachment.mimetype,
          filename: attachment.originalFilename,
        });
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        setAttachmentCacheHeaders(res, attachment);

        await pipeToResponse();
        return;
      }

      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);

      // Validate start value
      if (isNaN(start) || start < 0) {
        res.status(400).json({ error: 'Invalid Range header' });
        return;
      }

      // A start at or past the end of the file is unsatisfiable. Answering 206
      // with a negative Content-Length instead leaves the player waiting for
      // bytes that never arrive.
      if (fileSize <= 0 || start >= fileSize) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        res.status(416).json({ error: 'Requested range not satisfiable' });
        return;
      }

      // An open-ended range is answered with at most RANGE_CHUNK_SIZE bytes.
      let end = parts[1]
        ? parseInt(parts[1], 10)
        : Math.min(start + RANGE_CHUNK_SIZE - 1, fileSize - 1);

      // Validate end value if it was parsed
      if (parts[1] && (isNaN(end) || end < start)) {
        res.status(400).json({ error: 'Invalid Range header' });
        return;
      }

      if (end >= fileSize) {
        end = fileSize - 1;
      }

      const chunkSize = end - start + 1;

      // Set headers for partial content
      res.status(206); // Partial Content
      setSafeDownloadHeaders(res, {
        mimetype: attachment.mimetype,
        filename: attachment.originalFilename,
      });
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      setAttachmentCacheHeaders(res, attachment);

      await pipeToResponse({ start, end });
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

      const {
        entityId,
        entityType,
        fileMetadata: fileMetadataJson,
        sdlcParentType,
        sdlcParentId,
        sdlcTrackId,
      } = req.body;
      if (!entityId || !entityType) {
        res.status(400).json({ error: 'entityId and entityType are required' });
        return;
      }

      const allowedEntityTypes: AttachmentEntityType[] = [
        AttachmentEntityType.IMPACT,
        AttachmentEntityType.FORM_ENTITY_VALUE,
        AttachmentEntityType.SDLC_HUB,
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
      // An SDLC hub file is owned by the hub itself, so the entity to verify is the
      // channel — and membership of it, not just the workspace, is what earns the
      // right to put a file in its tree.
      if (entityType === AttachmentEntityType.SDLC_HUB) {
        const channel = await db.channel.findUnique({
          where: { id: entityId },
          select: { workspaceId: true, visibility: true },
        });
        if (!channel || channel.workspaceId !== callerWorkspaceId) {
          res.status(404).json({ error: 'Entity not found' });
          return;
        }
        if (channel.visibility !== ChannelVisibility.PUBLIC) {
          const isParticipant = await this.channelParticipantRepository.isParticipant(
            entityId,
            userId,
          );
          if (!isParticipant) {
            res.status(403).json({ error: 'Forbidden', message: 'You are not a member of this hub' });
            return;
          }
        }
      }

      // Where the file is filed in the hub's tree. Validated here and written
      // below in the same request: a Zero mutator would have to read the
      // attachment row this request is about to create, and the sync replica has
      // not caught up yet, so that edge write failed every time.
      let placement: { parentType: 'TRACK' | 'FOLDER'; parentId: string; trackId: string } | null =
        null;
      if (entityType === AttachmentEntityType.SDLC_HUB && sdlcParentId && sdlcTrackId) {
        const parentType = sdlcParentType === 'FOLDER' ? 'FOLDER' : 'TRACK';
        const trackEdge = await db.sdlcEntityLink.findFirst({
          where: {
            channelId: entityId,
            targetType: 'TRACK',
            targetId: sdlcTrackId,
            relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
          },
          select: { id: true },
        });
        if (!trackEdge) {
          res.status(404).json({ error: 'Track not found in this hub' });
          return;
        }
        if (parentType === 'FOLDER') {
          const parentTrack = await db.sdlcEntityLink.findFirst({
            where: {
              channelId: entityId,
              sourceType: 'TRACK',
              targetType: 'FOLDER',
              targetId: sdlcParentId,
              relationType: SDLC_TRACK_FLAT_RELATION,
            },
            select: { sourceId: true },
          });
          if (!parentTrack || parentTrack.sourceId !== sdlcTrackId) {
            res.status(400).json({ error: 'Parent folder belongs to another track' });
            return;
          }
        } else if (sdlcParentId !== sdlcTrackId) {
          res.status(400).json({ error: 'A track can only file into itself' });
          return;
        }
        placement = { parentType, parentId: sdlcParentId, trackId: sdlcTrackId };
      }

      const entityWorkspaceId =
        entityType === AttachmentEntityType.SDLC_HUB
          ? callerWorkspaceId
          : entityType === AttachmentEntityType.IMPACT
            ? (await db.impact.findUnique({ where: { id: entityId }, select: { workspaceId: true } }))?.workspaceId
            : (await db.formEntityValues.findUnique({ where: { id: entityId }, select: { workspaceId: true } }))?.workspaceId;
      if (!entityWorkspaceId) {
        // FORM_ENTITY_VALUE ids are minted client-side before the row exists; upload runs first,
        // then createV2 creates/verifies the row, so a missing row is legitimate and must not 404.
        if (entityType !== AttachmentEntityType.FORM_ENTITY_VALUE) {
          res.status(404).json({ error: 'Entity not found' });
          return;
        }
      } else if (entityWorkspaceId !== callerWorkspaceId) {
        // Existing row in another workspace: block cross-tenant attachment writes/leaks.
        res.status(404).json({ error: 'Entity not found' });
        return;
      }

      const reqFiles = req.files as { [fieldname: string]: Express.Multer.File[] };
      const files = reqFiles?.['files'];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'Files are required' });
        return;
      }

      // The picker's accept list is a convenience; this is the rule. A hub file
      // is something a reader opens in place, so archives and executables are
      // refused however they arrive.
      if (entityType === AttachmentEntityType.SDLC_HUB) {
        const refused = files
          .filter(file => !isAllowedSdlcUpload(file.originalname, file.mimetype))
          .map(file => file.originalname);
        if (refused.length > 0) {
          res.status(400).json({
            error: 'Unsupported file type',
            message: `These files cannot be added to a hub: ${refused.join(', ')}`,
            files: refused,
          });
          return;
        }
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
        id: randomUUID(),
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

      // Read back exactly the rows this request wrote. Their ids were generated
      // above for that reason: entityId is the hub channel for SDLC_HUB, so
      // asking for the entity's attachments would hand us every file in the hub,
      // and taking the newest few of those would pick up a concurrent upload by
      // another member — filing their file into this caller's folder.
      const createdIds = attachmentData.map(attachment => attachment.id as string);
      const savedAttachments =
        entityType === AttachmentEntityType.FORM_ENTITY_VALUE ||
        entityType === AttachmentEntityType.SDLC_HUB
          ? await this.messageAttachmentRepository.findByIds(createdIds)
          : await this.messageAttachmentRepository.findByEntityIdAndType(entityId, entityType);

      const responseAttachments = savedAttachments;

      if (placement && responseAttachments.length > 0) {
        await db.sdlcEntityLink.createMany({
          data: responseAttachments.flatMap(attachment => [
            {
              workspaceId,
              channelId: entityId,
              sourceType: placement.parentType,
              sourceId: placement.parentId,
              targetType: 'ATTACHMENT',
              targetId: attachment.id,
              relationType: SDLC_CONTAINMENT_RELATION,
              createdBy: userId,
            },
            {
              workspaceId,
              channelId: entityId,
              sourceType: 'TRACK',
              sourceId: placement.trackId,
              targetType: 'ATTACHMENT',
              targetId: attachment.id,
              relationType: SDLC_TRACK_FLAT_RELATION,
              createdBy: userId,
            },
          ]),
          skipDuplicates: true,
        });
      }

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
