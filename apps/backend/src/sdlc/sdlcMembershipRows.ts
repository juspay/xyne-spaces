import {
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
} from '@xyne/shared/sdlc';

/**
 * Shaping for the structural edges the backfill writes — CHANNEL -> REPOSITORY for
 * a hub's repository, CHANNEL -> TRACK for each of its tracks. Kept apart from the
 * backfill controller so it can be checked without loading Prisma.
 */

/** A pre-multirepo hub: the repos row still carrying its owning channel. */
export type LegacySdlcHub = {
  id: string;
  workspaceId: string;
  channelId: string;
  createdBy: string;
};

export type SdlcMembershipRow = {
  workspaceId: string;
  channelId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
  createdBy: string;
};

/**
 * sourceId is the channel, targetId the repository. channelId repeats the source
 * because it is the scope every row carries, and the unique is keyed on both.
 */
export function membershipRowsFor(hubs: readonly LegacySdlcHub[]): SdlcMembershipRow[] {
  return hubs.map(hub => ({
    workspaceId: hub.workspaceId,
    channelId: hub.channelId,
    sourceType: 'CHANNEL',
    sourceId: hub.channelId,
    targetType: 'REPOSITORY',
    targetId: hub.id,
    relationType: SDLC_MEMBERSHIP_RELATION,
    createdBy: hub.createdBy,
  }));
}

/** A pre-multirepo track: the sdlc_tracks row still carrying its owning repository. */
export type LegacySdlcTrack = {
  id: string;
  workspaceId: string;
  createdBy: string;
};

/**
 * One CHANNEL -> TRACK edge per track. Tracks have no scope column of their own,
 * so this edge is what places an existing track in the hub it already belonged to
 * through its repository.
 */
export function trackMembershipRowsFor(
  channelId: string,
  tracks: readonly LegacySdlcTrack[]
): SdlcMembershipRow[] {
  return tracks.map(track => ({
    workspaceId: track.workspaceId,
    channelId,
    sourceType: 'CHANNEL',
    sourceId: channelId,
    targetType: 'TRACK',
    targetId: track.id,
    relationType: SDLC_TRACK_MEMBERSHIP_RELATION,
    createdBy: track.createdBy,
  }));
}
