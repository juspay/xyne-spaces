import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { fetchEncryptionConfig, handshake } from '../crypto/handshake.js';
import type { EncryptionConfig } from '../crypto/handshake.js';
import { TransitKeyring } from '../crypto/keyring.js';
import { decryptionCache } from '../crypto/decryption-cache.js';
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

async function performBootstrap(): Promise<EncryptionBootstrapState> {
  const config = await fetchEncryptionConfig();

  consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_START, {
    message: '[encryptionlog] Encryption config fetched',
    clientEncryptionEnabled: config.clientEncryptionEnabled,
    apiClientEncryptionEnabled: config.apiClientEncryptionEnabled,
  });

  if (!config.clientEncryptionEnabled && !config.apiClientEncryptionEnabled) {
    return { config, keyring: null, isReady: true, error: null };
  }

  const keyring = new TransitKeyring(handshake);
  await keyring.init();

  consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_SUCCESS, {
    message: '[encryptionlog] Transit key established',
  });

  return { config, keyring, isReady: true, error: null };
}

export function useEncryptionBootstrapInit(
  scope: EncryptionBootstrapScope,
): EncryptionBootstrapContextValue {
  const scopeKey = JSON.stringify([scope.workspaceId, scope.userId]);
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
  }

  const reset = useCallback(() => {
    globalFetch = null;
    requestVersion.current += 1;
    decryptionCache.clear();
    setScopedState({ scopeKey, state: initialState() });
    setBootstrapVersion(version => version + 1);
  }, [scopeKey]);

  useEffect(() => {
    const activeRequestVersion = ++requestVersion.current;
    setScopedState(current =>
      current.scopeKey === scopeKey ? current : { scopeKey, state: initialState() },
    );

    if (!globalFetch || globalFetch.scopeKey !== scopeKey) {
      globalFetch = { scopeKey, promise: performBootstrap() };
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
