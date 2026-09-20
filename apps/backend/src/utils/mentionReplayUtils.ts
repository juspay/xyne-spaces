/**
 * Mention replay helpers.
 *
 * A user tagged in a channel they are not a member of is filtered out of the
 * mention pipeline at send time (MessagesSideEffectHandler gates both the
 * activity records and the mention notification on channel participation).
 * When they are later added to that channel through the "they are not in this
 * channel" banner, the mention has to be replayed for them, otherwise the only
 * thing they ever see is the generic "added you to #channel" notification.
 *
 * The decision logic lives here — free of Zero/Prisma — so it can be unit
 * tested, and so the replay path builds its notification in one place instead
 * of re-deriving the argument list at each call site. Note this covers the
 * REPLAY path only: send-time mention delivery still lives in
 * MessagesSideEffectHandler and is not routed through here.
 */

import { v4 as uuidv4 } from 'uuid';
import { ActivityClassification } from '@xyne/shared';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

export interface MentionReplaySource {
  messageId: string;
  conversationId: string;
  /** Channel the source message actually belongs to (from its conversation). */
  channelId: string;
  senderId: string;
  isDeleted?: boolean;
  /** True when the source message is a thread reply rather than the thread root. */
  isThreadMessage: boolean;
}

export interface MentionReplayEligibilityInput {
  /** Channel the add actually happened in — the authorization boundary. */
  channelId: string;
  source: MentionReplaySource;
  /** Users the add operation actually inserted as participants. */
  addedUserIds: string[];
  /** Users genuinely mentioned by the source message (groups already expanded). */
  mentionedUserIds: string[];
}

/**
 * Who may be told "you were mentioned" as a result of this add.
 *
 * Three independent guards, each of which alone would otherwise allow a wrong
 * notification:
 *  - the source message must belong to the channel the add happened in, so a
 *    tampered banner cannot notify about a message in an unrelated channel;
 *  - a deleted source message is never replayed;
 *  - only users the message actually mentions are notified, so adding an
 *    unrelated person in the same action does not tell them they were tagged.
 */
export function resolveMentionReplayRecipients({
  channelId,
  source,
  addedUserIds,
  mentionedUserIds,
}: MentionReplayEligibilityInput): string[] {
  if (source.channelId !== channelId) return [];
  if (source.isDeleted) return [];

  const mentioned = new Set(mentionedUserIds);
  return [...new Set(addedUserIds)].filter(
    userId => userId !== source.senderId && mentioned.has(userId),
  );
}

export interface ReplayMentionParams {
  recipientUserIds: string[];
  channelId: string;
  channelName: string;
  workspaceId: string;
  source: MentionReplaySource;
  actorName: string;
  actorPicture: string;
  /** Plain-text preview of the source message. */
  preview: string;
}

/**
 * Deliver the replayed mention: the activity-feed record plus the mention
 * notification, using the same shapes the send-time pipeline produces.
 * Never throws — a failed replay must not fail the add that triggered it.
 */
export async function replayMentionForAddedUsers({
  recipientUserIds,
  channelId,
  channelName,
  workspaceId,
  source,
  actorName,
  actorPicture,
  preview,
}: ReplayMentionParams): Promise<void> {
  if (recipientUserIds.length === 0) return;

  try {
    await activityService.createActivities(
      recipientUserIds.map(userId => ({
        id: uuidv4(),
        userId,
        workspaceId,
        actorId: source.senderId,
        actorAction: 'mentioned_user' as const,
        actionSource: 'message' as const,
        actionSourceId: source.messageId,
        messageId: source.messageId,
        conversationId: source.conversationId,
        channelId,
        isThreadActivity: source.isThreadMessage,
        classification: ActivityClassification.PENDING,
      })),
    );

    await notificationService.createMentionNotifications(
      recipientUserIds,
      source.messageId,
      source.conversationId,
      channelId,
      channelName,
      source.senderId,
      actorName,
      preview,
      workspaceId,
      undefined, // mentionType — a direct mention, not @channel/@here
      false, // isDMChannel
      source.isThreadMessage,
      actorPicture,
    );
  } catch (error) {
    logger.error('[MENTION-REPLAY] Failed to replay mention after channel add', {
      channelId,
      messageId: source.messageId,
      recipientUserIds,
      error,
    });
  }
}
