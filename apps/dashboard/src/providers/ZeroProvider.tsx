import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { ZeroProvider as ZeroReactProvider } from '@rocicorp/zero/react';
import { UpdateNeededReason, Zero } from '@rocicorp/zero';
import { useAuth } from './AuthProvider';
import { mutators } from '../zero/mutators';
import { schema } from '@xyne/shared';
import { VITE_ZERO_SERVER, ZERO_STORAGE_KEY } from '../config';
import { dropZeroDatabases, rememberZeroLane } from '../zero/dropZeroDatabases';
import { isCallWindow } from '../utils/electronApp';
import { isCallWindowActive } from '../utils/callWindowChannel';
import { createBatchViewUpdatesWithMetrics } from '../services/otel';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { useEncryptionBootstrap } from '@xyne/shared/hooks';

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

  useEffect(() => {
    if (!user || !encryptionReady) {
      return;
    }

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
    const needsDrop = prevWorkspaceId !== undefined && prevWorkspaceId !== currentWorkspaceId;
    const deferDrop = needsDrop && isCallWindowActive();
    if (!deferDrop) {
      prevWorkspaceIdRef.current = currentWorkspaceId;
    }

    const initZero = async (): Promise<void> => {
      // If workspaceId changed, drop this lane's local databases to prevent stale
      // cross-workspace cache. Scoped so a sibling bundle on the same origin keeps its own.
      if (needsDrop && !deferDrop) {
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
        hiddenTabDisconnectDelay: isCallWindow() ? 24 * 60 * 60 * 1000 : 60000,
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
