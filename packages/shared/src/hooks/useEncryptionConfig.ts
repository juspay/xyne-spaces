import { useContext } from 'react';
import { EncryptionBootstrapContext, EncryptionBootstrapContextValue } from './useEncryptionBootstrap.js';
import type { EncryptedTableConfig } from '../zero/query-validation.js';

export interface EncryptionConfig {
  encryptedFields: Record<string, EncryptedTableConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
  publicKey: string;
}

export type EncryptionContextData = EncryptionBootstrapContextValue;

export function useEncryptionConfig(): EncryptionBootstrapContextValue {
  const ctx = useContext(EncryptionBootstrapContext);
  return ctx;
}
