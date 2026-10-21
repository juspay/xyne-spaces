import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';

import { useAuth } from '@/src/contexts/AuthContext';
import { ChannelService } from '@/src/services/ChannelService';

type UseOpenUserDmReturn = {
  openUserDm: (userId: string) => Promise<void>;
  busy: boolean;
};

export const useOpenUserDm = (): UseOpenUserDmReturn => {
  const router = useRouter();
  const { token } = useAuth();
  const channelService = useMemo(() => new ChannelService(token), [token]);
  const [busy, setBusy] = useState(false);

  const openUserDm = useCallback(
    async (userId: string): Promise<void> => {
      if (!userId || busy) return;
      setBusy(true);
      try {
        const dm = await channelService.createDm({ participantIds: [userId] });
        router.push(`/(protected)/chat/${dm.id}`);
      } finally {
        setBusy(false);
      }
    },
    [router, channelService, busy],
  );

  return { openUserDm, busy };
};
