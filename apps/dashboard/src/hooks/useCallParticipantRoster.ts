import { useMemo } from 'react';
import { CallStatus } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { useUsers } from './useUsers';
import { queries } from '../zero/queries';
import {
  getPreviewParticipantEntries,
  type Call,
} from '../routes/CallHistoryScreen/callHistoryItem.utils';

type CallParticipant = NonNullable<Call['participants']>[number];
type MergedParticipant = Partial<CallParticipant> & {
  userId: string;
  isCurrentUser?: boolean;
  /** Set only for preview-sourced rows, which carry no `joinedAt` of their own. */
  previewHasJoined?: boolean;
};

/** A call participant with its display fields resolved against the user directory. */
export interface CallParticipantRow {
  userId: string;
  name: string;
  email: string;
  isExternal: boolean;
  isCurrentUser: boolean;
  /** Actually showed up, as opposed to merely being invited. */
  hasJoined: boolean;
}

interface UseCallParticipantRosterResult {
  participants: CallParticipantRow[];
  isLoading: boolean;
}

/**
 * Merges a call's inlined participants with its preview ids and — when the inlined
 * list is known to be truncated — the full roster fetched from Zero.
 *
 * `isEnabled` gates that fetch, so a closed modal or popover costs nothing. The
 * inlined and preview participants still resolve while closed, which is what lets
 * a trigger render avatars before it is opened.
 */
export function useCallParticipantRoster(
  call: Call,
  isEnabled: boolean,
  currentUserId: string | undefined,
): UseCallParticipantRosterResult {
  const hasFullParticipants =
    call.status === CallStatus.ACTIVE ||
    (call.participantCount !== null &&
      call.participantCount !== undefined &&
      call.participantCount <= (call.participants?.length ?? 0));

  const [fullParticipants, fullParticipantsDetails] = useCachedQuery(
    queries.callParticipantsByCallId({ callId: call.id }),
    {
      enabled: isEnabled && !hasFullParticipants,
    },
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const u of allUsers) {
      map.set(u.id, { name: u.name, email: u.email });
    }
    return map;
  }, [allUsers]);

  const previewParticipantEntries = useMemo(
    () => getPreviewParticipantEntries(call.participantPreviewUserIds, currentUserId).slice(0, 3),
    [call.participantPreviewUserIds, currentUserId],
  );

  const previewParticipants = useMemo(() => {
    const nextParticipants: MergedParticipant[] = [];
    const seen = new Set<string>();

    for (const participant of call.participants ?? []) {
      if (participant.userId && !seen.has(participant.userId)) {
        nextParticipants.push({
          ...participant,
          userId: participant.userId,
          isCurrentUser: participant.userId === currentUserId,
        });
        seen.add(participant.userId);
      }
    }

    for (const entry of previewParticipantEntries) {
      if (!seen.has(entry.userId)) {
        nextParticipants.push({
          userId: entry.userId,
          isCurrentUser: entry.userId === currentUserId,
          previewHasJoined: entry.hasJoined,
        });
        seen.add(entry.userId);
      }
    }

    return nextParticipants;
  }, [call.participants, currentUserId, previewParticipantEntries]);

  const participants = useMemo<CallParticipantRow[]>(() => {
    const merged = [...previewParticipants];
    const seen = new Set(merged.map(participant => participant.userId));

    // Index the authoritative full roster by userId. Its live `joinedAt` must be
    // able to OVERRIDE a possibly-stale preview `hasJoined` flag, not merely
    // backfill participants the preview didn't already cover — otherwise a preview
    // row whose cached flag is out of date would shadow the real join status.
    const fullByUserId = new Map<string, MergedParticipant>();
    for (const participant of fullParticipants ?? []) {
      if (!participant.userId) continue;
      const row: MergedParticipant = {
        ...participant,
        isCurrentUser: participant.userId === currentUserId,
      };
      fullByUserId.set(participant.userId, row);
      if (!seen.has(participant.userId)) {
        merged.push(row);
        seen.add(participant.userId);
      }
    }

    return merged.map(participant => {
      const isExternal = Boolean(participant.isExternal);
      const directoryUser = usersById.get(participant.userId);

      // When the authoritative roster row is present, trust its `joinedAt`
      // outright; only fall back to the preview flag for rows the roster does not
      // cover (e.g. active calls where the full fetch is skipped).
      const authoritative = fullByUserId.get(participant.userId);
      const joinedAt = authoritative ? authoritative.joinedAt : participant.joinedAt;
      const hasJoined = authoritative
        ? joinedAt !== null && joinedAt !== undefined
        : joinedAt !== null && joinedAt !== undefined
          ? true
          : Boolean(participant.previewHasJoined);

      return {
        userId: participant.userId,
        name: isExternal
          ? participant.displayName || 'Guest'
          : (directoryUser?.name ?? 'Unknown User'),
        email: isExternal ? (participant.email ?? '') : (directoryUser?.email ?? ''),
        isExternal,
        isCurrentUser: Boolean(participant.isCurrentUser),
        hasJoined,
      };
    });
  }, [currentUserId, fullParticipants, previewParticipants, usersById]);

  return {
    participants,
    isLoading: isEnabled && !hasFullParticipants && fullParticipantsDetails.type !== 'complete',
  };
}
