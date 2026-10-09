import { randomUUID } from 'node:crypto';
import { NotificationType } from '@xyne/shared';
import { db } from '@/database/client';
import * as notificationFilterService from '@/services/notificationFilterService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const POLL_JOB_LEASE_MS = 5 * 60_000;
const POLL_JOB_SCAN_INTERVAL_MS = 15_000;
const POLL_JOB_SCAN_LIMIT = 100;
const POLL_JOB_CONCURRENCY = 3;
const REMINDER_BATCH_SIZE = 25;

export interface PollLifecycleJobData {
  pollJobId: string;
}

type ReminderPoll = {
  id: string;
  workspaceId: string;
  createdBy: string;
  messageId: string;
  closedAt: Date | null;
  message: {
    isDeleted: boolean;
    createdAt: Date;
    conversation: { channelId: string };
  };
};

async function deliverReminderRecipient(
  pollJobId: string,
  poll: ReminderPoll,
  channelId: string,
  userId: string,
  now: Date
): Promise<void> {
  const { desktopUsers, mobileUsers } = await notificationFilterService.filterUsers(
    [userId],
    channelId,
    false,
    'channel_message',
    { notificationType: NotificationType.CHANNEL_MESSAGE }
  );
  const sendDesktop = desktopUsers.includes(userId);
  const sendMobile = mobileUsers.includes(userId);
  if (!sendDesktop && !sendMobile) return;

  const deliveryId = `${pollJobId}:${userId}`;
  const claimed = await db.pollReminderDelivery.createMany({
    data: [
      {
        id: deliveryId,
        workspaceId: poll.workspaceId,
        pollJobId,
        userId,
        status: 'CLAIMED',
        createdAt: now,
        updatedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (claimed.count === 0) {
    const reclaimed = await db.pollReminderDelivery.updateMany({
      where: { id: deliveryId, status: 'FAILED' },
      data: { status: 'CLAIMED', updatedAt: now },
    });
    if (reclaimed.count === 0) return;
  }

  try {
    await notificationService.createNotification(
      userId,
      {
        title: 'Poll reminder',
        message: 'A poll in this channel is waiting for your response.',
        type: NotificationType.CHANNEL_MESSAGE,
        relatedEntityType: 'message',
        relatedEntityId: poll.messageId,
        actionUrl: `/${poll.workspaceId}/chat/dir/${channelId}?messageId=${poll.messageId}`,
        workspaceId: poll.workspaceId,
        metadata: {
          channelId,
          messageId: poll.messageId,
          pollId: poll.id,
          messageType: 'poll_reminder',
        },
      },
      { sendDesktop, sendMobile }
    );
    await db.pollReminderDelivery.update({
      where: { id: deliveryId },
      data: { status: 'DELIVERED', deliveredAt: now },
    });
  } catch (error) {
    await db.pollReminderDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}

async function remindNonVoters(pollJobId: string, poll: ReminderPoll, now: Date): Promise<void> {
  const channelId = poll.message.conversation.channelId;
  const [members, voters] = await Promise.all([
    db.channelParticipant.findMany({
      where: { channelId },
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
  const failures: unknown[] = [];

  for (let offset = 0; offset < recipients.length; offset += REMINDER_BATCH_SIZE) {
    const batch = recipients.slice(offset, offset + REMINDER_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(userId => deliverReminderRecipient(pollJobId, poll, channelId, userId, now)),
    );
    failures.push(...results.filter(result => result.status === 'rejected'));
  }

  if (failures.length > 0) {
    throw new Error(`Failed to deliver ${failures.length} poll reminder(s)`);
  }
}

export async function processPollLifecycleJob(
  data: PollLifecycleJobData,
  now: Date = new Date(),
  workerId: string = randomUUID()
): Promise<void> {
  const candidate = await db.pollJob.findUnique({
    where: { id: data.pollJobId },
    select: {
      id: true,
      status: true,
      runAt: true,
      attempts: true,
      maxAttempts: true,
      leaseExpiresAt: true,
    },
  });
  if (!candidate || candidate.runAt > now || candidate.attempts >= candidate.maxAttempts) return;
  const claimable =
    candidate.status === 'PENDING' ||
    (candidate.status === 'RUNNING' &&
      candidate.leaseExpiresAt !== null &&
      candidate.leaseExpiresAt <= now);
  if (!claimable) return;

  const leaseExpiresAt = new Date(now.getTime() + POLL_JOB_LEASE_MS);
  const claimed = await db.pollJob.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      attempts: candidate.attempts,
      runAt: { lte: now },
      ...(candidate.status === 'RUNNING' ? { leaseExpiresAt: { lte: now } } : {}),
    },
    data: {
      status: 'RUNNING',
      attempts: { increment: 1 },
      leaseOwner: workerId,
      leaseExpiresAt,
      failedAt: null,
      updatedAt: now,
    },
  });
  if (claimed.count === 0) return;

  try {
    const pollJob = await db.pollJob.findUniqueOrThrow({
      where: { id: data.pollJobId },
      include: {
        poll: {
          include: {
            message: {
              include: { conversation: { select: { channelId: true } } },
            },
          },
        },
      },
    });

    if (pollJob.kind === 'CLOSE') {
      await db.poll.updateMany({
        where: { id: pollJob.pollId, closedAt: null },
        data: { closedAt: now },
      });
    } else if (pollJob.kind === 'REMINDER') {
      const poll = pollJob.poll;
      if (!poll.closedAt && !poll.message.isDeleted && poll.message.createdAt <= now) {
        await remindNonVoters(pollJob.id, poll, now);
      }
    } else {
      throw new Error(`Unsupported poll lifecycle job kind: ${pollJob.kind}`);
    }

    await db.pollJob.updateMany({
      where: { id: pollJob.id, status: 'RUNNING', leaseOwner: workerId },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        failedAt: null,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const finalAttempt = candidate.attempts + 1 >= candidate.maxAttempts;
    await db.pollJob.updateMany({
      where: { id: data.pollJobId, status: 'RUNNING', leaseOwner: workerId },
      data: {
        status: finalAttempt ? 'FAILED' : 'PENDING',
        failedAt: finalAttempt ? now : null,
        lastError: reason,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      },
    });
    throw error;
  }
}

export async function processClaimablePollJobs(
  now: Date = new Date(),
  workerId: string = randomUUID()
): Promise<void> {
  const jobs = await db.pollJob.findMany({
    where: {
      runAt: { lte: now },
      OR: [{ status: 'PENDING' }, { status: 'RUNNING', leaseExpiresAt: { lte: now } }],
    },
    orderBy: [{ runAt: 'asc' }, { id: 'asc' }],
    take: POLL_JOB_SCAN_LIMIT,
    select: { id: true },
  });

  for (let offset = 0; offset < jobs.length; offset += POLL_JOB_CONCURRENCY) {
    const batch = jobs.slice(offset, offset + POLL_JOB_CONCURRENCY);
    const outcomes = await Promise.allSettled(
      batch.map((job) => processPollLifecycleJob({ pollJobId: job.id }, now, workerId))
    );
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        logger.error('[POLL-LIFECYCLE] Job failed', {
          pollJobId: batch[index]?.id,
          error: outcome.reason,
        });
      }
    });
  }
}

class PollLifecycleWorker {
  private started = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId = randomUUID();

  async start(): Promise<void> {
    if (this.started) return;
    await processClaimablePollJobs(new Date(), this.workerId);
    this.timer = setInterval(() => {
      void processClaimablePollJobs(new Date(), this.workerId);
    }, POLL_JOB_SCAN_INTERVAL_MS);
    this.started = true;
    logger.info('[POLL-LIFECYCLE] Database worker started', { workerId: this.workerId });
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    logger.info('[POLL-LIFECYCLE] Database worker shut down', { workerId: this.workerId });
  }

  async reenqueuePendingJobs(): Promise<void> {
    await processClaimablePollJobs(new Date(), this.workerId);
  }
}

export const pollLifecycleWorker = new PollLifecycleWorker();
