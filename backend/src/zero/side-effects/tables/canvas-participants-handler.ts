import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import type { CanvasParticipantPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { activityService } from '@/services/activity/activityService';
import { ActivityClassification } from '@prisma/client';
import { logger } from '@/utils/logger';

export class CanvasParticipantsSideEffectHandler extends BaseSideEffectHandler {
  private async resolveRecipientUserIds(participant: {
    userId: string | null;
    userGroupId: string | null;
    channelId: string | null;
  }): Promise<string[]> {
    if (participant.userId) return [participant.userId];

    if (participant.userGroupId) {
      const mappings = await db.userGroupMapping.findMany({
        where: { userGroupId: participant.userGroupId },
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
  }): Promise<void> {
    const { recipientUserIds, canvasId, role, actorAction, actionSourceId } = params;
    const filteredRecipientIds = recipientUserIds.filter(id => id !== this.ctx.userID);
    if (filteredRecipientIds.length === 0) return;

    const actor = await db.user.findUnique({
      where: { id: this.ctx.userID },
      select: { name: true, id: true },
    });
    const actorName = actor?.name || 'Someone';
    const actorId = actor?.id || 'unknown';

    const canvas = await db.canvas.findUnique({
      where: { id: canvasId },
      select: { title: true },
    });
    const canvasTitle = canvas?.title || 'Untitled Canvas';

    await notificationService.createCanvasSharedNotifications(
      filteredRecipientIds,
      canvasId,
      canvasTitle,
      actorId,
      actorName,
      role,
      actorAction,
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

      const { canvasId, userId, role } = participant;

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

      const { canvasId, userId, role } = participant;

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
      });

    } catch (error) {
      logger.error(`[CanvasParticipantsHandler] Failed to process onDelete for entity ${job.entityId}:`, error);
    }
  }
}
