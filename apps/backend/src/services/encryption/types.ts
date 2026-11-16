import type { EncryptedTableConfig } from '@xyne/shared';

export type EncryptedFieldConfig = EncryptedTableConfig;

export type ClientEncryptionConfig = {
  publicKey: string;
  encryptedFields: Record<string, EncryptedFieldConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
};

export type RegisterSessionKeyInput = {
  wrappedKey: string;
  sessionId: string;
  userId: string;
  orgId: string;
};

export type RegisterSessionKeyResult = {
  ok: boolean;
  sessionFingerprint: string;
};

export type EncryptBatchItem = {
  value: string;
  entityId: string;
  entityType: string;
};

export type ProvisionEntityInput = {
  entityId: string;
  orgId: string;
  entityType: string;
};

export type ProvisionEntityResult = {
  entityId: string;
  entityType: string;
  ok: boolean;
  keyId?: string;
  message?: string;
};

export type GenerateStorageKeyInput = {
  workspaceId: string;
};

export type StorageObjectKey = {
  /** 32-byte AES-256 key for one storage object. Never persisted. */
  key: Buffer;
  /** `key` wrapped under the workspace storage key. */
  wrappedKey: string;
};

export interface EncryptionProvider {
  getPublicConfig(): Promise<ClientEncryptionConfig>;
  getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>>;
  registerSessionKey(input: RegisterSessionKeyInput): Promise<RegisterSessionKeyResult>;
  revokeSessionKey(sessionId: string): Promise<void>;
  encryptBatch(items: EncryptBatchItem[]): Promise<string[]>;
  decryptBatch(values: string[]): Promise<string[]>;
  encryptResponse<T>(body: T, sessionId: string): Promise<T>;
  decryptRequest<T>(body: T, sessionId: string): Promise<T>;
  initializeOrg(orgId: string): Promise<void>;
  provisionEntity(input: ProvisionEntityInput): Promise<void>;
  backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]>;
  generateStorageKey(input: GenerateStorageKeyInput): Promise<StorageObjectKey>;
  unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]>;
}
