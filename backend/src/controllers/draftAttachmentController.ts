import { Request, Response } from 'express';
import { DatabaseClient } from '../database/client';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { uploadFiles, UploadedFileResult } from '../services/fileUploadService';
import { logger } from '../utils/logger';
import { AttachmentEntityType, AttachmentUploadStatus } from '@prisma/client';
import { config } from '@/config/env';

export class DraftAttachmentController {
  private db = DatabaseClient.getInstance();
  private channelParticipantRepository: ChannelParticipantRepository;
  private channelRepository: ChannelRepository;

  constructor() {
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.channelRepository = new ChannelRepository();
  }

  /**
   * POST /api/drafts/attachments/upload
   * Upload multiple file attachments for a draft message
   */
  uploadDraftAttachment = async (req: Request, res: Response): Promise<void> => {
    let attachmentIdsArray: string[] = [];
    try {
      const { attachmentIds, channelId, conversationId, draftMessageId, width, height, fileMetadata: fileMetadataJson } = req.body;
      const reqFiles = req.files as { [fieldname: string]: Express.Multer.File[] };
      const files = reqFiles?.['files'];
      const thumbnails = reqFiles?.['thumbnails'];

      // Validate required parameters
      if (!channelId) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }

      if (!draftMessageId) {
        res.status(400).json({ error: 'draftMessageId is required' });
        return;
      }

      if (!files || files.length === 0) {
        res.status(400).json({ error: 'Files are required' });
        return;
      }

      // Parse attachmentIds - support both string and array formats

      if (typeof attachmentIds === 'string') {
        try {
          attachmentIdsArray = JSON.parse(attachmentIds);
        } catch (error) {
          attachmentIdsArray = [attachmentIds]; // Try treating it as a single ID
        }
      } else if (Array.isArray(attachmentIds)) {
        attachmentIdsArray = attachmentIds;
      } else {
        attachmentIdsArray = [];
      }

      // Ensure we have matching number of attachment IDs
      if (attachmentIdsArray.length !== files.length) {
        res.status(400).json({
          error: 'attachmentIds length must match files length',
          expected: files.length,
          received: attachmentIdsArray.length
        });
        return;
      }

      // Parse width and height if provided (for backward compatibility with single file)
      const parsedLegacyWidth = width ? parseInt(width, 10) : undefined;
      const parsedLegacyHeight = height ? parseInt(height, 10) : undefined;

      // Parse fileMetadata JSON array if provided
      let parsedFileMetadata: Array<{ hasThumbnail?: boolean; width?: number; height?: number; fileIndex?: number }> = [];
      if (fileMetadataJson) {
        try {
          parsedFileMetadata = JSON.parse(fileMetadataJson);
          logger.info('Received fileMetadata for draft attachments:', parsedFileMetadata);
        } catch (error) {
          logger.warn('Failed to parse fileMetadata:', error);
        }
      }

      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      // Verify user has access to this channel
      const isParticipant = await this.channelParticipantRepository.isParticipant(
        channelId,
        userId
      );

      if (!isParticipant) {
        logger.warn(`Unauthorized upload attempt: User ${userId} tried to upload to draft in channel ${channelId}`);
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to upload to this draft'
        });
        return;
      }

      // Note: We do NOT create the draft here. The frontend creates drafts via Zero mutators,
      // and we rely on that draft existing. If the draft doesn't exist (e.g., message was sent
      // while uploads were in progress), we still process the attachments since they were
      // already created via Zero with PENDING status. The attachments will be transferred
      // to the message when send completes, regardless of draft existence.
      const finalDraftMessageId = draftMessageId;

      logger.info(`Uploading ${files.length} draft attachments using fileUploadService`);

      // Fetch workspaceId from channel
      const draftWorkspaceId = await this.channelRepository.getWorkspaceId(channelId);

      // First, mark all attachments as STARTED
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const attachmentId = attachmentIdsArray[i];

        try {
          await this.db.messageAttachment.upsert({
            where: { id: attachmentId },
            update: {
              uploadStatus: AttachmentUploadStatus.STARTED,
            },
            create: {
              id: attachmentId,
              entityId: finalDraftMessageId,
              entityType: AttachmentEntityType.DRAFT,
              url: '',
              size: file.size,
              originalFilename: file.originalname,
              mimetype: file.mimetype,
              uploadedByUserId: userId,
              createdBy: userId,
              storageProvider: config.fileStorage.provider,
              conversationId: conversationId || null,
              workspaceId: draftWorkspaceId,
              width: null,
              height: null,
              thumbnailUrl: null,
              metadata: {},
              uploadStatus: AttachmentUploadStatus.STARTED,
            },
          });
        } catch (error) {
          logger.error(`Failed to mark attachment ${attachmentId} as STARTED:`, error);
        }
      }

      // Prepare fileMetadata array format for fileUploadService
      const fileMetadataArray = parsedFileMetadata.map((metadata, index) => ({
        fileIndex: index,
        hasThumbnail: metadata.hasThumbnail ?? false,
        thumbnailIndex: metadata.hasThumbnail ? index : undefined,
        width: metadata.width,
        height: metadata.height,
        duration: (metadata as { duration?: number }).duration,
      }));

      // Use fileUploadService to upload all files
      const uploadResults: UploadedFileResult[] = await uploadFiles(
        files,
        thumbnails,
        fileMetadataArray
      );

      // Process each file individually and update MessageAttachment records to COMPLETED
      const results = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const attachmentId = attachmentIdsArray[i];
        const uploadedFile = uploadResults[i];

        try {
          const fileUrl = uploadedFile.fileUrl;
          const thumbnailUrl = uploadedFile.thumbnailUrl;

          logger.info(`Processing draft attachment ${attachmentId}: ${fileUrl}`);

          // Get metadata for this file
          const metadata = parsedFileMetadata[i] || {};

          // Build complete metadata object - merge from uploadFiles result
          const completeMetadata: Record<string, any> = {
            ...uploadedFile.metadata,
            // Preserve any additional frontend-provided data
            ...(metadata.hasThumbnail && { thumbnailGenerated: true }),
            ...(metadata.width !== undefined && { width: metadata.width }),
            ...(metadata.height !== undefined && { height: metadata.height }),
            ...((metadata as { duration?: number }).duration !== undefined && { duration: (metadata as { duration?: number }).duration }),
          };

          // Use dimensions from fileMetadata first, then from uploadFiles result, then legacy fields
          const finalWidth = metadata.width ?? uploadedFile.width ?? parsedLegacyWidth;
          const finalHeight = metadata.height ?? uploadedFile.height ?? parsedLegacyHeight;

          // Update attachment to COMPLETED with all file metadata
          // Use upsert to handle race condition where attachment might have been deleted
          // (e.g., draft was sent/deleted while upload was in progress)
          await this.db.messageAttachment.upsert({
            where: { id: attachmentId },
            update: {
              url: fileUrl,
              size: file.size,
              originalFilename: uploadedFile.originalName,
              width: finalWidth,
              height: finalHeight,
              thumbnailUrl,
              storageProvider: config.fileStorage.provider,
              metadata: completeMetadata,
              uploadStatus: AttachmentUploadStatus.COMPLETED,
            },
            create: {
              id: attachmentId,
              entityId: finalDraftMessageId,
              entityType: AttachmentEntityType.DRAFT,
              url: fileUrl,
              size: file.size,
              originalFilename: uploadedFile.originalName,
              mimetype: file.mimetype,
              uploadedByUserId: userId,
              createdBy: userId,
              storageProvider: config.fileStorage.provider,
              conversationId: conversationId || null,
              workspaceId: draftWorkspaceId,
              width: finalWidth,
              height: finalHeight,
              thumbnailUrl,
              metadata: completeMetadata,
              uploadStatus: AttachmentUploadStatus.COMPLETED,
            },
          });

          logger.info(`Successfully processed draft attachment ${attachmentId}: ${fileUrl}`);

          results.push({
            attachmentId,
            fileUrl,
            success: true,
          });
        } catch (error) {
          logger.error(`Failed to process draft attachment ${attachmentId}:`, error);

          // Mark attachment as FAILED
          // Use upsert to handle race condition where attachment might have been deleted
          try {
            await this.db.messageAttachment.upsert({
              where: { id: attachmentId },
              update: {
                uploadStatus: AttachmentUploadStatus.FAILED,
              },
              create: {
                id: attachmentId,
                entityId: finalDraftMessageId,
                entityType: AttachmentEntityType.DRAFT,
                url: '',
                size: file.size,
                originalFilename: file.originalname,
                mimetype: file.mimetype,
                uploadedByUserId: userId,
                createdBy: userId,
                storageProvider: config.fileStorage.provider,
                conversationId: conversationId || null,
                workspaceId: draftWorkspaceId,
                width: null,
                height: null,
                thumbnailUrl: null,
                metadata: {},
                uploadStatus: AttachmentUploadStatus.FAILED,
              },
            });
          } catch (updateError) {
            logger.error(`Failed to mark attachment ${attachmentId} as FAILED:`, updateError);
          }

          // Continue with next file even if this one fails
          results.push({
            attachmentId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      res.status(200).json({
        success: true,
        uploadedAttachments: results,
        totalCount: results.length,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
      });

    } catch (error) {
      logger.error('Error uploading draft attachments:', error);
      res.status(500).json({
        error: 'Failed to upload attachments',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}