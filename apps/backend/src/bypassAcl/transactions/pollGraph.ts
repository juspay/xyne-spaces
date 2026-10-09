import type { PollSchedule } from '@xyne/shared';

export type PollLifecycleKind = 'CLOSE' | 'REMINDER';

export type PollLifecycleJobInput = {
  id: string;
  workspaceId: string;
  pollId: string;
  kind: PollLifecycleKind;
  runAt: Date;
  status: 'PENDING';
  attempts: number;
  maxAttempts: number;
  leaseOwner: null;
  leaseExpiresAt: null;
  completedAt: null;
  failedAt: null;
  lastError: null;
  createdAt: Date;
  updatedAt: Date;
};

export type PollGraphClient = {
  poll: {
    findUnique(args: unknown): Promise<{
      id: string;
      workspaceId: string;
      createdBy: string;
      message: { senderId: string };
    } | null>;
  };
  pollJob: {
    upsert(args: unknown): Promise<unknown>;
  };
};

export function buildPollLifecycleJobs(
  pollId: string,
  schedule: PollSchedule,
  workspaceId: string,
  timestamp: number
): PollLifecycleJobInput[] {
  const createdAt = new Date(timestamp);
  return [
    schedule.closeAt ? { kind: 'CLOSE' as const, runAt: new Date(schedule.closeAt) } : null,
    schedule.remindAt ? { kind: 'REMINDER' as const, runAt: new Date(schedule.remindAt) } : null,
  ]
    .filter((job): job is { kind: PollLifecycleKind; runAt: Date } => job !== null)
    .map((job) => ({
      id: `${pollId}:${job.kind}`,
      workspaceId,
      pollId,
      kind: job.kind,
      runAt: job.runAt,
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
    }));
}

export async function upsertPollLifecycleJobs(
  pollId: string,
  schedule: PollSchedule,
  actor: { userID: string; workspaceId: string },
  client: PollGraphClient
): Promise<void> {
  const poll = await client.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      workspaceId: true,
      createdBy: true,
      message: { select: { senderId: true } },
    },
  });

  if (
    !poll ||
    poll.workspaceId !== actor.workspaceId ||
    poll.createdBy !== actor.userID ||
    poll.message.senderId !== actor.userID
  ) {
    throw new Error('Poll lifecycle synchronization is not authorized');
  }

  const jobs = buildPollLifecycleJobs(poll.id, schedule, poll.workspaceId, Date.now());

  for (const job of jobs) {
    await client.pollJob.upsert({
      where: { pollId_kind: { pollId: job.pollId, kind: job.kind } },
      create: job,
      update: { runAt: job.runAt, updatedAt: job.updatedAt },
    });
  }
}
