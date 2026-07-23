import { MessageType, Prisma } from '@prisma/client';
import type { ActivityType } from '@prisma/client';
import { db } from '@/database/client';

/**
 * Ticket timeline events (Details → "Activity" tab + the Messages thread).
 *
 * A ticket event surfaces on up to two frontend surfaces:
 *   - the Details → Activity timeline, backed by a `ticket_activities` row, and
 *   - the ticket's conversation thread, backed by a SYSTEM `messages` row tagged
 *     `metadata.isTicketActivity: true` — the marker the frontend routes on
 *     (ChatBubble → TicketActivityMessage).
 *
 * Historically every call site hand-rolled both inserts and repeated the message
 * invariants (SYSTEM / isTicketActivity / non-attachment / not-in-channel). This
 * helper is the single place that owns those two writes so callers only supply
 * what actually varies.
 *
 * Semantics:
 *  - Pass `activity` only when a ticket row exists; pass `message` only when the
 *    ticket has a conversation. Either may be omitted (both surfaces are optional).
 *  - Errors propagate to the caller — wrap the call in the caller's own
 *    (typically non-blocking) try/catch, matching the existing inline behavior.
 *  - The Zero-mutator write path (backend/src/zero/mutators.ts) uses a different
 *    transaction mechanism (tx.mutate.*) and is intentionally out of scope here.
 */

export interface RecordTicketActivityInput {
  ticketId: string;
  updatedBy: string;
  activityType: ActivityType;
  value: Prisma.InputJsonValue;
  /** Denormalized key behind @@index([channelId, timestamp]); needed by desk metrics for some kinds. */
  channelId?: string | null;
  timestamp?: Date;
}

export interface RecordTicketSystemMessageInput {
  conversationId: string;
  senderId: string;
  content: string;
  /**
   * `metadata.activityType`. Typed as string because some values (e.g. 'EMAIL_REPLY')
   * are not members of the ActivityType enum.
   */
  activityType: string;
  /** Denormalized tenant key; conditionally set (omitted when falsy), matching prior call sites. */
  workspaceId?: string | null;
  createdAt?: Date;
  isAutomation?: boolean;
  /** Extra metadata merged in (e.g. fromStage/toStage/hasForm). Cannot override the invariants. */
  extraMetadata?: Record<string, unknown>;
}

export interface RecordTicketTimelineEventInput {
  activity?: RecordTicketActivityInput;
  message?: RecordTicketSystemMessageInput;
}

/**
 * @param client Prisma client to write through. Defaults to the shared `db`; pass a
 *   `Prisma.TransactionClient` to enlist the writes in a caller's `$transaction`.
 */
export async function recordTicketTimelineEvent(
  input: RecordTicketTimelineEventInput,
  client: Prisma.TransactionClient = db,
): Promise<void> {
  const { activity, message } = input;

  if (activity) {
    await client.ticketActivity.create({
      data: {
        ticketId: activity.ticketId,
        updatedBy: activity.updatedBy,
        activityType: activity.activityType,
        value: activity.value,
        ...(activity.channelId != null ? { channelId: activity.channelId } : {}),
        ...(activity.timestamp ? { timestamp: activity.timestamp } : {}),
      },
    });
  }

  if (message) {
    await client.message.create({
      data: {
        conversationId: message.conversationId,
        senderId: message.senderId,
        content: message.content,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        isSent: true,
        showInChannel: false,
        ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
        metadata: {
          ...(message.extraMetadata ?? {}),
          activityType: message.activityType,
          isTicketActivity: true,
          ...(message.isAutomation ? { isAutomation: true } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }
}
