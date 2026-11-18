import { useContext } from 'react';
import { EncryptionBootstrapContext, EncryptionBootstrapContextValue } from './useEncryptionBootstrap.js';

export type { EncryptionConfig } from '../crypto/transit.js';
export type EncryptionContextData = EncryptionBootstrapContextValue;

export function useEncryptionConfig(): EncryptionBootstrapContextValue {
  return useContext(EncryptionBootstrapContext);
}
