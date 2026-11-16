import type {
  ClientEncryptionManifest,
  ClientManifestRule,
  DerivedContentFacts,
  EncryptedTableConfig,
} from '@xyne/shared';

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

// The manifest types are defined once in @xyne/shared, next to the contracts they are
// generated from; re-exported here so provider code keeps importing them from this file.
export type {
  ClientManifestTransform,
  ClientManifestFieldRule,
  ClientManifestRule,
  ClientEncryptionManifest,
} from '@xyne/shared';

/** Identity of a manifest rule; the encryption service re-reads the field spec by it. */
export type ClientManifestRuleRef = Pick<ClientManifestRule, 'type' | 'value' | 'revision'>;

export type TransformRequestInput<T> = {
  body: T;
  /** Session the tickets inside `body` must have been issued to. */
  subject: string;
  rule: ClientManifestRuleRef;
  /**
   * The manifest the client encrypted with (its tag and version headers, and this
   * backend's environment). The encryption service rejects a version older than its latest
   * for that tag and environment, or a missing one (`version: null`), with 409.
   */
  manifest: { tag: string; environment: string; version: number | null };
  /**
   * Owner of the row the request writes (the workspace whose DEK the Prisma extension would
   * pick for it). Required when any `client: true` field in the rule is `MASTER_DEK`.
   */
  entityId?: string;
  entityType?: string;
};

export type TransformRequestResult<T> = {
  body: T;
  /**
   * Facts the encryption service extracted from the plaintext of the rule's encrypted
   * fields (rule extractionPolicy), so the backend can act on them without the plaintext.
   */
  derived?: DerivedContentFacts;
};

export type TransitEncryptResult<T> = {
  body: T;
  /**
   * Ticket the encrypted fields are under; absent when nothing needed encrypting. When the
   * caller presents no ticket that opens for the subject, the service mints one, which the
   * client resumes on first sight.
   */
  ticket?: string;
};

export interface EncryptionProvider {
  getClientConfig(): Promise<ClientEncryptionConfig>;
  getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>>;
  transitHandshake(input: TransitHandshakeInput): Promise<TransitHandshakeResult>;
  encryptBatch(items: EncryptBatchItem[]): Promise<string[]>;
  decryptBatch(values: string[]): Promise<string[]>;
  encryptResponse<T>(body: T, subject: string, ticket?: string): Promise<TransitEncryptResult<T>>;
  decryptRequest<T>(body: T, subject: string): Promise<T>;
  initializeOrg(orgId: string): Promise<void>;
  provisionEntity(input: ProvisionEntityInput): Promise<void>;
  backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]>;
  generateStorageKey(input: GenerateStorageKeyInput): Promise<StorageObjectKey>;
  unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]>;
  /** Latest client manifest for (tag, environment); `null` when the encryption service has none (404). */
  getClientManifest(params: { tag: string; environment: string }): Promise<ClientEncryptionManifest | null>;
  /** Latest client manifest version, cheap enough to poll; `null` when there is none (404). */
  getClientManifestVersion(params: { tag: string; environment: string }): Promise<number | null>;
  /**
   * The manifest for a client, encrypted with its transit key (the given ticket, or a new
   * one for `subject`), as a string to send as is. `null` when there is no manifest (404).
   */
  getTransitClientManifest(params: {
    tag: string;
    environment: string;
    subject: string;
    ticket?: string;
  }): Promise<{ clientManifest: string; ticket?: string } | null>;
  /**
   * Rule-driven counterpart of decryptRequest. Transit-encrypted fields the rule marks
   * `client: true` come back as workspace-DEK ciphertext (`transform: MASTER_DEK`, ready to
   * store as-is) or plaintext (`transform: NONE`); everything else is returned as sent, so
   * the backend never holds the plaintext of a MASTER_DEK field. `derived` carries the
   * facts extracted from that plaintext, when the rule asks for any.
   */
  transformRequest<T>(input: TransformRequestInput<T>): Promise<TransformRequestResult<T>>;
  /**
   * DEK-to-ticket counterpart of encryptResponse: storage ciphertext (ENC:v1|<dekId>|…) in
   * `body` comes back as transit ciphertext (ENC:v1|tk-…|…) under `ticket`; plaintext
   * configured fields are transit-encrypted as encryptResponse does; the backend never sees
   * the plaintext.
   */
  transformResponse<T>(body: T, subject: string, ticket?: string): Promise<TransitEncryptResult<T>>;
}
