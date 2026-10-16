import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';
import { usePollWhenShown } from './usePageCoverage';

export interface DlMemberSyncStatusInactive {
  active: false;
}

export interface DlMemberSyncStatusActive {
  active: true;
  memberEmail: string;
  provider: string;
  startedAt?: string;
}

export type DlMemberSyncStatus = DlMemberSyncStatusInactive | DlMemberSyncStatusActive;

export const useDlMemberSyncStatus = (
  channelId: string | null | undefined,
  enabled: boolean,
): UseQueryResult<DlMemberSyncStatus> => {
  const queryKey = ['dl-member-sync-status', channelId];
  const shown = usePollWhenShown(queryKey);
  return useQuery({
    queryKey,
    enabled: enabled && !!channelId,
    queryFn: async (): Promise<DlMemberSyncStatus> => {
      if (!channelId) return { active: false };
      const res = await apiInstance.get<DlMemberSyncStatus>(
        `/integrations/desk/${channelId}/dl-member-sync-status`,
      );
      return res.data;
    },
    refetchInterval: () => (shown() ? 5000 : false),
    refetchOnWindowFocus: () => shown(),
    refetchOnReconnect: () => shown(),
  });
};
