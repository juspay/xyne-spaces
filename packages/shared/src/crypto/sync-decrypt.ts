import type { TransitKeyring } from './keyring.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
import { parseTransitKeyId } from './keyring.js';
import { getCryptoLogger } from './crypto-logger.js';
import { Event as LogEvent } from '../logger/events.js';

/**
 * Decrypt-on-ingest for Zero's sync socket.
 *
 * The encryption proxy re-encrypts enforced fields for the client (`ENC:v1|tk-N|…`). Zero
 * stores rows and evaluates every `useQuery` against its local store, so a `where` on such a
 * field would compare ciphertext. Decrypting each `pokePart` before Zero reads it keeps the
 * local store, and therefore every client-side filter, in plaintext. The wire (and the
 * Network tab) still carries ciphertext.
 */

/** Zero's sync socket, e.g. `wss://host/sync/v51/connect?...`. Other sockets pass untouched. */
const ZERO_SYNC_PATH = /\/sync\/v\d+\/connect/;

/** `null` while the keys are not ready yet; `'disabled'` when client encryption is off. */
export type SyncKeyring = TransitKeyring | null | 'disabled';
type KeyringSource = () => SyncKeyring;

/**
 * `encrypted_field_configs` as the transit config serves it. A table's `fields` are decrypted
 * as they sync when `enforceClientEncryption` is set: those are the fields the proxy
 * re-encrypts for this client.
 */
export type SyncEncryptedFields = Readonly<
  Record<string, { readonly fields: readonly string[]; readonly enforceClientEncryption: boolean }>
>;
type EncryptedFieldsSource = () => SyncEncryptedFields;

/** Set by the proxy on every row it rewrote; not a column. */
const TABLE_NAME_KEY = '__tableName';

interface DecryptPlan {
  /** Fields to decrypt, by table. */
  fields: ReadonlyMap<string, ReadonlySet<string>>;
  /** `"tableName":"<table>"`: a frame with rows of the table contains this text (Zero's frames are compact JSON). */
  markers: readonly string[];
}

const plans = new WeakMap<SyncEncryptedFields, DecryptPlan>();

function decryptPlan(encryptedFields: SyncEncryptedFields): DecryptPlan {
  const cached = plans.get(encryptedFields);
  if (cached) return cached;
  const fields = new Map<string, ReadonlySet<string>>();
  for (const [table, config] of Object.entries(encryptedFields)) {
    if (config?.enforceClientEncryption && config.fields?.length) fields.set(table, new Set(config.fields));
  }
  const plan = { fields, markers: [...fields.keys()].map(table => `"tableName":${JSON.stringify(table)}`) };
  plans.set(encryptedFields, plan);
  return plan;
}

/** How many times in a row an undecryptable message closes the socket for a resync before it is let through. */
const MAX_RESYNC_ATTEMPTS = 3;
/** A frame whose decrypt hasn't settled by then counts as failed, so it can't hold up sync. */
const DECRYPT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 300;

/** `ENC:v1|tk-N|…`: encrypted for this client. Other ciphertext can't be decrypted here and is left alone. */
const isTransitCiphertext = (value: unknown): value is string =>
  isEncryptedField(value) && parseTransitKeyId(value.split('|')[1] ?? '') !== null;

// A key lookup that failed (e.g. the refetch after a rotation) is retried once. A failed AES-GCM
// check (OperationError) is final: retrying can't change it.
const decryptValue = async (ciphertext: string, keyring: TransitKeyring): Promise<string> => {
  try {
    return await decryptField(ciphertext, keyring);
  } catch (error) {
    if (error instanceof Error && error.name === 'OperationError') throw error;
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return decryptField(ciphertext, keyring);
  }
};

interface PokeDecryption {
  /** The message with its fields decrypted, or null when nothing changed. */
  message: unknown | null;
  /** Fields that are still ciphertext: decryption failed, or there was no keyring. */
  failed: number;
}

