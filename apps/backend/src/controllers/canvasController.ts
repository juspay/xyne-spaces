import { Request, Response } from 'express';
import { AttachmentEntityType, ActivityClassification, CanvasRole } from '@xyne/shared';
import { z } from 'zod';
import { uploadFiles } from '../services/fileUploadService.js';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository.js';
import { logger } from '../utils/logger';
import { canvasAuthService } from '../services/canvasAuthService.js';
import { config } from '../config/env.js';
import { notificationService } from '../services/notificationService.js';
import { slackService } from '../services/slackService.js';
import { activityService } from '../services/activity/activityService.js';
import { DatabaseClient } from '@/database/client';
import { getGroupMembersForNotification } from '../utils/mentionUtils.js';
import { getSlackRecipientEmails } from '../utils/notificationHelper.js';
import { cleanupProxiedFile } from '../utils/attachmentUtils';
import { v4 as uuidv4 } from 'uuid';
import { initializeYSweetDoc, readFromYSweetStrict, syncToYSweet } from '../utils/ysweetUtils.js';
import {
  convertMarkdownToBlockNote,
  convertBlockNoteToMarkdown,
  getCanvasUrl,
  getCanvasById,
} from '../services/canvasService.js';

export class CanvasController {
  private messageAttachmentRepository: MessageAttachmentRepository;

  constructor(messageAttachmentRepository: MessageAttachmentRepository) {
    this.messageAttachmentRepository = messageAttachmentRepository;
  }

