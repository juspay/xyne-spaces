import { useCallback, useMemo } from 'react';
import { useSelector } from '@xstate/react';

import {
  stateMachineActor,
  updateMyStatus,
  type PresenceStatus,
} from '@/src/machines/appStateMachine';
import { websocketService } from '@/src/services/websocketService';

export function useUsersPresence(status: PresenceStatus): string[] {
  return useSelector(stateMachineActor, state =>
    state.context.onlineUsers.filter(u => u.status === status).map(u => u.userId),
  );
}

export function useUserPresence(userId: string): {
  status: PresenceStatus;
  setStatus: (status: PresenceStatus) => void;
  isOnline: boolean;
} {
  const status = useSelector(
    stateMachineActor,
    state => {
      if (!userId) {
        return 'OFFLINE' as PresenceStatus;
      }
      return state.context.onlineUsers.find(u => u.userId === userId)?.status ?? 'OFFLINE';
    },
    (previous, next) => previous === next,
  );

  const setStatus = useCallback((newStatus: PresenceStatus) => {
    updateMyStatus(newStatus, websocketService);
  }, []);

  return useMemo(
    () => ({
      status,
      setStatus,
      isOnline: status === 'ONLINE',
    }),
    [status, setStatus],
  );
}
