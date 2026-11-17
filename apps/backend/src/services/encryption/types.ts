import type { EncryptedTableConfig } from '@xyne/shared';

export type EncryptedFieldConfig = EncryptedTableConfig;

export type ClientEncryptionConfig = {
  encryptedFields: Record<string, EncryptedFieldConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
};

/** Header the client sends its current ticket in; the cookie is the fallback for websockets. */
export const TRANSIT_TICKET_HEADER = 'x-transit-ticket';
export const TRANSIT_TICKET_COOKIE = 'xt';

export type TransitHandshakeInput = {
  /** Who the ticket is issued to: the auth session id (JWT `sid`). */
  subject: string;
  /** Client's ephemeral P-256 public key, base64 uncompressed point. */
  publicKey: string;
  /** A ticket of the same session to resume instead of minting a new key. */
  ticket?: string;
};

export type TransitHandshakeResult = {
  publicKey: string;
  wrappedKey: string;
  ticket: string;
  /** Unix seconds. */
  expiresAt: number;
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
  getClientConfig(): Promise<ClientEncryptionConfig>;
  getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>>;
  transitHandshake(input: TransitHandshakeInput): Promise<TransitHandshakeResult>;
  encryptBatch(items: EncryptBatchItem[]): Promise<string[]>;
  decryptBatch(values: string[]): Promise<string[]>;
  encryptResponse<T>(body: T, subject: string, ticket?: string): Promise<T>;
  decryptRequest<T>(body: T, subject: string): Promise<T>;
  initializeOrg(orgId: string): Promise<void>;
  provisionEntity(input: ProvisionEntityInput): Promise<void>;
  backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]>;
  generateStorageKey(input: GenerateStorageKeyInput): Promise<StorageObjectKey>;
  unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]>;
}
