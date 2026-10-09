/**
 * Backfill for XYNE-66008: move dev tickets bundled into already-COMPLETED
 * releases to a Completed-group stage, exactly as the live hook would.
 *
 *   pnpm exec tsx scripts/backfill-release-dev-ticket-completion.ts --since 2026-07-01 [--workspace <id>] [--apply]
 *
 * Without --apply it is a dry run: it only reports, per release, how many
 * bundled dev tickets are still in a movable status. Idempotent: tickets that
 * are already Completed are skipped, so re-running is safe.
 * closedAt is the release's closedAt (or its updatedAt when unset).
 */
import { BaseTicketType, TicketStatusV2 } from '@xyne/shared';
import { db } from '../src/database/client';
import { runAsSystem } from '../src/database/tenant/context';
import {
  releaseDevTicketCompletionService,
  RELEASE_COMPLETION_MOVABLE_STATUSES,
} from '../src/services/release/releaseDevTicketCompletionService';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const since = arg('since');
  if (!since) throw new Error('--since <ISO date> is required');
  const workspaceId = arg('workspace');
  const apply = process.argv.includes('--apply');

  await runAsSystem(async () => {
    const releases = await db.ticket.findMany({
      where: {
        ticketType: { in: [BaseTicketType.Release, BaseTicketType.Hotfix] },
        statusV2: TicketStatusV2.COMPLETED,
        isArchived: false,
        updatedAt: { gte: new Date(since) },
        ...(workspaceId ? { workspaceId } : {}),
      },
      select: { id: true, xyneId: true, closedAt: true, closedBy: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    });
    console.log(`${releases.length} completed release(s) since ${since}${apply ? '' : ' (dry run)'}`);

    for (const r of releases) {
      const links = await db.applicationReleaseTicket.findMany({ where: { releaseId: r.id }, select: { ticketId: true } });
      const pending = await db.ticket.count({
        where: {
          id: { in: links.map(l => l.ticketId) },
          isArchived: false,
          statusV2: { in: [...RELEASE_COMPLETION_MOVABLE_STATUSES] },
        },
      });
      if (pending === 0) continue;
      if (!apply) {
        console.log(`${r.xyneId}: ${pending} dev ticket(s) would be evaluated`);
        continue;
      }
      const outcomes = await releaseDevTicketCompletionService.onReleaseCompleted({
        releaseTicketId: r.id,
        completedBy: r.closedBy,
        completedAt: r.closedAt ?? r.updatedAt,
        ignoreGlobalFlag: true,
      });
      const counts = outcomes.reduce<Record<string, number>>((a, o) => {
        a[o.outcome] = (a[o.outcome] ?? 0) + 1;
        return a;
      }, {});
      console.log(`${r.xyneId}: ${JSON.stringify(counts)}`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
