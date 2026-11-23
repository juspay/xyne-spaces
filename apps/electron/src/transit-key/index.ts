import { createECDH, type ECDH } from 'crypto';
import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log/main';
import { isBrokenKey, isUnsupported } from './helper-process';
import { createEnclaveKey, enclaveAgree } from './secure-enclave';
import { deleteWindowsKey, windowsAgree, type WindowsKeyProvider } from './windows-key';

/**
 * The desktop app's transit key (ECDH P-256), held by the main process for every window. The
 * renderer gets only the public key and ECDH results — the key is never in IndexedDB.
 *
 * macOS: the key lives in the Secure Enclave. Its encrypted handle is sealed with safeStorage
 * (the Keychain) in userData, so the same key is used across launches.
 * Windows: the key lives in the TPM, else in the Windows software key storage provider; Windows
 * keeps it by name per user and app flavor, so the app stores nothing.
 * Where the machine can do neither, and on Linux: a software key in this process, its private
 * key sealed with safeStorage (Keychain, DPAPI, GNOME Keyring / KWallet) in userData, so it too
 * is kept across launches.
 * Without even that: no key here. The calls reject with NO_PLATFORM_KEY, so every window uses the
 * same persisted WebCrypto pair in IndexedDB.
 *
 * The tier is chosen once per install and saved, and only a machine that cannot do a tier moves
 * on to the next. After that the saved tier is the only one used: a failure that is not the key's
 * own (a busy TPM, a helper timeout, a Keychain that cannot decrypt the file now) fails the call
 * and is retried, never answered with another tier's key, and a stored key is replaced only when
 * it is itself broken. The public key would otherwise change, and data the server already
 * encrypted for the old one would be unreadable. A failure never prompts.
 */

type Tier = 'secure_enclave' | WindowsKeyProvider | 'os_keyring' | 'none';
type TransitKeyStorage = Exclude<Tier, 'none'>;

const TIERS: readonly Tier[] = ['secure_enclave', 'tpm', 'software', 'os_keyring', 'none'];

/** Tried in this order on an install's first choice; one is skipped only when it cannot work here. */
const CANDIDATE_TIERS: Partial<Record<NodeJS.Platform, TransitKeyStorage[]>> = {
  darwin: ['secure_enclave', 'os_keyring'],
  win32: ['tpm', 'software', 'os_keyring'],
  linux: ['os_keyring'],
};

interface TransitKeyBackend {
  storage: TransitKeyStorage;
  /** 65-byte uncompressed P-256 point. */
  publicKey: Buffer;
  derive(serverPoint: Uint8Array): Promise<Buffer>;
}

/**
 * The rejection when this install holds no platform key, kept for the whole launch. The renderer
 * matches this text (older desktop builds use it too) to fall back to its IndexedDB pair.
 */
const NO_PLATFORM_KEY = 'No platform transit key';

/** The Secure Enclave's encrypted handle to its key. */
const ENCLAVE_FILE = 'transit-key.bin';
/** The OS keyring tier's private key. */
const KEYRING_FILE = 'transit-key-software.bin';
/** The tier this install chose. Not secret. */
const TIER_FILE = 'transit-key-tier.json';

let backend: Promise<TransitKeyBackend> | null = null;

/** A key that agreed but gave the wrong secret: broken, so it is replaced. */
class SelfCheckFailed extends Error {
  constructor() {
    super('Transit key agreement self-check failed');
    this.name = 'SelfCheckFailed';
  }
}

/** No OS keyring behind safeStorage on this machine, so no tier that seals a file can work. */
class KeyringUnavailable extends Error {
  constructor(fileName: string) {
    super(`No OS keyring to store ${fileName}`);
    this.name = 'KeyringUnavailable';
  }
}

const isTierUnsupported = (error: unknown): boolean =>
  isUnsupported(error) || error instanceof KeyringUnavailable;

const isNoPlatformKey = (error: unknown): boolean =>
  error instanceof Error && error.message === NO_PLATFORM_KEY;

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

// Throws when the value cannot be kept: a key that is not kept would change on the next launch,
// so without a keyring the tier cannot be used here at all.
async function writeSealed(fileName: string, value: Buffer): Promise<void> {
  if (!keyringAvailable()) throw new KeyringUnavailable(fileName);
  await writeFileAtomic(
    userDataPath(fileName),
    safeStorage.encryptString(value.toString('base64'))
  );
}

/** The saved tier; null when there is none yet, or the file holds no tier it knows. */
async function readSavedTier(): Promise<Tier | null> {
  let text: string;
  try {
    text = await fs.readFile(userDataPath(TIER_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const tier = (JSON.parse(text) as { tier?: unknown }).tier;
    if (TIERS.includes(tier as Tier)) return tier as Tier;
  } catch {
    // Not JSON: chosen again below.
  }
  log.warn(`[TransitKey] ${TIER_FILE} holds no known tier; choosing again`);
  return null;
}

async function saveTier(tier: Tier): Promise<void> {
  await writeFileAtomic(userDataPath(TIER_FILE), JSON.stringify({ tier }));
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
  if (!keyringAvailable()) throw new KeyringUnavailable(KEYRING_FILE);
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

function openTier(tier: TransitKeyStorage): Promise<TransitKeyBackend> {
  switch (tier) {
    case 'secure_enclave':
      return secureEnclaveBackend();
    case 'tpm':
    case 'software':
      return windowsBackend(tier);
    case 'os_keyring':
      return keyringBackend();
  }
}

async function selectBackend(): Promise<TransitKeyBackend> {
  const saved = await readSavedTier();
  if (saved === 'none') throw new Error(NO_PLATFORM_KEY);
  if (saved) {
    try {
      return await openTier(saved);
    } catch (error) {
      if (!isTierUnsupported(error)) throw error;
      // The machine can no longer do the saved tier (a TPM switched off, a build without the
      // helper): its key is out of reach either way, so choose again.
      log.warn(`[TransitKey] Saved ${saved} tier is no longer supported; choosing again`, error);
    }
  }

  for (const tier of CANDIDATE_TIERS[process.platform] ?? []) {
    try {
      const chosen = await openTier(tier);
      await saveTier(tier);
      return chosen;
    } catch (error) {
      // A failure that is not "cannot work here" saves nothing: the next call starts over, so
      // one slow or busy launch never settles the install on a lesser tier.
      if (!isTierUnsupported(error)) throw error;
      log.info(`[TransitKey] ${tier} is not supported here`, error);
    }
  }
  await saveTier('none');
  throw new Error(NO_PLATFORM_KEY);
}

function getBackend(): Promise<TransitKeyBackend> {
  backend ??= selectBackend().then(
    (selected) => {
      log.info(`[TransitKey] Using ${selected.storage} storage`);
      return selected;
    },
    (error: unknown) => {
      // A failure is not kept, so the next call (from any window) tries again. "No platform
      // key" is kept for the launch: every window then uses the same IndexedDB pair.
      if (isNoPlatformKey(error)) {
        log.warn('[TransitKey] No platform key; windows use their WebCrypto key');
      } else {
        backend = null;
        log.warn('[TransitKey] Transit key unavailable for now; the next call retries', error);
      }
      throw error;
    }
  );
  return backend;
}

export async function getTransitPublicKey(): Promise<Uint8Array> {
  return new Uint8Array((await getBackend()).publicKey);
}

export async function deriveTransitSharedSecret(serverPoint: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await (await getBackend()).derive(serverPoint));
}
