import Bull from 'bull';
import { ChannelScopeType, NotificationType } from '@xyne/shared';
import { db } from '@/database/client';
import * as notificationFilterService from '@/services/notificationFilterService';
import { notificationService } from '@/services/notificationService';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import {
  POLL_LIFECYCLE_JOB_OPTIONS,
  POLL_LIFECYCLE_QUEUE_NAME,
  addPollLifecycleJobs,
  type PollLifecycleJobData,
} from '@/queues/pollLifecycleQueue';

const POLL_LIFECYCLE_CONCURRENCY = 3;
const REMINDER_BATCH_SIZE = 25;

export async function closePoll(pollId: string, now: Date = new Date()): Promise<void> {
  await db.poll.updateMany({
    where: { id: pollId, closedAt: null },
    data: { closedAt: now },
  });
}

/** Reminds channel members who have not voted. Runs at most once per poll. */
export async function remindPollNonVoters(pollId: string): Promise<void> {
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
          conversation: {
            select: { channel: { select: { id: true, scopeType: true } } },
          },
        },
      },
    },
  });
  if (!poll || !poll.remindAt || poll.closedAt || poll.message.isDeleted) return;
  const channel = poll.message.conversation.channel;

  const [members, voters] = await Promise.all([
    db.channelParticipant.findMany({
      where: { channelId: channel.id },
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
    'channel_message',
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
    actionUrl: `/${poll.workspaceId}/chat/dir/${channel.id}?messageId=${poll.messageId}`,
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

export async function processPollLifecycleJob(data: PollLifecycleJobData): Promise<void> {
  if (data.kind === 'CLOSE') {
    await closePoll(data.pollId);
  } else if (data.kind === 'REMIND') {
    await remindPollNonVoters(data.pollId);
  } else {
    throw new Error(`Unsupported poll lifecycle job kind: ${String(data.kind)}`);
  }
}

class PollLifecycleWorker {
  private queue: Bull.Queue<PollLifecycleJobData> | null = null;
  private isProcessorRegistered = false;

  private getQueue(): Bull.Queue<PollLifecycleJobData> {
    this.queue ??= new Bull<PollLifecycleJobData>(POLL_LIFECYCLE_QUEUE_NAME, {
      redis: { ...redisService.getRedisConfig(), lazyConnect: false },
      defaultJobOptions: POLL_LIFECYCLE_JOB_OPTIONS,
      settings: {
        stalledInterval: 30 * 1000,
        maxStalledCount: 1,
      },
    });
    return this.queue;
  }

  async start(): Promise<void> {
    if (this.isProcessorRegistered) return;
    const queue = this.getQueue();
    this.isProcessorRegistered = true;
    void queue.process(POLL_LIFECYCLE_CONCURRENCY, job => processPollLifecycleJob(job.data));
    queue.on('failed', (job, err) => {
      logger.error(`[POLL-LIFECYCLE] Job ${job.id} failed`, { data: job.data, error: err });
    });
    logger.info('[POLL-LIFECYCLE] Started');
  }

  /** `polls` is the durable record. Bull dedupes by jobId, so re-adding a queued job is a no-op. */
  async reenqueuePendingPolls(): Promise<void> {
    const queue = this.getQueue();
    const polls = await db.poll.findMany({
      where: {
        closedAt: null,
        OR: [{ closesAt: { not: null } }, { remindAt: { not: null } }],
      },
      select: { id: true, closesAt: true, remindAt: true },
    });
    for (const poll of polls) {
      await addPollLifecycleJobs(queue, poll);
    }
    logger.info(`[POLL-LIFECYCLE] Re-enqueue complete: ${polls.length} poll(s)`);
  }

  /** Bull's close() waits for in-flight jobs before resolving. */
  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.isProcessorRegistered = false;
    logger.info('[POLL-LIFECYCLE] Shut down');
  }
}

export const pollLifecycleWorker = new PollLifecycleWorker();
