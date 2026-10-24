import { db } from '@/database/client';
import { asSystem } from './base';

/** Restart recovery: polls with a pending close or reminder, across every workspace. */
export function findPollsWithPendingLifecycle(): Promise<
  Array<{
    id: string;
    workspaceId: string;
    createdBy: string;
    closesAt: Date | null;
    remindAt: Date | null;
  }>
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
        select: { id: true, workspaceId: true, createdBy: true, closesAt: true, remindAt: true },
      }),
  );
}
