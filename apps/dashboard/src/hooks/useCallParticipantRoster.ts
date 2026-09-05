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
  /**
   * Epoch ms of the latest join/leave, for placing them on a timeline. One row per
   * person, so a rejoin overwrites the earlier join — latest, not a history.
   */
  joinedAtMs: number | null;
  leftAtMs: number | null;
}

interface UseCallParticipantRosterResult {
  participants: CallParticipantRow[];
  isLoading: boolean;
}

/**
 * Merges a call's inlined participants with its preview ids and — when the inlined
 * list is known to be truncated — the full roster fetched from Zero.
 *
 * `isEnabled` gates that fetch, so a caller not showing the roster yet costs
 * nothing. The inlined and preview participants resolve either way, which is what
 * lets a trigger render avatars before anything is opened.
 *
 * `call` is nullable because screens route on state that may not have arrived yet
 * and hooks cannot be called conditionally — an absent call yields an empty roster.
 */
export function useCallParticipantRoster(
  call: Call | null | undefined,
  isEnabled: boolean,
  currentUserId: string | undefined,
): UseCallParticipantRosterResult {
  const hasFullParticipants =
    call?.status === CallStatus.ACTIVE ||
    (call?.participantCount !== null &&
      call?.participantCount !== undefined &&
      call.participantCount <= (call.participants?.length ?? 0));

  const [fullParticipants, fullParticipantsDetails] = useCachedQuery(
    queries.callParticipantsByCallId({ callId: call?.id ?? '' }),
    {
      enabled: Boolean(call) && isEnabled && !hasFullParticipants,
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
    () => getPreviewParticipantEntries(call?.participantPreviewUserIds, currentUserId).slice(0, 3),
    [call?.participantPreviewUserIds, currentUserId],
  );

  const previewParticipants = useMemo(() => {
    const nextParticipants: MergedParticipant[] = [];
    const seen = new Set<string>();

    for (const participant of call?.participants ?? []) {
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
  }, [call?.participants, currentUserId, previewParticipantEntries]);

  const participants = useMemo<CallParticipantRow[]>(() => {
    const merged = [...previewParticipants];
    const seen = new Set(merged.map(participant => participant.userId));

    for (const participant of fullParticipants ?? []) {
      if (participant.userId && !seen.has(participant.userId)) {
        merged.push({ ...participant, isCurrentUser: participant.userId === currentUserId });
        seen.add(participant.userId);
      }
    }

    return merged.map(participant => {
      const isExternal = Boolean(participant.isExternal);
      const directoryUser = usersById.get(participant.userId);

      return {
        userId: participant.userId,
        name: isExternal
          ? participant.displayName || 'Guest'
          : (directoryUser?.name ?? 'Unknown User'),
        email: isExternal ? (participant.email ?? '') : (directoryUser?.email ?? ''),
        isExternal,
        isCurrentUser: Boolean(participant.isCurrentUser),
        // `joinedAt` is the authoritative signal; preview-only rows fall back to
        // the flag carried in the preview payload.
        hasJoined:
          participant.joinedAt !== null && participant.joinedAt !== undefined
            ? true
            : Boolean(participant.previewHasJoined),
        joinedAtMs: typeof participant.joinedAt === 'number' ? participant.joinedAt : null,
        leftAtMs: typeof participant.leftAt === 'number' ? participant.leftAt : null,
      };
    });
  }, [currentUserId, fullParticipants, previewParticipants, usersById]);

  return {
    participants,
    isLoading:
      Boolean(call) &&
      isEnabled &&
      !hasFullParticipants &&
      fullParticipantsDetails.type !== 'complete',
  };
}
