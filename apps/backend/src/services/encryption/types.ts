import type {
  DerivedContentFacts,
  EncryptedTableConfig,
} from '@xyne/shared';

export type EncryptedFieldConfig = EncryptedTableConfig;

export type ClientEncryptionConfig = {
  encryptedFields: Record<string, EncryptedFieldConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
};

/**
 * Header the client sends its transit public key (base64 P-256 point) in; the cookie,
 * set by `POST /api/transit/register`, is the fallback for websockets and the sync proxy.
 */
export const TRANSIT_KEY_HEADER = 'x-transit-key';
export const TRANSIT_KEY_COOKIE = 'xk';

export type TransitServerKey = {
  version: number;
  /** Base64 uncompressed P-256 point. */
  publicKey: string;
};

/** The encryption service's key pairs' public halves; new ciphertext goes under `current`. */
export type TransitServerKeys = {
  current: number;
  keys: TransitServerKey[];
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

export type TransformRequestInput<T> = {
  body: T;
  /** The caller's transit public key, which the transit ciphertext in `body` is under. */
  clientKey?: string;
  /**
   * What the request is, for the encryption service to pick the manifest rule: a REST
   * request's `method` + `path` as made, or a Zero mutation's `mutator` name.
   */
  method?: string;
  path?: string;
  mutator?: string;
  /** The request's manifest lane (manifestEnvironmentForRequest). */
  environment: string;
  /** The client's manifest headers as sent; the encryption service checks them. */
  client: { tag?: string; version?: number; environment?: string };
  /**
   * The route's request contract, compared with the rule: its field names, which of them
   * the client encrypts, and the extractors its handler reads.
   */
  contractFields?: string[];
  contractEncrypted?: string[];
  contractDerived?: string[];
  /**
   * A guest's message: the user ids its mentions must stay within (the channel's members).
   * The encryption service has keepMentionsWithin run on each decrypted client field before
   * it is re-encrypted and its facts extracted, as the backend does to a plaintext message.
   */
  keepMentionsWithin?: string[];
  /** Owner of the row the request writes: the workspace whose DEK its fields go under. */
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
};

export interface EncryptionProvider {
  getClientConfig(): Promise<ClientEncryptionConfig>;
  getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>>;
  /** The encryption service's public keys; the client derives its transit keys from them. */
  getTransitServerKeys(): Promise<TransitServerKeys>;
  encryptBatch(items: EncryptBatchItem[]): Promise<string[]>;
  decryptBatch(values: string[]): Promise<string[]>;
  /**
   * Transit-encrypt the configured plaintext fields of `body` for the client with
   * `clientKey`. Without a key the body comes back as is when it has nothing to encrypt,
   * else the service answers 400 `TRANSIT_KEY_REQUIRED`.
   */
  encryptResponse<T>(body: T, clientKey: string | undefined): Promise<TransitEncryptResult<T>>;
  /** Decrypt the transit ciphertext in `body`, which the client with `clientKey` encrypted. */
  decryptRequest<T>(body: T, clientKey: string): Promise<T>;
  initializeOrg(orgId: string): Promise<void>;
  provisionEntity(input: ProvisionEntityInput): Promise<void>;
  backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]>;
  generateStorageKey(input: GenerateStorageKeyInput): Promise<StorageObjectKey>;
  unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]>;
  /**
   * The manifest for a client, encrypted with its transit key, as a string to send as is.
   * `null` when there is no manifest (404).
   */
  getTransitClientManifest(params: {
    tag: string;
    environment: string;
    clientKey: string;
  }): Promise<{ clientManifest: string } | null>;
  /**
   * Rule-driven counterpart of decryptRequest. Transit-encrypted fields the rule marks
   * `client: true` come back as workspace-DEK ciphertext (`transform: MASTER_DEK`, ready to
   * store as-is) or plaintext (`transform: NONE`); everything else is returned as sent, so
   * the backend never holds the plaintext of a MASTER_DEK field. `derived` carries the
   * facts extracted from that plaintext, when the rule asks for any.
   */
  transformRequest<T>(input: TransformRequestInput<T>): Promise<TransformRequestResult<T>>;
  /**
   * DEK-to-transit counterpart of encryptResponse: storage ciphertext (ENC:v1|<dekId>|…) in
   * `body` comes back as transit ciphertext (ENC:v1|tk-…|…) for the client with
   * `clientKey`; plaintext configured fields are transit-encrypted as encryptResponse does;
   * the backend never sees the plaintext.
   */
  transformResponse<T>(body: T, clientKey: string): Promise<TransitEncryptResult<T>>;
}
