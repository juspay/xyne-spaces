import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { ZeroProvider as ZeroReactProvider } from '@rocicorp/zero/react';
import { UpdateNeededReason, Zero } from '@rocicorp/zero';
import { useAuth } from './AuthProvider';
import { mutators } from '../zero/mutators';
import { schema } from '@xyne/shared';
import { VITE_ZERO_SERVER, ZERO_STORAGE_KEY } from '../config';
import { dropZeroDatabases, rememberZeroLane } from '../zero/dropZeroDatabases';
import { createBatchViewUpdatesWithMetrics } from '../services/otel';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { useEncryptionBootstrap } from '@xyne/shared/hooks';
import { startSyncEngineClient, connectSyncEngineSocket } from '../services/syncEngineClient';

interface ZeroProviderProps {
  children: ReactNode;
}

const ZeroProvider: React.FC<ZeroProviderProps> = ({ children }): ReactElement | null => {
  const { user } = useAuth();
  const { isReady: encryptionReady } = useEncryptionBootstrap();
  const isRefreshing = useRef(false);
  const isRecoveringRef = useRef(false);
  const refreshCount = useSelector(stateMachineActor, state => state.context.zeroRefreshCounter);
  const prevWorkspaceIdRef = useRef<string | undefined>(undefined);

  const [zero, setZero] = useState<Zero | null>(null);
  // Initialize the shared-base sync engine client once (no-op unless enabled). Optimistic-overlay
  // retirement is driven by each mutation's server result (the sync engine hooks Zero's MutationTracker
  // in initSyncEngine), NOT Zero's lastMutationID() — that is the optimistic local counter.
  useEffect(() => {
    startSyncEngineClient();
  }, []);

  useEffect(() => {
    if (!user || !encryptionReady) {
      return;
    }

    // Open the sync engine's socket here, alongside Zero's own connect below — BEFORE InitialStateLoader
    // gates on sync-routed queries. Otherwise the socket only opens via post-gate feature components and
    // the boot gate deadlocks (gate → sync → socket → gate). No-op if the engine is disabled.
    connectSyncEngineSocket();

    const authFunction = undefined;

    const handleUpdateNeeded = async (reason: UpdateNeededReason): Promise<void> => {
      if (reason.type === 'SchemaVersionNotSupported' || reason.type === 'VersionNotSupported') {
        isRefreshing.current = true;
        try {
          await dropZeroDatabases();
        } catch {
          // Ignore errors during drop
        }
        window.location.reload();
        isRefreshing.current = false;
      }
    };

    const handleClientStateNotFound = (): void => {
      if (isRecoveringRef.current) {
        return;
      }
      isRecoveringRef.current = true;
      stateMachineActor.send({ type: 'REFRESH_ZERO' });
    };

    const prevWorkspaceId = prevWorkspaceIdRef.current;
    const currentWorkspaceId = user.workspaceId ?? '';
    prevWorkspaceIdRef.current = currentWorkspaceId;

    const initZero = async (): Promise<void> => {
      // If workspaceId changed, drop this lane's local databases to prevent stale
      // cross-workspace cache. Scoped so a sibling bundle on the same origin keeps its own.
      if (prevWorkspaceId !== undefined && prevWorkspaceId !== currentWorkspaceId) {
        try {
          await dropZeroDatabases();
        } catch {
          // Ignore errors during drop
        }
      }

      const zeroObj = new Zero({
        userID: user.id,
        auth: authFunction,
        server: VITE_ZERO_SERVER,
        // Empty in single-lane builds, which keeps the storage name unchanged.
        ...(ZERO_STORAGE_KEY ? { storageKey: ZERO_STORAGE_KEY } : {}),
        pingTimeoutMs: 10000,
        schema,
        mutators: mutators,
        hiddenTabDisconnectDelay: 600000,
        context: {
          userID: user.id,
          workspaceId: currentWorkspaceId,
          role: user.role,
          orgRole: user.orgRole,
          memberId: user.memberId,
        },
        maxHeaderLength: 3072,
        batchViewUpdates: createBatchViewUpdatesWithMetrics(),
        onUpdateNeeded: (reason: UpdateNeededReason): void => {
          void handleUpdateNeeded(reason);
        },
        onClientStateNotFound: handleClientStateNotFound,
      });

      // Cache which lane this document's Zero storage belongs to, so a later
      // logout can scope its drop after the client has been torn down.
      rememberZeroLane(zeroObj.idbName);

      setZero(prev => {
        void prev?.close();
        return zeroObj;
      });

      isRecoveringRef.current = false;
    };

    void initZero();
  }, [user, refreshCount, encryptionReady]);

  if (!zero) {
    return null;
  }

  return <ZeroReactProvider zero={zero}>{children}</ZeroReactProvider>;
};

export default ZeroProvider;
