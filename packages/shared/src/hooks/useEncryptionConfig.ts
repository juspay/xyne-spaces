import { useContext } from 'react';
import { EncryptionBootstrapContext, EncryptionBootstrapContextValue } from './useEncryptionBootstrap.js';

export interface EncryptionConfig {
  encryptedFields: Record<string, { fields: string[]; enforceClientEncryption: boolean }>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
  publicKey: string;
}

export type EncryptionContextData = EncryptionBootstrapContextValue;

export function useEncryptionConfig(): EncryptionBootstrapContextValue {
  const ctx = useContext(EncryptionBootstrapContext);
  return ctx;
}
