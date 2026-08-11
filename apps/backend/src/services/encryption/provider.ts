import { config } from '@/config/env';
import type {
  ClientEncryptionConfig,
  EncryptBatchItem,
  EncryptionProvider,
  ProvisionEntityInput,
  ProvisionEntityResult,
  RegisterSessionKeyInput,
  RegisterSessionKeyResult,
} from './types';

function unsupported(operation: string): never {
  throw new Error(`Encryption provider does not support "${operation}"`);
}

const provider: EncryptionProvider = {
  async getPublicConfig(): Promise<ClientEncryptionConfig> {
    if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) {
      return {
        publicKey: '',
        encryptedFields: {},
        clientEncryptionEnabled: false,
        apiClientEncryptionEnabled: false,
      };
    }
    return unsupported('getPublicConfig');
  },

  async registerSessionKey(input: RegisterSessionKeyInput): Promise<RegisterSessionKeyResult> {
    if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) {
      return { ok: false, sessionFingerprint: input.sessionId };
    }
    return unsupported('registerSessionKey');
  },

  async revokeSessionKey(_sessionId: string): Promise<void> {
    if (!config.enc.clientEncryptionEnabled && !config.enc.apiClientEncryptionEnabled) return;
    return unsupported('revokeSessionKey');
  },

  async encryptBatch(items: EncryptBatchItem[]): Promise<string[]> {
    if (!config.enc.enableDbEncryption) return items.map((item) => item.value);
    return unsupported('encryptBatch');
  },

  async decryptBatch(values: string[]): Promise<string[]> {
    if (!config.enc.enableDbEncryption) return values;
    return unsupported('decryptBatch');
  },

  async encryptResponse<T>(body: T, _sessionId: string): Promise<T> {
    if (!config.enc.apiClientEncryptionEnabled) return body;
    return unsupported('encryptResponse');
  },

  async decryptRequest<T>(body: T, _sessionId: string): Promise<T> {
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
};

export function getEncryptionProvider(): EncryptionProvider {
  return provider;
}
