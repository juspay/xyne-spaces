import type {
  ClientEncryptionConfig,
  EncryptBatchItem,
  EncryptionCapabilities,
  EncryptionProvider,
  ProvisionEntityInput,
  ProvisionEntityResult,
  RegisterSessionKeyInput,
  RegisterSessionKeyResult,
} from './types';

export const DISABLED_ENCRYPTION_CAPABILITIES: EncryptionCapabilities = Object.freeze({
  dbEncryption: false,
  clientEncryption: false,
  apiTransitEncryption: false,
  provisioning: false,
});

function disabledOperation(operation: string): never {
  throw new Error(`Encryption operation "${operation}" is unavailable because encryption is disabled`);
}

export class DisabledEncryptionProvider implements EncryptionProvider {
  async initialize(): Promise<EncryptionCapabilities> {
    return DISABLED_ENCRYPTION_CAPABILITIES;
  }

  async getPublicConfig(): Promise<ClientEncryptionConfig> {
    return {
      publicKey: '',
      encryptedFields: {},
      clientEncryptionEnabled: false,
      apiClientEncryptionEnabled: false,
    };
  }

  async registerSessionKey(_input: RegisterSessionKeyInput): Promise<RegisterSessionKeyResult> {
    return disabledOperation('registerSessionKey');
  }

  async revokeSessionKey(_sessionId: string): Promise<void> {
    return disabledOperation('revokeSessionKey');
  }

  async encryptBatch(_items: EncryptBatchItem[]): Promise<string[]> {
    return disabledOperation('encryptBatch');
  }

  async decryptBatch(_values: string[]): Promise<string[]> {
    return disabledOperation('decryptBatch');
  }

  async encryptResponse<T>(_body: T, _sessionId: string): Promise<T> {
    return disabledOperation('encryptResponse');
  }

  async decryptRequest<T>(_body: T, _sessionId: string): Promise<T> {
    return disabledOperation('decryptRequest');
  }

  async initializeOrg(_orgId: string): Promise<void> {
    return disabledOperation('initializeOrg');
  }

  async provisionEntity(_input: ProvisionEntityInput): Promise<void> {
    return disabledOperation('provisionEntity');
  }

  async backfillEntities(_items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]> {
    return disabledOperation('backfillEntities');
  }
}
