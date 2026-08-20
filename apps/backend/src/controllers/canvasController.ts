import { Request, Response } from 'express';
import type { Tag } from '@prisma/client';
import { AttachmentEntityType, ActivityClassification, CanvasRole, TagMethod } from '@xyne/shared';
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
import { tagRepository } from '@/database/repositories/tagRepository';
import { getGroupMembersForNotification } from '../utils/mentionUtils.js';
import { getSlackRecipientEmails } from '../utils/notificationHelper.js';
import { cleanupProxiedFile } from '../utils/attachmentUtils';
import { v4 as uuidv4 } from 'uuid';
import { initializeYSweetDoc, syncToYSweet } from '../utils/ysweetUtils.js';
import {
  convertMarkdownToBlockNote,
  convertBlockNoteToMarkdown,
  getCanvasUrl,
  getCanvasById,
} from '../services/canvasService.js';

const CANVAS_LABEL_SOURCE_TYPE = 'canvas';
const CANVAS_LABEL_CATEGORY = 'generic';
const MAX_CANVAS_LABEL_BULK_IDS = 200;
const MAX_CANVAS_LABEL_NAMES_PER_REQUEST = 20;

const CanvasLabelBodySchema = z.object({
  // Canvas labels are freeform user labels, unlike configured desk tags.
  names: z.array(z.string().min(1).max(64)).min(1).max(MAX_CANVAS_LABEL_NAMES_PER_REQUEST),
});

const normalizeCanvasLabelName = (name: string): string => name.trim().replace(/\s+/g, ' ');

const normalizeCanvasLabelKey = (name: string): string =>
  normalizeCanvasLabelName(name).toLowerCase();

const parseCanvasIds = (value: unknown): string[] => {
  if (typeof value !== 'string') {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_CANVAS_LABEL_BULK_IDS);
};

