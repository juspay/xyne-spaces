import { ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
} from '@xyne/shared/hooks';
import type { EncryptionBootstrapContextValue } from '@xyne/shared/hooks';
import type { TransitKeyring } from '@xyne/shared';
import { useAuth } from '../contexts/AuthContext';
import { getAuthSessionGeneration } from '../services/authSessionLifecycle';
import { setActiveKeyring } from '../services/encryption/activeKeyring';
import { setSyncProxyTransitKey } from '../services/encryption/syncProxyKeyCookie';
import {
  TransitKeyModuleMissingError,
  transitKeyStore,
} from '../services/encryption/transitKeyStores';
import { installMobileTransitPlatform } from '../services/encryption/transitPlatform';
import { Event, logger } from '../utils/logger';

/** Auth session the key was last registered for; process-wide, like the shared bootstrap cache. */
let registeredGeneration: number | null = null;

/** Timed retry of a failed setup: 1 s, doubling, at most every 30 s. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Transit encryption for the app, as the dashboard has it: the Keystore key is registered with
 * the session, the keyring and manifest go to the shared Zero hooks, and the key is handed to
 * the API client and the sync proxy.
 */
export function EncryptionBootstrapProvider({ children }: { children: ReactNode }): ReactElement {
  const { user, token } = useAuth();

  const installed = useRef(false);
  if (!installed.current) {
    installMobileTransitPlatform();
    installed.current = true;
  }

  const userId = user?.user_id ?? null;
  const workspaceId = user?.workspaceId ?? null;
  const scope = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId]);
  const state = useEncryptionBootstrapInit(scope, { keyStore: transitKeyStore, logger });

  // Each sign-in is a new server session (the shell can stay mounted through it), so register again.
  const { reset } = state;
  useEffect(() => {
    const generation = getAuthSessionGeneration();
    if (registeredGeneration !== null && registeredGeneration !== generation) reset();
    registeredGeneration = generation;
  }, [token, reset]);

  // The keyring the `xk` cookie was set for, or why it could not be.
  const [cookie, setCookie] = useState<{ keyring: TransitKeyring; error: Error | null } | null>(
    null,
  );

  // The API client encrypts bodies and decrypts responses only under API client encryption, as
  // the dashboard does; the cookie is for Zero, which encrypts whenever there is a keyring.
  const { keyring, config } = state;
  const apiEncryption = config?.apiClientEncryptionEnabled === true;
  useEffect(() => {
    setActiveKeyring(apiEncryption ? keyring : null);
    if (keyring) {
      let cancelled = false;
      setSyncProxyTransitKey(keyring.clientPublicKey)
        .then(() => {
          if (!cancelled) setCookie({ keyring, error: null });
        })
        .catch((error: unknown) => {
          logger.error(Event.ENCRYPTION_KEY_REGISTRATION_FAILED, {
            type: 'transit_key',
            message: '[TransitKey] Could not set the sync proxy key cookie',
            error: error instanceof Error ? error.message : String(error),
          });
          if (!cancelled) {
            setCookie({
              keyring,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        });
      return (): void => {
        cancelled = true;
        setActiveKeyring(null);
      };
    }
    return (): void => setActiveKeyring(null);
  }, [keyring, apiEncryption]);

  // Ready only once the cookie is set: the sync proxy reads the key from it once, when the Zero
  // websocket connects, so a Zero opened before it would get every encrypted field withheld.
  const cookieState = keyring && cookie?.keyring === keyring ? cookie : null;
  const value: EncryptionBootstrapContextValue = useMemo(
    () => ({
      ...state,
      isReady: state.isReady && (!keyring || cookieState?.error === null),
      error: state.error ?? cookieState?.error ?? null,
    }),
    [state, keyring, cookieState],
  );

  // A failed setup is kept until reset and Zero stays closed on it, so try again when the app
  // comes back to the foreground or the network comes back (not on any online report: NetInfo
  // fires one on subscribe, and a server error would then retry in a loop).
  const failed = value.error !== null;
  const needsAppUpdate = value.error instanceof TransitKeyModuleMissingError;
  const retryAttempt = useRef(0);
  useEffect(() => {
    if (value.isReady) retryAttempt.current = 0;
  }, [value.isReady]);
  useEffect(() => {
    if (!failed) return;
    // Also retry on a timer, for errors while online and in the foreground; a binary without
    // the native key module never succeeds, so it waits for the update screen instead.
    const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt.current, RETRY_MAX_MS);
    retryAttempt.current += 1;
    const timer = needsAppUpdate ? undefined : setTimeout(reset, delay);
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') reset();
    });
    let wasOffline = false;
    const unsubscribeNetInfo = NetInfo.addEventListener(net => {
      const online = net.isConnected === true && net.isInternetReachable !== false;
      if (!online) {
        wasOffline = true;
      } else if (wasOffline) {
        wasOffline = false;
        reset();
      }
    });
    return (): void => {
      clearTimeout(timer);
      appState.remove();
      unsubscribeNetInfo();
    };
  }, [failed, needsAppUpdate, reset]);

  return <SharedProvider value={value}>{children}</SharedProvider>;
}
