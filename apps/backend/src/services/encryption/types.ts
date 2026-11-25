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

export type YSweetSocketKey = {
  nonce: string;
  keyVersion: number;
  wrappedKey: string;
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

export type SealEventInput = {
  /** The event JSON exactly as the bot will receive it. */
  event: string;
  webhookUrl: string;
  signingSecret: string;
  proxyClient: { role: 'egress'; version: number };
};

/** Whom a transit operation is for: `authToken` names the auth session whose registered key the encryption service uses. */
export type TransitCaller = {
  /**
   * Xyne Apps traffic relayed by the ingress or egress proxy. The encryption service then
   * uses its apps server keys and the proxy key pinned for this role and version, and
   * refuses an `authToken` alongside it.
   */
  proxyClient?: { role: 'ingress' | 'egress'; version: number };
  authToken?: string;
  /**
   * Accept `authToken` past its expiry (signature still checked): a websocket's handshake
   * token, which the socket keeps using after the token's lifetime.
   */
  allowExpiredAuthToken?: boolean;
};

/** One chunk of a chunked encrypted file container (`@xyne/shared` file-container). */
export type FileChunk = {
  index: number;
  last: boolean;
  data: Buffer;
};

export type SealFileChunksInput = TransitCaller & {
  /** Workspace whose storage key the file goes under. */
  workspaceId: string;
  /** The file's storage header (base64) from its first call; omitted on the first call. */
  header?: string;
  /**
   * The caller's transit container header (base64) when `chunks` are its transit
   * ciphertext; omitted for plaintext chunks.
   */
  sourceHeader?: string;
  /** Plaintext bytes per chunk, for the first call of a plaintext file. */
  chunkSize?: number;
  chunks: FileChunk[];
};

export type OpenFileChunksInput = TransitCaller & {
  workspaceId: string;
  /** The stored file's header (base64). */
  header: string;
  /** The transit header (base64) from the file's first call; omitted on the first call. */
  transitHeader?: string;
  chunks: FileChunk[];
};

/** Re-encrypted chunks, in request order, and the header of the container they belong to. */
export type FileChunksResult = {
  header: string;
  chunks: Buffer[];
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

/**
 * One value to compose (see COMPOSE_TEMPLATES in @xyne/shared): the template, its inputs with
 * the encrypted ones as they are stored, and the stored value it would replace, if any.
 */
export type ComposeItem = { template: string; inputs: Record<string, unknown>; current?: string | null };

export type ComposeInput = {
  items: ComposeItem[];
  /** Owner of the value: every encrypted input must be under its key, and the result is encrypted under it. */
  entityId: string;
  entityType: string;
};

/** Per item: the built value encrypted under the entity's key, or `unchanged` when it equals `current`. */
export type ComposeItemResult = { unchanged: true } | { unchanged: false; value: string };

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
  /**
   * A canvas socket key for the session's registered client key: the client derives it from
   * `nonce` and `keyVersion`, y-sweet unwraps `wrappedKey`. The backend can read neither.
   */
  mintYSweetSocketKey(sessionId: string, docId: string): Promise<YSweetSocketKey>;
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
   * Chunks of a file into its workspace storage container: plaintext chunks (server-side
   * files), or the caller's transit container chunks (`sourceHeader`), which the encryption
   * service opens itself, so the backend never holds their plaintext.
   */
  sealFileChunks(input: SealFileChunksInput): Promise<FileChunksResult>;
  /** Chunks of a stored file re-encrypted for the caller's transit key. */
  openFileChunksForTransit(input: OpenFileChunksInput): Promise<FileChunksResult>;
  /**
   * The manifest for a client, encrypted with its transit key, as a string to send as is.
   * `null` when there is no manifest (404).
   */
  getTransitClientManifest(params: { tag: string } & TransitCaller): Promise<{ clientManifest: string } | null>;
  /**
   * Seal an outbound app event for the egress transit proxy: the encryption service signs
   * `event` with the app's signing secret and encrypts `{ url, body, signature }` to the
   * pinned egress proxy key. Only the proxy can open it.
   */
  sealEvent(input: SealEventInput): Promise<{ sealed: string }>;
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
   * Values the backend stores but cannot build, because it holds their parts only encrypted:
   * the encryption service decrypts the inputs, builds each template and returns the result
   * encrypted (or `unchanged`). The backend never sees the plaintext. One result per item, in order.
   */
  compose(input: ComposeInput): Promise<ComposeItemResult[]>;
  /**
   * DEK-to-transit counterpart of encryptResponse: storage ciphertext (ENC:v1|<dekId>|…) in
   * `body` comes back as transit ciphertext (ENC:v1|tk-…|…) for the client of `caller`;
   * plaintext configured fields are transit-encrypted as encryptResponse does;
   * the backend never sees the plaintext.
   */
  transformResponse<T>(body: T, caller: TransitCaller): Promise<TransitEncryptResult<T>>;
}
