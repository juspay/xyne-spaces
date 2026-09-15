export type EncryptedFieldConfig = {
  fields: string[];
  enforceClientEncryption: boolean;
};

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

export interface EncryptionProvider {
  getPublicConfig(): Promise<ClientEncryptionConfig>;
  registerSessionKey(input: RegisterSessionKeyInput): Promise<RegisterSessionKeyResult>;
  revokeSessionKey(sessionId: string): Promise<void>;
  encryptBatch(items: EncryptBatchItem[]): Promise<string[]>;
  decryptBatch(values: string[]): Promise<string[]>;
  encryptResponse<T>(body: T, sessionId: string): Promise<T>;
  decryptRequest<T>(body: T, sessionId: string): Promise<T>;
  initializeOrg(orgId: string): Promise<void>;
  provisionEntity(input: ProvisionEntityInput): Promise<void>;
  backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]>;
}
