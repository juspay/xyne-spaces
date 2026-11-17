import { ReactNode, useMemo } from 'react';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
  EncryptionBootstrapContextValue,
} from '@xyne/shared/hooks';
import {
  chainTransitKeyStores,
  deleteIndexedDbTransitKey,
  indexedDbTransitKeyStore,
  memoryTransitKeyStore,
} from '@xyne/shared';
import type { TransitKeyStore } from '@xyne/shared';
import { useAuth } from './AuthProvider';
import { logger, Event as LogEvent } from '../utils/logger';
import { isElectronApp } from '../utils/electronApp';
import { electronTransitKeyStore } from '../services/electronTransitKeyStore';

function logFallback(error: unknown): void {
  logger.warn(LogEvent.FRONTEND_ERROR, {
    type: 'transit_key',
    message: '[TransitKey] Falling back to the next transit key store',
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Desktop: the main process's key (Secure Enclave on macOS), else one for this page load —
 * never IndexedDB, and any pair earlier desktop builds left there is removed.
 * Browser: the persisted IndexedDB pair, else one for this page load.
 */
function selectTransitKeyStore(): TransitKeyStore {
  if (isElectronApp()) {
    void deleteIndexedDbTransitKey();
    return chainTransitKeyStores([electronTransitKeyStore, memoryTransitKeyStore], {
      onFallback: logFallback,
    });
  }
  return chainTransitKeyStores([indexedDbTransitKeyStore, memoryTransitKeyStore], {
    onFallback: logFallback,
  });
}

const transitKeyStore = selectTransitKeyStore();

interface EncryptionBootstrapProviderProps {
  children: ReactNode;
}

export function EncryptionBootstrapProvider({
  children,
}: EncryptionBootstrapProviderProps): React.ReactElement {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const workspaceId = user?.workspaceId ?? null;
  const scope = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId]);

  const state = useEncryptionBootstrapInit(scope, { keyStore: transitKeyStore });

  const value: EncryptionBootstrapContextValue = useMemo(
    () => ({
      config: state.config,
      keyring: state.keyring,
      isReady: state.isReady,
      error: state.error,
      reset: state.reset,
    }),
    [state],
  );

  return <SharedProvider value={value}>{children}</SharedProvider>;
}
