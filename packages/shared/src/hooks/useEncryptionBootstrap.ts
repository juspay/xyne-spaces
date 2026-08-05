import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { fetchEncryptionConfig, registerClientKey } from '../crypto/key-exchange.js';
import { decryptionCache } from '../crypto/decryption-cache.js';
import { consoleLogger, Event } from '../logger/index.js';

export interface EncryptionConfig {
  encryptedFields: Record<string, { fields: string[]; enforceClientEncryption: boolean }>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
  publicKey: string;
}

export interface EncryptionBootstrapState {
  config: EncryptionConfig | null;
  key: CryptoKey | null;
  sessionFingerprint: string | null;
  isReady: boolean;
  error: Error | null;
}

export interface EncryptionBootstrapContextValue extends EncryptionBootstrapState {
  reset: () => void;
}

export const EncryptionBootstrapContext = createContext<EncryptionBootstrapContextValue>({
  config: null,
  key: null,
  sessionFingerprint: null,
  isReady: false,
  error: null,
  reset: () => {},
});

export const EncryptionBootstrapProvider = EncryptionBootstrapContext.Provider;
export const useEncryptionBootstrap = (): EncryptionBootstrapContextValue =>
  useContext(EncryptionBootstrapContext);

interface BootstrapOptions {
  getStoredKey?: (fingerprint: string) => Promise<CryptoKey | null>;
  storeKey?: (fingerprint: string, key: CryptoKey) => Promise<void>;
  clearStoredKey?: (fingerprint: string) => Promise<void>;
}

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
  key: null,
  sessionFingerprint: null,
  isReady: false,
  error: null,
});

async function performBootstrap(options: BootstrapOptions = {}): Promise<EncryptionBootstrapState> {
  const result = await fetchEncryptionConfig();

  if (!result) {
    consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_START, {
      message: '[encryptionlog] Encryption not configured on server',
    });
    return {
      config: null,
      key: null,
      sessionFingerprint: null,
      isReady: true,
      error: null,
    };
  }

  consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_START, {
    message: '[encryptionlog] Encryption config fetched',
    clientEncryptionEnabled: result.clientEncryptionEnabled,
    apiClientEncryptionEnabled: result.apiClientEncryptionEnabled,
  });

  const config: EncryptionConfig = {
    publicKey: result.publicKey,
    encryptedFields: result.encryptedFields,
    clientEncryptionEnabled: result.clientEncryptionEnabled,
    apiClientEncryptionEnabled: result.apiClientEncryptionEnabled,
  };

  const keyRegistrationRequired = result.clientEncryptionEnabled || result.apiClientEncryptionEnabled;

  if (!keyRegistrationRequired) {
    return {
      config,
      key: null,
      sessionFingerprint: null,
      isReady: true,
      error: null,
    };
  }

  const sessionFingerprint = result.sessionFingerprint ?? null;

  if (sessionFingerprint && options.getStoredKey) {
    try {
      const storedKey = await options.getStoredKey(sessionFingerprint);
      if (storedKey) {
        consoleLogger.info(Event.ENCRYPTION_KEY_REGISTRATION_START, {
          message: '[encryptionlog] Encryption key restored from storage',
        });
        return {
          config,
          key: storedKey,
          sessionFingerprint,
          isReady: true,
          error: null,
        };
      }
    } catch (err) {
      consoleLogger.warn(Event.ENCRYPTION_CONFIG_FETCH_FAILED, {
        message: '[encryptionlog] Failed to restore encryption key from storage',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const registration = await registerClientKey(result.publicKey);

  if (!registration) {
    const error = new Error('Failed to register client encryption key');
    consoleLogger.error(Event.ENCRYPTION_CONFIG_FETCH_FAILED, {
      message: '[encryptionlog] registerClientKey returned null',
    });
    return {
      config,
      key: null,
      sessionFingerprint: null,
      isReady: true,
      error,
    };
  }

  if (registration.sessionFingerprint && options.storeKey) {
    try {
      await options.storeKey(registration.sessionFingerprint, registration.key);
    } catch (err) {
      consoleLogger.warn(Event.ENCRYPTION_CONFIG_FETCH_FAILED, {
        message: '[encryptionlog] Failed to persist encryption key',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    config,
    key: registration.key,
    sessionFingerprint: registration.sessionFingerprint,
    isReady: true,
    error: null,
  };
}

export function useEncryptionBootstrapInit(
  scope: EncryptionBootstrapScope,
  options: BootstrapOptions = {},
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
      globalFetch = {
        scopeKey,
        promise: performBootstrap(options),
      };
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
              isReady: true,
              error: err instanceof Error ? err : new Error(String(err)),
            },
          });
        }
      });
  }, [options, bootstrapVersion, scopeKey]);

  const state = scopedState.scopeKey === scopeKey ? scopedState.state : initialState();
  return { ...state, reset };
}

export function resetGlobalEncryptionBootstrap(): void {
  globalFetch = null;
}
