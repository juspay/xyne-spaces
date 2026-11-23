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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logFallback(error: unknown): void {
  logger.warn(LogEvent.FRONTEND_ERROR, {
    type: 'transit_key',
    message: '[TransitKey] Falling back to the next transit key store',
    error: errorMessage(error),
  });
}

/** One wait for the main process's key; it chooses a tier with helpers capped at 3 s each. */
const DESKTOP_STORE_TIMEOUT_MS = 12_000;

/** Waits between retries of the main process's key; the last one repeats. */
const DESKTOP_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/**
 * The main process holds no platform key, and will not for this launch. The text crosses IPC
 * (which keeps only the message) and is the one older desktop builds reject with too.
 */
function isNoPlatformKey(error: unknown): boolean {
  return errorMessage(error).includes('No platform transit key');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Desktop transit key timed out')), timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * The main process's key, retried until it answers; the persisted IndexedDB pair only when the
 * main process says it holds no platform key, which it then says to every window. Never this
 * window's own key on a slow or failing main process: windows share one session, so a window
 * with a different key would overwrite the key the others registered.
 */
const desktopTransitKeyStore: TransitKeyStore = {
  async getOrCreate() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withTimeout(electronTransitKeyStore.getOrCreate(), DESKTOP_STORE_TIMEOUT_MS);
      } catch (error: unknown) {
        if (isNoPlatformKey(error)) {
          logFallback(error);
          return indexedDbTransitKeyStore.getOrCreate();
        }
        const delayMs =
          DESKTOP_RETRY_DELAYS_MS[Math.min(attempt, DESKTOP_RETRY_DELAYS_MS.length - 1)];
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'transit_key',
          message: '[TransitKey] Desktop transit key unavailable; retrying',
          error: errorMessage(error),
          attempt,
          delayMs,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  },
};

/**
 * Desktop builds with the key API: the main process's key (Secure Enclave on macOS), shared by
 * every window, or every window's persisted IndexedDB pair where the main process holds none.
 * Never a key for this page load: the next reload would register a new one, and what was
 * encrypted for the old one is lost.
 * Browser, and desktop builds from before the key API: the persisted IndexedDB pair, which all
 * windows share, else one for this page load.
 */
function selectTransitKeyStore(): TransitKeyStore {
  if (window.electronAPI?.transitKey) {
    return desktopTransitKeyStore;
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
