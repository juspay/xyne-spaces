import { transaction } from '@/bypassAcl/base';
import { db } from '@/database/client';
import {
  AttachmentEntityType,
  ConversationParticipation,
  MessageType,
  buildInitialMessageMd,
  buildPollMessageSummary,
  buildPollRows,
  normalizePollDraft,
  normalizePollSchedule,
} from '@xyne/shared';
import type { Prisma } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';

const SCHEDULED_POLL_NAMESPACE = '5084fb70-81ed-5e24-8e61-9d5567ca2f29';

export interface ScheduledPollDeliveryInput {
  delayedMessageId: string;
  expectedChannelId: string;
  expectedSenderId: string;
  timestamp: number;
}

export interface ScheduledPollDeliveryResult {
  conversationId: string;
  messageId: string;
  /** Set only when this call created the poll; the caller schedules its close/reminder jobs. */
  createdPoll: { id: string; closesAt: Date | null; remindAt: Date | null } | null;
}

export function scheduledPollIds(delayedMessageId: string): {
  conversationId: string;
  messageId: string;
} {
  return {
    conversationId: uuidv5(
      `scheduled-poll:conversation:${delayedMessageId}`,
      SCHEDULED_POLL_NAMESPACE
    ),
    messageId: uuidv5(`scheduled-poll:message:${delayedMessageId}`, SCHEDULED_POLL_NAMESPACE),
  };
}

/** `delayed_messages.pollDraft` is always written by `delayedMessages.create` as `{ poll, schedule }`. */
function parseScheduledPollPayload(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('poll' in value)) {
    throw new Error('Scheduled poll payload is missing');
  }
  return {
    poll: normalizePollDraft(value.poll),
    schedule: normalizePollSchedule(value.schedule ?? {}),
  };
}

const toDate = (epoch: number | null): Date | null => (epoch === null ? null : new Date(epoch));

export function deliverScheduledPollTx(
  input: ScheduledPollDeliveryInput
): Promise<ScheduledPollDeliveryResult> {
  const ids = scheduledPollIds(input.delayedMessageId);

  return transaction(
    [
      'DelayedMessage',
      'User',
      'Conversation',
      'ConversationParticipant',
      'Message',
      'MessageAttachment',
      'Poll',
      'PollQuestion',
      'PollQuestionResult',
    ],
    'atomically deliver a scheduled poll and finalize its delayed message',
    db,
    async (tx: Prisma.TransactionClient) => {
      const delayed = await tx.delayedMessage.findUnique({
        where: { id: input.delayedMessageId },
        select: {
          id: true,
          workspaceId: true,
          channelId: true,
          conversationId: true,
          senderId: true,
          pollDraft: true,
          status: true,
        },
      });

      if (!delayed) throw new Error('Scheduled poll not found');
      if (delayed.channelId !== input.expectedChannelId || delayed.senderId !== input.expectedSenderId) {
        throw new Error('Not authorized to deliver this scheduled poll');
      }
      if (delayed.conversationId) throw new Error('Scheduled polls must create a top-level conversation');
      if (delayed.status !== 'SENDING' && delayed.status !== 'SENT') {
        throw new Error(`Scheduled poll is not deliverable from status ${delayed.status}`);
      }

      const existingMessage = await tx.message.findUnique({
        where: { messageId: ids.messageId },
        select: { messageId: true },
      });
      if (existingMessage) {
        if (delayed.status !== 'SENT') throw new Error('Scheduled poll delivery is in an inconsistent state');
        return { ...ids, createdPoll: null };
      }
      if (delayed.status === 'SENT') {
        throw new Error('Scheduled poll is marked sent without its deterministic message');
      }

      // Channel archive and membership checks happen in processJobTx (worker) and the
      // send-now side effect before delivery reaches here.
      const sender = await tx.user.findUnique({
        where: { id: delayed.senderId },
        select: { id: true, workspaceId: true },
      });
      if (!sender || sender.workspaceId !== delayed.workspaceId) {
        throw new Error('Scheduled poll sender is unavailable');
      }

      const { poll: draft, schedule } = parseScheduledPollPayload(delayed.pollDraft);
      const rows = buildPollRows({
        draft,
        messageId: ids.messageId,
        workspaceId: delayed.workspaceId,
        userId: delayed.senderId,
        timestamp: input.timestamp,
        schedule,
      });
      const content = buildPollMessageSummary(draft);
      const createdAt = new Date(input.timestamp);
      const messageMetadata = { messageSubtype: 'poll', pollId: draft.pollId };
      const initialMessageMd = buildInitialMessageMd({
        messageId: ids.messageId,
        conversationId: ids.conversationId,
        workspaceId: delayed.workspaceId,
        senderId: delayed.senderId,
        content,
        msgType: MessageType.USER,
        hasAttachment: false,
        createdAt: input.timestamp,
        metadata: messageMetadata,
        isSent: true,
        nudgeCount: 0,
      });

      await tx.conversation.create({
        data: {
          conversationId: ids.conversationId,
          channelId: delayed.channelId,
          createdBy: delayed.senderId,
          initialMessageId: ids.messageId,
          workspaceId: delayed.workspaceId,
          lastActivityAt: createdAt,
          initial_message_md: initialMessageMd,
          createdAt,
        },
      });
      await tx.message.create({
        data: {
          messageId: ids.messageId,
          conversationId: ids.conversationId,
          senderId: delayed.senderId,
          workspaceId: delayed.workspaceId,
          content,
          msgType: MessageType.USER,
          hasAttachment: false,
          metadata: messageMetadata,
          createdAt,
          isSent: true,
        },
      });
      await tx.conversationParticipant.create({
        data: {
          workspaceId: delayed.workspaceId,
          conversationId: ids.conversationId,
          userId: delayed.senderId,
          channelId: delayed.channelId,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: createdAt,
        },
      });

      const poll = {
        ...rows.poll,
        closesAt: toDate(rows.poll.closesAt),
        remindAt: toDate(rows.poll.remindAt),
        createdAt,
      };
      await tx.poll.create({ data: poll });
      await tx.pollQuestion.createMany({
        data: rows.questions.map(question => ({
          ...question,
          options: question.options.map(option => ({ ...option })),
          createdAt,
        })),
      });
      await tx.pollQuestionResult.createMany({
        data: rows.results.map(result => ({ ...result, updatedAt: createdAt })),
      });

      await tx.messageAttachment.deleteMany({
        where: { entityId: delayed.id, entityType: AttachmentEntityType.DELAYED_MESSAGE },
      });
      await tx.delayedMessage.update({
        where: { id: delayed.id },
        data: { status: 'SENT', sentAt: createdAt, failureReason: null },
      });

      return {
        ...ids,
        createdPoll: { id: poll.id, closesAt: poll.closesAt, remindAt: poll.remindAt },
      };
    },
  );
}
