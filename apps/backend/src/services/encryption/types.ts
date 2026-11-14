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

export type ClientManifestTransform = 'NONE' | 'MASTER_DEK';

export type ClientManifestFieldRule = {
  client: boolean;
  transform: ClientManifestTransform;
  storage: ClientManifestTransform;
};

export type ClientManifestRule = {
  type: 'REQUEST' | 'MUTATOR';
  value: string;
  revision: number;
  fields: Record<string, ClientManifestFieldRule>;
};

export type ClientEncryptionManifest = {
  schemaKey: string;
  version: number;
  tag: string;
  environment: string;
  rules: ClientManifestRule[];
};

/** Identity of a manifest rule; the encryption service re-reads the field spec by it. */
export type ClientManifestRuleRef = Pick<ClientManifestRule, 'type' | 'value' | 'revision'>;

export type TransformRequestInput<T> = {
  body: T;
  sessionId: string;
  rule: ClientManifestRuleRef;
  /**
   * Owner of the row the request writes (the workspace whose DEK the Prisma extension would
   * pick for it). Required when any `client: true` field in the rule is `MASTER_DEK`.
   */
  entityId?: string;
  entityType?: string;
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
  /** Latest client manifest for (tag, environment); `null` when the encryption service has none (404). */
  getClientManifest(params: { tag: string; environment: string }): Promise<ClientEncryptionManifest | null>;
  /**
   * Rule-driven counterpart of decryptRequest. Session-encrypted fields the rule marks
   * `client: true` come back as workspace-DEK ciphertext (`transform: MASTER_DEK`, ready to
   * store as-is) or plaintext (`transform: NONE`); everything else is returned as sent, so
   * the backend never holds the plaintext of a MASTER_DEK field.
   */
  transformRequest<T>(input: TransformRequestInput<T>): Promise<T>;
  /**
   * DEK→CEK counterpart of encryptResponse: storage ciphertext (ENC:v1|<dekId>|…) in `body`
   * comes back as session ciphertext (ENC:v1|sess|…) for `sessionId`; plaintext configured
   * fields are session-encrypted as encryptResponse does; the backend never sees the plaintext.
   */
  transformResponse<T>(body: T, sessionId: string): Promise<T>;
}
