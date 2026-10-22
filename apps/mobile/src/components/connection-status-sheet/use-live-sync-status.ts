import { useConnectionState } from '@rocicorp/zero/react';
import { useCallback } from 'react';
import { stateMachineActor } from '@xyne/shared/machines';

import { describeConnectionState, type ConnectionStateCopy } from './connection-status-copy';

export type LiveSyncStatus = {
  /** Zero's state name, as `useConnectionState()` reports it. */
  stateName: string;
  current: ConnectionStateCopy;
  /** Zero's reason, when it gives one (disconnected / error / closed). */
  reason: string | undefined;
  /** Kicks the state machine to reconnect, as the dashboard's Refresh does. */
  refresh: () => void;
};

/** The live-sync connection, as every indicator and explainer reads it. */
export function useLiveSyncStatus(): LiveSyncStatus {
  const connection = useConnectionState();
  const stateName = connection.name;
  const reason =
    'reason' in connection && typeof connection.reason === 'string' ? connection.reason : undefined;

  const refresh = useCallback(() => {
    stateMachineActor.send({ type: 'REFRESH_ZERO' });
  }, []);

  return { stateName, current: describeConnectionState(stateName), reason, refresh };
}
