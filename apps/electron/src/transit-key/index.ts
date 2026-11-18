import { createECDH } from 'crypto';
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
 * Anywhere that fails, and on other platforms for now: a key held in this process's memory
 * only, new each launch. Losing the key costs nothing — it protects no stored data and is
 * registered again on every load — so every failure falls back silently and never prompts
 * or holds up login.
 */

type TransitKeyStorage = 'secure_enclave' | WindowsKeyProvider | 'memory';

interface TransitKeyBackend {
  storage: TransitKeyStorage;
  /** 65-byte uncompressed P-256 point. */
  publicKey: Buffer;
  derive(serverPoint: Uint8Array): Promise<Buffer>;
}

const FILE_NAME = 'transit-key.bin';
/** The most the platform key may take to be ready before this launch uses a memory key. */
const SELECT_TIMEOUT_MS = 5000;

let backend: Promise<TransitKeyBackend> | null = null;

const blobPath = (): string => path.join(app.getPath('userData'), FILE_NAME);

/** A 65-byte uncompressed P-256 point, as the encryption service publishes its keys. */
export function isP256Point(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === 65 && value[0] === 0x04;
}

async function readSealedBlob(): Promise<Buffer | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const sealed = await fs.readFile(blobPath());
    return Buffer.from(safeStorage.decryptString(sealed), 'base64');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[TransitKey] Could not read the stored Secure Enclave key; creating a new one', error);
    }
    return null;
  }
}

async function writeSealedBlob(blob: Buffer): Promise<void> {
  // Without safeStorage the handle is not kept, and the next launch makes a new key.
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const sealed = safeStorage.encryptString(blob.toString('base64'));
    // Written aside, then moved over: a crash mid-write never leaves half a file.
    const target = blobPath();
    const pending = `${target}.tmp`;
    await fs.writeFile(pending, sealed, { mode: 0o600 });
    await fs.rename(pending, target);
  } catch (error) {
    log.warn('[TransitKey] Could not store the Secure Enclave key', error);
  }
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

async function secureEnclaveBackend(): Promise<TransitKeyBackend> {
  const probe = createProbe();
  const probePoint = probe.point;

  let blob = await readSealedBlob();
  let checked = blob
    ? await enclaveAgree(blob, probePoint).catch((error: unknown) => {
        log.warn('[TransitKey] Stored Secure Enclave key is unusable; creating a new one', error);
        return null;
      })
    : null;
  if (!blob || !checked) {
    blob = await createEnclaveKey();
    checked = await enclaveAgree(blob, probePoint);
    await writeSealedBlob(blob);
  }
  probe.check(checked);

  const key = blob;
  return {
    storage: 'secure_enclave',
    publicKey: checked.publicKey,
    derive: derivePerServerKey(
      async (serverPoint) => (await enclaveAgree(key, serverPoint)).secret
    ),
  };
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

function memoryBackend(): TransitKeyBackend {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    storage: 'memory',
    publicKey: ecdh.getPublicKey(),
    derive: async (serverPoint) => ecdh.computeSecret(serverPoint),
  };
}

function startPlatformBackend(): Promise<TransitKeyBackend> | null {
  if (process.platform === 'darwin') return secureEnclaveBackend();
  if (process.platform === 'win32') {
    return windowsBackend('tpm').catch((error: unknown) => {
      log.warn('[TransitKey] TPM key unavailable; trying the software key provider', error);
      return windowsBackend('software');
    });
  }
  return null;
}

async function platformBackend(): Promise<TransitKeyBackend | null> {
  const pending = startPlatformBackend();
  if (!pending) return null;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), SELECT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([pending, timedOut]);
  } catch (error) {
    log.warn('[TransitKey] Platform key unavailable; using a memory key', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function selectBackend(): Promise<TransitKeyBackend> {
  const selected = (await platformBackend()) ?? memoryBackend();
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