    createCanvas = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }

      const { title, markdown, visibility, channelId } = req.body;
      if (!title || !markdown) {
        res.status(400).json({ error: 'Title and markdown are required' });
        return;
      }
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      // USE THE AUTHENTICATED USER, NOT A BOT
      const creatorId = userId;

      const canvasId = uuidv4();
      const participantId = uuidv4();

      const blocks = await convertMarkdownToBlockNote(markdown);

      await prisma.$transaction([
        prisma.canvas.create({
          data: {
            id: canvasId,
            title,
            content: [],
            workspaceId: req.user!.workspaceId!,
            createdBy: creatorId,  // <-- AUTHENTICATED USER
            channelId: channelId || null,  // <-- ASSOCIATE WITH CHANNEL IF PROVIDED
            visibility: visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
            isTemplate: false,
            isCollaborative: true,
            lastEditedBy: creatorId,
            lastEditedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }),
        prisma.canvasParticipant.create({
          data: {
            id: participantId,
            canvasId,
            workspaceId: req.user!.workspaceId!,
            userId: creatorId,  // <-- AUTHENTICATED USER IS OWNER
            role: CanvasRole.OWNER,
            joinedAt: now,
            updatedAt: now,
          },
        }),
      ]);

      const ysweetInitialized = await initializeYSweetDoc(canvasId, blocks);
      if (!ysweetInitialized) {
        res.status(500).json({ error: 'Failed to initialize canvas content' });
        return;
      }

      const canvasUrl = getCanvasUrl(canvasId, req.user?.workspaceId);

      res.status(201).json({
        id: canvasId,
        title,
        url: canvasUrl,
        visibility: visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
        channelId: channelId || null,
      });
    } catch (error) {
      logger.error('[CANVAS-CREATE] Error:', error);
      res.status(500).json({ error: 'Failed to create canvas' });
    }
  };

  uploadFile = async (req: Request, res: Response): Promise<void> => {
    try {
      const { canvasId, width, height } = req.body;
      const userId = req.user?.id;
      const file = req.file;

      if (!userId) {
        await cleanupProxiedFile(file, { logPrefix: 'CANVAS-UPLOAD' });
        res.status(403).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      if (!canvasId) {
        await cleanupProxiedFile(file, { logPrefix: 'CANVAS-UPLOAD' });
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
        await cleanupProxiedFile(file, { logPrefix: 'CANVAS-UPLOAD' });
        res.status(403).json({ error: 'Permission denied' });
        return;
      }

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
        await cleanupProxiedFile(file, { logPrefix: 'CANVAS-UPLOAD' });
        res.status(500).json({ error: 'Failed to process the uploaded file.' });
        return;
      }

      const uploadedFile = uploadResults[0];

      // Use dimensions from request body (frontend) or fallback to uploadedFile dimensions
      const finalWidth = parsedWidth || uploadedFile.width;
      const finalHeight = parsedHeight || uploadedFile.height;

      if (!req.user?.workspaceId) {
        throw new Error('workspaceId required: no authenticated workspace');
      }
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
        workspaceId: req.user.workspaceId,
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

      res.status(200).json({
        attachmentId: attachment.id,
        fileName: attachment.originalFilename,
        fileSize: attachment.size,
        mimeType: attachment.mimetype,
        thumbnailUrl: attachment.thumbnailUrl,
      });
    } catch (error) {
      await cleanupProxiedFile(req.file, { logPrefix: 'CANVAS-UPLOAD' });
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
      commentThreadId: z.string().optional(),
      canvasTitle: z.string().optional(),
      mentionContext: z.enum(['canvas', 'comment']).optional(),
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

      const { mentionType, mentionId, blockId, commentThreadId, canvasTitle, mentionContext, slackUrl } =
        validatedBody.data;
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
        actionSource: mentionContext === 'comment' ? 'canvas_comment' : 'canvas',
        actionSourceId: mentionContext === 'comment' && commentThreadId ? commentThreadId : canvasId,
        channelId: canvasChannelId ?? undefined,
        canvasId: canvasId,
        blockId: blockId ?? undefined,
        classification: ActivityClassification.PENDING,
      }));

      const senderName = sender?.name ?? 'Someone';
      // Filter to only users with access for email notifications
      const usersWithAccessSet = new Set(usersWithAccessIds);
      const userEmailMap = new Map(
        mentionedUserRecords
          .filter(u => u.email && usersWithAccessSet.has(u.id))
          .map(u => [u.id, u.email!])
      );
      const mentionedEmails = Array.from(userEmailMap.values());

      // Step 1: Create activities
      await activityService.createActivities(activities);

      // Step 2: Send app notifications first and collect delivered user IDs.
      // On failure, fall back to sending Slack to everyone (fail-open).
      let slackRecipientEmails = mentionedEmails;
      try {
        const { deliveredUserIds } = await notificationService.createCanvasMentionNotifications(
          usersWithAccessIds,
          canvasId,
          canvasTitle ?? 'Canvas',
          userId,
          senderName,
          req.user?.workspaceId ?? '',
          channelName,
          blockId,
          commentThreadId,
          canvasChannelId ?? undefined,
          mentionContext,
        );

        slackRecipientEmails = getSlackRecipientEmails(mentionedEmails, deliveredUserIds, userEmailMap);
      } catch (error) {
        logger.error('[CANVAS-MENTIONS] Spaces notification failed — sending Slack to all recipients', { error });
      }

      // Step 3: Send Slack notifications only to users who didn't receive app notification
      await slackService.sendCanvasMentionNotifications(
        slackRecipientEmails,
        senderName,
        canvasTitle ?? 'Canvas',
        slackUrl!,
      );

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

  readCanvas = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }

      const { canvasId } = req.params;
      if (!canvasId) {
        res.status(400).json({ error: 'canvasId is required' });
        return;
      }

      const canvas = await getCanvasById(canvasId);
      if (!canvas) {
        res.status(404).json({ error: 'Canvas not found' });
        return;
      }

      // Check read permission
      try {
        await canvasAuthService.requireViewAccess(canvas.id, userId);
      } catch (error) {
        logger.warn(`[CANVAS-READ] Permission denied for user ${userId} on canvas ${canvas.id}`);
        res.status(403).json({ error: 'Permission denied' });
        return;
      }

      // Read content from Y-Sweet
      const { readFromYSweet } = await import('../utils/ysweetUtils.js');
      const blocks = await readFromYSweet(canvas.id);
      const markdown = blocks.length > 0 ? await convertBlockNoteToMarkdown(blocks) : '';

      res.status(200).json({
        id: canvas.id,
        title: canvas.title,
        markdown,
        url: getCanvasUrl(canvas.id, req.user?.workspaceId),
      });
    } catch (error) {
      logger.error('[CANVAS-READ] Error:', error);
      res.status(500).json({ error: 'Failed to read canvas' });
    }
  };

  updateCanvas = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }

      const { canvasId } = req.params;
      const { markdown } = req.body;

      if (!canvasId) {
        res.status(400).json({ error: 'canvasId is required' });
        return;
      }

      if (!markdown || typeof markdown !== 'string') {
        res.status(400).json({ error: 'markdown content is required' });
        return;
      }

      const canvas = await getCanvasById(canvasId);
      if (!canvas) {
        res.status(404).json({ error: 'Canvas not found' });
        return;
      }

      // Check edit permission
      try {
        await canvasAuthService.requireEditAccess(canvas.id, userId);
      } catch (error) {
        logger.warn(`[CANVAS-UPDATE] Permission denied for user ${userId} on canvas ${canvas.id}`);
        res.status(403).json({ error: 'Permission denied' });
        return;
      }

      // The markdown cannot carry a whiteboard's drawing, only its id, so the
      // current document is what the write restores it from. A read that fails
      // must stop the write: taken as an empty canvas it would restore nothing,
      // and the drawing would be gone for good behind a warning in a log.
      let existingBlocks;
      try {
        existingBlocks = await readFromYSweetStrict(canvas.id);
      } catch (error) {
        logger.error(
          `[CANVAS-UPDATE] Could not read canvas ${canvas.id} before writing to it`,
          error
        );
        res.status(503).json({ error: 'Could not read the canvas to update it. Please try again.' });
        return;
      }
      const blocks = await convertMarkdownToBlockNote(markdown, existingBlocks);

      // Sync content to Y-Sweet for collaborative editing
      const ysweetSynced = await syncToYSweet(canvas.id, blocks);
      if (!ysweetSynced) {
        logger.warn(`[CANVAS-UPDATE] Y-Sweet sync failed for canvas ${canvas.id}`);
      }

      // Update DB timestamp
      const prisma = DatabaseClient.getInstance();
      await prisma.canvas.update({
        where: { id: canvas.id },
        data: {
          lastEditedBy: userId,
          lastEditedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      res.status(200).json({
        id: canvas.id,
        title: canvas.title,
        url: getCanvasUrl(canvas.id, req.user?.workspaceId),
      });
    } catch (error) {
      logger.error('[CANVAS-UPDATE] Error:', error);
      res.status(500).json({ error: 'Failed to update canvas' });
    }
  };
}
