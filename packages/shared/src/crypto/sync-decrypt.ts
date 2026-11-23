import type { TransitKeyring } from './keyring.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
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

type KeyringSource = () => TransitKeyring | null;

/**
 * Tables decrypted as they sync: those the client filters on. Other tables keep the decrypt
 * that `useQuery` runs on results, so a large table (messages) isn't decrypted row by row on
 * first sync.
 */
export const SYNC_DECRYPTED_TABLES: readonly string[] = ['form_entity_values'];

// Retried once: a failed field is stored as ciphertext and no local filter can match it.
const decryptValue = async (ciphertext: string, keyring: TransitKeyring): Promise<string> => {
  try {
    return await decryptField(ciphertext, keyring);
  } catch {
    return decryptField(ciphertext, keyring);
  }
};

/**
 * Returns the message with every encrypted field of its `pokePart` rows in `tables` decrypted,
 * or null when it carries none. A field that fails to decrypt is left as ciphertext: the
 * decrypt that `useQuery` runs on results still covers it for display.
 */
export async function decryptPokeMessage(
  message: unknown,
  keyring: TransitKeyring,
  tables: readonly string[] = SYNC_DECRYPTED_TABLES,
): Promise<unknown | null> {
  if (!Array.isArray(message) || message[0] !== 'pokePart') return null;
  const body = message[1] as { rowsPatch?: unknown } | undefined;
  if (!body || !Array.isArray(body.rowsPatch)) return null;

  let changed = false;
  const rowsPatch = await Promise.all(
    body.rowsPatch.map(async (patch: unknown) => {
      if (!patch || typeof patch !== 'object') return patch;
      const op = patch as Record<string, unknown>;
      if (typeof op.tableName !== 'string' || !tables.includes(op.tableName)) return patch;
      const key = op.value && typeof op.value === 'object' ? 'value' : op.merge && typeof op.merge === 'object' ? 'merge' : null;
      if (!key) return patch;
      const row = op[key] as Record<string, unknown>;
      const fields = Object.entries(row).filter(([, value]) => isEncryptedField(value));
      if (fields.length === 0) return patch;

      const decrypted = { ...row };
      await Promise.all(
        fields.map(async ([field, value]) => {
          try {
            decrypted[field] = await decryptValue(value as string, keyring);
            changed = true;
          } catch (error) {
            getCryptoLogger().warn(LogEvent.ENCRYPTION_WS_MESSAGE_DECRYPT, {
              outcome: 'left_encrypted',
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

  return changed ? [message[0], { ...body, rowsPatch }, ...message.slice(2)] : null;
}

async function decryptFrame(data: string, keyring: TransitKeyring, tables: readonly string[]): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return data;
  }
  const decrypted = await decryptPokeMessage(parsed, keyring, tables);
  return decrypted === null ? data : JSON.stringify(decrypted);
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
  tables: readonly string[] = SYNC_DECRYPTED_TABLES,
): typeof WebSocket {
  const released = new WeakSet<Event>();
  // Zero's frames are compact JSON, so a frame with rows from these tables contains this text.
  const tableMarkers = tables.map(table => `"tableName":${JSON.stringify(table)}`);

  return class DecryptingWebSocket extends Base {
    #pending = 0;
    #tail: Promise<void> = Promise.resolve();

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (!ZERO_SYNC_PATH.test(String(url))) return;
      // Registered before any caller's listener, so these run first and can hold an event back.
      super.addEventListener('message', event => this.#interceptMessage(event as MessageEvent));
      super.addEventListener('close', event => this.#interceptClose(event as CloseEvent));
    }

    #interceptMessage(event: MessageEvent): void {
      if (released.has(event)) return;
      const keyring = getKeyring();
      const data: unknown = event.data;
      // A pong carries no rows and must not wait: Zero drops the connection if it is late.
      if (typeof data === 'string' && data.startsWith('["pong"')) return;
      const needsDecrypt =
        keyring !== null &&
        typeof data === 'string' &&
        data.includes('"ENC:') &&
        tableMarkers.some(marker => data.includes(marker));
      if (!needsDecrypt && this.#pending === 0) return;

      event.stopImmediatePropagation();
      // Decrypts start at once (frames overlap); delivery stays in arrival order.
      const ready = needsDecrypt ? decryptFrame(data as string, keyring, tables).catch(() => data) : Promise.resolve(data);
      this.#deliverInOrder(async () => new MessageEvent('message', { data: await ready, origin: event.origin, lastEventId: event.lastEventId }));
    }

    // A close behind held messages waits for them, as it would on a plain socket; otherwise Zero
    // would reconnect first and then apply the old connection's messages.
    #interceptClose(event: CloseEvent): void {
      if (released.has(event) || this.#pending === 0) return;
      event.stopImmediatePropagation();
      this.#deliverInOrder(async () => closeEventLike(event));
    }

    #deliverInOrder(build: () => Promise<Event>): void {
      this.#pending += 1;
      // A step that throws must not block the events queued behind it.
      this.#tail = this.#tail
        .then(async () => {
          const next = await build().finally(() => {
            this.#pending -= 1;
          });
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

/**
 * Swaps the browser's WebSocket for one that decrypts Zero's sync messages. Zero looks up the
 * global WebSocket each time it connects, so call this before the Zero instance is created.
 * Each call replaces the keyring source; the WebSocket is swapped only once.
 */
export function installSyncDecryption(getKeyring: KeyringSource): void {
  currentKeyring = getKeyring;
  if (installed || typeof globalThis.WebSocket !== 'function') return;
  globalThis.WebSocket = createDecryptingWebSocket(globalThis.WebSocket, () => currentKeyring(), SYNC_DECRYPTED_TABLES);
  installed = true;
}
