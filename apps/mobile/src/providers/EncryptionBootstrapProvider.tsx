import { ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import { transitKeyStore } from '../services/encryption/transitKeyStores';
import { installMobileTransitPlatform } from '../services/encryption/transitPlatform';
import { Event, logger } from '../utils/logger';

/** Auth session the key was last registered for; process-wide, like the shared bootstrap cache. */
let registeredGeneration: number | null = null;

/**
 * Transit encryption for the app, as the dashboard has it: the Keystore key is registered with
 * the session, the keyring and manifest go to the shared Zero hooks, and the key is handed to
 * the API client and the sync proxy.
 */
export function EncryptionBootstrapProvider({ children }: { children: ReactNode }): ReactElement {
  const { user, token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const installed = useRef(false);
  if (!installed.current) {
    installMobileTransitPlatform(() => tokenRef.current);
    installed.current = true;
  }

  const userId = user?.user_id ?? null;
  const workspaceId = user?.workspaceId ?? null;
  const scope = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId]);
  const state = useEncryptionBootstrapInit(scope, { keyStore: transitKeyStore });

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

  const { keyring } = state;
  useEffect(() => {
    setActiveKeyring(keyring);
    if (keyring) {
      let cancelled = false;
      setSyncProxyTransitKey(keyring.clientPublicKey)
        .then(() => {
          if (!cancelled) setCookie({ keyring, error: null });
        })
        .catch((error: unknown) => {
          logger.warn(Event.ENCRYPTION_KEY_GENERATED, {
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
  }, [keyring]);

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

  return <SharedProvider value={value}>{children}</SharedProvider>;
}
