import { useMemo } from 'react';
import type { QueryResultType } from '@rocicorp/zero';
import {
  recordingAccessAtLeast,
  resolveRecordingAccessLevel,
  type RecordingAccessLevel,
} from '@xyne/shared';
import { queries } from '../zero/queries';
import { useAuth } from './useAuth';

type RecordingRow = NonNullable<QueryResultType<typeof queries.oatsRecordingByExternalId>>;
type RecordingShareRow = RecordingRow['shares'][number];
type RecordingListRow = QueryResultType<typeof queries.createdOatsRecordings>[number];

/** Only the fields access resolution reads, so a narrowed row can be passed in. */
type AccessFields<TRow> = Pick<
  TRow,
  Extract<keyof TRow, 'createdByUserId' | 'visibility' | 'shares'>
>;

/**
 * Whether a share row reaches the signed-in user. The detail query returns every
 * share, and narrows `userGroupMemberships` / `channelMembers` to them — so a
 * non-empty array means "they are in the group or channel this was shared with".
 */
const reachesViewer = (share: RecordingShareRow, userId: string): boolean =>
  share.userId === userId ||
  (share.userGroupMemberships?.length ?? 0) > 0 ||
  (share.channelMembers?.length ?? 0) > 0;

export interface RecordingAccess {
  /** `null` while the recording is still loading, or when there is no access. */
  level: RecordingAccessLevel | null;
  isOwner: boolean;
  /** Owner or editor: may rename, regenerate, export, email and manage sharing. */
  canEdit: boolean;
  canView: boolean;
  /**
   * A non-owner holding a grant addressed to them personally — the only access
   * they can hand back. Access that arrives through a group or channel has no
   * row of their own to revoke, so leaving would silently do nothing.
   */
  canLeave: boolean;
}

const toAccess = (level: RecordingAccessLevel | null, hasOwnGrant: boolean): RecordingAccess => ({
  level,
  isOwner: level === 'owner',
  canEdit: recordingAccessAtLeast(level, 'edit'),
  canView: recordingAccessAtLeast(level, 'view'),
  canLeave: level !== null && level !== 'owner' && hasOwnGrant,
});

/**
 * The signed-in user's standing on a recording, resolved with the same rules
 * `CallShareService.hasAtLeast` enforces — so what the UI offers and
 * what the API allows cannot disagree.
 *
 * Pass the row from `queries.oatsRecordingByExternalId`; it carries the shares
 * and the membership rows this needs.
 */
export const useRecordingAccessLevel = (
  recording: AccessFields<RecordingRow> | null | undefined,
): RecordingAccess => {
  const { user } = useAuth();
  const userId = user?.id;

  return useMemo(() => {
    if (!recording) return toAccess(null, false);
    const shares = recording.shares ?? [];
    return toAccess(
      resolveRecordingAccessLevel({
        currentUserId: userId,
        createdByUserId: recording.createdByUserId,
        visibility: recording.visibility,
        grants: userId ? shares.filter(share => reachesViewer(share, userId)) : [],
      }),
      !!userId && shares.some(share => share.userId === userId),
    );
  }, [recording, userId]);
};

/**
 * Same answer for a row from the recordings list. Those queries already narrow
 * `shares` to the ones reaching the viewer, so there is nothing left to filter —
 * which is why this cannot just call the hook above.
 */
export const useRecordingListAccessLevel = (
  recording: AccessFields<RecordingListRow> | null | undefined,
): RecordingAccess => {
  const { user } = useAuth();
  const userId = user?.id;

  return useMemo(() => {
    if (!recording) return toAccess(null, false);
    const shares = recording.shares ?? [];
    return toAccess(
      resolveRecordingAccessLevel({
        currentUserId: userId,
        createdByUserId: recording.createdByUserId,
        visibility: recording.visibility,
        grants: shares,
      }),
      !!userId && shares.some(share => share.userId === userId),
    );
  }, [recording, userId]);
};
