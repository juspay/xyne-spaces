import { Request, Response } from 'express';
import { z } from 'zod';
import { uploadFiles } from '../services/fileUploadService.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';
import { AttachmentEntityType } from '@prisma/client';
import { logger } from '../utils/logger';
import { canvasAuthService } from '../services/canvasAuthService.js';
import { config } from '../config/env.js';
import { websocketService } from '../services/websocketService';
import { notificationService } from '../services/notificationService.js';
import { slackService } from '../services/slackService.js';
import { activityService } from '../services/activity/activityService.js';
import { DatabaseClient } from '@/database/client';
import { getGroupMembersForNotification } from '../utils/mentionUtils.js';
import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification } from '@prisma/client';

export class CanvasController {
  private messageAttachmentRepository: MessageAttachmentRepository;

  constructor(messageAttachmentRepository: MessageAttachmentRepository) {
    this.messageAttachmentRepository = messageAttachmentRepository;
  }

  uploadFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { canvasId, width, height } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        res.status(403).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      if (!canvasId) {
        res.status(400).json({ error: 'Canvas ID is required' });
        return;
      }

      // Check if user has edit permission on this canvas
      try {
        await canvasAuthService.requireEditAccess(canvasId, userId);
      } catch (error) {
        logger.warn(`[CANVAS-UPLOAD] Permission denied for user ${userId} on canvas ${canvasId}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        res.status(403).json({ error: 'Permission denied' });
        return;
      }

      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Parse dimensions from request body (sent by frontend for images/videos)
      const parsedWidth = width ? parseInt(width, 10) : undefined;
      const parsedHeight = height ? parseInt(height, 10) : undefined;

      logger.info(`[CANVAS-UPLOAD] Uploading file for canvas ${canvasId}:`, {
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        userId,
        width: parsedWidth,
        height: parsedHeight,
      });

      const uploadResults = await uploadFiles([file]);

      if (!uploadResults || uploadResults.length === 0) {
        logger.error('[CANVAS-UPLOAD] The file upload service did not return a valid result for file:', { fileName: file.originalname });
        res.status(500).json({ error: 'Failed to process the uploaded file.' });
        return;
      }

      const uploadedFile = uploadResults[0];

      // Use dimensions from request body (frontend) or fallback to uploadedFile dimensions
      const finalWidth = parsedWidth || uploadedFile.width;
      const finalHeight = parsedHeight || uploadedFile.height;

      const attachment = await this.messageAttachmentRepository.create({
        entityId: canvasId,
        entityType: AttachmentEntityType.CANVAS,
        conversationId: `canvas_${canvasId}`,
        originalFilename: uploadedFile.originalName,
        size: uploadedFile.fileSize,
        mimetype: uploadedFile.mimeType,
        url: uploadedFile.fileUrl,
        thumbnailUrl: uploadedFile.thumbnailUrl,
        width: finalWidth,
        height: finalHeight,
        uploadedByUserId: userId,
        createdBy: userId,
        storageProvider: config.fileStorage.provider,
        metadata: {
          ...uploadedFile.metadata,
          canvasId,
          type: 'canvas_attachment',
        },
      });

      logger.info(`[CANVAS-UPLOAD] File uploaded successfully:`, {
        attachmentId: attachment.id,
        fileName: attachment.originalFilename,
        canvasId,
      });

      // Track user activity using Redis Set - O(1) operation, no DB query
      websocketService.trackUserActivity(userId)
        .catch(err => logger.error('Failed to track user activity after canvas file upload:', err));

      res.status(200).json({
        attachmentId: attachment.id,
        fileName: attachment.originalFilename,
        fileSize: attachment.size,
        mimeType: attachment.mimetype,
        thumbnailUrl: attachment.thumbnailUrl,
      });
    } catch (error) {
      logger.error('[CANVAS-UPLOAD] Error uploading file:', error);
      res.status(500).json({
        error: 'Failed to upload file',
        message: 'An unexpected error occurred while uploading the file.',
      });
    }
  };

  /**
   * POST /api/canvas/:canvasId/mentions
   * Event-based: notify users when a user/group is selected from the @ mention menu.
   * Body: { mentionType: 'user' | 'group', mentionId: string, blockId: string, canvasTitle: string }
   *
   * One API call per mention selection. No counting/deduplication - react to events.
   */
  handleMentions = async (req: Request, res: Response): Promise<void> => {
    const CanvasMentionSchema = z.object({
      mentionType: z.enum(['user', 'group']),
      mentionId: z.string().min(1),
      blockId: z.string().min(1),
      canvasTitle: z.string().optional(),
      slackUrl: z.string().url().optional().or(z.literal('')),
    });

    try {
      const { canvasId } = req.params;
      const validatedBody = CanvasMentionSchema.safeParse(req.body);

      if (!validatedBody.success) {
        res.status(400).json({
          error: 'Bad request',
          message: 'Invalid request body',
          details: validatedBody.error.flatten(),
        });
        return;
      }

      const { mentionType, mentionId, blockId, canvasTitle, slackUrl } = validatedBody.data;
      const userId = req.user?.id;

      if (!userId) {
        res.status(403).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      if (!canvasId) {
        res.status(400).json({ error: 'Canvas ID is required' });
        return;
      }

      try {
        await canvasAuthService.requireEditAccess(canvasId, userId);
      } catch (error) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }

      const db = DatabaseClient.getInstance();

      // Fetch canvas to get channelId
      const canvasRecord = await db.canvas.findUnique({
        where: { id: canvasId },
        select: { channelId: true },
      });
      const canvasChannelId = canvasRecord?.channelId;

      // Fetch channel name if canvas is linked to a channel
      const channel = canvasChannelId
        ? await db.channel.findUnique({
            where: { id: canvasChannelId },
            select: { name: true },
          })
        : null;
      const channelName = channel?.name;

      // Resolve mentioned users
      const mentionedUsers: { userId: string; mentionSource: 'direct' | 'group' }[] = [];
      
      if (mentionType === 'user' && mentionId !== userId) {
        mentionedUsers.push({ userId: mentionId, mentionSource: 'direct' });
      } else if (mentionType === 'group') {
        const members = await getGroupMembersForNotification(mentionId).catch(() => []);
        for (const m of members) {
          if (m.userId !== userId) {
            mentionedUsers.push({ userId: m.userId, mentionSource: 'group' });
          }
        }
      }

      if (mentionedUsers.length === 0) {
        res.status(200).json({ success: true, notified: 0 });
        return;
      }

      // Batch check canvas access for all mentioned users in a single query
      const uniqueUserIds = [...new Set(mentionedUsers.map(u => u.userId))];
      
      // Fetch canvas details, canvas participants, sender name, and mentioned users' emails in one batch
      const [canvas, canvasParticipants, sender, mentionedUserRecords] = await Promise.all([
        db.canvas.findUnique({
          where: { id: canvasId },
          select: { createdBy: true },
        }),
        db.canvasParticipant.findMany({
          where: {
            canvasId,
            userId: { in: uniqueUserIds },
          },
          select: { userId: true },
        }),
        db.user.findUnique({ where: { id: userId }, select: { name: true } }),
        db.user.findMany({
          where: { id: { in: uniqueUserIds } },
          select: { id: true, email: true },
        }),
      ]);
      
      // Determine which users have access (canvas creator or canvas participant)
      const canvasParticipantIds = new Set(canvasParticipants.map(p => p.userId));
      const usersWithAccessIds = uniqueUserIds.filter(uid => 
        uid === canvas?.createdBy || 
        canvasParticipantIds.has(uid)
      );

      if (usersWithAccessIds.length === 0) {
        res.status(200).json({ success: true, notified: 0 });
        return;
      }

      // Filter to users with access and create activities
      const mentionedUsersWithAccess = mentionedUsers.filter(u => usersWithAccessIds.includes(u.userId));
      const activities = mentionedUsersWithAccess.map(u => ({
        id: uuidv4(),
        userId: u.userId,
        actorId: userId,
        actorAction: u.mentionSource === 'direct' ? 'mentioned_user' : 'group_mention',
        actionSource: 'canvas',
        actionSourceId: canvasId,
        channelId: canvasChannelId ?? undefined,
        canvasId: canvasId,
        blockId: blockId ?? undefined,
        classification: ActivityClassification.PENDING,
      }));

      const senderName = sender?.name ?? 'Someone';
      // Filter to only users with access for email notifications
      const usersWithAccessSet = new Set(usersWithAccessIds);
      const mentionedEmails = mentionedUserRecords
        .filter(u => u.email && usersWithAccessSet.has(u.id))
        .map(u => u.email!);

      // Create activities and send notifications in parallel
      await Promise.all([
        activityService.createActivities(activities),
        notificationService.createCanvasMentionNotifications(
          usersWithAccessIds,
          canvasId,
          canvasTitle ?? 'Canvas',
          userId,
          senderName,
          channelName,
          blockId,
        ),
        slackService.sendCanvasMentionNotifications(
          mentionedEmails,
          senderName,
          canvasTitle ?? 'Canvas',
          slackUrl!,
        ),
      ]);

      res.status(200).json({
        success: true,
        notified: usersWithAccessIds.length,
      });
    } catch (error) {
      logger.error('[CANVAS-MENTIONS] Error sending mention notifications:', error);
      res.status(500).json({
        error: 'Failed to send mention notifications',
        message: 'An unexpected error occurred.',
      });
    }
  };
}
