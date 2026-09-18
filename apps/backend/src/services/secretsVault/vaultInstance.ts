import { createCustomEncryptionAdapter, createSecretsVault, parseHexEncryptionKey } from '@xyne/secrets-vault';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { genericEncryptionAdapter } from './genericEncryptionAdapter';

const prisma = DatabaseClient.getInstance();

if (!config.encryptionKey) {
  throw new Error('ENCRYPTION_KEY not found in environment variables');
}
const customEncryptionAdapter = createCustomEncryptionAdapter(
  parseHexEncryptionKey(config.encryptionKey),
);

export const secretsVault = createSecretsVault({
  prisma,
  encryptionAdapters: {
    generic: genericEncryptionAdapter,
    custom: customEncryptionAdapter,
  },
  isGenericEncryptionEnabled: () => Boolean(config.enc.enableDbEncryption),
  cacheTtlMs: config.secretsVault.cacheTtlMs,
});
