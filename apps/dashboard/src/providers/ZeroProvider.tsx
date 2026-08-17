import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { ZeroProvider as ZeroReactProvider } from '@rocicorp/zero/react';
import { dropAllDatabases, UpdateNeededReason, Zero } from '@rocicorp/zero';
import { useAuth } from './AuthProvider';
import { mutators } from '../zero/mutators';
import { schema } from '@xyne/shared';
import { VITE_ZERO_SERVER } from '../config';
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
    console.log('ZeroProvider useEffect triggered', { user, encryptionReady, refreshCount });
    if (!user || !encryptionReady) {
      return;
    }
    console.log('Initializing Zero with user', { id: user.id, workspaceId: user.workspaceId });

    const authFunction = undefined;

    const handleUpdateNeeded = async (reason: UpdateNeededReason): Promise<void> => {
      if (reason.type === 'SchemaVersionNotSupported' || reason.type === 'VersionNotSupported') {
        isRefreshing.current = true;
        try {
          await dropAllDatabases();
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
      // If workspaceId changed, drop all local databases to prevent stale cross-workspace cache
      if (prevWorkspaceId !== undefined && prevWorkspaceId !== currentWorkspaceId) {
        try {
          await dropAllDatabases();
        } catch {
          // Ignore errors during drop
        }
      }

      const zeroObj = new Zero({
        userID: user.id,
        auth: authFunction,
        server: VITE_ZERO_SERVER,
        pingTimeoutMs: 10000,
        schema,
        mutators: mutators,
        hiddenTabDisconnectDelay: 60000,
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
