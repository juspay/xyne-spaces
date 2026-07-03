import { db } from '@/database/client';
import { CanvasRole } from '@prisma/client';
import { resolveCanvasHierarchy } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';

export interface CanvasAuthResult {
  hasAccess: boolean;
  canEdit: boolean;
  canView: boolean;
  role?: CanvasRole;
  canvas?: {
    id: string;
    createdBy: string;
    visibility: string;
  };
}

class CanvasAuthService {
  async checkCanvasAccess(
    canvasIdOrAccessId: string,
    userId: string
  ): Promise<CanvasAuthResult> {
    try {
      const canvas = await db.canvas.findFirst({
        where: {
          OR: [
            { id: canvasIdOrAccessId },
            { editAccessId: canvasIdOrAccessId },
            { viewAccessId: canvasIdOrAccessId },
          ],
        },
        select: {
          id: true,
          createdBy: true,
          visibility: true,
          editAccessId: true,
          viewAccessId: true,
          channelId: true,
          folderId: true,
          projectId: true,
        },
      });

      if (!canvas) {
        logger.warn(`[CanvasAuth] Canvas not found: ${canvasIdOrAccessId}`);
        return {
          hasAccess: false,
          canEdit: false,
          canView: false,
        };
      }

      const isCreator = canvas.createdBy === userId;

      const participant = await db.canvasParticipant.findUnique({
        where: {
          canvasId_userId: {
            canvasId: canvas.id,
            userId,
          },
        },
        select: { role: true },
      });

      const groupIds = (
        await db.userGroupMapping.findMany({
          where: { userId },
          select: { userGroupId: true },
        })
      ).map(mapping => mapping.userGroupId);
      const groupParticipant = groupIds.length
        ? await db.canvasParticipant.findFirst({
            where: {
              canvasId: canvas.id,
              userGroupId: { in: groupIds },
            },
            select: { role: true },
          })
        : null;

      const userChannelIds = (
        await db.channelParticipant.findMany({
          where: { userId },
          select: { channelId: true },
        })
      ).map(p => p.channelId);
      const channelParticipant = userChannelIds.length
        ? await db.canvasParticipant.findFirst({
            where: {
              canvasId: canvas.id,
              channelId: { in: userChannelIds },
            },
            select: { role: true },
          })
        : null;

      const hasEditAccessLink = canvas.editAccessId === canvasIdOrAccessId;
      const hasViewAccessLink = canvas.viewAccessId === canvasIdOrAccessId;

      let hasPublicVisibilityAccess = false;
      if (canvas.visibility === 'PUBLIC') {
        if (canvas.channelId) {
          const membership = await db.channelParticipant.findUnique({
            where: {
              channelId_userId: {
                channelId: canvas.channelId,
                userId,
              },
            },
          });
          hasPublicVisibilityAccess = !!membership;
        } else if (canvas.projectId) {
          const membership = await db.channelParticipant.findFirst({
            where: {
              userId,
              channel: {
                projectId: canvas.projectId,
              },
            },
          });
          hasPublicVisibilityAccess = !!membership;
        }
      }

      const roleRank = (r: CanvasRole | undefined): number =>
        r === CanvasRole.OWNER ? 3 : r === CanvasRole.EDITOR ? 2 : r === CanvasRole.VIEWER ? 1 : 0;

      const stronger = (
        a: { role: CanvasRole } | null,
        b: { role: CanvasRole } | null,
      ): { role: CanvasRole } | null => {
        if (!a) return b;
        if (!b) return a;
        return roleRank(a.role) >= roleRank(b.role) ? a : b;
      };

      const entityRole = stronger(groupParticipant, channelParticipant);
      const effectiveRole = participant?.role ?? entityRole?.role;
      const hasOwnerRole = effectiveRole === CanvasRole.OWNER;
      const hasEditorRole = effectiveRole === CanvasRole.EDITOR;
      const hasViewerRole = effectiveRole === CanvasRole.VIEWER;

      const canEdit =
        isCreator || hasOwnerRole || hasEditorRole || hasEditAccessLink;

      const canView =
        canEdit || hasViewerRole || hasViewAccessLink || hasPublicVisibilityAccess;

      const hasAccess = canView;

      logger.debug(`[CanvasAuth] Access check for canvas ${canvas.id}:`, {
        userId,
        isCreator,
        participantRole: effectiveRole,
        hasEditAccessLink,
        hasViewAccessLink,
        hasPublicVisibilityAccess,
        canEdit,
        canView,
      });

      return {
        hasAccess,
        canEdit,
        canView,
        role: effectiveRole,
        canvas: {
          id: canvas.id,
          createdBy: canvas.createdBy,
          visibility: canvas.visibility,
        },
      };
    } catch (error) {
      logger.error('[CanvasAuth] Error checking canvas access:', error);
      throw error;
    }
  }

