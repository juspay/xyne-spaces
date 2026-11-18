import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchEncryptionConfig,
  fetchTransitServerKeys,
  memoryTransitKeyStore,
  registerTransitKey,
} from '../crypto/transit.js';
import type { EncryptionConfig } from '../crypto/transit.js';
import { TransitKeyring } from '../crypto/keyring.js';
import type { TransitKeyStore } from '../crypto/keyring.js';
import { decryptionCache } from '../crypto/decryption-cache.js';
import { refreshClientManifest, clearClientManifest, setClientManifestKeyring } from '../crypto/client-manifest.js';
import { consoleLogger, Event } from '../logger/index.js';

export type { EncryptionConfig };

export interface EncryptionBootstrapState {
  config: EncryptionConfig | null;
  keyring: TransitKeyring | null;
  isReady: boolean;
  error: Error | null;
}

export interface EncryptionBootstrapContextValue extends EncryptionBootstrapState {
  reset: () => void;
}

export const EncryptionBootstrapContext = createContext<EncryptionBootstrapContextValue>({
  config: null,
  keyring: null,
  isReady: false,
  error: null,
  reset: () => {},
});

export const EncryptionBootstrapProvider = EncryptionBootstrapContext.Provider;
export const useEncryptionBootstrap = (): EncryptionBootstrapContextValue =>
  useContext(EncryptionBootstrapContext);

export interface EncryptionBootstrapScope {
  workspaceId: string | null;
  userId: string | null;
}

export interface EncryptionBootstrapOptions {
  /** Where the client's transit key pair is kept; defaults to one pair per page load. */
  keyStore?: TransitKeyStore;
}

interface ScopedBootstrapState {
  scopeKey: string;
  state: EncryptionBootstrapState;
}

let globalFetch: {
  scopeKey: string;
  promise: Promise<EncryptionBootstrapState>;
} | null = null;

const initialState = (): EncryptionBootstrapState => ({
  config: null,
  keyring: null,
  isReady: false,
  error: null,
});

async function performBootstrap(keyStore: TransitKeyStore): Promise<EncryptionBootstrapState> {
  const config = await fetchEncryptionConfig();

  consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_START, {
    message: '[encryptionlog] Encryption config fetched',
    clientEncryptionEnabled: config.clientEncryptionEnabled,
    apiClientEncryptionEnabled: config.apiClientEncryptionEnabled,
  });

  if (!config.clientEncryptionEnabled && !config.apiClientEncryptionEnabled) {
    return { config, keyring: null, isReady: true, error: null };
  }

  // The client's key pair is registered with the session; the server's public keys come
  // back and the keyring derives the transit keys from both. With API client encryption
  // on, the manifest then arrives encrypted for that key, so bootstrap is not ready until
  // both are in place.
  const pair = await keyStore.getOrCreate();
  const serverKeys = await registerTransitKey(pair.publicKey);
  const keyring = new TransitKeyring(pair, serverKeys, fetchTransitServerKeys);
  if (config.apiClientEncryptionEnabled) {
    setClientManifestKeyring(keyring);
    await refreshClientManifest();
  }

  consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_SUCCESS, {
    message: '[encryptionlog] Transit key established',
  });

  return { config, keyring, isReady: true, error: null };
}

export function useEncryptionBootstrapInit(
  scope: EncryptionBootstrapScope,
  options: EncryptionBootstrapOptions = {},
): EncryptionBootstrapContextValue {
  const scopeKey = JSON.stringify([scope.workspaceId, scope.userId]);
  const keyStore = useRef(options.keyStore ?? memoryTransitKeyStore);
  keyStore.current = options.keyStore ?? memoryTransitKeyStore;
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const [scopedState, setScopedState] = useState<ScopedBootstrapState>(() => ({
    scopeKey,
    state: initialState(),
  }));
  const currentScopeKey = useRef(scopeKey);
  const requestVersion = useRef(0);

  if (currentScopeKey.current !== scopeKey) {
    currentScopeKey.current = scopeKey;
    requestVersion.current += 1;
    decryptionCache.clear();
    clearClientManifest();
  }

  const reset = useCallback(() => {
    globalFetch = null;
    requestVersion.current += 1;
    decryptionCache.clear();
    clearClientManifest();
    setScopedState({ scopeKey, state: initialState() });
    setBootstrapVersion(version => version + 1);
  }, [scopeKey]);

  useEffect(() => {
    const activeRequestVersion = ++requestVersion.current;
    setScopedState(current =>
      current.scopeKey === scopeKey ? current : { scopeKey, state: initialState() },
    );

    if (!globalFetch || globalFetch.scopeKey !== scopeKey) {
      globalFetch = { scopeKey, promise: performBootstrap(keyStore.current) };
    }

    globalFetch.promise
      .then(state => {
        if (
          currentScopeKey.current === scopeKey &&
          requestVersion.current === activeRequestVersion
        ) {
          setScopedState({ scopeKey, state });
        }
      })
      .catch(err => {
        if (
          currentScopeKey.current === scopeKey &&
          requestVersion.current === activeRequestVersion
        ) {
          setScopedState({
            scopeKey,
            state: {
              ...initialState(),
              error: err instanceof Error ? err : new Error(String(err)),
            },
          });
        }
      });
  }, [bootstrapVersion, scopeKey]);

  const state = scopedState.scopeKey === scopeKey ? scopedState.state : initialState();
  return { ...state, reset };
}

export function resetGlobalEncryptionBootstrap(): void {
  globalFetch = null;
}
