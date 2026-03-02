import { db } from '@/database/client';
import { CanvasRole } from '@prisma/client';
import { logger } from '@/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { websocketService } from '@/services/websocketService';
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

      const hasEditAccessLink = canvas.editAccessId === canvasIdOrAccessId;
      const hasViewAccessLink = canvas.viewAccessId === canvasIdOrAccessId;

      let isChannelMember = false;
      if (canvas.channelId && canvas.visibility === 'PUBLIC') {
        const membership = await db.channelParticipant.findUnique({
          where: {
            channelId_userId: {
              channelId: canvas.channelId,
              userId,
            },
          },
        });
        isChannelMember = !!membership;
      }

      const hasOwnerRole = participant?.role === CanvasRole.OWNER;
      const hasEditorRole = participant?.role === CanvasRole.EDITOR;
      const hasViewerRole = participant?.role === CanvasRole.VIEWER;

      const canEdit =
        isCreator || hasOwnerRole || hasEditorRole || hasEditAccessLink;

      const canView =
        canEdit || hasViewerRole || hasViewAccessLink || isChannelMember;

      const hasAccess = canView;

      logger.debug(`[CanvasAuth] Access check for canvas ${canvas.id}:`, {
        userId,
        isCreator,
        participantRole: participant?.role,
        hasEditAccessLink,
        hasViewAccessLink,
        isChannelMember,
        canEdit,
        canView,
      });

      return {
        hasAccess,
        canEdit,
        canView,
        role: participant?.role,
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
      title?: string;
      viewAccessId?: string;
      editAccessId?: string;
    }
  ): Promise<void> {
    try {
      if (options?.channelId) {
        const channelMembership = await db.channelParticipant.findUnique({
          where: {
            channelId_userId: {
              channelId: options.channelId,
              userId,
            },
          },
        });

        if (!channelMembership) {
          throw new Error('User does not have permission to create canvas in this channel');
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
            ...(options?.channelId ? { channelId: options.channelId } : {}),
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

      // Track user activity using Redis Set - O(1) operation, no DB query
      websocketService.trackUserActivity(userId)
        .catch(err => logger.error('Failed to track user activity after auto canvas creation:', err));

      logger.info(`Auto-created canvas ${canvasId} for user ${userId}`);

      // Queue Vespa indexing for the canvas
      try {
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: canvasId,
          jobType: 'feed',
          userId,
          app: SubApp.CANVAS,
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
