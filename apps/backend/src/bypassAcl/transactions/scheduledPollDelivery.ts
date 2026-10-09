import { transaction, type TxCapableClient } from '@/bypassAcl/base';
import {
  AttachmentEntityType,
  ConversationParticipation,
  MessageType,
  buildInitialMessageMd,
  normalizePollChoice,
  normalizePollDraft,
  normalizePollSchedule,
  type PollSchedule,
} from '@xyne/shared';
import { v5 as uuidv5 } from 'uuid';

const SCHEDULED_POLL_NAMESPACE = '5084fb70-81ed-5e24-8e61-9d5567ca2f29';

export type ScheduledPollDeliveryClient = TxCapableClient;

export interface ScheduledPollDeliveryInput {
  delayedMessageId: string;
  expectedChannelId: string;
  expectedSenderId: string;
  timestamp: number;
  client: ScheduledPollDeliveryClient;
}

export interface ScheduledPollDeliveryResult {
  conversationId: string;
  messageId: string;
  created: boolean;
}

type ScheduledPollTransactionClient = {
  delayedMessage: {
    findUnique(args: unknown): Promise<{
      id: string;
      workspaceId: string;
      channelId: string;
      conversationId: string | null;
      senderId: string;
      content: string;
      pollDraft: unknown;
      status: string;
    } | null>;
    update(args: unknown): Promise<unknown>;
  };
  channel: {
    findUnique(args: unknown): Promise<{
      id: string;
      workspaceId: string;
      archivedAt: Date | null;
    } | null>;
  };
  user: {
    findUnique(args: unknown): Promise<{ id: string; workspaceId: string } | null>;
  };
  message: {
    findUnique(args: unknown): Promise<{ messageId: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
  conversation: { create(args: unknown): Promise<unknown> };
  conversationParticipant: { create(args: unknown): Promise<unknown> };
  poll: { create(args: unknown): Promise<unknown> };
  messageAttachment: { deleteMany(args: unknown): Promise<unknown> };
};

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

function normalizeScheduledPollPayload(value: unknown): {
  poll: ReturnType<typeof normalizePollDraft>;
  schedule: PollSchedule;
} {
  const envelope =
    value && typeof value === 'object' && 'poll' in value
      ? (value as { poll: unknown; schedule?: unknown })
      : { poll: value, schedule: {} };
  return {
    poll: normalizePollDraft(envelope.poll),
    schedule: normalizePollSchedule(envelope.schedule ?? {}),
  };
}

export function deliverScheduledPollTx(
  input: ScheduledPollDeliveryInput
): Promise<ScheduledPollDeliveryResult> {
  const ids = scheduledPollIds(input.delayedMessageId);

  return transaction(
    [
      'DelayedMessage',
      'Channel',
      'User',
      'Conversation',
      'ConversationParticipant',
      'Message',
      'MessageAttachment',
      'Poll',
      'PollQuestion',
      'PollOption',
      'PollQuestionResult',
      'PollJob',
    ],
    'atomically deliver a scheduled poll and finalize its delayed message',
    input.client,
    async prismaTx => {
      const tx = prismaTx as unknown as ScheduledPollTransactionClient;
      const delayed = await tx.delayedMessage.findUnique({
        where: { id: input.delayedMessageId },
        select: {
          id: true,
          workspaceId: true,
          channelId: true,
          conversationId: true,
          senderId: true,
          content: true,
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
        return { ...ids, created: false };
      }
      if (delayed.status === 'SENT') {
        throw new Error('Scheduled poll is marked sent without its deterministic message');
      }

      const [channel, sender] = await Promise.all([
        tx.channel.findUnique({
          where: { id: delayed.channelId },
          select: { id: true, workspaceId: true, archivedAt: true },
        }),
        tx.user.findUnique({
          where: { id: delayed.senderId },
          select: { id: true, workspaceId: true },
        }),
      ]);
      if (!channel || channel.archivedAt || channel.workspaceId !== delayed.workspaceId) {
        throw new Error('Scheduled poll channel is unavailable');
      }
      if (!sender || sender.workspaceId !== delayed.workspaceId) {
        throw new Error('Scheduled poll sender is unavailable');
      }

      const { poll, schedule } = normalizeScheduledPollPayload(delayed.pollDraft);
      const createdAt = new Date(input.timestamp);
      const messageMetadata = { messageSubtype: 'poll', pollId: poll.pollId };
      const initialMessageMd = buildInitialMessageMd({
        messageId: ids.messageId,
        conversationId: ids.conversationId,
        workspaceId: delayed.workspaceId,
        senderId: delayed.senderId,
        content: delayed.content,
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
          content: delayed.content,
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
      await tx.poll.create({
        data: {
          id: poll.pollId,
          workspaceId: delayed.workspaceId,
          messageId: ids.messageId,
          createdBy: delayed.senderId,
          allowAudienceChoices: poll.allowAudienceChoices,
          isAnonymous: poll.isAnonymous,
          resultVisibility: poll.resultVisibility,
          sortResultsByVotes: poll.sortResultsByVotes,
          createdAt,
          questions: {
            create: poll.questions.map((question, questionPosition) => ({
              id: question.id,
              workspaceId: delayed.workspaceId,
              question: question.question,
              position: questionPosition,
              responseType: question.responseType,
              createdAt,
              options: {
                create: question.options.map((option, optionPosition) => ({
                  id: option.id,
                  workspaceId: delayed.workspaceId,
                  text: option.text,
                  normalizedText: normalizePollChoice(option.text),
                  position: optionPosition,
                  createdBy: delayed.senderId,
                  createdAt,
                })),
              },
              result: {
                create: {
                  workspaceId: delayed.workspaceId,
                  pollId: poll.pollId,
                  voterCount: 0,
                  optionCounts: {},
                  responseCount: 0,
                  rankTotals: {},
                  rankResponseCount: 0,
                  ratingCounts: {},
                  ratingTotal: 0,
                  updatedAt: createdAt,
                },
              },
            })),
          },
          jobs: {
            create: [
              ...(schedule.closeAt
                ? [
                    {
                      id: `${poll.pollId}:CLOSE`,
                      workspaceId: delayed.workspaceId,
                      kind: 'CLOSE',
                      runAt: new Date(schedule.closeAt),
                      status: 'PENDING',
                      attempts: 0,
                      maxAttempts: 5,
                      leaseOwner: null,
                      leaseExpiresAt: null,
                      completedAt: null,
                      failedAt: null,
                      lastError: null,
                      createdAt,
                      updatedAt: createdAt,
                    },
                  ]
                : []),
              ...(schedule.remindAt
                ? [
                    {
                      id: `${poll.pollId}:REMINDER`,
                      workspaceId: delayed.workspaceId,
                      kind: 'REMINDER',
                      runAt: new Date(schedule.remindAt),
                      status: 'PENDING',
                      attempts: 0,
                      maxAttempts: 5,
                      leaseOwner: null,
                      leaseExpiresAt: null,
                      completedAt: null,
                      failedAt: null,
                      lastError: null,
                      createdAt,
                      updatedAt: createdAt,
                    },
                  ]
                : []),
            ],
          },
        },
      });
      await tx.messageAttachment.deleteMany({
        where: { entityId: delayed.id, entityType: AttachmentEntityType.DELAYED_MESSAGE },
      });
      await tx.delayedMessage.update({
        where: { id: delayed.id },
        data: { status: 'SENT', sentAt: createdAt, failureReason: null },
      });

      return { ...ids, created: true };
    },
  );
}
