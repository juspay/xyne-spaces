import { useEffect, useMemo, useState } from 'react';
import type { Call } from '@xyne/shared';

import { useQuery } from '@/src/hooks/useQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { queries } from '@/src/zero/queries';

import { callDetailService } from '../services/call-detail-service';
import {
  buildParticipantEvents,
  buildRecordedSpans,
  parseMarkedItems,
  type CallRecordingSession,
  type MarkedItem,
  type ParticipantEvent,
  type RecordedSpan,
} from '../utils/call-detail-format';

export interface RosterParticipant {
  userId: string;
  name: string;
  email: string | null;
  picture: string | null;
  joinedAtMs: number | null;
  leftAtMs: number | null;
  isHost: boolean;
  isSelf: boolean;
  response: string;
}

export interface CallTimelineData {
  participants: RosterParticipant[];
  isRosterLoading: boolean;
  markedItems: MarkedItem[];
  participantEvents: ParticipantEvent[];
  recordedSpans: RecordedSpan[];
  /** Null while the call is live — nothing settled to draw. */
  spanSeconds: number | null;
}

/** Full roster (the call row only carries the viewer's own participant row). */
function useCallRoster(
  call: Call | undefined,
  currentUserId: string | undefined,
): { participants: RosterParticipant[]; isLoading: boolean } {
  const users = useUsers();
  const [rows, details] = useQuery(queries.callParticipantsByCallId({ callId: call?.id ?? '' }), {
    enabled: Boolean(call?.id),
  });

  const participants = useMemo<RosterParticipant[]>(() => {
    const usersById = new Map(users.map(user => [user.id, user]));
    const list = (rows ?? []).map(row => {
      const user = usersById.get(row.userId);
      return {
        userId: row.userId,
        name: user?.name || user?.email || 'Unknown',
        email: user?.email ?? null,
        picture: user?.picture ?? null,
        joinedAtMs: row.joinedAt ?? null,
        leftAtMs: row.leftAt ?? null,
        isHost: row.userId === call?.createdByUserId,
        isSelf: row.userId === currentUserId,
        response: String(row.response ?? ''),
      };
    });
    // Host first, then those who joined (by join time), then everyone invited.
    return list.sort((left, right) => {
      if (left.isHost !== right.isHost) return left.isHost ? -1 : 1;
      if ((left.joinedAtMs === null) !== (right.joinedAtMs === null)) {
        return left.joinedAtMs === null ? 1 : -1;
      }
      return (left.joinedAtMs ?? 0) - (right.joinedAtMs ?? 0);
    });
  }, [rows, users, call?.createdByUserId, currentUserId]);

  return { participants, isLoading: Boolean(call?.id) && details.type !== 'complete' && !rows };
}

/** Recording sessions are not in Zero; fetched once the call has settled. */
function useCallRecordingSessions(
  externalId: string | undefined,
  enabled: boolean,
): CallRecordingSession[] {
  const [sessions, setSessions] = useState<CallRecordingSession[]>([]);
  useEffect(() => {
    if (!externalId || !enabled) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    callDetailService
      .listCallRecordings(externalId)
      .then(next => {
        if (!cancelled) setSessions(next);
      })
      // The timeline is still worth drawing without its recorded band.
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return (): void => {
      cancelled = true;
    };
  }, [externalId, enabled]);
  return sessions;
}

export function useCallTimeline(
  call: Call | undefined,
  currentUserId: string | undefined,
): CallTimelineData {
  const { participants, isLoading } = useCallRoster(call, currentUserId);
  const startedAt = call?.startedAt ?? null;
  const endedAt = call?.endedAt ?? null;
  const spanSeconds =
    startedAt !== null && endedAt !== null && endedAt > startedAt
      ? (endedAt - startedAt) / 1000
      : null;

  const sessions = useCallRecordingSessions(call?.externalId, spanSeconds !== null);

  const markedItems = useMemo(() => parseMarkedItems(call?.markedItems), [call?.markedItems]);
  const participantEvents = useMemo(
    () =>
      startedAt === null
        ? []
        : buildParticipantEvents(
            participants.map(p => ({ name: p.name, joinedAt: p.joinedAtMs, leftAt: p.leftAtMs })),
            startedAt,
          ),
    [participants, startedAt],
  );
  const recordedSpans = useMemo(
    () => (startedAt === null ? [] : buildRecordedSpans(sessions, startedAt)),
    [sessions, startedAt],
  );

  return {
    participants,
    isRosterLoading: isLoading,
    markedItems,
    participantEvents,
    recordedSpans,
    spanSeconds,
  };
}
