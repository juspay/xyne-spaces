import { z } from 'zod';

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
 * The implementation runs inside bypassAcl's asSystem — db is the ACL-wrapped client and
 * every table here carries a workspaceId scalar, so an ordinary request context
 * would silently narrow this to the calling admin's own workspace. This repair
 * spans all of them. See bypassAcl/sdlcServices.ts for backfillSdlcMultirepo.
 */

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

// Runs under runAsSystem — the implementation lives in bypassAcl/sdlcServices.ts.
export { backfillSdlcMultirepo } from '@/bypassAcl/sdlcServices';
