import { Request, Response } from 'express';
import { DatabaseClient } from '../database/client';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { ChannelRepository } from '../database/repositories/channelRepository';
import { uploadFiles, UploadedFileResult } from '../services/fileUploadService';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { AttachmentEntityType, AttachmentUploadStatus } from '@xyne/shared';
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

      // The attachmentIds are client-supplied and the upsert below keys on them
      // (create branch pins `id`, but a colliding existing row falls through to an
      // update). Reject any id that already resolves to a row the caller does not own
      // as a DRAFT.
      if (attachmentIdsArray.length > 0) {
        const existingAttachments = await this.db.messageAttachment.findMany({
          where: { id: { in: attachmentIdsArray } },
          select: { id: true, uploadedByUserId: true, entityType: true },
        });
        const foreign = existingAttachments.find(
          a => a.uploadedByUserId !== userId,
        );
        if (foreign) {
          logger.warn(
            `Unauthorized draft attachment reuse: user ${userId} referenced attachment ${foreign.id} they do not own`,
          );
          res.status(403).json({
            error: 'Forbidden',
            message: 'One or more attachment ids reference a resource you do not own',
          });
          return;
        }
      }

      // Check if draft message already exists for this user+channel+conversation
      const existingDraft = await this.db.draftMessage.findFirst({
        where: {
          channelId: channelId,
          conversationId: conversationId || null,
          userId: userId,
        },
      });

      const finalDraftMessageId = existingDraft?.id || draftMessageId;
      if (!existingDraft) {
        const now = new Date();
        try {
          await this.db.draftMessage.upsert({
            where: { id: draftMessageId },
            update: {}, // already exists — leave all fields alone
            create: {
              id: draftMessageId,
              channelId,
              conversationId: conversationId || null,
              userId,
              workspaceId: req.user!.workspaceId!,
              content: '',
              hasAttachment: true,
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            // Race condition: another request already created this draft — safe to ignore
          } else {
            throw error;
          }
        }
      }

      logger.info(`Uploading ${files.length} draft attachments using fileUploadService`);

      // Fetch workspaceId from channel
      const draftWorkspaceId = await this.channelRepository.getWorkspaceId(channelId);

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

      // Process each file individually and create/update MessageAttachment records
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

          // Fields that must always reflect the just-uploaded file (esp. `url`).
          const attachmentData = {
            url: fileUrl,
            size: file.size,
            originalFilename: uploadedFile.originalName,
            width: finalWidth,
            height: finalHeight,
            thumbnailUrl,
            storageProvider: config.fileStorage.provider,
            metadata: completeMetadata,
            uploadStatus: AttachmentUploadStatus.COMPLETED,
          };

          try {
            await this.db.messageAttachment.upsert({
              where: { id: attachmentId },
              update: attachmentData,
              create: {
                id: attachmentId,
                entityId: finalDraftMessageId,
                entityType: AttachmentEntityType.DRAFT,
                mimetype: file.mimetype,
                uploadedByUserId: userId,
                createdBy: userId,
                conversationId: conversationId || null,
                workspaceId: draftWorkspaceId,
                ...attachmentData,
              },
            });
          } catch (upsertError) {
            // With relationMode="prisma", upsert is a non-atomic SELECT-then-write.
            // Zero's optimistic insert of the same attachment id can land between
            // the SELECT and the INSERT, so the create branch fails with P2002.
            // The row already exists — fall back to an update so the uploaded url
            // is never lost (otherwise the attachment stays url-less and silently
            // never ingests). More likely on larger/slower uploads.
            if (
              upsertError instanceof Prisma.PrismaClientKnownRequestError &&
              upsertError.code === 'P2002'
            ) {
              await this.db.messageAttachment.update({
                where: { id: attachmentId },
                data: attachmentData,
              });
            } else {
              throw upsertError;
            }
          }

          logger.info(`Successfully processed draft attachment ${attachmentId}: ${fileUrl}`);

          results.push({
            attachmentId,
            fileUrl,
            success: true,
          });
        } catch (error) {
          logger.error(`Failed to process draft attachment ${attachmentId}:`, error);
          await this.markAttachmentsFailed([attachmentId]);
          // Continue with next file even if this one fails
          results.push({
            attachmentId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const failureCount = results.filter(r => !r.success).length;

      res.status(failureCount > 0 ? 500 : 200).json({
        success: failureCount === 0,
        uploadedAttachments: results,
        totalCount: results.length,
        successCount: results.filter(r => r.success).length,
        failureCount,
      });

    } catch (error) {
      logger.error('Error uploading draft attachments:', error);
      await this.markAttachmentsFailed(attachmentIdsArray);
      res.status(500).json({
        error: 'Failed to upload attachments',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * Best-effort: park rows whose upload never completed in FAILED so the send gate
   * rejects them and the UI can show the failure. Never throws — the caller is
   * already on an error path.
   */
  private markAttachmentsFailed = async (attachmentIds: string[]): Promise<void> => {
    if (attachmentIds.length === 0) return;
    try {
      await this.db.messageAttachment.updateMany({
        where: { id: { in: attachmentIds }, url: '' },
        data: { uploadStatus: AttachmentUploadStatus.FAILED },
      });
    } catch (error) {
      logger.error('Failed to mark attachments as failed:', error);
    }
  };
}