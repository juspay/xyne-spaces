import type { TransitKeyring } from './keyring.js';
import { decryptField, isEncryptedField } from './field-decrypt.js';
import { decryptionCache } from './decryption-cache.js';
import { getCryptoLogger } from './crypto-logger.js';
import { Event } from '../logger/events.js';

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

const decryptValue = async (ciphertext: string, keyring: TransitKeyring): Promise<string> => {
  const cached = decryptionCache.get(ciphertext);
  if (cached !== undefined) return cached;
  const plaintext = await decryptField(ciphertext, keyring);
  decryptionCache.set(ciphertext, plaintext);
  return plaintext;
};

/**
 * Returns the message with every encrypted field of its `pokePart` rows decrypted, or null when
 * it carries none. A field that fails to decrypt is left as ciphertext: the decrypt that
 * `useQuery` runs on results still covers it for display.
 */
export async function decryptPokeMessage(message: unknown, keyring: TransitKeyring): Promise<unknown | null> {
  if (!Array.isArray(message) || message[0] !== 'pokePart') return null;
  const body = message[1] as { rowsPatch?: unknown } | undefined;
  if (!body || !Array.isArray(body.rowsPatch)) return null;

  let changed = false;
  const rowsPatch = await Promise.all(
    body.rowsPatch.map(async (patch: unknown) => {
      if (!patch || typeof patch !== 'object') return patch;
      const op = patch as Record<string, unknown>;
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
            getCryptoLogger().warn(Event.ENCRYPTION_WS_MESSAGE_DECRYPT, {
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

async function decryptFrame(data: string, keyring: TransitKeyring): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return data;
  }
  const decrypted = await decryptPokeMessage(parsed, keyring);
  return decrypted === null ? data : JSON.stringify(decrypted);
}

/**
 * A WebSocket class that hands Zero's sync messages to its listeners only after their
 * encrypted fields are decrypted. Messages keep their arrival order: one that needs no
 * decryption still waits behind any earlier message that is being decrypted.
 */
export function createDecryptingWebSocket(Base: typeof WebSocket, getKeyring: KeyringSource): typeof WebSocket {
  const released = new WeakSet<Event>();

  return class DecryptingWebSocket extends Base {
    #pending = 0;
    #tail: Promise<void> = Promise.resolve();

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (!ZERO_SYNC_PATH.test(String(url))) return;
      // Registered before any caller's listener, so it runs first and can hold the event back.
      super.addEventListener('message', event => this.#intercept(event as MessageEvent));
    }

    #intercept(event: MessageEvent): void {
      if (released.has(event)) return;
      const keyring = getKeyring();
      const data: unknown = event.data;
      const needsDecrypt = keyring !== null && typeof data === 'string' && data.includes('"ENC:');
      if (!needsDecrypt && this.#pending === 0) return;

      event.stopImmediatePropagation();
      this.#pending += 1;
      // Decrypts start at once (frames overlap); delivery stays in arrival order.
      const ready = needsDecrypt ? decryptFrame(data as string, keyring).catch(() => data) : Promise.resolve(data);
      this.#tail = this.#tail.then(async () => {
        const out = await ready;
        this.#pending -= 1;
        const next = new MessageEvent('message', { data: out, origin: event.origin, lastEventId: event.lastEventId });
        released.add(next);
        this.dispatchEvent(next);
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
  globalThis.WebSocket = createDecryptingWebSocket(globalThis.WebSocket, () => currentKeyring());
  installed = true;
}
