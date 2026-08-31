import { Request, Response } from 'express';
import { AttachmentEntityType, ActivityClassification, CanvasRole, NotificationType } from '@xyne/shared';
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
import {initializeYSweetDoc, syncToYSweet} from '../utils/ysweetUtils.js';
import { convertMarkdownToBlockNote, convertBlockNoteToMarkdown, getCanvasUrl, getCanvasById } from '../services/canvasService.js';

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

      const blocks = await convertMarkdownToBlockNote(markdown);

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

  // POST /api/canvas/:canvasId/request-access — edit-access request. The
  // request's durable state IS the recipients' activity rows: an open request
  // is one whose activity is still ACTIONABLE (approve/dismiss flip it to
  // SKIP), so dedupe checks those rows instead of any in-memory state.
  requestAccess = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }
      const { canvasId } = req.params;
      const message =
        typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : undefined;

      // In-process guard only absorbs rapid double-clicks racing the durable
      // activity-row dedupe below.
      const rateKey = `${userId}:${canvasId}`;
      const lastRequestedAt = accessRequestTimestamps.get(rateKey);
      if (lastRequestedAt && Date.now() - lastRequestedAt < ACCESS_REQUEST_DEBOUNCE_MS) {
        res.status(200).json({ success: true, alreadyRequested: true });
        return;
      }

      const prisma = DatabaseClient.getInstance();
      const canvas = await prisma.canvas.findFirst({
        where: { id: canvasId, workspaceId },
        select: { id: true, title: true, createdBy: true, visibility: true },
      });
      if (!canvas) {
        res.status(404).json({ error: 'Canvas not found' });
        return;
      }

      // Resolve the requester's effective participant rows (direct, group, channel).
      const [groupMappings, channelMemberships] = await Promise.all([
        prisma.userGroupMapping.findMany({ where: { userId }, select: { userGroupId: true } }),
        prisma.channelParticipant.findMany({ where: { userId }, select: { channelId: true } }),
      ]);
      const groupIds = groupMappings.map(m => m.userGroupId);
      const channelIds = channelMemberships.map(c => c.channelId);
      const effectiveRows = await prisma.canvasParticipant.findMany({
        where: {
          canvasId: canvas.id,
          OR: [
            { userId },
            ...(groupIds.length ? [{ userGroupId: { in: groupIds } }] : []),
            ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
          ],
        },
        select: { role: true },
      });

      const canAlreadyEdit =
        canvas.createdBy === userId ||
        effectiveRows.some(r => r.role === CanvasRole.EDITOR || r.role === CanvasRole.OWNER);
      if (canAlreadyEdit) {
        res.status(400).json({ error: 'You already have edit access' });
        return;
      }
      // Must at least be able to view — don't let no-access users probe private canvases.
      if (effectiveRows.length === 0 && canvas.visibility !== 'PUBLIC') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // Durable dedupe: while any recipient's request activity is still open
      // (ACTIONABLE — approve/dismiss flip it to SKIP) AND fresh, don't create
      // another round of activities/notifications. Survives restarts and
      // multiple backend instances, unlike the in-memory debounce above.
      // A stale open request (every recipient ignored it past the refresh
      // window) does NOT block: it gets superseded below, so the requester is
      // never permanently locked out by owner inaction.
      const openRequest = await prisma.activity.findFirst({
        where: {
          canvasId: canvas.id,
          actorId: userId,
          actorAction: 'canvas_access_requested',
          classification: ActivityClassification.ACTIONABLE,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      });
      if (
        openRequest &&
        Date.now() - openRequest.createdAt.getTime() < ACCESS_REQUEST_REFRESH_MS
      ) {
        res.status(200).json({ success: true, alreadyRequested: true });
        return;
      }
      if (openRequest) {
        // Stale open request: resolve the old rows so the fresh round below
        // is the single open request (keeps the one-open-request invariant).
        await prisma.activity.updateMany({
          where: {
            canvasId: canvas.id,
            actorId: userId,
            actorAction: 'canvas_access_requested',
            classification: ActivityClassification.ACTIONABLE,
          },
          data: { classification: ActivityClassification.SKIP, isRead: true },
        });
      }

      // Recipients: anyone who can grant edit access — the creator plus
      // direct OWNER/EDITOR participants, expanding OWNER/EDITOR user groups.
      // Channel-role rows are deliberately excluded: a channel audience is
      // unbounded and its members didn't opt into managing this canvas.
      const grantorRows = await prisma.canvasParticipant.findMany({
        where: {
          canvasId: canvas.id,
          role: { in: [CanvasRole.OWNER, CanvasRole.EDITOR] },
          channelId: null,
        },
        select: { userId: true, userGroupId: true },
      });
      const grantorGroupIds = grantorRows
        .map(r => r.userGroupId)
        .filter((id): id is string => !!id);
      const groupMemberLists = await Promise.all(
        grantorGroupIds.map(groupId => getGroupMembersForNotification(groupId)),
      );
      const recipientIds = [
        ...new Set([
          canvas.createdBy,
          ...grantorRows.map(r => r.userId).filter((id): id is string => !!id),
          ...groupMemberLists.flat().map(m => m.userId),
        ]),
      ].filter(id => id && id !== userId);
      if (recipientIds.length === 0) {
        res.status(200).json({ success: true });
        return;
      }

      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, displayName: true },
      });
      const requesterName = requester?.displayName || requester?.name || 'Someone';

      accessRequestTimestamps.set(rateKey, Date.now());

      // Persistent surface: an Activity row per recipient (stays in the
      // activity feed until acted on, clicks through to the canvas). The push
      // notification below is just the transient heads-up. ACTIONABLE, not
      // PENDING: PENDING would enqueue these into the AI classification
      // worker, which rewrites non-message activities to FYI and can clobber
      // a concurrent approve/dismiss (classification doubles as this
      // feature's open/resolved request state).
      await activityService.createActivities(
        recipientIds.map(recipientId => ({
          id: uuidv4(),
          userId: recipientId,
          actorId: userId,
          actorAction: 'canvas_access_requested',
          actionSource: 'canvas',
          actionSourceId: canvas.id,
          canvasId: canvas.id,
          classification: ActivityClassification.ACTIONABLE,
        })),
      );

      await Promise.allSettled(
        recipientIds.map(recipientId =>
          notificationService.createNotification(recipientId, {
            title: `${requesterName} requested edit access`,
            message: message
              ? `${requesterName} requested edit access to "${canvas.title}": ${message}`
              : `${requesterName} requested edit access to "${canvas.title}"`,
            type: NotificationType.CANVAS_ACCESS_REQUESTED,
            relatedEntityType: 'canvas',
            relatedEntityId: canvas.id,
            actionUrl: `/${workspaceId}/chat/canvas/${canvas.id}`,
            metadata: { canvasId: canvas.id, requesterId: userId, requesterName },
          }),
        ),
      );

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[CANVAS-REQUEST-ACCESS] Error:', error);
      res.status(500).json({ error: 'Failed to request access' });
    }
  };

  // Whether userId may manage access requests on this canvas: the creator or
  // a direct OWNER/EDITOR participant (mirrors the canvas mutators' checks).
  private canManageCanvasAccess = async (
    prisma: ReturnType<typeof DatabaseClient.getInstance>,
    canvas: { id: string; createdBy: string },
    userId: string,
  ): Promise<boolean> => {
    if (canvas.createdBy === userId) return true;
    const row = await prisma.canvasParticipant.findFirst({
      where: {
        canvasId: canvas.id,
        userId,
        role: { in: [CanvasRole.OWNER, CanvasRole.EDITOR] },
      },
      select: { id: true },
    });
    return !!row;
  };

  // GET /api/canvas/:canvasId/access-requests — canvas-wide list of open
  // edit-access requests for the share dialog. Deliberately canvas-scoped
  // (any recipient's ACTIONABLE row counts), not per-recipient, so
  // owners/editors added AFTER a request still see and can resolve it.
  listAccessRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }
      const { canvasId } = req.params;
      const prisma = DatabaseClient.getInstance();
      const canvas = await prisma.canvas.findFirst({
        where: { id: canvasId, workspaceId },
        select: { id: true, createdBy: true },
      });
      if (!canvas) {
        res.status(404).json({ error: 'Canvas not found' });
        return;
      }
      if (!(await this.canManageCanvasAccess(prisma, canvas, userId))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const rows = await prisma.activity.findMany({
        where: {
          canvasId: canvas.id,
          actorAction: 'canvas_access_requested',
          classification: ActivityClassification.ACTIONABLE,
        },
        select: { actorId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      // One entry per requester (rows are per-recipient copies of the same request).
      const requestedAtByRequester = new Map<string, number>();
      for (const row of rows) {
        if (!requestedAtByRequester.has(row.actorId)) {
          requestedAtByRequester.set(row.actorId, row.createdAt.getTime());
        }
      }
      const requesterIds = [...requestedAtByRequester.keys()];
      const requesters = requesterIds.length
        ? await prisma.user.findMany({
            where: { id: { in: requesterIds } },
            select: { id: true, name: true, displayName: true },
          })
        : [];
      const requesterById = new Map(requesters.map(u => [u.id, u]));

      res.status(200).json({
        requests: requesterIds.map(requesterId => ({
          requesterId,
          requesterName:
            requesterById.get(requesterId)?.displayName ||
            requesterById.get(requesterId)?.name ||
            'Unknown user',
          requestedAt: requestedAtByRequester.get(requesterId),
        })),
      });
    } catch (error) {
      logger.error('[CANVAS-ACCESS-REQUESTS] List error:', error);
      res.status(500).json({ error: 'Failed to load access requests' });
    }
  };

  // GET /api/canvas/:canvasId/access-requests/mine — whether the caller has
  // an open edit-access request on this canvas. The requester's "Requested"
  // button state renders from this server truth instead of a local timer, so
  // it clears the moment anyone approves or rejects (or the ignore window
  // lapses) and is consistent across devices.
  myAccessRequestStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }
      const { canvasId } = req.params;
      const prisma = DatabaseClient.getInstance();
      const openRequest = await prisma.activity.findFirst({
        where: {
          canvasId,
          actorId: userId,
          actorAction: 'canvas_access_requested',
          classification: ActivityClassification.ACTIONABLE,
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      const pending =
        !!openRequest &&
        Date.now() - openRequest.createdAt.getTime() < ACCESS_REQUEST_REFRESH_MS;
      res.status(200).json({ pending });
    } catch (error) {
      logger.error('[CANVAS-ACCESS-REQUESTS] Status error:', error);
      res.status(500).json({ error: 'Failed to load request status' });
    }
  };

  // POST /api/canvas/:canvasId/access-requests/:requesterId/resolve
  // {action: 'approve' | 'decline'} — resolves an open edit-access request for
  // EVERY recipient in one transaction. Lives in REST (Prisma) rather than a
  // Zero mutator because the activities mutation ACL correctly forbids one
  // client from updating other recipients' rows; the server resolving rows it
  // created itself is the sanctioned path. First resolution wins; a second
  // call finds nothing open and no-ops with alreadyResolved.
  resolveAccessRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(403).json({ error: 'Unauthorized' });
        return;
      }
      const { canvasId, requesterId } = req.params;
      const action = req.body?.action;
      if (action !== 'approve' && action !== 'decline') {
        res.status(400).json({ error: "action must be 'approve' or 'decline'" });
        return;
      }
      const prisma = DatabaseClient.getInstance();
      const canvas = await prisma.canvas.findFirst({
        where: { id: canvasId, workspaceId },
        select: { id: true, title: true, createdBy: true },
      });
      if (!canvas) {
        res.status(404).json({ error: 'Canvas not found' });
        return;
      }
      if (!(await this.canManageCanvasAccess(prisma, canvas, userId))) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const requester = await prisma.user.findFirst({
        where: { id: requesterId, workspaceId },
        select: { id: true },
      });
      if (!requester) {
        res.status(404).json({ error: 'Requester not found' });
        return;
      }

      let granted = false;
      let resolvedCount = 0;
      await prisma.$transaction(async tx => {
        if (action === 'approve') {
          const target = await tx.canvasParticipant.findFirst({
            where: { canvasId: canvas.id, userId: requesterId },
          });
          const alreadyHasEdit =
            requesterId === canvas.createdBy || target?.role === CanvasRole.OWNER;
          if (!alreadyHasEdit) {
            if (target) {
              if (target.role !== CanvasRole.EDITOR) {
                await tx.canvasParticipant.update({
                  where: { id: target.id },
                  data: { role: CanvasRole.EDITOR },
                });
                granted = true;
              }
            } else {
              await tx.canvasParticipant.create({
                data: {
                  workspaceId,
                  canvasId: canvas.id,
                  userId: requesterId,
                  role: CanvasRole.EDITOR,
                },
              });
              granted = true;
            }
          }
        }
        const resolved = await tx.activity.updateMany({
          where: {
            canvasId: canvas.id,
            actorId: requesterId,
            actorAction: 'canvas_access_requested',
            classification: ActivityClassification.ACTIONABLE,
          },
          data: { classification: ActivityClassification.SKIP, isRead: true },
        });
        resolvedCount = resolved.count;
      });

      // Raw Prisma writes bypass the zero side-effect handlers, so notify the
      // requester of the grant here (decline stays deliberately silent).
      if (granted) {
        const approver = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, displayName: true },
        });
        await notificationService.createCanvasSharedNotifications(
          [requesterId],
          canvas.id,
          canvas.title ?? 'Untitled',
          userId,
          approver?.displayName || approver?.name || 'Someone',
          CanvasRole.EDITOR,
          'canvas_shared',
        );
        await activityService.createActivities([
          {
            id: uuidv4(),
            userId: requesterId,
            actorId: userId,
            actorAction: 'canvas_shared',
            actionSource: 'canvas',
            actionSourceId: canvas.id,
            canvasId: canvas.id,
            classification: ActivityClassification.ACTIONABLE,
          },
        ]);
      }

      res.status(200).json({
        success: true,
        granted,
        alreadyResolved: resolvedCount === 0 && !granted,
      });
    } catch (error) {
      logger.error('[CANVAS-ACCESS-REQUESTS] Resolve error:', error);
      res.status(500).json({ error: 'Failed to resolve access request' });
    }
  };
}

// Absorbs rapid double-clicks that could race the durable activity-row dedupe
// (two concurrent requests both seeing "no open request"). Deliberately short:
// real repeat-request protection lives in the ACTIONABLE-activity check.
const ACCESS_REQUEST_DEBOUNCE_MS = 30 * 1000;
const accessRequestTimestamps = new Map<string, number>();

// How long an unanswered request blocks re-requesting. After this, a new
// request supersedes the ignored one (fresh activities + notifications), so
// owner inaction can never permanently lock a requester out. Kept short:
// rejects free the requester immediately, so this only paces reminders when
// every owner ignored the request.
const ACCESS_REQUEST_REFRESH_MS = 10 * 1000;