  getYSweetAuthorizationLevel(canEdit: boolean): 'full' | 'read-only' {
    return canEdit ? 'full' : 'read-only';
  }

  async requireEditAccess(
    canvasIdOrAccessId: string,
    userId: string
  ): Promise<void> {
    const auth = await this.checkCanvasAccess(canvasIdOrAccessId, userId);

    if (!auth.hasAccess) {
      throw new Error('Canvas not found');
    }

    if (!auth.canEdit) {
      throw new Error('Edit permission denied');
    }
  }

  async requireViewAccess(
    canvasIdOrAccessId: string,
    userId: string
  ): Promise<void> {
    const auth = await this.checkCanvasAccess(canvasIdOrAccessId, userId);

    if (!auth.hasAccess) {
      throw new Error('Canvas not found');
    }

    if (!auth.canView) {
      throw new Error('View permission denied');
    }
  }

  async createCanvasForUser(
    canvasId: string,
    userId: string,
    options?: {
      channelId?: string;
      projectId?: string;
      folderId?: string;
      title?: string;
      viewAccessId?: string;
      editAccessId?: string;
    }
  ): Promise<void> {
    try {
      const { folderId, projectId: resolvedProjectId, channelId: resolvedChannelId } =
        await resolveCanvasHierarchy({
          folderId: options?.folderId,
          projectId: options?.projectId,
          channelId: options?.channelId,
          loadFolder: folderId =>
            db.canvasFolder.findUnique({
              where: { id: folderId },
              select: { projectId: true, channelId: true },
            }),
          loadChannel: channelId =>
            db.channel.findUnique({
              where: { id: channelId },
              select: { projectId: true, isArchived: true },
            }),
        });

      if (resolvedChannelId != null) {
        const channel = await db.channel.findUnique({
          where: { id: resolvedChannelId },
          select: { isArchived: true },
        });

        if (!channel) {
          throw new Error('Channel not found');
        }

        if (channel.isArchived) {
          throw new Error('Channel is archived');
        }

        const channelMembership = await db.channelParticipant.findUnique({
          where: {
            channelId_userId: {
              channelId: resolvedChannelId,
              userId,
            },
          },
        });

        if (!channelMembership) {
          throw new Error('User does not have permission to create canvas in this channel');
        }
      } else if (resolvedProjectId) {
        const projectChannelMembership = await db.channelParticipant.findFirst({
          where: {
            userId,
            channel: {
              projectId: resolvedProjectId,
            },
          },
        });

        if (!projectChannelMembership) {
          throw new Error('User does not have permission to create canvas in this project');
        }
      }

      await db.$transaction([
        db.canvas.create({
          data: {
            id: canvasId,
            createdBy: userId,
            visibility: 'PRIVATE',
            title: options?.title || 'Untitled Canvas',
            editAccessId: options?.editAccessId || uuidv4(),
            viewAccessId: options?.viewAccessId || uuidv4(),
            content: [],
            isCollaborative: true,
            ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
            ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
            ...(folderId ? { folderId } : {}),
          },
        }),
        db.canvasParticipant.create({
          data: {
            canvasId,
            userId,
            role: 'OWNER',
          },
        }),
      ]);

      logger.info(`Auto-created canvas ${canvasId} for user ${userId}`);

      // Queue Vespa indexing for the canvas
      try {
        const userWorkspace = await db.user.findUnique({
          where: { id: userId },
          select: { workspaceId: true },
        });
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: canvasId,
          jobType: 'feed',
          userId,
          app: SubApp.CANVAS,
          ...(userWorkspace?.workspaceId ? { workspaceId: userWorkspace.workspaceId } : {}),
        });
        logger.info(`[CanvasAuthService] Queued Vespa indexing for canvas ${canvasId}`);
      } catch (vespaError) {
        logger.error(`[CanvasAuthService] Failed to queue Vespa job for canvas ${canvasId}:`, vespaError);
      }
    } catch (error) {
      logger.error('Failed to auto-create canvas', { canvasId, userId, error });
      throw error;
    }
  }
}

export const canvasAuthService = new CanvasAuthService();
