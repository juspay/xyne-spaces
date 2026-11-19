import { ReactElement, ReactNode, useEffect, useMemo, useRef } from 'react';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
} from '@xyne/shared/hooks';
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

  useEffect(() => {
    setActiveKeyring(state.keyring);
    if (state.keyring) {
      setSyncProxyTransitKey(state.keyring.clientPublicKey).catch((error: unknown) => {
        logger.warn(Event.ENCRYPTION_KEY_GENERATED, {
          type: 'transit_key',
          message: '[TransitKey] Could not set the sync proxy key cookie',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return (): void => setActiveKeyring(null);
  }, [state.keyring]);

  return <SharedProvider value={state}>{children}</SharedProvider>;
}
