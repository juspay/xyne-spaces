import { SDLC_MEMBERSHIP_RELATION, SDLC_TRACK_MEMBERSHIP_RELATION } from '@xyne/shared/sdlc';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  membershipRowsFor,
  trackMembershipRowsFor,
  type LegacySdlcHub,
} from '@/sdlc/sdlcMembershipRows';
import { asSystem } from './base';
import type { SdlcMultirepoBackfillInput, SdlcMultirepoBackfillResult } from '@/sdlc/cleanup/multirepoBackfill';
import { repositoryHost } from '@/sdlc/vcs/repositoryHost';
import { SDLC_VCS_EXTERNAL_SOURCE_TYPE } from '@/sdlc/vcs/SdlcVcsCredentialStore';
import { SDLC_GITHUB_HOST } from '@xyne/shared';
import { isTrackInChannel } from '@/sdlc/sdlcChannelMembership';

const MULTIREPO_BACKFILL_TAG = '[SdlcMultirepoBackfill]';

/**
 * Relocated from sdlc/sdlcNavTarget.ts's placeInChannel. Checking whether a track sits in a
 * caller-named channel needs an unscoped lookup because the CHANNEL -> TRACK edge is not keyed
 * by the caller's own workspace context at this call site — same reasoning as isSdlcChannel
 * above, just not memoized (this check is per call, not cacheable across callers).
 */
export function isTrackReachableInChannel(trackId: string, channelId: string): Promise<boolean> {
  return asSystem(
    ['SdlcEntityLink'],
    'nav-target authorization: track-in-channel edge lookup ahead of any workspace scope',
    () => isTrackInChannel(db, trackId, channelId),
  );
}

/**
 * Relocated from sdlc/sdlcNavTarget.ts's placeInChannel. Same reasoning as
 * isTrackReachableInChannel: the ticket's channelId is read to authorize a nav target before any
 * workspace scope is available for this call.
 */
export function ticketChannelIdForNavTarget(ticketId: string): Promise<{ channelId: string | null } | null> {
  return asSystem(
    ['Ticket'],
    'nav-target authorization: ticket channelId lookup ahead of any workspace scope',
    () => db.ticket.findUnique({ where: { id: ticketId }, select: { channelId: true } }),
  );
}

/**
 * Relocated from routes/sdlcRepoCredentialBackfill.ts's backfill. Links GitHub repositories to
 * the workspace's legacy single credential, across every workspace. Only null links are touched.
 */
export function backfillSdlcRepoCredentials(dryRun: boolean) {
  return asSystem(
    ['ExternalSource', 'Repo'],
    'repo-credential backfill links legacy credentials across every workspace',
    async () => {
      const legacy = await db.externalSource.findMany({
        where: {
          sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE,
          externalIdentifier: 'GITHUB',
          name: { endsWith: ':github' },
        },
        select: { id: true, workspaceId: true },
      });
      const workspaces = [];
      let pending = 0;
      let updated = 0;
      for (const credential of legacy) {
        const repos = await db.repo.findMany({
          where: { workspaceId: credential.workspaceId, vcsCredentialId: null, projectId: { not: null } },
          select: { id: true, url: true, canonicalUrl: true },
        });
        const repoIds = repos
          .filter((repo) => {
            try {
              return repositoryHost(repo.canonicalUrl || repo.url) === SDLC_GITHUB_HOST;
            } catch {
              return false;
            }
          })
          .map((repo) => repo.id);
        pending += repoIds.length;
        if (!dryRun && repoIds.length > 0) {
          const result = await db.repo.updateMany({
            where: { id: { in: repoIds }, vcsCredentialId: null },
            data: { vcsCredentialId: credential.id },
          });
          updated += result.count;
        }
        workspaces.push({ workspaceId: credential.workspaceId, credentialId: credential.id, repoIds });
      }
      return { dryRun, legacyCredentials: legacy.length, pending, updated, workspaces };
    },
  );
}

/**
 * Hubs still carrying a channel, oldest first. Ordering by id keeps paging stable; nothing
 * writes repos."channelId" any more, so the set never grows. Relocated from
 * sdlc/cleanup/multirepoBackfill.ts.
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

/**
 * Relocated from sdlc/cleanup/multirepoBackfill.ts's backfillSdlcMultirepo. `db` is the
 * ACL-wrapped client and every table here carries a workspaceId scalar, so an ordinary request
 * context would silently narrow this to the calling admin's own workspace. This repair spans
 * all of them. See multirepoBackfill.ts for the full doc comment on what this migration does.
 */
export async function backfillSdlcMultirepo(
  input: SdlcMultirepoBackfillInput,
): Promise<SdlcMultirepoBackfillResult> {
  const startedAt = Date.now();
  return asSystem(
    ['Repo', 'SdlcEntityLink', 'SdlcTrack'],
    'one-off multirepo migration spans every workspace by design',
    async () => {
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

      logger.info(`${MULTIREPO_BACKFILL_TAG} finished`, {
        hubsSeen,
        membershipCreated,
        trackEdgesCreated,
        linksStamped,
        dryRun: input.dryRun,
        durationMs: Date.now() - startedAt,
      });

      return { dryRun: input.dryRun, hubsSeen, membershipCreated, trackEdgesCreated, linksStamped };
    },
  );
}
