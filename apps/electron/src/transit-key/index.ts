import { createECDH, type ECDH } from 'crypto';
import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log/main';
import { createEnclaveKey, enclaveAgree } from './secure-enclave';
import {
  deleteWindowsKey,
  isKeyFailure,
  windowsAgree,
  type WindowsKeyProvider,
} from './windows-key';

/**
 * The desktop app's transit key (ECDH P-256), held by the main process for every window. The
 * renderer gets only the public key and ECDH results — the key is never in IndexedDB.
 *
 * macOS: the key lives in the Secure Enclave. Its encrypted handle is sealed with safeStorage
 * (the Keychain) in userData, so the same key is used across launches.
 * Windows: the key lives in the TPM, else in the Windows software key storage provider; Windows
 * keeps it by name per user and app flavor, so the app stores nothing.
 * Anywhere that fails, and on Linux: a software key in this process, its private key sealed with
 * safeStorage (Keychain, DPAPI, GNOME Keyring / KWallet) in userData, so it too is kept across
 * launches.
 * Without even that: no key here. The calls reject for the whole launch, so every window falls
 * back to the same persisted WebCrypto pair in IndexedDB. Never a key that is not kept: it would
 * change on the next launch, and data the server already encrypted for the old one would be
 * unreadable. A failure never prompts or holds up login.
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
/** The OS keyring tier's private key. */
const KEYRING_FILE = 'transit-key-software.bin';
/** The most the hardware key may take to be ready before this launch tries the next tier. */
const SELECT_TIMEOUT_MS = 5000;

let backend: Promise<TransitKeyBackend> | null = null;

const sealedPath = (fileName: string): string => path.join(app.getPath('userData'), fileName);

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

async function readSealed(fileName: string): Promise<Buffer | null> {
  if (!keyringAvailable()) return null;
  try {
    const sealed = await fs.readFile(sealedPath(fileName));
    return Buffer.from(safeStorage.decryptString(sealed), 'base64');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`[TransitKey] Could not read ${fileName}; creating a new key`, error);
    }
    return null;
  }
}

// Throws when the value cannot be kept: a key that is not kept would change on the next launch,
// so its tier fails instead and the next one is tried.
async function writeSealed(fileName: string, value: Buffer): Promise<void> {
  if (!keyringAvailable()) throw new Error(`No OS keyring to store ${fileName}`);
  const sealed = safeStorage.encryptString(value.toString('base64'));
  // Written aside, then moved over: a crash mid-write never leaves half a file.
  const target = sealedPath(fileName);
  const pending = `${target}.tmp`;
  await fs.writeFile(pending, sealed, { mode: 0o600 });
  await fs.rename(pending, target);
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
      if (!probe.computeSecret(publicKey).equals(secret)) {
        throw new Error('Transit key agreement self-check failed');
      }
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

  // A stored key that fails the agreement or its check is replaced, and a new key is stored
  // only once it passes, so a bad key is never kept for later launches.
  const stored = await readSealed(ENCLAVE_FILE);
  if (stored) {
    try {
      const checked = await enclaveAgree(stored, probe.point);
      probe.check(checked);
      return enclaveBackend(stored, checked.publicKey);
    } catch (error) {
      log.warn('[TransitKey] Stored Secure Enclave key is unusable; creating a new one', error);
    }
  }

  const blob = await createEnclaveKey();
  const checked = await enclaveAgree(blob, probe.point);
  probe.check(checked);
  await writeSealed(ENCLAVE_FILE, blob);
  return enclaveBackend(blob, checked.publicKey);
}

async function windowsBackend(provider: WindowsKeyProvider): Promise<TransitKeyBackend> {
  const probe = createProbe();
  // Windows keeps the key by name and the helper creates it on first use; one that exists but
  // no longer works is replaced. Any other failure (no helper, no provider) has no key to
  // replace, so it goes straight to the caller, which tries the next tier.
  const checked = await windowsAgree(provider, probe.point).catch(async (error: unknown) => {
    if (!isKeyFailure(error)) throw error;
    log.warn(`[TransitKey] Stored ${provider} key is unusable; creating a new one`, error);
    await deleteWindowsKey(provider);
    return windowsAgree(provider, probe.point);
  });
  probe.check(checked);

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
  if (!keyringAvailable()) throw new Error('No OS keyring for safeStorage');
  const ecdh = createECDH('prime256v1');
  const stored = await readSealed(KEYRING_FILE);
  if (stored) {
    try {
      ecdh.setPrivateKey(stored);
      return keyringKeyBackend(ecdh);
    } catch (error) {
      log.warn('[TransitKey] Stored OS keyring key is unusable; creating a new one', error);
    }
  }
  ecdh.generateKeys();
  await writeSealed(KEYRING_FILE, ecdh.getPrivateKey());
  return keyringKeyBackend(ecdh);
}

function startHardwareBackend(): Promise<TransitKeyBackend> | null {
  if (process.platform === 'darwin') return secureEnclaveBackend();
  if (process.platform === 'win32') {
    return windowsBackend('tpm').catch((error: unknown) => {
      log.warn('[TransitKey] TPM key unavailable; trying the software key provider', error);
      return windowsBackend('software');
    });
  }
  return null;
}

async function hardwareBackend(): Promise<TransitKeyBackend | null> {
  const pending = startHardwareBackend();
  if (!pending) return null;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), SELECT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([pending, timedOut]);
  } catch (error) {
    log.warn('[TransitKey] Hardware key unavailable; trying the OS keyring key', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The keyring tier runs after the hardware cap: it is a file read and a safeStorage call.
async function platformBackend(): Promise<TransitKeyBackend | null> {
  const hardware = await hardwareBackend();
  if (hardware) return hardware;
  try {
    return await keyringBackend();
  } catch (error) {
    log.warn('[TransitKey] OS keyring key unavailable; windows fall back to their WebCrypto key', error);
    return null;
  }
}

async function selectBackend(): Promise<TransitKeyBackend> {
  const selected = await platformBackend();
  if (!selected) throw new Error('No platform transit key');
  log.info(`[TransitKey] Using ${selected.storage} storage`);
  return selected;
}

function getBackend(): Promise<TransitKeyBackend> {
  backend ??= selectBackend();
  return backend;
}

export async function getTransitPublicKey(): Promise<Uint8Array> {
  return new Uint8Array((await getBackend()).publicKey);
}

export async function deriveTransitSharedSecret(serverPoint: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await (await getBackend()).derive(serverPoint));
}
