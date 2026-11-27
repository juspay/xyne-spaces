import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { ZeroProvider as ZeroReactProvider } from '@rocicorp/zero/react';
import { dropAllDatabases, UpdateNeededReason, Zero } from '@rocicorp/zero';
import { useAuth } from './AuthProvider';
import { mutators } from '../zero/mutators';
import { installSyncDecryption, schema } from '@xyne/shared';
import { VITE_ZERO_SERVER } from '../config';
import { createBatchViewUpdatesWithMetrics } from '../services/otel';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { useEncryptionBootstrap } from '@xyne/shared/hooks';
import { isElectronApp } from '../utils/electronApp';
import { EncryptionSetupError } from '../components/EncryptionSetupError';

interface ZeroProviderProps {
  children: ReactNode;
}

const ZeroProvider: React.FC<ZeroProviderProps> = ({ children }): ReactElement | null => {
  const { user } = useAuth();
  const {
    isReady: encryptionReady,
    keyring,
    config: encryptionConfig,
    error: encryptionError,
    reset: retryEncryption,
  } = useEncryptionBootstrap();
  const isRefreshing = useRef(false);
  const isRecoveringRef = useRef(false);
  const refreshCount = useSelector(stateMachineActor, state => state.context.zeroRefreshCounter);
  const prevWorkspaceIdRef = useRef<string | undefined>(undefined);
  const zeroRef = useRef<Zero | null>(null);

  const [zero, setZero] = useState<Zero | null>(null);

  // Zero filters its local store, so encrypted fields are decrypted as they arrive (the wire
  // still carries ciphertext). Declared before the effect that creates Zero, so it runs first.
  useEffect(() => {
    installSyncDecryption(() => (encryptionConfig?.clientEncryptionEnabled ? keyring : 'disabled'));
  }, [encryptionConfig, keyring]);

  useEffect(() => {
    if (!user || !encryptionReady) {
      return;
    }

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
        // Close first: an open instance keeps its databases in use.
        await zeroRef.current?.close();
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
        // Desktop keeps Zero connected while hidden so badges and unread counts stay live.
        hiddenTabDisconnectDelay: isElectronApp() ? 24 * 60 * 60 * 1000 : 60000,
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

      zeroRef.current = zeroObj;
      setZero(prev => {
        void prev?.close();
        return zeroObj;
      });

      isRecoveringRef.current = false;
    };

    void initZero();
  }, [user, refreshCount, encryptionReady]);

  if (!zero) {
    // A failed setup keeps Zero closed; without this the app would sit blank.
    return encryptionError ? (
      <EncryptionSetupError error={encryptionError} onRetry={retryEncryption} />
    ) : null;
  }

  return <ZeroReactProvider zero={zero}>{children}</ZeroReactProvider>;
};

export default ZeroProvider;
