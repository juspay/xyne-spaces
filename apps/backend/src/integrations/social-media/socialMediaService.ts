import { ActivityType, EmailType, ExternalEntityType } from '@xyne/shared';
import { Prisma } from '@prisma/client';
import type { Email, ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { externalSourceCore } from '@/integrations/core/core';
import { InteractionReplyValidationError } from '@/integrations/core/baseInteractionReplySender';

export { InteractionReplyValidationError };

const TAG = '[SocialMediaService]';

type SocialMediaSource = ExternalSource & {
  channelId: string;
  boardId: string | null;
  ownerUserId: string;
};

class SocialMediaService {
  private async getSourceContext(sourceId: string): Promise<SocialMediaSource> {
    const source = await db.externalSource.findUnique({
      where: { id: sourceId },
    });
    if (
      !source?.isActive ||
      !source.channelId ||
      !source.ownerUserId
    ) {
      throw new Error('Active social media source is not configured');
    }
    return source as SocialMediaSource;
  }

  async reply(params: {
    conversationId: string;
    workspaceId: string;
    userId: string;
    body: string;
  }): Promise<Email> {
    const body = params.body.trim();
    if (!body) throw new InteractionReplyValidationError('Reply body is required');

    const inboundEmail = await db.email.findFirst({
      where: {
        conversationId: params.conversationId,
        workspaceId: params.workspaceId,
        type: EmailType.DEFAULT,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!inboundEmail) throw new Error('Conversation not found');

    const externalMessage = await db.externalMessage.findFirst({
      where: {
        workspaceId: params.workspaceId,
        entityType: ExternalEntityType.EMAIL,
        messageId: inboundEmail.id,
      },
    });
    if (!externalMessage) throw new Error('Conversation not found');

    const source = await this.getSourceContext(externalMessage.externalSourceId);
    if (source.workspaceId !== params.workspaceId) throw new Error('Conversation not found');

    const adapter = adapterRegistry.getAdapter(source.sourceType);
    if (!adapter.sendInteractionReply) {
      throw new Error(`Replies are not supported for source type: ${source.sourceType}`);
    }

    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: { name: true },
    });

    const normalizedReply = await adapter.sendInteractionReply({
      source,
      externalThreadId: inboundEmail.externalThreadId,
      subject: inboundEmail.subject,
      body,
      userId: params.userId,
      authorName: user?.name ?? source.displayName,
    });

    const [result] = await externalSourceCore.sync(adapter, source.name, normalizedReply, source);
    if (!result?.entityId) throw new Error('Social media reply was not persisted');

    const interaction = await db.email.findUnique({ where: { id: result.entityId } });
    if (!interaction) throw new Error('Social media reply was not persisted');

    const ticket = await db.ticket.findFirst({
      where: { conversationId: params.conversationId, workspaceId: params.workspaceId },
      select: { id: true },
    });
    if (ticket) {
      const occurredAt = normalizedReply.metadata.timestamp;
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

    logger.info(`${TAG} Reply sent`, {
      conversationId: params.conversationId,
      sourceType: source.sourceType,
      interactionId: interaction.id,
    });

    return interaction;
  }
}

export const socialMediaService = new SocialMediaService();
