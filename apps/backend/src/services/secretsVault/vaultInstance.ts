import { createCustomEncryptionAdapter, createSecretsVault, parseHexEncryptionKey } from '@xyne/secrets-vault';
import { config } from '@/config/env';
import { CommonDatabaseClient } from '@/database/commonClient';
import { EntitySequenceService, SequenceEntityType } from '@/services/entitySequenceService';
import { genericEncryptionAdapter } from './genericEncryptionAdapter';

// SecretDefinition/SecretVersion live in the common DB, not the main one — see
// apps/backend/prisma-common/schema.prisma. Moved here so version allocation
// (EntitySequenceService) and the row insert share one database.
const prisma = CommonDatabaseClient.getInstance();

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
  allocateVersion: (secretDefinitionId) =>
    EntitySequenceService.getNextSequence(SequenceEntityType.SECRET_VERSION, secretDefinitionId),
});
