import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, DelayedMessagePreviousValue } from '../types';
import { db } from '@/database/client';
import { delayedMessageQueue } from '@/queues/delayedMessageQueue';
import { logger } from '@/utils/logger';
import { DelayedMessageStatus } from '@prisma/client';
import { deliverDelayedMessage } from '@/zero/utils/delayedMessageDelivery';
import { cleanupDelayedMessageAttachmentsPrisma } from '@/zero/utils/attachmentEntityCleanup';

export class DelayedMessagesSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: delayedMessageId } = job;

    const record = await db.delayedMessage.findUnique({
      where: { id: delayedMessageId },
      select: {
        id: true,
        channelId: true,
        conversationId: true,
        senderId: true,
        content: true,
        hasAttachment: true,
        scheduledFor: true,
        status: true,
      },
    });

    if (!record || record.status !== 'PENDING') {
      return;
    }

    await delayedMessageQueue.scheduleMessage({
      delayedMessageId: record.id,
      channelId: record.channelId,
      conversationId: record.conversationId,
      senderId: record.senderId,
      content: record.content,
      hasAttachment: record.hasAttachment,
      scheduledFor: record.scheduledFor,
    });

    logger.info('[DELAYED-MSG-SIDE-EFFECT] Enqueued Bull job', {
      delayedMessageId,
    });
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: delayedMessageId } = job;
    const previousValue = job.previousValue as DelayedMessagePreviousValue | undefined;

    const record = await db.delayedMessage.findUnique({
      where: { id: delayedMessageId },
      select: {
        id: true,
        channelId: true,
        conversationId: true,
        senderId: true,
        content: true,
        hasAttachment: true,
        scheduledFor: true,
        status: true,
      },
    });

    if (!record) {
      return;
    }

    const scheduledForChanged = previousValue
      ? previousValue.scheduledFor !== record.scheduledFor
      : false;
    const statusChanged = previousValue ? previousValue.status !== record.status : false;

    if (scheduledForChanged && record.status === DelayedMessageStatus.PENDING) {
      if (record.scheduledFor <= Date.now()) {
        logger.error('[DELAYED-MSG-SIDE-EFFECT] Cannot reschedule to a past time', {
          delayedMessageId,
          scheduledFor: record.scheduledFor,
        });
        return;
      }

      try {
        await delayedMessageQueue.cancelMessage(delayedMessageId);
      } catch (error) {
        logger.warn('[DELAYED-MSG-SIDE-EFFECT] Failed to cancel old Bull job on reschedule', {
          delayedMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        await delayedMessageQueue.scheduleMessage({
          delayedMessageId: record.id,
          channelId: record.channelId,
          conversationId: record.conversationId,
          senderId: record.senderId,
          content: record.content,
          hasAttachment: record.hasAttachment,
          scheduledFor: record.scheduledFor,
        });

        logger.info('[DELAYED-MSG-SIDE-EFFECT] Rescheduled Bull job', {
          delayedMessageId,
          newScheduledFor: record.scheduledFor,
        });
      } catch (error) {
        logger.error('[DELAYED-MSG-SIDE-EFFECT] Failed to create new Bull job on reschedule', {
          delayedMessageId,
          error: error,
        });
      }

      return;
    }

    if (
      (!statusChanged && record.status === DelayedMessageStatus.SENDING) ||
      (previousValue?.status === DelayedMessageStatus.PENDING &&
        record.status === DelayedMessageStatus.SENDING)
    ) {
      try {
        await delayedMessageQueue.cancelMessage(delayedMessageId);
      } catch (error) {
        logger.warn('[DELAYED-MSG-SIDE-EFFECT] Failed to cancel Bull job on sendNow', {
          delayedMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const channel = await db.channel.findUnique({ where: { id: record.channelId } });
      if (!channel || channel.isArchived) {
        const failureReason = 'Channel deleted';
        await db.delayedMessage.update({
          where: { id: record.id },
          data: { status: DelayedMessageStatus.FAILED, failureReason },
        });
        await cleanupDelayedMessageAttachmentsPrisma(record.id);
        logger.warn('[DELAYED-MSG-SIDE-EFFECT] sendNow failed: channel not found or archived', {
          delayedMessageId,
          channelId: record.channelId,
        });
        return;
      }

      const participant = await db.channelParticipant.findFirst({
        where: { channelId: record.channelId, userId: record.senderId },
      });
      if (!participant) {
        const failureReason = 'Sender no longer has access';
        await db.delayedMessage.update({
          where: { id: record.id },
          data: { status: DelayedMessageStatus.FAILED, failureReason },
        });
        await cleanupDelayedMessageAttachmentsPrisma(record.id);
        logger.warn('[DELAYED-MSG-SIDE-EFFECT] sendNow failed: sender no longer participant', {
          delayedMessageId,
          senderId: record.senderId,
          channelId: record.channelId,
        });
        return;
      }

      try {
        const result = await deliverDelayedMessage({
          delayedMessageId: record.id,
          channelId: record.channelId,
          conversationId: record.conversationId,
          senderId: record.senderId,
          content: record.content,
          hasAttachment: record.hasAttachment,
        });

        if (!result.success) {
          const failureReason = result.error || 'Delivery failed';
          await db.delayedMessage.update({
            where: { id: record.id },
            data: { status: DelayedMessageStatus.FAILED, failureReason },
          });
          await cleanupDelayedMessageAttachmentsPrisma(record.id);
          logger.error('[DELAYED-MSG-SIDE-EFFECT] sendNow delivery failed', {
            delayedMessageId,
            error: failureReason,
          });
          return;
        }

        logger.info('[DELAYED-MSG-SIDE-EFFECT] sendNow delivered message', {
          delayedMessageId,
        });
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : 'Delivery failed';
        await db.delayedMessage.update({
          where: { id: record.id },
          data: { status: DelayedMessageStatus.FAILED, failureReason },
        });
        await cleanupDelayedMessageAttachmentsPrisma(record.id);
        logger.error('[DELAYED-MSG-SIDE-EFFECT] sendNow delivery failed', {
          delayedMessageId,
          error: failureReason,
        });
      }

      return;
    }

    if (
      previousValue?.status === DelayedMessageStatus.PENDING &&
      record.status === DelayedMessageStatus.CANCELLED
    ) {
      try {
        await delayedMessageQueue.cancelMessage(delayedMessageId);
      } catch (error) {
        logger.warn('[DELAYED-MSG-SIDE-EFFECT] Failed to cancel Bull job on cancel', {
          delayedMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info('[DELAYED-MSG-SIDE-EFFECT] Cancelled delayed message via status change', {
        delayedMessageId,
      });
      return;
    }

    if (!scheduledForChanged && !statusChanged) {
      logger.info('[DELAYED-MSG-SIDE-EFFECT] Content-only edit detected', {
        delayedMessageId,
      });
      return;
    }
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { entityId: delayedMessageId } = job;
    const previousValue = job.previousValue as DelayedMessagePreviousValue | undefined;

    const record = await db.delayedMessage.findUnique({
      where: { id: delayedMessageId },
      select: {
        id: true,
        senderId: true,
        channelId: true,
        status: true,
      },
    });

    const wasPending = record?.status === 'PENDING' || previousValue?.status === 'PENDING';
    const isConvertToDraft = !record && !!previousValue;

    if (wasPending) {
      try {
        await delayedMessageQueue.cancelMessage(delayedMessageId);
      } catch (error) {
        logger.warn('[DELAYED-MSG-SIDE-EFFECT] Failed to cancel Bull job on delete', {
          delayedMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('[DELAYED-MSG-SIDE-EFFECT] Deleted delayed message', {
      delayedMessageId,
      isConvertToDraft,
    });
  }
}
