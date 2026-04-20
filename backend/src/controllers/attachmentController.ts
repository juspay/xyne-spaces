import { Request, Response } from 'express';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '../database/repositories/messageAttachmentRepository';
import { ConversationRepository } from '../database/repositories/conversationRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { storageService, getStorageService } from '../services/storage/index';
import { normalizeStoragePath } from '../services/storage/pathUtils';
import { logger } from '../utils/logger';
import { AttachmentEntityType } from '@prisma/client';
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
    userId: string
  ): Promise<void> {
    if (attachments.length === 0) return;

    // Filter only supported MIME types (PDF, DOCX, TXT, MD, etc.)
    const supportedAttachments = attachments.filter(att => isSupportedMimeType(att.mimetype));

    for (const attachment of supportedAttachments) {
      vespaQueue.addJob({
        schema: fileSchema,
        jobType: "feed",
        docId: attachment.id,
        app: SubApp.CHAT_ATTACHMENT
      }).catch(async (error: any) => {
        logger.error(`[AttachmentController] Error queuing Vespa job for attachment ${attachment.id}:`, error);
        // Log failed insertion to Postgres
        try {
          if (db.vespaInsertionLogs) {
            await db.vespaInsertionLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: attachment.id,
                entityType: fileSchema,
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
      });
    }
  }

  /**
   * GET /api/attachments/:attachmentId/download
   * Stream file from GCS to client
   */
  downloadAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found'});
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

      // Set response headers
      res.setHeader('Content-Type', attachment.mimetype);
      res.setHeader('Content-Length', buffer.length);

      // Encode filename to handle special characters
      const encodedFilename = encodeURIComponent(attachment.originalFilename);
      res.setHeader('Content-Disposition', `inline; filename="${encodedFilename}"`);

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
   * GET /api/attachments/file
   * Stream file from GCS to client using GCS path as query parameter
   * This is useful when we have the GCS path but not the attachment ID
   */
  downloadByPath = async (req: Request, res: Response): Promise<void> => {
    try {
      const { path: gcsPath } = req.query;

      if (!gcsPath || typeof gcsPath !== 'string') {
        res.status(400).json({ error: 'GCS path is required' });
        return;
      }

      logger.info(`Streaming file from GCS path: ${gcsPath}`);

      // Check if file exists in GCS
      const fileExists = await storageService.fileExists(gcsPath);
      if (!fileExists) {
        logger.error(`File not found in GCS: ${gcsPath}`);
        res.status(404).json({ error: 'File not found in storage' });
        return;
      }

      // Get file metadata to determine content type and size
      const metadata = await storageService.getFileMetadata(gcsPath);
      const contentType = metadata.contentType || 'application/octet-stream';
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Extract filename from path
      const fileName = gcsPath.split('/').pop() || 'download';

      // Set response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

      // Stream the file directly from GCS
      const stream = await storageService.createReadStream(gcsPath);
      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error('File stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream file' });
        }
      });
    } catch (error) {
      logger.error('Error downloading file by path:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  };

  /**
   * GET /api/attachments/:attachmentId/thumbnail
   * Download thumbnail for an attachment (if available)
   */
  downloadThumbnail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;

      // Get attachment metadata from database
      const attachment = await this.messageAttachmentRepository.findById(attachmentId);

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
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

      if (attachment.entityType !== AttachmentEntityType.DRAFT) {
        // CHECK: Verify user has access to this attachment
        // Attachments belong to conversations, conversations belong to channels
        // User must be a participant of the channel to access the attachment
        const conversation = attachment.conversationId ? await this.conversationRepository.findById(attachment.conversationId) : null;
          if (!conversation) {
          logger.error(`Conversation not found for attachment ${attachmentId}`);
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }

        // Check if user is a participant of the channel
        const isParticipant = conversation ? await this.channelParticipantRepository.isParticipant(
          conversation.channelId,
          userId
        ) : attachment.createdBy === userId;

        if (!isParticipant) {
          logger.warn(`Unauthorized access attempt: User ${userId} tried to stream attachment ${attachmentId} from channel ${conversation.channelId}`);
          res.status(403).json({
            error: 'Forbidden',
            message: 'You do not have permission to access this attachment'
          });
          return;
        }
      } else {
        if (attachment.createdBy !== userId) {
          logger.warn(`Unauthorized access attempt: User ${userId} tried to stream draft attachment ${attachmentId} created by ${attachment.createdBy}`);
          res.status(403).json({
            error: 'Forbidden',
            message: 'You do not have permission to access this attachment'
          });
          return;
        }
      }

      const filePath = normalizeStoragePath(attachment.url);
      if (!filePath) {
        res.status(404).json({ error: 'Attachment not yet uploaded' });
        return;
      }

      const fileExists = await storageService.fileExists(filePath);
      if (!fileExists) {
        logger.error(`File not found in storage: ${filePath}`);
        res.status(404).json({ error: 'File not found in storage' });
        return;
      }

      const metadata = await storageService.getFileMetadata(filePath);
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      // Parse Range header (e.g., "bytes=0-1023")
      const range = req.headers.range;

      if (!range) {
        // No range requested - send entire file
        logger.info(`Streaming entire file: ${filePath}`);

        res.setHeader('Content-Type', attachment.mimetype);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');

        const stream = await storageService.createReadStream(filePath);
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
      res.setHeader('Content-Type', attachment.mimetype);
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const stream = await storageService.createReadStream(filePath, { start, end });
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
   * Upload multiple attachments for an entity (e.g., IMPACT)
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

      if (entityType !== AttachmentEntityType.IMPACT) {
        res.status(400).json({ error: 'Only IMPACT attachments are supported' });
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

      const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map(file => ({
        entityId,
        entityType: AttachmentEntityType.IMPACT,
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
        metadata: file.metadata || {},
      }));

      await this.messageAttachmentRepository.createMany(attachmentData);

      // Fetch created attachments from database to get their real IDs for Vespa indexing
      const savedAttachments = await this.messageAttachmentRepository.findByEntityIdAndType(entityId, AttachmentEntityType.IMPACT);

      if (savedAttachments.length > 0) {
        const attachments = savedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        this.pushVespaJobForAttachments(attachments, userId).catch(error => {
          logger.error(`[AttachmentController] Error pushing Vespa job for attachments for entity ${entityId}:`, error);
        });
      }

      res.status(200).json({ success: true, count: attachmentData.length });
    } catch (error) {
      logger.error('Error uploading attachments:', error);
      res.status(500).json({ error: 'Failed to upload attachments' });
    }
  };
}
