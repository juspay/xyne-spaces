import { useEffect, useRef } from 'react';
import { useEncryptionBootstrap } from '@xyne/shared/hooks';
import { encryptionActor } from '../machines/encryptionMachine.js';

export function EncryptionInit(): null {
  const { config, keyring, isReady } = useEncryptionBootstrap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!isReady || !config || hasInitialized.current) {
      return;
    }

    hasInitialized.current = true;
    encryptionActor.send({ type: 'INIT', config, keyring });
  }, [config, keyring, isReady]);

  return null;
}
