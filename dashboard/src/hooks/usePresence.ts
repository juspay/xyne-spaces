import { useSelector } from '@xstate/react';
import { useMemo, useCallback } from 'react';
import { stateMachineActor, PresenceStatus, updateMyStatus } from '../machines/stateMachine';
import { websocketService } from '../services/clients/socketClient';

/**
 * Hook to get all users with a specific presence status
 */
export function useUsersPresence(status: PresenceStatus): string[] {
  return useSelector(stateMachineActor, state =>
    state.context.onlineUsers.filter(u => u.status === status).map(u => u.userId),
  );
}

/**
 * Hook to get a user's presence status and setter
 */
export function useUserPresence(userId: string): {
  status: PresenceStatus;
  setStatus: (status: PresenceStatus) => void;
} {
  const onlineUsers = useSelector(stateMachineActor, state => state.context.onlineUsers);

  const status = useMemo(() => {
    if (!userId) return 'OFFLINE';
    const user = onlineUsers.find(u => u.userId === userId);
    return user?.status ?? 'OFFLINE';
  }, [onlineUsers, userId]);

  const setStatus = useCallback((newStatus: PresenceStatus) => {
    updateMyStatus(newStatus, websocketService);
  }, []);

  return useMemo(() => ({ status, setStatus }), [status, setStatus]);
}
