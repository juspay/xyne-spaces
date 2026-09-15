import { ReactNode, useMemo } from 'react';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
  EncryptionBootstrapContextValue,
} from '@xyne/shared/hooks';
import { useAuth } from './AuthProvider';
import {
  getStoredSessionKey,
  storeSessionKey,
  clearSessionKey,
  acquireSessionKeyLock,
} from '../services/sessionKeyStore';

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
  const options = useMemo(
    () => ({
      getStoredKey: async (fingerprint: string): Promise<CryptoKey | null> => {
        return acquireSessionKeyLock(fingerprint, async () => {
          return getStoredSessionKey(fingerprint);
        });
      },
      storeKey: async (fingerprint: string, key: CryptoKey): Promise<void> => {
        return acquireSessionKeyLock(fingerprint, async () => {
          return storeSessionKey(fingerprint, key);
        });
      },
      clearStoredKey: async (fingerprint: string): Promise<void> => {
        return acquireSessionKeyLock(fingerprint, async () => {
          return clearSessionKey(fingerprint);
        });
      },
    }),
    [],
  );

  const state = useEncryptionBootstrapInit(scope, options);

  const value: EncryptionBootstrapContextValue = useMemo(
    () => ({
      config: state.config,
      key: state.key,
      sessionFingerprint: state.sessionFingerprint,
      isReady: state.isReady,
      error: state.error,
      reset: state.reset,
    }),
    [state],
  );

  return <SharedProvider value={value}>{children}</SharedProvider>;
}
