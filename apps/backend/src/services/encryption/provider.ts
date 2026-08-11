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
    return unsupported('getPublicConfig');
  },

  async registerSessionKey(_input: RegisterSessionKeyInput): Promise<RegisterSessionKeyResult> {
    return unsupported('registerSessionKey');
  },

  async revokeSessionKey(_sessionId: string): Promise<void> {
    return unsupported('revokeSessionKey');
  },

  async encryptBatch(_items: EncryptBatchItem[]): Promise<string[]> {
    return unsupported('encryptBatch');
  },

  async decryptBatch(_values: string[]): Promise<string[]> {
    return unsupported('decryptBatch');
  },

  async encryptResponse<T>(_body: T, _sessionId: string): Promise<T> {
    return unsupported('encryptResponse');
  },

  async decryptRequest<T>(_body: T, _sessionId: string): Promise<T> {
    return unsupported('decryptRequest');
  },

  async initializeOrg(_orgId: string): Promise<void> {
    return unsupported('initializeOrg');
  },

  async provisionEntity(_input: ProvisionEntityInput): Promise<void> {
    return unsupported('provisionEntity');
  },

  async backfillEntities(_items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]> {
    return unsupported('backfillEntities');
  },
};

export function getEncryptionProvider(): EncryptionProvider {
  return provider;
}
