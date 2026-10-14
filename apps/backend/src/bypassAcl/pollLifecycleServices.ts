import { db } from '@/database/client';
import { asService, asSystem } from './base';

const POLL_LIFECYCLE_ACTOR = 'system:poll-lifecycle';

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
export async function runInPollWorkspace(pollId: string, fn: () => Promise<void>): Promise<void> {
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
