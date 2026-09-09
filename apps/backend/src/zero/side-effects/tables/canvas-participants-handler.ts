import { BaseSideEffectHandler } from '../base-handler';
import { ActivityClassification } from '@xyne/shared';
import type { SideEffectJobConfig } from '../types';
import type { CanvasParticipantPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { activityService } from '@/services/activity/activityService';
import { logger } from '@/utils/logger';
import { enqueueCanvasPermissionRefresh } from '@/services/canvasPermissionSync';

export class CanvasParticipantsSideEffectHandler extends BaseSideEffectHandler {
  private async resolveRecipientUserIds(participant: {
    userId: string | null;
    userGroupId: string | null;
    channelId: string | null;
  }): Promise<string[]> {
    if (participant.userId) return [participant.userId];

    if (participant.userGroupId) {
      const userGroupId = participant.userGroupId;
      const mappings = await db.userGroupMapping.findMany({
        where: { userGroupId },
        select: { userId: true },
      });
      return Array.from(new Set(mappings.map(m => m.userId).filter(Boolean)));
    }

    if (participant.channelId) {
      const channelParticipants = await db.channelParticipant.findMany({
        where: { channelId: participant.channelId },
        select: { userId: true },
      });
      return Array.from(new Set(channelParticipants.map(p => p.userId).filter(Boolean)));
    }

    return [];
  }

  private async fetchParticipantSnapshot(participantId: string): Promise<{
    canvasId: string;
    userId: string | null;
    role: string;
    userGroupId: string | null;
    channelId: string | null;
  } | null> {
    const participant = await db.canvasParticipant.findUnique({
      where: { id: participantId },
    });
    if (!participant) return null;

    return {
      canvasId: participant.canvasId,
      userId: participant.userId,
      role: participant.role,
      userGroupId: participant.userGroupId,
      channelId: participant.channelId,
    };
  }

  private async notifyAndCreateActivities(params: {
    recipientUserIds: string[];
    canvasId: string;
    role: string;
    actorAction: 'canvas_shared' | 'canvas_role_changed' | 'canvas_access_revoked';
    actionSourceId: string;
    channelId: string | null;
  }): Promise<void> {
    const { recipientUserIds, canvasId, role, actorAction, actionSourceId, channelId } = params;
    const filteredRecipientIds = recipientUserIds.filter(id => id !== this.ctx.userID);
    if (filteredRecipientIds.length === 0) return;

    const actor = await db.user.findUnique({
      where: { id: this.ctx.userID },
      select: { name: true, displayName: true, id: true },
    });
    const actorName = actor?.displayName || actor?.name || 'Someone';
    const actorId = actor?.id || 'unknown';

    const canvas = await db.canvas.findUnique({
      where: { id: canvasId },
      select: { title: true, channelId: true },
    });
    const canvasTitle = canvas?.title || 'Untitled Canvas';
    const effectiveChannelId = channelId ?? canvas?.channelId ?? null;

    await notificationService.createCanvasSharedNotifications(
      filteredRecipientIds,
      canvasId,
      canvasTitle,
      actorId,
      actorName,
      role,
      actorAction,
      this.ctx.workspaceId,
    );

    await activityService.createActivities(
      filteredRecipientIds.map(userId => ({
        userId,
        actorAction,
        actionSource: 'canvas_participants',
        actionSourceId,
        canvasId,
        actorId: this.ctx.userID,
        classification: ActivityClassification.ACTIONABLE,
        ...(effectiveChannelId ? { channelId: effectiveChannelId } : {}),
      })),
    );
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[CanvasParticipantsHandler] onInsert called for entity: ${job.entityId}`);

    try {
      const participant = await this.fetchParticipantSnapshot(job.entityId);

      if (!participant) {
        logger.warn(`[CanvasParticipantsHandler] Participant not found for ID: ${job.entityId}`);
        return;
      }

      const { canvasId, userId, role, channelId } = participant;

      // Share added → refresh the canvas's denormalized ACL (direct/channel/group members).
      await enqueueCanvasPermissionRefresh(canvasId).catch(err =>
        logger.warn(`[CanvasParticipantsHandler] ACL refresh enqueue failed for canvas ${canvasId}: ${err}`));

      if (userId && this.ctx.userID === userId) {
        logger.info(`[CanvasParticipantsHandler] User ${userId} added themselves to canvas ${canvasId} - skipping notification`);
        return;
      }

      const recipientUserIds = await this.resolveRecipientUserIds(participant);
      await this.notifyAndCreateActivities({
        recipientUserIds,
        canvasId,
        role,
        actorAction: 'canvas_shared',
        actionSourceId: job.entityId,
        channelId,
      });

    } catch (error) {
      logger.error(`[CanvasParticipantsHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[CanvasParticipantsHandler] onUpdate called for entity: ${job.entityId}`);

    try {
      const participant = await this.fetchParticipantSnapshot(job.entityId);

      if (!participant) {
        logger.warn(`[CanvasParticipantsHandler] Participant not found for ID: ${job.entityId}`);
        return;
      }

      const { canvasId, userId, role, channelId } = participant;

      if (userId && this.ctx.userID === userId) {
        logger.info(`[CanvasParticipantsHandler] User ${userId} changed their own role on canvas ${canvasId} - skipping notification`);
        return;
      }

      const recipientUserIds = await this.resolveRecipientUserIds(participant);
      await this.notifyAndCreateActivities({
        recipientUserIds,
        canvasId,
        role,
        actorAction: 'canvas_role_changed',
        actionSourceId: job.entityId,
        channelId,
      });

    } catch (error) {
      logger.error(`[CanvasParticipantsHandler] Failed to process onUpdate for entity ${job.entityId}:`, error);
    }
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[CanvasParticipantsHandler] onDelete called for entity: ${job.entityId}`);

    try {
      const previousValue = job.previousValue as CanvasParticipantPreviousValue | undefined;

      if (!previousValue) {
        logger.warn(`[CanvasParticipantsHandler] No previousValue for deleted participant ID: ${job.entityId}`);
        return;
      }

      const { canvasId, userId, role, userGroupId, channelId } = previousValue;

      // Share revoked → refresh the canvas's denormalized ACL so the removed grant drops out.
      await enqueueCanvasPermissionRefresh(canvasId).catch(err =>
        logger.warn(`[CanvasParticipantsHandler] ACL refresh enqueue failed for canvas ${canvasId}: ${err}`));

      if (userId && this.ctx.userID === userId) {
        logger.info(`[CanvasParticipantsHandler] User ${userId} removed themselves from canvas ${canvasId} - skipping notification`);
        return;
      }

      const recipientUserIds = await this.resolveRecipientUserIds({
        userId: userId ?? null,
        userGroupId: userGroupId ?? null,
        channelId: channelId ?? null,
      });
      await this.notifyAndCreateActivities({
        recipientUserIds,
        canvasId,
        role,
        actorAction: 'canvas_access_revoked',
        actionSourceId: job.entityId,
        channelId: channelId ?? null,
      });

    } catch (error) {
      logger.error(`[CanvasParticipantsHandler] Failed to process onDelete for entity ${job.entityId}:`, error);
    }
  }
}
