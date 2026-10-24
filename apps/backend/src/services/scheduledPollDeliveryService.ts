import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import {
  AttachmentEntityType,
  ConversationParticipation,
  MessageType,
  buildInitialMessageMd,
  buildPollMessageSummary,
  buildPollRows,
  pollDraftSchema,
  pollScheduleSchema,
  shiftPollSchedule,
} from '@xyne/shared';
import { Prisma } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';

const SCHEDULED_POLL_NAMESPACE = '5084fb70-81ed-5e24-8e61-9d5567ca2f29';

/** The delayed_messages row a scheduled poll is delivered from. */
export interface ScheduledPollRow {
  id: string;
  workspaceId: string;
  channelId: string;
  conversationId: string | null;
  senderId: string;
  scheduledFor: number;
  status: string;
  pollDraft: Prisma.JsonValue | null;
}

export interface ScheduledPollDeliveryResult {
  conversationId: string;
  messageId: string;
  /** Set only when this call created the poll; the caller schedules its jobs and indexes it. */
  createdPoll: {
    id: string;
    workspaceId: string;
    createdBy: string;
    createdAt: Date;
    closesAt: Date | null;
    remindAt: Date | null;
  } | null;
}

function scheduledPollIds(delayedMessageId: string): {
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
    poll: pollDraftSchema.parse(value.poll),
    schedule: pollScheduleSchema.parse(value.schedule ?? {}),
  };
}

const toDate = (epoch: number | null): Date | null => (epoch === null ? null : new Date(epoch));

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Publishes a scheduled poll as its sender, in the sender's workspace, through the tenant
 * ACL extension. Every write goes in one array transaction, so a delivery either lands
 * completely (message, poll rows, channel activity, delayed row SENT) or not at all.
 * Ids are derived from the delayed message, so a replay finds the poll already delivered.
 */
export function deliverScheduledPoll(
  delayed: ScheduledPollRow,
  timestamp: number
): Promise<ScheduledPollDeliveryResult> {
  const ids = scheduledPollIds(delayed.id);

  return runWithContext({ userId: delayed.senderId, workspaceId: delayed.workspaceId }, async () => {
    if (delayed.conversationId) throw new Error('Scheduled polls must create a top-level conversation');
    if (delayed.status !== 'SENDING' && delayed.status !== 'SENT') {
      throw new Error(`Scheduled poll is not deliverable from status ${delayed.status}`);
    }

    const existingMessage = await db.message.findUnique({
      where: { messageId: ids.messageId },
      select: { messageId: true },
    });
    if (existingMessage) return { ...ids, createdPoll: null };
    if (delayed.status === 'SENT') {
      throw new Error('Scheduled poll is marked sent without its deterministic message');
    }

    // Channel archive and membership checks happen in processJobTx (worker) and the
    // send-now side effect before delivery reaches here.
    const sender = await db.user.findUnique({
      where: { id: delayed.senderId },
      select: { id: true },
    });
    if (!sender) throw new Error('Scheduled poll sender is unavailable');

    const { poll: draft, schedule } = parseScheduledPollPayload(delayed.pollDraft);
    const rows = buildPollRows({
      draft,
      messageId: ids.messageId,
      workspaceId: delayed.workspaceId,
      userId: delayed.senderId,
      timestamp,
      schedule: shiftPollSchedule(schedule, timestamp - delayed.scheduledFor),
      lateDelivery: true,
    });
    const content = buildPollMessageSummary(draft);
    const createdAt = new Date(timestamp);
    const messageMetadata = { messageSubtype: 'poll', pollId: draft.pollId };
    const initialMessageMd = buildInitialMessageMd({
      messageId: ids.messageId,
      conversationId: ids.conversationId,
      workspaceId: delayed.workspaceId,
      senderId: delayed.senderId,
      content,
      msgType: MessageType.USER,
      hasAttachment: false,
      createdAt: timestamp,
      metadata: messageMetadata,
      isSent: true,
      nudgeCount: 0,
    });
    const poll = {
      ...rows.poll,
      closesAt: toDate(rows.poll.closesAt),
      remindAt: toDate(rows.poll.remindAt),
      closedAt: toDate(rows.poll.closedAt),
      createdAt,
    };

    try {
      // Array form only: an interactive transaction would skip the ACL extension. Bulk
      // update/delete are used because the extension authorizes them without a pre-read.
      await db.$transaction([
        db.conversation.create({
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
        }),
        db.message.create({
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
        }),
        db.conversationParticipant.create({
          data: {
            workspaceId: delayed.workspaceId,
            conversationId: ids.conversationId,
            userId: delayed.senderId,
            channelId: delayed.channelId,
            participationType: ConversationParticipation.AUTHOR,
            isSubscribed: true,
            joinedAt: createdAt,
          },
        }),
        db.poll.create({ data: poll }),
        db.pollQuestion.createMany({
          data: rows.questions.map(question => ({
            ...question,
            options: question.options.map(option => ({ ...option })),
            createdAt,
          })),
        }),
        db.pollQuestionResult.createMany({
          data: rows.results.map(result => ({ ...result, updatedAt: createdAt })),
        }),
        db.channelStats.updateMany({
          where: { channelId: delayed.channelId },
          data: { lastActivityAt: createdAt },
        }),
        db.messageAttachment.deleteMany({
          where: { entityId: delayed.id, entityType: AttachmentEntityType.DELAYED_MESSAGE },
        }),
        db.delayedMessage.updateMany({
          where: { id: delayed.id },
          data: { status: 'SENT', sentAt: createdAt, failureReason: null },
        }),
      ]);
    } catch (error) {
      // A concurrent delivery of the same delayed message won the deterministic ids.
      if (isUniqueViolation(error)) return { ...ids, createdPoll: null };
      throw error;
    }

    return {
      ...ids,
      createdPoll: {
        id: poll.id,
        workspaceId: delayed.workspaceId,
        createdBy: delayed.senderId,
        createdAt,
        closesAt: poll.closesAt,
        remindAt: poll.remindAt,
      },
    };
  });
}
