import { useEffect, useRef } from 'react';
import { useEncryptionBootstrap } from '@xyne/shared/hooks';
import { encryptionActor } from '../machines/encryptionMachine.js';

export function EncryptionInit(): null {
  const { config, key, sessionFingerprint, isReady } = useEncryptionBootstrap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!isReady || !config || hasInitialized.current) {
      return;
    }

    hasInitialized.current = true;
    encryptionActor.send({ type: 'INIT', config, sessionFingerprint, key });
  }, [config, key, sessionFingerprint, isReady]);

  return null;
}
