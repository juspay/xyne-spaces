import { useMemo } from 'react';
import { useUsersById } from '@xyne/shared/hooks';

import { useQuery } from '@/src/hooks/useQuery';
import { useSelf } from '@/src/hooks/useUsers';
import { queries } from '@/src/zero/queries';

import type { ScheduleCallUser } from './useScheduleCallForm';

export function useChannelMembers(channelId: string | null): ScheduleCallUser[] | null {
  const self = useSelf();
  const usersById = useUsersById();
  const [rows, details] = useQuery(queries.channelParticipants({ channelId: channelId ?? '' }), {
    enabled: channelId !== null,
  });

  return useMemo(() => {
    if (channelId === null || details.type !== 'complete') return null;
    return rows
      .filter(row => row.userId !== self?.id)
      .map(row => {
        const user = usersById.get(row.userId);
        const email = user?.email ?? '';
        return {
          id: row.userId,
          name: user?.name ?? (email || 'Unknown'),
          email,
          picture: user?.picture ?? null,
        };
      });
  }, [channelId, details.type, rows, self?.id, usersById]);
}
