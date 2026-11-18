import { ReactNode, useMemo } from 'react';
import {
  EncryptionBootstrapProvider as SharedProvider,
  useEncryptionBootstrapInit,
  EncryptionBootstrapContextValue,
} from '@xyne/shared/hooks';
import { memoryTransitKeyStore } from '@xyne/shared';
import type { TransitKeyStore } from '@xyne/shared';
import { useAuth } from './AuthProvider';
import { getOrCreateTransitKeyPair } from '../services/transitKeyStore';

/** The persisted browser pair, else one for this page load. */
const transitKeyStore: TransitKeyStore = {
  getOrCreate: async () =>
    (await getOrCreateTransitKeyPair()) ?? memoryTransitKeyStore.getOrCreate(),
};

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
