import { z } from 'zod';
import { SDLC_MEMBERSHIP_RELATION, SDLC_TRACK_MEMBERSHIP_RELATION } from '@xyne/shared/sdlc';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import {
  membershipRowsFor,
  trackMembershipRowsFor,
  type LegacySdlcHub,
} from '@/sdlc/sdlcMembershipRows';

/**
 * One-off data migration for SDLC multi-repo channels.
 *
 * Until now an SDLC hub was a repos row carrying both projectId and channelId, so
 * a repository and its channel were locked 1:1. Membership now lives in
 * sdlc_entity_links: a CHANNEL -> REPOSITORY edge for the repository, and a
 * CHANNEL -> TRACK edge for each of its tracks. This writes both, and stamps the
 * owning channel onto the content links that until now inherited it through their
 * repository.
 *
 * Runs after 20260828121427_sdlc_multirepo_add and the branch deploy. Nothing is
 * dropped: repos."channelId", sdlc_entity_links."repoId" and sdlc_tracks."repoId"
 * stay in the database, deprecated, still holding their old values. Between the
 * deploy and this run the deployed code reads everything by channelId and no new
 * row carries one, so SDLC shows no hubs, links or tracks - the surface is dark
 * until this runs and comes back the moment it does. Nothing is lost, and a
 * rollback finds every legacy column intact.
 *
 * Idempotent. Every insert skips duplicates against the unique on
 * (channelId, sourceType, sourceId, targetType, targetId, relationType), and the
 * link update only touches rows whose channelId is still null, so a re-run after a
 * partial pass picks up exactly the stragglers. A dryRun pass reports what a real
 * one would write; all zeros means the migration is complete.
 *
 * Runs inside runAsSystem(): `db` is the ACL-wrapped client and every table here
 * carries a workspaceId scalar, so an ordinary request context would silently
 * narrow this to the calling admin's own workspace. This repair spans all of them.
 */

const TAG = '[SdlcMultirepoBackfill]';

export const sdlcMultirepoBackfillSchema = z.object({
  dryRun: z.boolean().default(true),
  batchSize: z.number().int().positive().max(1000).default(100),
});
export type SdlcMultirepoBackfillInput = z.infer<typeof sdlcMultirepoBackfillSchema>;

export interface SdlcMultirepoBackfillResult {
  dryRun: boolean;
  hubsSeen: number;
  membershipCreated: number;
  trackEdgesCreated: number;
  linksStamped: number;
}

/**
 * Hubs still carrying a channel, oldest first. Ordering by id keeps paging
 * stable; nothing writes repos."channelId" any more, so the set never grows.
 */
async function readHubs(limit: number, afterId: string | null): Promise<LegacySdlcHub[]> {
  const rows = await db.repo.findMany({
    where: { channelId: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, workspaceId: true, channelId: true, createdBy: true },
  });
  return rows.map(row => ({ ...row, channelId: row.channelId! }));
}

// Raw because the column is required in Prisma and nullable only for these rows,
// so the typed filters cannot name them.
function countLegacyLinks(repoId: string): Promise<number> {
  return db
    .$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM "public"."sdlc_entity_links"
      WHERE "repoId" = ${repoId} AND "channelId" IS NULL
    `
    .then(rows => Number(rows[0]?.count ?? 0));
}

function stampLegacyLinks(repoId: string, channelId: string): Promise<number> {
  return db.$executeRaw`
    UPDATE "public"."sdlc_entity_links" SET "channelId" = ${channelId}
    WHERE "repoId" = ${repoId} AND "channelId" IS NULL
  `;
}

/** A hub's tracks, by the repository column they were scoped by. */
function readTracks(repoId: string) {
  return db.sdlcTrack.findMany({
    where: { repoId },
    select: { id: true, workspaceId: true, createdBy: true },
  });
}

export async function backfillSdlcMultirepo(
  input: SdlcMultirepoBackfillInput
): Promise<SdlcMultirepoBackfillResult> {
  const startedAt = Date.now();
  return runAsSystem(async () => {
    let afterId: string | null = null;
    let hubsSeen = 0;
    let membershipCreated = 0;
    let trackEdgesCreated = 0;
    let linksStamped = 0;

    for (;;) {
      const hubs = await readHubs(input.batchSize, afterId);
      if (hubs.length === 0) break;
      hubsSeen += hubs.length;
      afterId = hubs[hubs.length - 1]!.id;

      const rows = membershipRowsFor(hubs);
      if (input.dryRun) {
        // createMany skips duplicates, so rows.length would report every hub.
        const existing = await db.sdlcEntityLink.count({
          where: {
            relationType: SDLC_MEMBERSHIP_RELATION,
            targetType: 'REPOSITORY',
            OR: rows.map(row => ({ channelId: row.channelId, targetId: row.targetId })),
          },
        });
        membershipCreated += rows.length - existing;
      } else {
        const created = await db.sdlcEntityLink.createMany({ data: rows, skipDuplicates: true });
        membershipCreated += created.count;
      }

      for (const hub of hubs) {
        const trackRows = trackMembershipRowsFor(hub.channelId, await readTracks(hub.id));
        if (input.dryRun) {
          const [existingTrackEdges, stampableLinks] = await Promise.all([
            trackRows.length === 0
              ? Promise.resolve(0)
              : db.sdlcEntityLink.count({
                  where: {
                    channelId: hub.channelId,
                    relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
                    targetType: 'TRACK',
                    targetId: { in: trackRows.map(row => row.targetId) },
                  },
                }),
            countLegacyLinks(hub.id),
          ]);
          trackEdgesCreated += trackRows.length - existingTrackEdges;
          linksStamped += stampableLinks;
        } else {
          const [trackEdges, links] = await Promise.all([
            trackRows.length === 0
              ? Promise.resolve({ count: 0 })
              : db.sdlcEntityLink.createMany({ data: trackRows, skipDuplicates: true }),
            stampLegacyLinks(hub.id, hub.channelId),
          ]);
          trackEdgesCreated += trackEdges.count;
          linksStamped += links;
        }
      }

      if (hubs.length < input.batchSize) break;
    }

    logger.info(`${TAG} finished`, {
      hubsSeen,
      membershipCreated,
      trackEdgesCreated,
      linksStamped,
      dryRun: input.dryRun,
      durationMs: Date.now() - startedAt,
    });

    return { dryRun: input.dryRun, hubsSeen, membershipCreated, trackEdgesCreated, linksStamped };
  });
}
