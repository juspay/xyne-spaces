import { config } from '@/config/env';
import type {
  ClientEncryptionConfig,
  EncryptBatchItem,
  EncryptedFieldConfig,
  EncryptionProvider,
  GenerateStorageKeyInput,
  ProvisionEntityInput,
  ProvisionEntityResult,
  StorageObjectKey,
  TransitHandshakeInput,
  TransitHandshakeResult,
} from './types';

function unsupported(operation: string): never {
  throw new Error(`Encryption provider does not support "${operation}"`);
}

const provider: EncryptionProvider = {
  async getClientConfig(): Promise<ClientEncryptionConfig> {
    if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) {
      return {
        encryptedFields: {},
        clientEncryptionEnabled: false,
        apiClientEncryptionEnabled: false,
      };
    }
    return unsupported('getClientConfig');
  },

  async getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>> {
    if (!config.enc.enableDbEncryption && !config.enc.enableDbDecryption) return {};
    return unsupported('getEncryptedFieldsConfig');
  },

  async transitHandshake(_input: TransitHandshakeInput): Promise<TransitHandshakeResult> {
    return unsupported('transitHandshake');
  },

  async encryptBatch(items: EncryptBatchItem[]): Promise<string[]> {
    if (!config.enc.enableDbEncryption) return items.map((item) => item.value);
    return unsupported('encryptBatch');
  },

  async decryptBatch(values: string[]): Promise<string[]> {
    if (!config.enc.enableDbEncryption) return values;
    return unsupported('decryptBatch');
  },

  async encryptResponse<T>(body: T, _subject: string): Promise<T> {
    if (!config.enc.apiClientEncryptionEnabled) return body;
    return unsupported('encryptResponse');
  },

  async decryptRequest<T>(body: T, _subject: string): Promise<T> {
    if (!config.enc.apiClientEncryptionEnabled) return body;
    return unsupported('decryptRequest');
  },

  async initializeOrg(_orgId: string): Promise<void> {
    if (!config.enc.orgProvisionEnabled) return;
    return unsupported('initializeOrg');
  },

  async provisionEntity(_input: ProvisionEntityInput): Promise<void> {
    if (!config.enc.workspaceProvisionEnabled) return;
    return unsupported('provisionEntity');
  },

  async backfillEntities(_items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]> {
    if (!config.enc.workspaceProvisionEnabled) {
      return _items.map((item) => ({
        entityId: item.entityId,
        entityType: item.entityType,
        ok: false,
        message: 'Workspace encryption is not enabled',
      }));
    }
    return unsupported('backfillEntities');
  },

  async generateStorageKey(_input: GenerateStorageKeyInput): Promise<StorageObjectKey> {
    return unsupported('generateStorageKey');
  },

  async unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]> {
    if (wrappedKeys.length === 0) return [];
    return unsupported('unwrapStorageKeys');
  },
};

export function getEncryptionProvider(): EncryptionProvider {
  return provider;
}