const isUniqueConstraintError = (error: unknown): boolean => {
  if (error && typeof error === 'object') {
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (code === 'P2002' || code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return true;
    }
    if (cause && cause !== error && isUniqueConstraintError(cause)) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint|duplicate/i.test(message);
};

const toCanvasLabelResponse = (row: Tag) => ({
  id: row.id,
  canvasId: row.sourceId,
  name: row.tag,
  createdAt: row.createdAt.getTime(),
});

export class CanvasController {
  private messageAttachmentRepository: MessageAttachmentRepository;

  constructor(messageAttachmentRepository: MessageAttachmentRepository) {
    this.messageAttachmentRepository = messageAttachmentRepository;
  }

  private async assertCanvasAccess(
    req: Request,
    res: Response,
    canvasId: string,
    requireEditAccess = false
  ): Promise<string | null> {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    const auth = await canvasAuthService.checkCanvasAccess(canvasId, userId);
    if (!auth.canvas?.id) {
      res.status(404).json({ error: 'Canvas not found' });
      return null;
    }

    const prisma = DatabaseClient.getInstance();
    const canvas = await prisma.canvas.findUnique({
      where: { id: auth.canvas.id },
      select: { id: true, workspaceId: true },
    });

    if (!canvas || canvas.workspaceId !== workspaceId) {
      res.status(404).json({ error: 'Canvas not found' });
      return null;
    }

    const hasAccess = requireEditAccess ? auth.canEdit : auth.canView;
    if (!hasAccess) {
      res.status(403).json({ error: 'Permission denied' });
      return null;
    }

    return canvas.id;
  }

  getCanvasLabelSuggestions = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const query =
        typeof req.query.query === 'string' ? normalizeCanvasLabelKey(req.query.query) : '';
      const rows = await tagRepository.distinctTagsByCategory(
        workspaceId,
        CANVAS_LABEL_SOURCE_TYPE,
        CANVAS_LABEL_CATEGORY,
        query || undefined
      );

      const seen = new Set<string>();
      const labels: string[] = [];
      for (const labelName of rows) {
        const key = normalizeCanvasLabelKey(labelName);
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        labels.push(labelName);
        if (labels.length >= 50) {
          break;
        }
      }

      res.status(200).json({ labels });
    } catch (error) {
      logger.error('[CANVAS-LABELS] Failed to fetch label suggestions:', error);
      res.status(500).json({ error: 'Failed to fetch canvas label suggestions' });
    }
  };

  getCanvasLabels = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const requestedCanvasIds = parseCanvasIds(req.query.canvasIds);
      if (requestedCanvasIds.length === 0) {
        res.status(400).json({ error: 'canvasIds query param is required' });
        return;
      }

      const labelsByCanvasId: Record<string, ReturnType<typeof toCanvasLabelResponse>[]> =
        Object.fromEntries(requestedCanvasIds.map((canvasId) => [canvasId, []]));

      const canonicalToRequested = new Map<string, string[]>();

      // This query is doing two jobs at once, and both are required - there's no
      // Tag-table-only shortcut here:
      //
      // 1. ID resolution. `requestedCanvasIds` can contain either a canonical
      //    canvas id, or a legacy `viewAccessId`/`editAccessId` share-link id
      //    (old chat message URLs, y-sweet client cache, bookmarks predating the
      //    canonical-id migration - see canvasAuthService.checkCanvasAccess for
      //    the same fallback on the single-canvas path). `tags.sourceId` is
      //    always the canonical id, so if a legacy id isn't resolved to its
      //    canonical id first, the later `tagRepository` lookup finds nothing
      //    and labels silently vanish for that canvas. Example: user opens an
      //    old shared link `/canvas/<viewAccessId>`; without this OR-match, that
      //    id never maps to a canvas row and every label lookup for it 404s in
      //    practice even though the canvas and its labels both exist.
      //
      // 2. Permission data. Whether the user canView/canEdit a canvas depends on
      //    `createdBy`, `visibility`, `channelId`, `projectId` - none of which
      //    exist on the Tag row (which only stores `sourceId` = canvas id).
      //    `canvasParticipant` alone can't answer "is this canvas public" or
      //    "what channel does it belong to" either - only the `canvas` table has
      //    these columns, so an access decision requires reading them from here
      //    regardless of how the id was resolved.
      const prisma = DatabaseClient.getInstance();
      const canvases = await prisma.canvas.findMany({
        where: {
          OR: [
            { id: { in: requestedCanvasIds } },
            { viewAccessId: { in: requestedCanvasIds } },
            { editAccessId: { in: requestedCanvasIds } },
          ],
        },
        select: {
          id: true,
          createdBy: true,
          visibility: true,
          channelId: true,
          folderId: true,
          projectId: true,
          workspaceId: true,
          viewAccessId: true,
          editAccessId: true,
        },
      });

      // Map any identifier (id, viewAccessId, editAccessId) -> canonical id
      const anyToCanonical = new Map<string, string>();
      for (const c of canvases) {
        anyToCanonical.set(c.id, c.id);
        if (c.viewAccessId) anyToCanonical.set(c.viewAccessId, c.id);
        if (c.editAccessId) anyToCanonical.set(c.editAccessId, c.id);
      }

      // Build candidate canonical IDs filtered by workspace and request mapping
      const candidateCanonicalIds: string[] = [];
      for (const requestedCanvasId of requestedCanvasIds) {
        const canonical = anyToCanonical.get(requestedCanvasId);
        if (!canonical) continue;
        const canvasRow = canvases.find((x) => x.id === canonical);
        if (!canvasRow || canvasRow.workspaceId !== workspaceId) continue;
        if (!candidateCanonicalIds.includes(canonical)) candidateCanonicalIds.push(canonical);
        const requestedIds = canonicalToRequested.get(canonical) ?? [];
        requestedIds.push(requestedCanvasId);
        canonicalToRequested.set(canonical, requestedIds);
      }

      // Now perform access checks in-memory for the candidate canonical IDs.
      const candidateIds = candidateCanonicalIds;
      if (candidateIds.length === 0) {
        res.status(200).json({ labels: labelsByCanvasId });
        return;
      }

      // Fetch user role and group memberships (constant number of queries)
      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const workspaceRole = userRow?.role;

      const groupMappings = await prisma.userGroupMapping.findMany({
        where: { userId },
        select: { userGroupId: true },
      });
      const groupIds = groupMappings.map((m) => m.userGroupId);

      // Participants for the canvases: user-specific and group-specific
      const participantWhere: any = { canvasId: { in: candidateIds }, OR: [{ userId }] };
      if (groupIds.length) participantWhere.OR.push({ userGroupId: { in: groupIds } });
      const participants = await prisma.canvasParticipant.findMany({
        where: participantWhere,
        select: { canvasId: true, role: true, userGroupId: true, userId: true },
      });

      // Channel-related participants (for shared channel roles)
      const canvasChannelParticipants = await prisma.canvasParticipant.findMany({
        where: { canvasId: { in: candidateIds }, channelId: { not: null } },
        select: { canvasId: true, channelId: true, role: true },
      });

      const channelIds = Array.from(
        new Set(
          canvases
            .filter((c) => c.channelId && candidateIds.includes(c.id))
            .map((c) => c.channelId!)
        )
      );
      const projectIds = Array.from(
        new Set(
          canvases
            .filter((c) => c.projectId && candidateIds.includes(c.id))
            .map((c) => c.projectId!)
        )
      );

      const channelMemberships = channelIds.length
        ? await prisma.channelParticipant.findMany({
            where: { channelId: { in: channelIds }, userId },
            select: { channelId: true },
          })
        : [];
      const channelMembershipSet = new Set(channelMemberships.map((c) => c.channelId));

      const guestAccessWhereOr: any[] = [];
      if (channelIds.length)
        guestAccessWhereOr.push({
          accessibleEntityType: 'CHANNEL',
          accessibleEntityId: { in: channelIds },
        });
      if (projectIds.length)
        guestAccessWhereOr.push({
          accessibleEntityType: 'PROJECT',
          accessibleEntityId: { in: projectIds },
        });

      const guestAccessRows = guestAccessWhereOr.length
        ? await prisma.guestAccess.findMany({
            where: { workspaceId, userId, OR: guestAccessWhereOr },
            select: { accessibleEntityType: true, accessibleEntityId: true },
          })
        : [];

      const guestChannelSet = new Set(
        guestAccessRows
          .filter((g) => g.accessibleEntityType === 'CHANNEL')
          .map((g) => g.accessibleEntityId)
      );
      const guestProjectSet = new Set(
        guestAccessRows
          .filter((g) => g.accessibleEntityType === 'PROJECT')
          .map((g) => g.accessibleEntityId)
      );

      const roleRank = (role: CanvasRole | undefined): number =>
        role === CanvasRole.OWNER
          ? 3
          : role === CanvasRole.EDITOR
            ? 2
            : role === CanvasRole.VIEWER
              ? 1
              : 0;
      const strongerRole = (a: { role: CanvasRole } | null, b: { role: CanvasRole } | null) => {
        if (!a) return b;
        if (!b) return a;
        return roleRank(a.role) >= roleRank(b.role) ? a : b;
      };

      const allowedCanonicalIds: string[] = [];
      for (const canonicalId of candidateIds) {
        const canvasRow = canvases.find((c) => c.id === canonicalId)!;
        const isCreator = canvasRow.createdBy === userId;

        const participant = participants.find(
          (p) => p.canvasId === canonicalId && p.userId === userId
        );

        const groupParticipantEntries = participants.filter(
          (p) => p.canvasId === canonicalId && p.userGroupId
        );
        let strongestGroup: { role: CanvasRole } | null = null;
        for (const gp of groupParticipantEntries) {
          strongestGroup = strongerRole(strongestGroup, { role: gp.role as CanvasRole });
        }

        // Channel-shared role
        const channelParticipants = canvasChannelParticipants.filter(
          (p) => p.canvasId === canonicalId && p.channelId
        );
        let strongestChannelRole: { role: CanvasRole } | null = null;
        for (const cp of channelParticipants) {
          const chanId = cp.channelId!;
          const hasEffectiveChannelAccess =
            channelMembershipSet.has(chanId) ||
            (workspaceRole === 'GUEST' && guestChannelSet.has(chanId));
          if (hasEffectiveChannelAccess) {
            strongestChannelRole = strongerRole(strongestChannelRole, {
              role: cp.role as CanvasRole,
            });
          }
        }

        const entityRole = strongerRole(strongestGroup, strongestChannelRole);
        const effectiveRole = participant?.role ?? entityRole?.role;
        const hasOwnerRole = effectiveRole === CanvasRole.OWNER;
        const hasEditorRole = effectiveRole === CanvasRole.EDITOR;
        const hasViewerRole = effectiveRole === CanvasRole.VIEWER;

        const hasPublicVisibilityAccess = (() => {
          if (canvasRow.visibility !== 'PUBLIC') return false;
          if (workspaceRole === 'GUEST') {
            if (canvasRow.channelId) return guestChannelSet.has(canvasRow.channelId);
            if (canvasRow.projectId) return guestProjectSet.has(canvasRow.projectId);
            return false;
          }
          return true;
        })();

        const hasGuestContainerAccess = (() => {
          if (workspaceRole !== 'GUEST') return false;
          if (canvasRow.channelId && guestChannelSet.has(canvasRow.channelId)) return true;
          if (!canvasRow.projectId) return false;
          return guestProjectSet.has(canvasRow.projectId);
        })();

        const canEdit = isCreator || hasOwnerRole || hasEditorRole;
        const canView =
          canEdit || hasViewerRole || hasPublicVisibilityAccess || hasGuestContainerAccess;

        if (canView) {
          allowedCanonicalIds.push(canonicalId);
        }
      }

      if (allowedCanonicalIds.length === 0) {
        res.status(200).json({ labels: labelsByCanvasId });
        return;
      }

      const rows = await tagRepository.findActiveTagsBySourceIds(
        allowedCanonicalIds,
        workspaceId,
        CANVAS_LABEL_SOURCE_TYPE,
        CANVAS_LABEL_CATEGORY
      );

      for (const row of rows) {
        const label = toCanvasLabelResponse(row);
        const requestedIds = canonicalToRequested.get(row.sourceId) ?? [row.sourceId];
        for (const requestedCanvasId of requestedIds) {
          labelsByCanvasId[requestedCanvasId] = [
            ...(labelsByCanvasId[requestedCanvasId] ?? []),
            label,
          ];
        }
      }

      res.status(200).json({ labels: labelsByCanvasId });
    } catch (error) {
      logger.error('[CANVAS-LABELS] Failed to fetch labels:', error);
      res.status(500).json({ error: 'Failed to fetch canvas labels' });
    }
  };

  addCanvasLabel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { canvasId } = req.params;
      if (!canvasId) {
        res.status(400).json({ error: 'Canvas ID is required' });
        return;
      }

      const canonicalCanvasId = await this.assertCanvasAccess(req, res, canvasId, true);
      if (!canonicalCanvasId) {
        return;
      }

      const userId = req.user!.id!;
      const workspaceId = req.user!.workspaceId!;

      const parsedBody = CanvasLabelBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'At least one label name is required' });
        return;
      }

      const seenKeys = new Set<string>();
      const requestedLabels: { name: string; key: string }[] = [];
      for (const rawName of parsedBody.data.names) {
        const name = normalizeCanvasLabelName(rawName);
        const key = normalizeCanvasLabelKey(name);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        requestedLabels.push({ name, key });
      }
      if (requestedLabels.length === 0) {
        res.status(400).json({ error: 'Label name cannot be empty' });
        return;
      }

      const existingRows = await tagRepository.findActiveTags(
        canonicalCanvasId,
        CANVAS_LABEL_SOURCE_TYPE,
        CANVAS_LABEL_CATEGORY
      );
      const existingByKey = new Map(
        existingRows.map((row) => [normalizeCanvasLabelKey(row.tag), row])
      );

      const labels: ReturnType<typeof toCanvasLabelResponse>[] = [];
      for (const { name, key } of requestedLabels) {
        const existing = existingByKey.get(key);
        if (existing) {
          labels.push(toCanvasLabelResponse(existing));
          continue;
        }

        try {
          const label = await tagRepository.insertTagRow({
            sourceId: canonicalCanvasId,
            sourceType: CANVAS_LABEL_SOURCE_TYPE,
            workspaceId,
            configKey: null,
            tagCategory: CANVAS_LABEL_CATEGORY,
            tag: name,
            method: TagMethod.MANUAL,
            reason: null,
            createdBy: userId,
            updatedBy: userId,
          });
          existingByKey.set(key, label);
          labels.push(toCanvasLabelResponse(label));
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            const fallback = await tagRepository.findActiveTag(
              canonicalCanvasId,
              CANVAS_LABEL_SOURCE_TYPE,
              CANVAS_LABEL_CATEGORY,
              name
            );
            if (fallback) {
              labels.push(toCanvasLabelResponse(fallback));
              continue;
            }
          }
          throw error;
        }
      }

      res.status(200).json({ labels });
    } catch (error) {
      logger.error('[CANVAS-LABELS] Failed to add label:', error);
      res.status(500).json({ error: 'Failed to add canvas label' });
    }
  };

  removeCanvasLabel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { canvasId, labelId } = req.params;
      if (!canvasId || !labelId) {
        res.status(400).json({ error: 'Canvas ID and label ID are required' });
        return;
      }

      const canonicalCanvasId = await this.assertCanvasAccess(req, res, canvasId, true);
      if (!canonicalCanvasId) {
        return;
      }

      const userId = req.user!.id!;
      const workspaceId = req.user!.workspaceId!;
      const existing = await tagRepository.findById(labelId, workspaceId);

      if (
        !existing ||
        existing.sourceId !== canonicalCanvasId ||
        existing.sourceType !== CANVAS_LABEL_SOURCE_TYPE ||
        existing.tagCategory !== CANVAS_LABEL_CATEGORY
      ) {
        res.status(200).json({ success: true });
        return;
      }

      await tagRepository.softDeleteTagRow(existing.id, userId);

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[CANVAS-LABELS] Failed to remove label:', error);
      res.status(500).json({ error: 'Failed to remove canvas label' });
    }
  };

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
            createdBy: creatorId, // <-- AUTHENTICATED USER
            channelId: channelId || null, // <-- ASSOCIATE WITH CHANNEL IF PROVIDED
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
            userId: creatorId, // <-- AUTHENTICATED USER IS OWNER
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
          error: error instanceof Error ? error.message : 'Unknown error',
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
        logger.error(
          '[CANVAS-UPLOAD] The file upload service did not return a valid result for file:',
          { fileName: file.originalname }
        );
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

      const {
        mentionType,
        mentionId,
        blockId,
        commentThreadId,
        canvasTitle,
        mentionContext,
        slackUrl,
      } = validatedBody.data;
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
      const uniqueUserIds = [...new Set(mentionedUsers.map((u) => u.userId))];

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
      const canvasParticipantIds = new Set(canvasParticipants.map((p) => p.userId));
      const usersWithAccessIds = uniqueUserIds.filter(
        (uid) => uid === canvas?.createdBy || canvasParticipantIds.has(uid)
      );

      if (usersWithAccessIds.length === 0) {
        res.status(200).json({ success: true, notified: 0 });
        return;
      }

      // Filter to users with access and create activities
      const mentionedUsersWithAccess = mentionedUsers.filter((u) =>
        usersWithAccessIds.includes(u.userId)
      );
      const activities = mentionedUsersWithAccess.map((u) => ({
        id: uuidv4(),
        userId: u.userId,
        actorId: userId,
        actorAction: u.mentionSource === 'direct' ? 'mentioned_user' : 'group_mention',
        actionSource: mentionContext === 'comment' ? 'canvas_comment' : 'canvas',
        actionSourceId:
          mentionContext === 'comment' && commentThreadId ? commentThreadId : canvasId,
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
          .filter((u) => u.email && usersWithAccessSet.has(u.id))
          .map((u) => [u.id, u.email!])
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
          mentionContext
        );

        slackRecipientEmails = getSlackRecipientEmails(
          mentionedEmails,
          deliveredUserIds,
          userEmailMap
        );
      } catch (error) {
        logger.error(
          '[CANVAS-MENTIONS] Spaces notification failed — sending Slack to all recipients',
          { error }
        );
      }

      // Step 3: Send Slack notifications only to users who didn't receive app notification
      await slackService.sendCanvasMentionNotifications(
        slackRecipientEmails,
        senderName,
        canvasTitle ?? 'Canvas',
        slackUrl!
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
}
