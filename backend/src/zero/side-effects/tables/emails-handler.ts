import { EmailType, UserType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { handleEventSubscriptionsForUsers } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, BaseAppEvent, EmailEventPayload } from '@/apps/types';

export class EmailsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    try {
      const email = await db.email.findUnique({
        where: { id: job.entityId },
      });
      if (!email) return;

      const channelParticipants = await db.channelParticipant.findMany({
        where: { channelId: email.channelId },
        select: { userId: true },
      });
      const participantUserIds = channelParticipants.map(p => p.userId);
      if (participantUserIds.length === 0) return;

      const appUsers = await db.user.findMany({
        where: { id: { in: participantUserIds }, userType: UserType.APP },
        select: { id: true },
      });
      const appUserIds = appUsers.map(u => u.id);
      if (appUserIds.length === 0) return;

      const ticket = await db.ticket.findFirst({
        where: { conversationId: email.conversationId },
        select: { id: true },
      });

      let parentId = email.id;
      if (email.type !== EmailType.DEFAULT) {
        const rootEmail = await db.email.findFirst({
          where: { externalThreadId: email.externalThreadId, type: EmailType.DEFAULT },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (rootEmail) parentId = rootEmail.id;
      }

      const payload: EmailEventPayload = {
        conversationId: email.conversationId,
        subject: email.subject,
        content: email.body,
        to: email.to,
        from: email.from,
        recipients: [...email.cc, ...email.bcc],
        parentId,
        id: email.id,
        ticketId: ticket?.id ?? '',
      };

      const event: BaseAppEvent = {
        eventType: AppEventType.EMAIL,
        payload,
        timestamp: new Date().toISOString(),
      };

      await handleEventSubscriptionsForUsers(event, appUserIds);
    } catch (error) {
      logger.error('[EmailsSideEffectHandler] Failed to dispatch EMAIL event', {
        emailId: job.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
