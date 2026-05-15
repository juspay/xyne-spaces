import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { ingestAttachment } from '../core/fileUtils';
import { resolveChannelId } from '../utils/channelUtils';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { storageService, getStorageService } from '@/services/storage/index';
import { normalizeStoragePath } from '@/services/storage/pathUtils';
import { config } from '@/config/env';

const UploadFilesBodySchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required').trim().optional(),
  channelName: z.string().min(1, 'Channel name is required').trim().optional(),
  text: z.string().trim().optional(),
  markdownText: z.string().optional(),
  metadata: z.string().optional(), // JSON-encoded string
  conversationId: z.string().trim().optional(),
  userId: z.string().min(1, 'User ID is required').trim(),
}).refine(
  data => !!data.channelId || !!data.channelName || !!data.conversationId,
  { message: 'Either channelId, channelName, or conversationId is required', path: ['channelId'] }
);

export class FilesController {
  private messageAttachmentRepository: MessageAttachmentRepository;

  constructor() {
    this.messageAttachmentRepository = new MessageAttachmentRepository();
  }

  /**
   * Get file metadata by attachment ID
   * GET /api/external-event/files/info/:attachmentId
   */
  getFileInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;
      const workspaceId = req.body.workspaceId as string | undefined;

      const attachment = await this.messageAttachmentRepository.findById(attachmentId);
      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' });
        return;
      }

      if (workspaceId && attachment.workspaceId !== workspaceId) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      res.status(200).json({
        id: attachment.id,
        originalFilename: attachment.originalFilename,
        mimetype: attachment.mimetype,
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
        thumbnailUrl: attachment.thumbnailUrl,
        createdAt: attachment.createdAt,
        conversationId: attachment.conversationId,
      });
    } catch (error) {
      logger.error('Error fetching file info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Download a file by attachment ID (wrapper over internal attachment download logic)
   * GET /api/external-event/files/download/:attachmentId
   */
  downloadFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { attachmentId } = req.params;
      const workspaceId = req.body.workspaceId as string | undefined;

      const attachment = await this.messageAttachmentRepository.findById(attachmentId);
      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' });
        return;
      }

      if (workspaceId && attachment.workspaceId !== workspaceId) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const filePath = normalizeStoragePath(attachment.url);
      if (!filePath) {
        res.status(404).json({ error: 'Attachment not yet uploaded', code: 'NOT_FOUND' });
        return;
      }

      const meta = attachment.metadata as { type?: string };
      const service = meta?.type === 'transcript' || meta?.type === 'identified_transcript'
        ? getStorageService(config.gcs.transcriptionBucketName)
        : storageService;

      const buffer = await service.getFileBuffer(filePath);

      const encodedFilename = encodeURIComponent(attachment.originalFilename);
      res.setHeader('Content-Type', attachment.mimetype);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', `inline; filename="${encodedFilename}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      res.send(buffer);
    } catch (error) {
      logger.error('Error downloading file:', error);
      res.status(500).json({ error: 'Failed to download file' });
    }
  };

  /**
   * Upload file(s) to a channel or conversation
   * POST /api/external-event/files/upload
   */
  uploadFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body with Zod
      const bodyResult = UploadFilesBodySchema.safeParse(req.body);
      
      if (!bodyResult.success) {
        res.status(400).json({ 
          error: `Validation error`,
          code: 'VALIDATION_ERROR',
          details: bodyResult.error.errors
        });
        return;
      }

      const { channelId, channelName, text, markdownText, metadata, conversationId, userId } = bodyResult.data;

      // Resolve channelId from channelName or conversationId if not provided
      const resolvedChannelId = await resolveChannelId(channelId, conversationId, channelName);

      // Extract files from multer
      // uploadMultiple uses fields() so files are in object format
      const reqFiles = (Array.isArray(req.files) ? {} : req.files) || {};
      const files = reqFiles['files'] || [];

      if (files.length === 0) {
        res.status(400).json({
          error: 'At least one file is required',
          code: 'MISSING_FILES',
        });
        return;
      }

      // Parse metadata JSON if provided
      let parsedMetadata: Record<string, unknown> | undefined;
      if (metadata) {
        try {
          parsedMetadata = JSON.parse(metadata) as Record<string, unknown>;
        } catch {
          res.status(400).json({ error: 'metadata must be valid JSON', code: 'VALIDATION_ERROR' });
          return;
        }
      }

      // Upload files and create/update conversation
      const result = await ingestAttachment({
        files,
        channelId: resolvedChannelId,
        userId,
        text,
        markdownText,
        metadata: parsedMetadata,
        conversationId,
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error('Error uploading files:', error);

      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          res.status(404).json({
            error: error.message,
            code: 'NOT_FOUND',
          });
          return;
        }
        if (error.message.includes('required')) {
          res.status(400).json({
            error: error.message,
            code: 'VALIDATION_ERROR',
          });
          return;
        }
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
