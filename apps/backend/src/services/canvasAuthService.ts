import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import {
  resolveCanvasHierarchy,
  GuestEntity,
  CanvasRole,
  ChannelRole,
  WorkspaceRole,
  CanvasVisibility,
} from '@xyne/shared';
import { isBaselineCanvasType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { repositories } from '@/database/repositories';

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
  private roleRank(role: CanvasRole | undefined): number {
    return role === CanvasRole.OWNER
      ? 3
      : role === CanvasRole.EDITOR
        ? 2
        : role === CanvasRole.VIEWER
          ? 1
          : 0;
  }

  private strongerRole(
    a: { role: CanvasRole } | null,
    b: { role: CanvasRole } | null
  ): { role: CanvasRole } | null {
    if (!a) return b;
    if (!b) return a;
    return this.roleRank(a.role) >= this.roleRank(b.role) ? a : b;
  }

  private async getCurrentUserContext(
    userId: string
  ): Promise<{ role: WorkspaceRole; workspaceId: string } | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true, workspaceId: true },
    });
    if (!user?.workspaceId) {
      return null;
    }
    return { role: user.role as WorkspaceRole, workspaceId: user.workspaceId };
  }

  private async hasGuestChannelAccess(
    userId: string,
    workspaceId: string,
    channelId: string
  ): Promise<boolean> {
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true },
    });
    if (!channel || channel.workspaceId !== workspaceId) {
      return false;
    }

    const directGuestAccess = await db.guestAccess.findFirst({
      where: {
        workspaceId,
        userId,
        accessibleEntityType: GuestEntity.CHANNEL,
        accessibleEntityId: channelId,
      },
      select: { id: true },
    });
    return Boolean(directGuestAccess);
  }

  private async hasEffectiveChannelAccess(
    userId: string,
    context: { role: WorkspaceRole; workspaceId: string } | null,
    channelId: string
  ): Promise<boolean> {
    const membership = await db.channelParticipant.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        },
      },
      select: { channelId: true },
    });
    if (membership) {
      return true;
    }

    if (context?.role !== WorkspaceRole.GUEST) {
      return false;
    }

    return this.hasGuestChannelAccess(userId, context.workspaceId, channelId);
  }

  private async getChannelSharedRole(
    canvasId: string,
    userId: string,
    context: { role: WorkspaceRole; workspaceId: string } | null
  ): Promise<{ role: CanvasRole } | null> {
    const channelParticipants = await db.canvasParticipant.findMany({
      where: {
        canvasId,
        channelId: { not: null },
      },
      select: { role: true, channelId: true },
    });

    let strongestRole: { role: CanvasRole } | null = null;
    for (const participant of channelParticipants) {
      if (!participant.channelId) continue;
      if (await this.hasEffectiveChannelAccess(userId, context, participant.channelId)) {
        strongestRole = this.strongerRole(strongestRole, { role: participant.role as CanvasRole });
      }
    }

    return strongestRole;
  }

  private async hasPublicVisibilityAccess(
    canvas: { visibility: string; channelId: string | null; projectId: string | null },
    userId: string,
    context: { role: WorkspaceRole; workspaceId: string } | null
  ): Promise<boolean> {
    if (canvas.visibility !== 'PUBLIC') {
      return false;
    }
    if (context?.role === WorkspaceRole.GUEST) {
      if (canvas.channelId) {
        return this.hasGuestChannelAccess(userId, context.workspaceId, canvas.channelId);
      }
      return false;
    }
    return true;
  }

  private async hasGuestContainerAccess(
    canvas: { channelId: string | null; projectId: string | null },
    userId: string,
    context: { role: WorkspaceRole; workspaceId: string } | null
  ): Promise<boolean> {
    if (context?.role !== WorkspaceRole.GUEST) {
      return false;
    }
    if (
      canvas.channelId &&
      (await this.hasGuestChannelAccess(userId, context.workspaceId, canvas.channelId))
    ) {
      return true;
    }
    return false;
  }

  async checkCanvasAccess(canvasId: string, userId: string): Promise<CanvasAuthResult> {
    try {
      let canvas = await db.canvas.findUnique({
        where: { id: canvasId },
        select: {
          id: true,
          createdBy: true,
          visibility: true,
          channelId: true,
          folderId: true,
          projectId: true,
          sdlcArtifact: { select: { artifactType: true } },
          metadata: true,
        },
      });

      // Backward-compat: pre-XYNE-17290 callers may pass a legacy
      // viewAccessId or editAccessId instead of the canonical id (stored in
      // old chat message URLs, y-sweet client cache, etc.). If the id lookup
      // misses, try to resolve as a legacy access id and use the canonical
      // row. Note: this does NOT reintroduce the capability-URL edit gate —
      // edit privileges still flow through participant checks below.
      if (!canvas) {
        canvas = await db.canvas.findFirst({
          where: {
            OR: [{ viewAccessId: canvasId }, { editAccessId: canvasId }],
          },
          select: {
            id: true,
            createdBy: true,
            visibility: true,
            channelId: true,
            folderId: true,
            projectId: true,
            sdlcArtifact: { select: { artifactType: true } },
            metadata: true,
          },
        });
      }

      if (!canvas) {
        logger.warn(`[CanvasAuth] Canvas not found: ${canvasId}`);
        return {
          hasAccess: false,
          canEdit: false,
          canView: false,
        };
      }

      const isCreator = canvas.createdBy === userId;
      const currentUserContext = await this.getCurrentUserContext(userId);
      const isSdlcBaseline = isBaselineCanvasType(canvas.sdlcArtifact?.artifactType);
      const isSdlcBaselineChannelAdmin = Boolean(
        isSdlcBaseline &&
        canvas.channelId &&
        (await db.channelParticipant.findFirst({
          where: { channelId: canvas.channelId, userId, role: ChannelRole.ADMIN },
          select: { id: true },
        }))
      );

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
      ).map((mapping) => mapping.userGroupId);
      const groupParticipant = groupIds.length
        ? await db.canvasParticipant.findFirst({
            where: {
              canvasId: canvas.id,
              userGroupId: { in: groupIds },
            },
            select: { role: true },
          })
        : null;

      const channelParticipant = await this.getChannelSharedRole(
        canvas.id,
        userId,
        currentUserContext
      );

      const hasPublicVisibilityAccess = await this.hasPublicVisibilityAccess(
        canvas,
        userId,
        currentUserContext
      );

      const entityRole = this.strongerRole(
        groupParticipant as Parameters<typeof this.strongerRole>[0],
        channelParticipant
      );
      const effectiveRole = isSdlcBaselineChannelAdmin
        ? CanvasRole.EDITOR
        : (participant?.role ?? entityRole?.role);
      const hasOwnerRole = effectiveRole === CanvasRole.OWNER;
      const hasEditorRole = effectiveRole === CanvasRole.EDITOR;
      const hasViewerRole = effectiveRole === CanvasRole.VIEWER;
      const hasGuestContainerAccess = await this.hasGuestContainerAccess(
        canvas,
        userId,
        currentUserContext
      );

      const canEdit = isCreator || hasOwnerRole || hasEditorRole || isSdlcBaselineChannelAdmin;

      const canView =
        canEdit || hasViewerRole || hasPublicVisibilityAccess || hasGuestContainerAccess;

      const hasAccess = canView;

      logger.debug(`[CanvasAuth] Access check for canvas ${canvas.id}:`, {
        userId,
        isCreator,
        participantRole: effectiveRole,
        hasPublicVisibilityAccess,
        canEdit,
        canView,
      });

      return {
        hasAccess,
        canEdit,
        canView,
        role: effectiveRole as CanvasRole,
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

  async requireEditAccess(canvasIdOrAccessId: string, userId: string): Promise<void> {
    const auth = await this.checkCanvasAccess(canvasIdOrAccessId, userId);

    if (!auth.hasAccess) {
      throw new Error('Canvas not found');
    }

    if (!auth.canEdit) {
      throw new Error('Edit permission denied');
    }
  }

  async requireViewAccess(canvasIdOrAccessId: string, userId: string): Promise<void> {
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
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      const {
        folderId,
        projectId: resolvedProjectId,
        channelId: resolvedChannelId,
      } = await resolveCanvasHierarchy({
        folderId: options?.folderId,
        projectId: options?.projectId,
        channelId: options?.channelId,
        loadFolder: (folderId) =>
          db.canvasFolder.findUnique({
            where: { id: folderId },
            select: { projectId: true, channelId: true },
          }),
        loadChannel: (channelId) =>
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

      const creator = await db.user.findUnique({
        where: { id: userId },
        select: { workspaceId: true },
      });
      if (!creator?.workspaceId) {
        throw new Error(`Could not find workspaceId for user ${userId}`);
      }
      const workspaceId = creator.workspaceId;

      await db.$transaction([
        db.canvas.create({
          data: {
            id: canvasId,
            createdBy: userId,
            workspaceId,
            visibility: CanvasVisibility.PRIVATE,
            title: options?.title || 'Untitled Canvas',
            content: [],
            isCollaborative: true,
            ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
            ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
            ...(folderId ? { folderId } : {}),
            ...(options?.metadata ? { metadata: options.metadata as Prisma.InputJsonValue } : {}),
          },
        }),
        db.canvasParticipant.upsert({
          where: { canvasId_userId: { canvasId, userId } },
          create: {
            canvasId,
            userId,
            workspaceId,
            role: CanvasRole.OWNER,
          },
          update: {
            workspaceId,
            role: CanvasRole.OWNER,
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
        logger.error(
          `[CanvasAuthService] Failed to queue Vespa job for canvas ${canvasId}:`,
          vespaError
        );
      }
    } catch (error) {
      logger.error('Failed to auto-create canvas', { canvasId, userId, error });
      throw error;
    }
  }

  async syncNotesCanvasTitle(callDbId: string, callTitle: string): Promise<void> {
    const call = await repositories.calls.findById(callDbId);
    const notesCanvasId = (call?.metadata as Record<string, unknown> | null)?.notesCanvasId;
    if (typeof notesCanvasId !== 'string' || !notesCanvasId) {
      return;
    }

    await db.canvas.update({
      where: { id: notesCanvasId },
      data: { title: `Notes: ${callTitle}` },
    });
  }

  /**
   * Mirrors syncNotesCanvasTitle for the Detailed Summary canvas. Needed
   * because summary generation reads Call.title concurrently with AI title
   * generation (a race), so the summary canvas frequently gets created with
   * a timestamp-fallback title before the real one is known — this corrects
   * it once the title is actually saved.
   */
  async syncDetailedSummaryCanvasTitle(callDbId: string, callTitle: string): Promise<void> {
    const call = await repositories.calls.findById(callDbId);
    const detailedSummaryCanvasId = (call?.metadata as Record<string, unknown> | null)
      ?.detailedSummaryCanvasId;
    if (typeof detailedSummaryCanvasId !== 'string' || !detailedSummaryCanvasId) {
      return;
    }

    await db.canvas.update({
      where: { id: detailedSummaryCanvasId },
      data: { title: `Summary: ${callTitle}` },
    });
  }
}

export const canvasAuthService = new CanvasAuthService();
