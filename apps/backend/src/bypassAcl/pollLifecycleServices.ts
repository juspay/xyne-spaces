import { ChannelScopeType, NotificationType, UserStatus, UserType } from '@xyne/shared';
import { db } from '@/database/client';
import * as notificationFilterService from '@/services/notificationFilterService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { asService, asSystem } from './base';

const POLL_LIFECYCLE_ACTOR = 'system:poll-lifecycle';
const REMINDER_BATCH_SIZE = 25;

/** Restart recovery: polls with a pending close or reminder, across every workspace. */
export function findPollsWithPendingLifecycle(): Promise<
  Array<{ id: string; closesAt: Date | null; remindAt: Date | null }>
> {
  return asSystem(
    ['Poll'],
    'worker restart re-enqueues pending poll close/reminder jobs for every workspace',
    // Awaited inside the scope: Prisma queries are lazy and would otherwise run after it closes.
    async () =>
      await db.poll.findMany({
        where: {
          closedAt: null,
          OR: [{ closesAt: { not: null } }, { remindAt: { not: null } }],
        },
        select: { id: true, closesAt: true, remindAt: true },
      }),
  );
}

/**
 * Runs a poll lifecycle job inside the poll's own workspace. The Bull payload carries only
 * the poll id, so its workspace is resolved first; a deleted poll resolves to nothing.
 */
async function runInPollWorkspace(pollId: string, fn: () => Promise<void>): Promise<void> {
  const poll = await asSystem(
    ['Poll'],
    'a poll lifecycle job payload carries only the poll id; resolve its workspace',
    async () => await db.poll.findUnique({ where: { id: pollId }, select: { workspaceId: true } }),
  );
  if (!poll) return;
  await asService(
    ['Poll', 'PollVote', 'ChannelParticipant', 'Message', 'Conversation', 'Channel'],
    'poll close/reminder job acts for the workspace, not a signed-in user',
    POLL_LIFECYCLE_ACTOR,
    poll.workspaceId,
    fn,
  );
}

async function closePoll(pollId: string, now: Date = new Date()): Promise<void> {
  await db.poll.updateMany({
    where: { id: pollId, closedAt: null },
    data: { closedAt: now },
  });
}

/** Reminds channel members who have not voted. Runs at most once per poll. */
async function remindPollNonVoters(pollId: string): Promise<void> {
  const poll = await db.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      workspaceId: true,
      createdBy: true,
      messageId: true,
      remindAt: true,
      closedAt: true,
      message: {
        select: {
          isDeleted: true,
          conversationId: true,
          conversation: {
            select: { channel: { select: { id: true, scopeType: true } } },
          },
        },
      },
    },
  });
  if (!poll || !poll.remindAt || poll.closedAt || poll.message.isDeleted) return;
  const channel = poll.message.conversation.channel;
  const isDirectMessage =
    channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM;

  const [members, voters] = await Promise.all([
    // Same recipients as channel message notifications: no apps, agents or inactive users.
    db.channelParticipant.findMany({
      where: {
        channelId: channel.id,
        user: { status: UserStatus.ACTIVE, userType: { notIn: [UserType.APP, UserType.AGENT] } },
      },
      select: { userId: true },
    }),
    db.pollVote.findMany({
      where: { pollId: poll.id },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);
  const voterIds = new Set(voters.map(vote => vote.userId));
  const recipients = [...new Set(members.map(member => member.userId))]
    .filter(userId => userId !== poll.createdBy && !voterIds.has(userId));
  const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
    recipients,
    channel.id,
    channel.scopeType === ChannelScopeType.DM,
    // A reminder is addressed to each non-voter, so it passes MENTIONS_ONLY like a
    // mention does; a channel muted to NONE still blocks it.
    'mention',
    { notificationType: NotificationType.CHANNEL_MESSAGE },
    undefined,
    channel.scopeType === ChannelScopeType.GROUP_DM,
  );

  // Claim after the reads above, so a transient failure there is retried, and before
  // sending, so a retry or a second worker never reminds the same poll twice.
  const claimed = await db.poll.updateMany({
    where: { id: poll.id, remindAt: { not: null }, closedAt: null },
    data: { remindAt: null },
  });
  if (claimed.count === 0) return;

  const desktop = new Set(desktopUsers);
  const mobile = new Set(mobileUsers);
  const targets = [...new Set([...desktopUsers, ...mobileUsers])];
  const notification = {
    title: 'Poll reminder',
    message: 'A poll in this channel is waiting for your response.',
    type: NotificationType.CHANNEL_MESSAGE,
    relatedEntityType: 'message' as const,
    relatedEntityId: poll.messageId,
    // Same link shape as message notifications, so the chat view scrolls to the poll.
    actionUrl: `/${poll.workspaceId}/chat/${isDirectMessage ? 'dm' : 'dir'}/${channel.id}#origin=${poll.message.conversationId}&messageId=${poll.messageId}`,
    workspaceId: poll.workspaceId,
    metadata: {
      channelId: channel.id,
      messageId: poll.messageId,
      pollId: poll.id,
      messageType: 'poll_reminder',
    },
  };

  let failed = 0;
  for (let offset = 0; offset < targets.length; offset += REMINDER_BATCH_SIZE) {
    const batch = targets.slice(offset, offset + REMINDER_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(userId =>
        notificationService.createNotification(userId, notification, {
          sendDesktop: desktop.has(userId),
          sendMobile: mobile.has(userId),
        }),
      ),
    );
    failed += results.filter(result => result.status === 'rejected').length;
  }
  if (failed > 0) {
    logger.error('[POLL-LIFECYCLE] Some poll reminders were not delivered', {
      pollId: poll.id,
      failed,
      total: targets.length,
    });
  }
}

/** Poll close job: closes the poll in its own workspace. */
export function closePollForLifecycle(pollId: string): Promise<void> {
  return runInPollWorkspace(pollId, () => closePoll(pollId));
}

/** Poll reminder job: reminds non-voters in the poll's own workspace. */
export function remindPollNonVotersForLifecycle(pollId: string): Promise<void> {
  return runInPollWorkspace(pollId, () => remindPollNonVoters(pollId));
}
