import { useSelector } from '@xstate/react';
import { useMemo, useCallback } from 'react';
import { stateMachineActor, PresenceStatus, updateMyStatus } from '../machines/stateMachine';
import { websocketService } from '../services/clients/socketClient';

// Shared Map for O(1) presence lookups. The server broadcasts a fresh
// onlineUsers array on every status change org-wide; rebuilding the Map once
// per broadcast (instead of `.find()` per avatar per render) keeps lookups
// cheap with many mounted avatars.
let _presenceMapSource: unknown = null;
let _presenceMap = new Map<string, PresenceStatus>();

function getPresenceMap(
  onlineUsers: { userId: string; status: PresenceStatus }[],
): Map<string, PresenceStatus> {
  if (_presenceMapSource !== onlineUsers) {
    _presenceMapSource = onlineUsers;
    _presenceMap = new Map(onlineUsers.map(u => [u.userId, u.status]));
  }
  return _presenceMap;
}

const arrayShallowEqual = (a: string[], b: string[]): boolean =>
  a === b || (a.length === b.length && a.every((v, i) => v === b[i]));

/**
 * Hook to get all users with a specific presence status
 */
export function useUsersPresence(status: PresenceStatus): string[] {
  return useSelector(
    stateMachineActor,
    state => state.context.onlineUsers.filter(u => u.status === status).map(u => u.userId),
    arrayShallowEqual,
  );
}

/**
 * Hook to get a user's presence status and setter
 */
export function useUserPresence(userId: string): {
  status: PresenceStatus;
  setStatus: (status: PresenceStatus) => void;
} {
  // Select only this user's scalar status. Subscribing to the whole
  // onlineUsers array re-rendered EVERY mounted avatar on EVERY presence
  // broadcast (the server sends the full list org-wide on any user's change),
  // which was a constant idle CPU drain on list views.
  const status = useSelector(stateMachineActor, state =>
    userId ? (getPresenceMap(state.context.onlineUsers).get(userId) ?? 'OFFLINE') : 'OFFLINE',
  );

  const setStatus = useCallback((newStatus: PresenceStatus) => {
    updateMyStatus(newStatus, websocketService);
  }, []);

  return useMemo(() => ({ status, setStatus }), [status, setStatus]);
}
