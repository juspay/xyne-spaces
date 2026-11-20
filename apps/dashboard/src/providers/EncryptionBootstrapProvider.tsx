import { ReactNode, useMemo } from 'react';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
  EncryptionBootstrapContextValue,
} from '@xyne/shared/hooks';
import {
  chainTransitKeyStores,
  indexedDbTransitKeyStore,
  memoryTransitKeyStore,
} from '@xyne/shared';
import type { TransitKeyStore } from '@xyne/shared';
import { useAuth } from './AuthProvider';
import { logger, Event as LogEvent } from '../utils/logger';
import { electronTransitKeyStore } from '../services/electronTransitKeyStore';

function logFallback(error: unknown): void {
  logger.warn(LogEvent.FRONTEND_ERROR, {
    type: 'transit_key',
    message: '[TransitKey] Falling back to the next transit key store',
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Above the main process's own limit for choosing its key (SELECT_TIMEOUT_MS, 5 s), so a window
 * never gives up on the shared key while the main process is still choosing it.
 */
const DESKTOP_STORE_TIMEOUT_MS = 12_000;

/**
 * Desktop builds with the key API: the main process's key (Secure Enclave on macOS), shared by
 * every window. Only if this window cannot reach it, the persisted IndexedDB pair, which survives
 * reloads so data already encrypted for it stays readable. Never a key for this page load: the
 * next reload would register a new one, and what was encrypted for the old one is lost.
 * Browser, and desktop builds from before the key API: the persisted IndexedDB pair, which all
 * windows share, else one for this page load.
 */
function selectTransitKeyStore(): TransitKeyStore {
  if (window.electronAPI?.transitKey) {
    return chainTransitKeyStores([electronTransitKeyStore, indexedDbTransitKeyStore], {
      onFallback: logFallback,
      timeoutMs: DESKTOP_STORE_TIMEOUT_MS,
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