async function decryptPoke(message: unknown, keyring: TransitKeyring | null, plan: DecryptPlan): Promise<PokeDecryption> {
  if (!Array.isArray(message) || message[0] !== 'pokePart') return { message: null, failed: 0 };
  const body = message[1] as { rowsPatch?: unknown } | undefined;
  if (!body || !Array.isArray(body.rowsPatch)) return { message: null, failed: 0 };

  let changed = false;
  let failed = 0;
  const rowsPatch = await Promise.all(
    body.rowsPatch.map(async (patch: unknown) => {
      if (!patch || typeof patch !== 'object') return patch;
      const op = patch as Record<string, unknown>;
      const key = op.value && typeof op.value === 'object' ? 'value' : op.merge && typeof op.merge === 'object' ? 'merge' : null;
      if (!key) return patch;
      const row = op[key] as Record<string, unknown>;
      const tagged = TABLE_NAME_KEY in row;
      const tableFields = typeof op.tableName === 'string' ? plan.fields.get(op.tableName) : undefined;
      const fields = tableFields
        ? Object.entries(row).filter(([field, value]) => tableFields.has(field) && isTransitCiphertext(value))
        : [];
      if (fields.length === 0 && !tagged) return patch;

      const decrypted = { ...row };
      if (tagged) {
        delete decrypted[TABLE_NAME_KEY];
        changed = true;
      }
      if (!keyring) {
        failed += fields.length;
        return { ...op, [key]: decrypted };
      }
      await Promise.all(
        fields.map(async ([field, value]) => {
          try {
            decrypted[field] = await decryptValue(value as string, keyring);
            changed = true;
          } catch (error) {
            failed += 1;
            getCryptoLogger().warn(LogEvent.ENCRYPTION_WS_MESSAGE_DECRYPT, {
              outcome: 'failed',
              table: String(op.tableName ?? 'unknown'),
              field,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );
      return { ...op, [key]: decrypted };
    }),
  );

  return { message: changed ? [message[0], { ...body, rowsPatch }, ...message.slice(2)] : null, failed };
}

/**
 * Returns the message with the encrypted fields of its `pokePart` rows decrypted, per
 * `encryptedFields`, and the proxy's `__tableName` tag dropped; null when it carries neither.
 * A field that fails to decrypt is left as ciphertext.
 */
export async function decryptPokeMessage(
  message: unknown,
  keyring: TransitKeyring,
  encryptedFields: SyncEncryptedFields,
): Promise<unknown | null> {
  return (await decryptPoke(message, keyring, decryptPlan(encryptedFields))).message;
}

interface FrameDecryption {
  data: string;
  failed: number;
}

async function decryptFrame(data: string, keyring: TransitKeyring | null, plan: DecryptPlan): Promise<FrameDecryption> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { data, failed: 0 };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PokeDecryption>(resolve => {
    timer = setTimeout(() => resolve({ message: null, failed: 1 }), DECRYPT_TIMEOUT_MS);
  });
  const { message, failed } = await Promise.race([decryptPoke(parsed, keyring, plan), timedOut]).finally(() => clearTimeout(timer));
  return { data: message === null ? data : JSON.stringify(message), failed };
}

function closeEventLike(event: CloseEvent): Event {
  const init = { code: event.code, reason: event.reason, wasClean: event.wasClean };
  if (typeof CloseEvent === 'function') return new CloseEvent('close', init);
  return Object.assign(new Event('close'), init);
}

/**
 * A WebSocket class that hands Zero's sync messages to its listeners only after their
 * encrypted fields are decrypted. Messages keep their arrival order: one that needs no
 * decryption still waits behind any earlier message that is being decrypted.
 */
export function createDecryptingWebSocket(
  Base: typeof WebSocket,
  getKeyring: KeyringSource,
  getEncryptedFields: EncryptedFieldsSource,
): typeof WebSocket {
  const released = new WeakSet<Event>();
  // Counted across sockets: each resync is a new connection.
  let resyncAttempts = 0;

  return class DecryptingWebSocket extends Base {
    #pending = 0;
    #tail: Promise<void> = Promise.resolve();
    #resyncing = false;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (!ZERO_SYNC_PATH.test(String(url))) return;
      // Registered before any caller's listener, so these run first and can hold an event back.
      super.addEventListener('message', event => this.#interceptMessage(event as MessageEvent));
      super.addEventListener('close', event => this.#interceptClose(event as CloseEvent));
    }

    #interceptMessage(event: MessageEvent): void {
      if (released.has(event)) return;
      if (this.#resyncing) {
        event.stopImmediatePropagation();
        return;
      }
      const data: unknown = event.data;
      // A pong carries no rows and must not wait: Zero drops the connection if it is late.
      if (typeof data === 'string' && data.startsWith('["pong"')) return;
      const keyring = getKeyring();
      const plan = keyring === 'disabled' ? null : decryptPlan(getEncryptedFields());
      const rewrite =
        plan !== null &&
        typeof data === 'string' &&
        (data.includes(`"${TABLE_NAME_KEY}"`) ||
          (data.includes('"ENC:') && plan.markers.some(marker => data.includes(marker))));
      // Only a whole poke applied counts as recovered; a part that decrypts fine says nothing
      // about the part after it.
      const pokeEnd = typeof data === 'string' && data.startsWith('["pokeEnd"');
      if (!rewrite && !pokeEnd && this.#pending === 0) return;
      if (!rewrite && this.#pending === 0) {
        resyncAttempts = 0;
        return;
      }

      event.stopImmediatePropagation();
      // Decrypts start at once (frames overlap); delivery stays in arrival order.
      const ready: Promise<FrameDecryption> = rewrite && plan && keyring !== 'disabled'
        ? decryptFrame(data as string, keyring, plan).catch(() => ({ data: data as string, failed: 1 }))
        : Promise.resolve({ data: data as string, failed: 0 });
      this.#deliverInOrder(async () => {
        const frame = await ready;
        if (this.#resyncing) return null;
        if (frame.failed > 0 && this.#resync(frame.failed)) return null;
        if (pokeEnd) resyncAttempts = 0;
        return new MessageEvent('message', { data: frame.data, origin: event.origin, lastEventId: event.lastEventId });
      });
    }

    /**
     * Ciphertext written to Zero's store stays there until the row next changes, and no filter
     * can match it. So a message that can't be decrypted is not delivered: the socket closes,
     * Zero reconnects from the last poke it applied and the server sends the rows again.
     * Returns false once the attempts are used up; the message is then delivered as it is.
     */
    #resync(failed: number): boolean {
      if (resyncAttempts >= MAX_RESYNC_ATTEMPTS) {
        getCryptoLogger().error(LogEvent.ENCRYPTION_WS_MESSAGE_DECRYPT, { outcome: 'left_encrypted', failed, attempts: resyncAttempts });
        return false;
      }
      resyncAttempts += 1;
      this.#resyncing = true;
      getCryptoLogger().warn(LogEvent.ENCRYPTION_WS_MESSAGE_DECRYPT, { outcome: 'resync', failed, attempt: resyncAttempts });
      this.close();
      return true;
    }

    // A close behind held messages waits for them, as it would on a plain socket; otherwise Zero
    // would reconnect first and then apply the old connection's messages.
    #interceptClose(event: CloseEvent): void {
      if (released.has(event) || this.#pending === 0) return;
      event.stopImmediatePropagation();
      this.#deliverInOrder(async () => closeEventLike(event));
    }

    #deliverInOrder(build: () => Promise<Event | null>): void {
      this.#pending += 1;
      // A step that throws must not block the events queued behind it.
      this.#tail = this.#tail
        .then(async () => {
          const next = await build().finally(() => {
            this.#pending -= 1;
          });
          if (!next) return;
          released.add(next);
          this.dispatchEvent(next);
        })
        .catch(error => {
          getCryptoLogger().warn(LogEvent.ENCRYPTION_WS_MESSAGE_DECRYPT, {
            outcome: 'dropped',
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  };
}

let installed = false;
let currentKeyring: KeyringSource = () => null;
let currentEncryptedFields: EncryptedFieldsSource = () => ({});

/**
 * Swaps the browser's WebSocket for one that decrypts Zero's sync messages. Zero looks up the
 * global WebSocket each time it connects, so call this before the Zero instance is created.
 * Each call replaces the keyring and config sources; the WebSocket is swapped only once.
 */
export function installSyncDecryption(getKeyring: KeyringSource, getEncryptedFields: EncryptedFieldsSource): void {
  currentKeyring = getKeyring;
  currentEncryptedFields = getEncryptedFields;
  if (installed || typeof globalThis.WebSocket !== 'function') return;
  globalThis.WebSocket = createDecryptingWebSocket(
    globalThis.WebSocket,
    () => currentKeyring(),
    () => currentEncryptedFields(),
  );
  installed = true;
}
