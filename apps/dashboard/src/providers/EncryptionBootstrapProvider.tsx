import { ReactNode, useMemo } from 'react';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
  EncryptionBootstrapContextValue,
} from '@xyne/shared/hooks';
import { indexedDbTransitKeyStore, TransitKeyUnavailableError } from '@xyne/shared';
import type { TransitKeyStore } from '@xyne/shared';
import { useAuth } from './AuthProvider';
import { logger, Event as LogEvent } from '../utils/logger';
import { electronTransitKeyStore } from '../services/electronTransitKeyStore';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One wait for the main process's key; its helpers are capped at 3 s each. */
const DESKTOP_STORE_TIMEOUT_MS = 12_000;

/**
 * Waits before each retry of the main process's key, for a slow start (a helper spinning up, a
 * busy TPM); after the last one the failure goes to the user, who can retry from there.
 */
const DESKTOP_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Desktop transit key timed out')), timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * The main process's key, shared by every window, retried a few times. Never this window's own
 * key on a slow or failing main process: windows share one session, so a window with a different
 * key would overwrite the key the others registered.
 */
const desktopTransitKeyStore: TransitKeyStore = {
  async getOrCreate() {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withTimeout(electronTransitKeyStore.getOrCreate(), DESKTOP_STORE_TIMEOUT_MS);
      } catch (error: unknown) {
        if (attempt >= DESKTOP_RETRY_DELAYS_MS.length) {
          // A timeout here is the key store's failure too, so the user sees it as one.
          throw error instanceof TransitKeyUnavailableError
            ? error
            : new TransitKeyUnavailableError('desktop', errorMessage(error));
        }
        const delayMs = DESKTOP_RETRY_DELAYS_MS[attempt];
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
 * Each host has one store. Desktop builds with the key API: the main process's key (Secure
 * Enclave, TPM, or the platform's software store where the machine has neither). Browsers, and
 * desktop builds from before the key API: the persisted IndexedDB pair, which all tabs share.
 */
const transitKeyStore: TransitKeyStore = window.electronAPI?.transitKey
  ? desktopTransitKeyStore
  : indexedDbTransitKeyStore;

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

  const state = useEncryptionBootstrapInit(scope, { keyStore: transitKeyStore, logger });

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
