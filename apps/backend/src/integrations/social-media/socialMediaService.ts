import {
  type ExternalSource,
  Prisma,
  type Email,
} from '@prisma/client';
import { ActivityType, EmailType, ExternalEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { externalSourceCore } from '@/integrations/core/core';
import { InteractionReplyValidationError } from '@/integrations/core/baseInteractionReplySender';
import { ExternalSourcePlatform, type IngestionOptions } from '@/integrations/core/types';
import { logger } from '@/utils/logger';
import { acquireLock, releaseLock } from '@/utils/distributedLock';

const TAG = '[SocialMediaDesk]';
const SYNC_LOCK_TTL_SECONDS = 30 * 60;

type SocialMediaSource = ExternalSource & {
  channelId: string;
  workspaceId: string;
  ownerUserId: string;
};

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

class SocialMediaService {
  private async getSourceContext(sourceId: string): Promise<SocialMediaSource> {
    const source = await db.externalSource.findUnique({ where: { id: sourceId } });
    if (!source || !source.isActive || !source.channelId || !source.ownerUserId) {
      throw new Error('Active social media source is not configured');
    }
    return source as SocialMediaSource;
  }

  async syncSource(
    sourceId: string,
    options?: IngestionOptions,
  ): Promise<{ synced: number }> {
    const lock = await acquireLock(`lock:social-media-sync:${sourceId}`, {
      ttlSeconds: SYNC_LOCK_TTL_SECONDS,
    });
    if (!lock) {
      logger.debug(`${TAG} Source sync skipped because another worker owns the lock`, {
        sourceId,
      });
      return { synced: 0 };
    }

    try {
      const syncStartedAt = new Date();
      const source = await this.getSourceContext(sourceId);
      const adapter = adapterRegistry.getAdapter(source.sourceType);
      const results = await externalSourceCore.ingest(
        adapter,
        source.name,
        undefined,
        source,
        options,
      );
      const synced = results.filter((result) => result.action === 'created').length;
      if (source.sourceType === ExternalSourcePlatform.GOOGLE_PLAY) {
        await db.externalSource.update({
          where: { id: source.id },
          data: { lastSyncCursor: syncStartedAt.toISOString() },
        });
      }
      logger.info(`${TAG} Source synchronized`, {
        sourceId,
        sourceType: source.sourceType,
        interactionCount: results.length,
        newInteractionCount: synced,
      });
      return { synced };
    } finally {
      await releaseLock(lock);
    }
  }

  async reply(params: {
    conversationId: string;
    workspaceId: string;
    userId: string;
    body: string;
  }): Promise<Email> {
    const body = plainText(params.body);
    if (!body) throw new InteractionReplyValidationError('Reply body is required');

    const review = await db.email.findFirst({
      where: {
        conversationId: params.conversationId,
        workspaceId: params.workspaceId,
        type: EmailType.DEFAULT,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!review) throw new Error('Review conversation not found');
    const externalMessage = await db.externalMessage.findFirst({
      where: {
        workspaceId: params.workspaceId,
        entityType: ExternalEntityType.EMAIL,
        messageId: review.id,
      },
    });
    if (!externalMessage) throw new Error('Review conversation not found');
    const source = await this.getSourceContext(externalMessage.externalSourceId);
    if (source.workspaceId !== params.workspaceId) throw new Error('Review conversation not found');
    const adapter = adapterRegistry.getAdapter(source.sourceType);
    if (!adapter.sendInteractionReply) {
      throw new Error(`Replies are not supported for source ${source.sourceType}`);
    }
    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: { name: true },
    });
    const normalizedReply = await adapter.sendInteractionReply({
      source,
      externalThreadId: review.externalThreadId,
      subject: review.subject,
      body,
      userId: params.userId,
      authorName: user?.name ?? source.displayName,
    });
    const [result] = await externalSourceCore.sync(
      adapter,
      source.name,
      normalizedReply,
      source,
    );
    if (!result?.entityId) throw new Error('Social media reply was not persisted');
    const interaction = await db.email.findUnique({ where: { id: result.entityId } });
    if (!interaction) throw new Error('Social media reply was not persisted');
    const occurredAt = normalizedReply.metadata.timestamp;

    const ticket = await db.ticket.findFirst({
      where: { conversationId: params.conversationId, workspaceId: params.workspaceId },
      select: { id: true },
    });
    if (ticket) {
      await db.$transaction([
        db.ticket.updateMany({
          where: { id: ticket.id, firstRespondedAt: null },
          data: { firstRespondedAt: occurredAt },
        }),
        db.ticketActivity.create({
          data: {
            ticketId: ticket.id,
            workspaceId: params.workspaceId,
            channelId: source.channelId,
            updatedBy: params.userId,
            timestamp: occurredAt,
            activityType: ActivityType.EMAIL_SENT,
            value: {
              medium: 'SOCIAL_MEDIA',
              provider: source.sourceType,
              interactionId: interaction.id,
            } satisfies Prisma.InputJsonValue,
          },
        }),
      ]);
    }
    return interaction;
  }
}

export const socialMediaService = new SocialMediaService();
