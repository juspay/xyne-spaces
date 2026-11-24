import type {
  DerivedFacts,
  EncryptedTableConfig,
  FieldFacts,
} from '@xyne/shared';

export type EncryptedFieldConfig = EncryptedTableConfig;

export type ClientEncryptionConfig = {
  encryptedFields: Record<string, EncryptedFieldConfig>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
};

/**
 * Cookie `POST /api/transit/register` sets with the client's transit public key (base64 P-256
 * point): read by the sync proxy, and sent along as a fallback for a session the encryption
 * service has no registered key for.
 */
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

/**
 * Whom a transit operation is for. `authToken` (the caller's access token) names its auth
 * session, whose registered transit key the encryption service looks up and uses; `clientKey`
 * (the public key the request itself carried) applies when that session registered none.
 */
export type SealEventInput = {
  /** The event JSON exactly as the bot will receive it. */
  event: string;
  webhookUrl: string;
  signingSecret: string;
  proxyClient: { role: 'egress'; version: number };
};

export type TransitCaller = {
  /**
   * Xyne Apps traffic relayed from the ingress or egress transit proxy (its `x-xyne-transit-proxy:
   * <role>;<version>` header). The encryption service then uses its apps server keys and the
   * proxy key pinned for that role and version; it refuses `clientKey` / `authToken`
   * alongside, so the backend can never choose the key a reply is encrypted to.
   */
  proxyClient?: { role: 'ingress' | 'egress'; version: number };
  clientKey?: string;
  authToken?: string;
  /**
   * Accept `authToken` past its expiry (signature still checked): a websocket's handshake
   * token, which the socket keeps using after the token's lifetime.
   */
  allowExpiredAuthToken?: boolean;
};

export type TransformRequestInput<T> = TransitCaller & {
  body: T;
  /**
   * What the request is, for the encryption service to pick the manifest rule: a REST
   * request's `method` + `path` as made, or a Zero mutation's `mutator` name.
   */
  method?: string;
  path?: string;
  mutator?: string;
  /**
   * The route's request contract, compared with the rule: its field names, which of them
   * the client encrypts, and the extractors its handler reads.
   */
  contractFields?: string[];
  contractEncrypted?: string[];
  /** `{ <field>: [<fact names>] }` from the contract's sourceToDerived. */
  contractDerived?: Record<string, string[]>;
  /** Owner of the row the request writes: the workspace whose DEK its fields go under. */
  entityId?: string;
  entityType?: string;
};

export type TransformRequestResult<T> = {
  body: T;
  /**
   * Facts extracted from the plaintext of the contract's source fields, per field, as the
   * contract's `sourceToDerived` asks (`contractDerived`), so the backend acts on them without
   * the plaintext.
   */
  derived?: DerivedFacts;
};

/** One stored value and the facts wanted from it (extractor names). */
export type DeriveFactsItem = { value: string; derive: string[] };

export type DeriveFactsInput = {
  items: DeriveFactsItem[];
  /** Owner of the rows read: workspace-DEK ciphertext in `items` must be under its key. */
  entityId: string;
  entityType: string;
};

export type TransitEncryptResult<T> = {
  body: T;
};

export interface EncryptionProvider {
  getClientConfig(): Promise<ClientEncryptionConfig>;
  getEncryptedFieldsConfig(): Promise<Record<string, EncryptedFieldConfig>>;
  /** Zero mutators with a manifest rule: each one is sent to the encryption service to be checked. */
  getClientEncryptedMutators(): Promise<string[]>;
  /** The encryption service's public keys; the client derives its transit keys from them. */
  getTransitServerKeys(): Promise<TransitServerKeys>;
  /**
   * Keeps the client's transit public key for its auth session (the encryption service
   * stores it, for pushes that carry no key) and returns the service's public keys.
   */
  registerTransitClientKey(sessionId: string, clientKey: string): Promise<TransitServerKeys>;
  /** The transit public key the auth session's client registered; `undefined` when none. */
  transitClientKey(sessionId: string): Promise<string | undefined>;
  encryptBatch(items: EncryptBatchItem[]): Promise<string[]>;
  decryptBatch(values: string[]): Promise<string[]>;
  /**
   * Transit-encrypt the configured plaintext fields of `body` for the client of `caller`.
   * Without a key the body comes back as is when it has nothing to encrypt,
   * else the service answers 400 `TRANSIT_KEY_REQUIRED`.
   */
  encryptResponse<T>(body: T, caller: TransitCaller): Promise<TransitEncryptResult<T>>;
  /** Decrypt the transit ciphertext in `body`, which the client of `caller` encrypted. */
  decryptRequest<T>(body: T, caller: TransitCaller): Promise<T>;
  initializeOrg(orgId: string): Promise<void>;
  provisionEntity(input: ProvisionEntityInput): Promise<void>;
  backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]>;
  generateStorageKey(input: GenerateStorageKeyInput): Promise<StorageObjectKey>;
  unwrapStorageKeys(wrappedKeys: string[]): Promise<Buffer[]>;
  /**
   * The manifest for a client, encrypted with its transit key, as a string to send as is.
   * `null` when there is no manifest (404).
   */
  /**
   * Seal an outbound app event for the egress transit proxy: the encryption service signs
   * `event` with the app's signing secret and encrypts `{ url, body, signature }` to the
   * pinned egress proxy key. Only the proxy can open it.
   */
  sealEvent(input: SealEventInput): Promise<{ sealed: string }>;
  getTransitClientManifest(params: { tag: string } & TransitCaller): Promise<{ clientManifest: string } | null>;
  /**
   * Rule-driven counterpart of decryptRequest. Transit-encrypted fields the rule marks
   * `client: true` come back as workspace-DEK ciphertext (`transform: MASTER_DEK`, ready to
   * store as-is) or plaintext (`transform: NONE`); everything else is returned as sent, so
   * the backend never holds the plaintext of a MASTER_DEK field. `derived` carries the
   * facts extracted from that plaintext, when the rule asks for any.
   */
  transformRequest<T>(input: TransformRequestInput<T>): Promise<TransformRequestResult<T>>;
  /**
   * Facts from values read from the database: each item's value is workspace-DEK ciphertext
   * (decrypted for extraction only, never returned) or, while reads still come back
   * decrypted, plaintext. One `FieldFacts` per item, in order.
   */
  deriveFacts(input: DeriveFactsInput): Promise<FieldFacts[]>;
  /**
   * DEK-to-transit counterpart of encryptResponse: storage ciphertext (ENC:v1|<dekId>|…) in
   * `body` comes back as transit ciphertext (ENC:v1|tk-…|…) for the client of `caller`;
   * plaintext configured fields are transit-encrypted as encryptResponse does;
   * the backend never sees the plaintext.
   */
  transformResponse<T>(body: T, caller: TransitCaller): Promise<TransitEncryptResult<T>>;
}
