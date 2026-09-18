import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '../database/repositories/messageAttachmentRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { storageService, getStorageService } from '../services/storage/index';
import { normalizeStoragePath } from '@xyne/storage';
import { logger } from '../utils/logger';
import { setSafeDownloadHeaders } from '../utils/safeAttachmentDownload';
import { getHeicRendition, HeicRenditionError, isHeicAttachment, toWebpFilename } from '../services/heicRenditionService';
import { heicRenditionQueue } from '../queues/heicRenditionQueue';
import { MessageAttachment } from '@prisma/client';
import { AttachmentEntityType, ChannelVisibility } from '@xyne/shared';
import {
  isAllowedSdlcUpload,
  SDLC_CONTAINMENT_RELATION,
  SDLC_TRACK_FLAT_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
} from '@xyne/shared/sdlc';
import { assertAttachmentAccess as assertAttachmentAccessShared, type AttachmentAccessResult } from '../services/attachmentAccessService';
import { uploadFiles } from '../services/fileUploadService';
import { config } from '../config/env';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { DatabaseClient } from '../database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { isSupportedMimeType } from '@/services/fileProcessor';

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

export class AttachmentController {
  private messageAttachmentRepository: MessageAttachmentRepository;
  private channelParticipantRepository: ChannelParticipantRepository;

  constructor() {
    this.messageAttachmentRepository = new MessageAttachmentRepository();
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
   * Authorization for attachment reads (download / thumbnail). Delegates to the
   * shared attachment-access service so every attachment route enforces identical
   * checks.
   */
  private assertAttachmentAccess(
    attachment: MessageAttachment,
    userId: string,
    workspaceId?: string,
  ): Promise<AttachmentAccessResult> {
    return assertAttachmentAccessShared(attachment, userId, workspaceId);
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

      // Opt-in browser-renderable rendition: the original HEIC stays the
      // canonical bytes; ?format=webp serves a lossy (q85) WebP derivative
      // (generated + cached on first request).
      if (req.query.format === 'webp' && isHeicAttachment(attachment.mimetype, attachment.originalFilename)) {
        try {
          const webpBuffer = await getHeicRendition(service, filePath, 'full');

          res.setHeader('Content-Length', webpBuffer.length);
          setSafeDownloadHeaders(res, {
            mimetype: 'image/webp',
            filename: toWebpFilename(attachment.originalFilename),
          });
          setAttachmentCacheHeaders(res, attachment);

          res.send(webpBuffer);
          return;
        } catch (error) {
          const code = error instanceof HeicRenditionError ? error.code : 'CONVERSION_FAILED';
          if (code === 'PENDING') {
            void heicRenditionQueue.enqueueRenditions({ storagePath: filePath });
            res.setHeader('Retry-After', '2');
            res.status(503).json({ error: 'WebP rendition is being generated', code: 'PENDING' });
            return;
          }
          if (code === 'NOT_HEIC' || code === 'TOO_LARGE') {
            logger.info('[AttachmentController] HEIC rendition unavailable, serving original', {
              attachmentId,
              code,
            });
          } else {
            logger.warn('[AttachmentController] HEIC→WebP rendition failed', {
              attachmentId,
              code,
              error: error instanceof Error ? error.message : String(error),
            });
            res.status(502).json({ error: 'Failed to generate WebP rendition', code });
            return;
          }
        }
      }

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
      // HEIC attachments have no upstream thumbnail (the image pipeline
      // can't decode HEVC), so generate one lazily from the original on
      // first request and serve the cached rendition afterwards.
      if (!attachment.thumbnailUrl) {
        const filePath = normalizeStoragePath(attachment.url);

        if (filePath && isHeicAttachment(attachment.mimetype, attachment.originalFilename)) {
          try {
            const service = getAttachmentStorage(attachment);
            const thumbBuffer = await getHeicRendition(service, filePath, 'thumb');

            res.setHeader('Content-Length', thumbBuffer.length);
            setSafeDownloadHeaders(res, {
              mimetype: 'image/webp',
              filename: 'thumbnail.webp',
            });
            res.setHeader('Cache-Control', 'private, max-age=3600');

            res.send(thumbBuffer);
            return;
          } catch (error) {
            const code = error instanceof HeicRenditionError ? error.code : 'CONVERSION_FAILED';
            if (code === 'PENDING') {
              void heicRenditionQueue.enqueueRenditions({ storagePath: filePath });
              res.setHeader('Retry-After', '2');
              res.status(503).json({ error: 'Thumbnail is being generated', code: 'PENDING' });
              return;
            }
            if (code === 'NOT_HEIC' || code === 'TOO_LARGE') {
              logger.info('[AttachmentController] HEIC thumbnail unavailable', {
                attachmentId,
                code,
              });
            } else {
              logger.error('[AttachmentController] HEIC thumbnail generation failed', {
                attachmentId,
                error: error instanceof Error ? error.message : String(error),
              });
              res.status(500).json({ error: 'Failed to generate thumbnail' });
              return;
            }
          }
        }

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

      const service = getAttachmentStorage(attachment);

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
        setAttachmentCacheHeaders(res, attachment);

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
      setAttachmentCacheHeaders(res, attachment);

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
