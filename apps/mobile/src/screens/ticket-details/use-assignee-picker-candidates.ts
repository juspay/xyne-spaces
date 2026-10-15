import { useMemo } from 'react';
import type { User } from '@xyne/shared';

import { useQuery } from '@/src/hooks/useQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import { isUserDeactivated } from '@/src/utils/statusUtils';
import { queries } from '@/src/zero/queries';

import { normalizeGroupId } from './assignment-utils';

const DEFAULT_MAX_VISIBLE = 10;

type UseAssigneePickerCandidatesArgs = {
  channelId: string;
  userGroupId: string | null;
  query: string;
  selectedUserId: string | null;
  maxVisible?: number;
};

type UseAssigneePickerCandidatesResult = {
  candidates: User[];
  emptyLabel: string;
};

/**
 * Loads channel + assignment-group members, then filters / sorts / caps them
 * for the ticket assignee picker.
 */
export function useAssigneePickerCandidates({
  channelId,
  userGroupId,
  query,
  selectedUserId,
  maxVisible = DEFAULT_MAX_VISIBLE,
}: UseAssigneePickerCandidatesArgs): UseAssigneePickerCandidatesResult {
  const users = useUsers();
  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const resolvedGroupId = normalizeGroupId(userGroupId);

  const [participants] = useQuery(queries.channelParticipants({ channelId: channelId || '' }), {
    enabled: !!channelId,
  });
  const [groupMappings] = useQuery(
    queries.getUserGroupMembers({ userGroupId: resolvedGroupId || '' }),
    { enabled: !!resolvedGroupId },
  );

  const memberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const mapping of groupMappings ?? []) {
      if (mapping.userId) ids.add(mapping.userId);
    }
    for (const participant of participants ?? []) {
      if (participant.userId) ids.add(participant.userId);
    }
    return ids;
  }, [groupMappings, participants]);

  const candidates = useMemo(() => {
    const searchLower = query.trim().toLowerCase();
    const list: User[] = [];

    for (const userId of memberIds) {
      const user = usersById.get(userId);
      if (!user || isUserDeactivated(user)) continue;
      if (searchLower) {
        const name = getUserDisplayName(user).toLowerCase();
        const email = (user.email ?? '').toLowerCase();
        if (!name.includes(searchLower) && !email.includes(searchLower)) continue;
      }
      list.push(user);
    }

    return list
      .sort((a, b) => {
        const aSel = a.id === selectedUserId ? 1 : 0;
        const bSel = b.id === selectedUserId ? 1 : 0;
        if (bSel !== aSel) return bSel - aSel;
        return getUserDisplayName(a).localeCompare(getUserDisplayName(b));
      })
      .slice(0, maxVisible);
  }, [maxVisible, memberIds, query, selectedUserId, usersById]);

  const emptyLabel =
    memberIds.size === 0
      ? 'No members found in this channel or group'
      : query.trim()
        ? 'No matching members'
        : 'No active members';

  return { candidates, emptyLabel };
}
