import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

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
  return useQuery({
    queryKey: ['dl-member-sync-status', channelId],
    enabled: enabled && !!channelId,
    queryFn: async (): Promise<DlMemberSyncStatus> => {
      if (!channelId) return { active: false };
      const res = await apiInstance.get<DlMemberSyncStatus>(
        `/integrations/desk/${channelId}/dl-member-sync-status`,
      );
      return res.data;
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
};
