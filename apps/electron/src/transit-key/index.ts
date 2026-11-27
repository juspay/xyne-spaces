import { createECDH, type ECDH } from 'crypto';
import { app, safeStorage } from 'electron';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log/main';
import { isBrokenKey, isUnsupported } from './helper-process';
import { createEnclaveKey, enclaveAgree, hasSecureEnclave } from './secure-enclave';
import { deleteWindowsKey, hasTpm, windowsAgree, type WindowsKeyProvider } from './windows-key';

/**
 * The desktop app's transit key (ECDH P-256), held by the main process for every window. The
 * renderer gets only the public key and ECDH results — the key is never in IndexedDB.
 *
 * The store is chosen on every launch from what the machine has (a helper's `probe`); nothing
 * records the choice, so there is no label to edit:
 *
 * macOS: the Secure Enclave. Its encrypted handle is sealed with safeStorage (the Keychain) in
 * userData, so the same key is used across launches. A Mac without one (Intel without a T2) uses
 * the OS keyring store instead.
 * Windows: the TPM. A PC without one that does P-256 key agreement uses the Windows software key
 * storage provider instead, whose key Windows also keeps out of this process. Windows keeps
 * either by name per user and app flavor, so the app stores nothing.
 * Linux: the OS keyring store.
 * The OS keyring store is a software key in this process, its private key sealed with
 * safeStorage (Keychain, GNOME Keyring / KWallet) in userData, so it is kept across launches.
 *
 * Nothing falls back. A failure (a busy TPM, a helper timeout, a missing helper, a probe that
 * fails rather than answers, a Keychain that cannot decrypt the file now, no keyring) fails the
 * call loudly and is retried; it is never answered with another store's key. A stored key is
 * replaced only when it is itself broken. The public key would otherwise change, and data the
 * server already encrypted for the old one would be unreadable. A failure never prompts.
 *
 * A Mac that holds a Secure Enclave key but reports no Enclave fails loudly: a Mac's Enclave
 * cannot go away, so that answer is wrong. A Windows TPM can (switched off in firmware, cleared),
 * and leaves nothing here to notice it by: that PC moves to the software provider with a new key.
 */

type TransitKeyStorage = 'secure_enclave' | WindowsKeyProvider | 'os_keyring';

interface TransitKeyBackend {
  storage: TransitKeyStorage;
  /** 65-byte uncompressed P-256 point. */
  publicKey: Buffer;
  derive(serverPoint: Uint8Array): Promise<Buffer>;
}

/** The Secure Enclave's encrypted handle to its key. */
const ENCLAVE_FILE = 'transit-key.bin';
/** The OS keyring store's private key. */
const KEYRING_FILE = 'transit-key-software.bin';

let backend: Promise<TransitKeyBackend> | null = null;

/** A key that agreed but gave the wrong secret: broken, so it is replaced. */
class SelfCheckFailed extends Error {
  constructor() {
    super('Transit key agreement self-check failed');
    this.name = 'SelfCheckFailed';
  }
}

/**
 * Every failure the renderer sees, in the text the dashboard parses back into its
 * TransitKeyUnavailableError (IPC keeps only an error's message).
 */
class TransitKeyUnavailable extends Error {
  constructor(storage: TransitKeyStorage | 'unknown', reason: string) {
    super(`Transit key unavailable (${storage}): ${reason}`);
    this.name = 'TransitKeyUnavailable';
  }
}

function unavailable(storage: TransitKeyStorage | 'unknown', error: unknown): Error {
  if (error instanceof TransitKeyUnavailable) return error;
  const reason =
    storage !== 'unknown' && storage !== 'os_keyring' && isUnsupported(error)
      ? `the hardware this key is kept in cannot be used here (${String(error)})`
      : error instanceof Error
        ? error.message
        : String(error);
  return new TransitKeyUnavailable(storage, reason);
}

const userDataPath = (fileName: string): string => path.join(app.getPath('userData'), fileName);

/** A 65-byte uncompressed P-256 point, as the encryption service publishes its keys. */
export function isP256Point(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === 65 && value[0] === 0x04;
}

/**
 * Whether safeStorage is backed by a real OS keyring: the Keychain on macOS, DPAPI on Windows,
 * GNOME Keyring or KWallet on Linux — not Linux's `basic_text`, which uses a fixed password.
 */
function keyringAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

// Written aside, synced, then moved over: neither a crash nor a power loss leaves half a file.
async function writeFileAtomic(target: string, data: Buffer | string): Promise<void> {
  const pending = `${target}.tmp`;
  const file = await fs.open(pending, 'w', 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  await fs.rename(pending, target);
}

/**
 * The sealed value; null only when the file does not exist. Anything else (no keyring right now,
 * a decrypt failure after a re-sign or a Keychain or DPAPI change) is thrown and the file is
 * left as it is: treating it as "no key" would replace the key for good.
 */
async function readSealed(fileName: string): Promise<Buffer | null> {
  let sealed: Buffer;
  try {
    sealed = await fs.readFile(userDataPath(fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!keyringAvailable()) throw new Error(`No OS keyring to read ${fileName}`);
  return Buffer.from(safeStorage.decryptString(sealed), 'base64');
}

// Throws when the value cannot be kept: a key that is not kept would change on the next launch.
async function writeSealed(fileName: string, value: Buffer): Promise<void> {
  if (!keyringAvailable()) throw new Error(`No OS keyring to store ${fileName}`);
  await writeFileAtomic(
    userDataPath(fileName),
    safeStorage.encryptString(value.toString('base64'))
  );
}

// One ECDH against a throwaway point, checked from the other side, proves a platform key works
// before anything relies on it, and yields its public key.
function createProbe(): {
  point: Buffer;
  check(result: { secret: Buffer; publicKey: Buffer }): void;
} {
  const probe = createECDH('prime256v1');
  probe.generateKeys();
  return {
    point: probe.getPublicKey(),
    check({ secret, publicKey }) {
      if (!probe.computeSecret(publicKey).equals(secret)) throw new SelfCheckFailed();
    },
  };
}

/** Each server key version is derived once per launch and reused; failures are not kept. */
function derivePerServerKey(
  agree: (serverPoint: Uint8Array) => Promise<Buffer>
): (serverPoint: Uint8Array) => Promise<Buffer> {
  const derived = new Map<string, Promise<Buffer>>();
  return (serverPoint) => {
    const id = Buffer.from(serverPoint).toString('base64');
    let pending = derived.get(id);
    if (!pending) {
      pending = agree(serverPoint);
      pending.catch(() => derived.delete(id));
      derived.set(id, pending);
    }
    return pending;
  };
}

function enclaveBackend(blob: Buffer, publicKey: Buffer): TransitKeyBackend {
  return {
    storage: 'secure_enclave',
    publicKey,
    derive: derivePerServerKey(
      async (serverPoint) => (await enclaveAgree(blob, serverPoint)).secret
    ),
  };
}

async function secureEnclaveBackend(): Promise<TransitKeyBackend> {
  const probe = createProbe();

  const stored = await readSealed(ENCLAVE_FILE);
  if (stored) {
    try {
      const checked = await enclaveAgree(stored, probe.point);
      probe.check(checked);
      return enclaveBackend(stored, checked.publicKey);
    } catch (error) {
      // Only a key the Enclave rejected, or one that gives the wrong secret, is replaced. Anything
      // else (a helper timeout, a spawn error, a busy Enclave) fails this call and keeps the file.
      if (!isBrokenKey(error) && !(error instanceof SelfCheckFailed)) throw error;
      log.warn('[TransitKey] Stored Secure Enclave key is broken; replacing it', error);
    }
  }

  // A new key is stored only once it passes, so a bad key is never kept for later launches; the
  // write replaces a broken file in one step.
  const blob = await createEnclaveKey();
  const checked = await enclaveAgree(blob, probe.point);
  probe.check(checked);
  await writeSealed(ENCLAVE_FILE, blob);
  return enclaveBackend(blob, checked.publicKey);
}

async function windowsBackend(provider: WindowsKeyProvider): Promise<TransitKeyBackend> {
  const probe = createProbe();
  // Windows keeps the key by name and the helper creates it on first use. It is replaced only
  // when the helper found it bad or it gives the wrong secret: a busy TPM, a lockout or a device
  // not ready after resume fails this call and keeps the key.
  const checked = await windowsAgree(provider, probe.point)
    .then((result) => {
      probe.check(result);
      return result;
    })
    .catch(async (error: unknown) => {
      if (!isBrokenKey(error) && !(error instanceof SelfCheckFailed)) throw error;
      log.warn(`[TransitKey] Stored ${provider} key is broken; replacing it`, error);
      await deleteWindowsKey(provider);
      const fresh = await windowsAgree(provider, probe.point);
      probe.check(fresh);
      return fresh;
    });

  return {
    storage: provider,
    publicKey: checked.publicKey,
    derive: derivePerServerKey(
      async (serverPoint) => (await windowsAgree(provider, serverPoint)).secret
    ),
  };
}

function keyringKeyBackend(ecdh: ECDH): TransitKeyBackend {
  return {
    storage: 'os_keyring',
    publicKey: ecdh.getPublicKey(),
    derive: async (serverPoint) => ecdh.computeSecret(serverPoint),
  };
}

// A software key in this process, its private key sealed with safeStorage in userData, so the
// same key is used across launches. Node runs the ECDH, so there is no helper to self-check.
async function keyringBackend(): Promise<TransitKeyBackend> {
  if (!keyringAvailable()) throw new Error(`No OS keyring to store ${KEYRING_FILE}`);
  const ecdh = createECDH('prime256v1');
  const stored = await readSealed(KEYRING_FILE);
  if (stored) {
    try {
      ecdh.setPrivateKey(stored);
      return keyringKeyBackend(ecdh);
    } catch (error) {
      // It decrypted, so the keyring is fine; the bytes themselves are not a key.
      log.warn('[TransitKey] Stored OS keyring key is broken; replacing it', error);
    }
  }
  ecdh.generateKeys();
  await writeSealed(KEYRING_FILE, ecdh.getPrivateKey());
  return keyringKeyBackend(ecdh);
}

function openStore(storage: TransitKeyStorage): Promise<TransitKeyBackend> {
  switch (storage) {
    case 'secure_enclave':
      return secureEnclaveBackend();
    case 'tpm':
    case 'software':
      return windowsBackend(storage);
    case 'os_keyring':
      return keyringBackend();
  }
}

/**
 * This machine's store, from what it has: its secure hardware, else that platform's software
 * store. A probe that fails (rather than answering) fails the choice.
 */
async function detectStore(): Promise<TransitKeyStorage> {
  switch (process.platform) {
    case 'darwin': {
      if (await hasSecureEnclave()) return 'secure_enclave';
      // An Enclave key here means this Mac has an Enclave; the answer is wrong, not the key.
      if (existsSync(userDataPath(ENCLAVE_FILE))) {
        throw new TransitKeyUnavailable(
          'secure_enclave',
          `this Mac holds a Secure Enclave key (${ENCLAVE_FILE}) but reports no Secure Enclave`
        );
      }
      return 'os_keyring';
    }
    case 'win32':
      return (await hasTpm()) ? 'tpm' : 'software';
    case 'linux':
      return 'os_keyring';
    default:
      throw new Error(`No transit key store on ${process.platform}`);
  }
}

async function selectBackend(): Promise<TransitKeyBackend> {
  let storage: TransitKeyStorage | 'unknown' = 'unknown';
  try {
    storage = await detectStore();
    return await openStore(storage);
  } catch (error) {
    throw unavailable(storage, error);
  }
}

function getBackend(): Promise<TransitKeyBackend> {
  backend ??= selectBackend().then(
    (selected) => {
      log.info(`[TransitKey] Using ${selected.storage} storage`);
      return selected;
    },
    (error: unknown) => {
      // A failure is not kept, so the next call (from any window) tries the same store again.
      backend = null;
      log.error('[TransitKey] No transit key; encrypted data stays closed until a retry', error);
      throw error;
    }
  );
  return backend;
}

export async function getTransitPublicKey(): Promise<Uint8Array> {
  return new Uint8Array((await getBackend()).publicKey);
}

export async function deriveTransitSharedSecret(serverPoint: Uint8Array): Promise<Uint8Array> {
  const selected = await getBackend();
  try {
    return new Uint8Array(await selected.derive(serverPoint));
  } catch (error) {
    log.error(`[TransitKey] ${selected.storage} key agreement failed`, error);
    throw unavailable(selected.storage, error);
  }
}
