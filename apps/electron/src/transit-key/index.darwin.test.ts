import { execFileSync } from 'child_process';
import { createECDH } from 'crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The macOS transit key, end to end in the main process: the real Secure Enclave through the real
 * helper (native/transit-key, built with build.sh), and a stand-in helper for a Mac without one.
 * Only Electron is faked: userData is a temp dir and safeStorage seals in the clear.
 */

const env = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  keyringAvailable: true,
  decryptFails: false,
  logError: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => env.userData, getAppPath: () => env.appPath, isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => env.keyringAvailable,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (sealed: Buffer) => {
      if (env.decryptFails) throw new Error('Keychain cannot decrypt right now');
      return sealed.toString().replace(/^sealed:/, '');
    },
  },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: env.logError },
}));

const ELECTRON_ROOT = path.resolve(__dirname, '../..');
const REAL_HELPER = path.join(ELECTRON_ROOT, 'native', 'transit-key', 'transit-key');
const ENCLAVE_FILE = 'transit-key.bin';
const KEYRING_FILE = 'transit-key-software.bin';

/** This Mac has a Secure Enclave and the helper is built (`native/transit-key/build.sh`). */
function realEnclaveAvailable(): boolean {
  if (process.platform !== 'darwin' || !existsSync(REAL_HELPER)) return false;
  try {
    return JSON.parse(execFileSync(REAL_HELPER, ['probe']).toString()).available === 'true';
  } catch {
    return false;
  }
}

type TransitKey = typeof import('./index');

/** A fresh main process: the module keeps its key for the launch. */
async function launch(): Promise<TransitKey> {
  vi.resetModules();
  return import('./index');
}

/** ECDH with a throwaway server key, checked from the server's side; returns the public key. */
async function expectWorkingKey(transitKey: TransitKey): Promise<Buffer> {
  const publicKey = Buffer.from(await transitKey.getTransitPublicKey());
  const server = createECDH('prime256v1');
  server.generateKeys();
  const secret = await transitKey.deriveTransitSharedSecret(new Uint8Array(server.getPublicKey()));
  expect(Buffer.from(secret).equals(server.computeSecret(publicKey))).toBe(true);
  return publicKey;
}

const userDataFile = (name: string): string => path.join(env.userData, name);
const seal = (bytes: Buffer): Buffer => Buffer.from(`sealed:${bytes.toString('base64')}`);

/** An app dir whose transit-key helper is this shell script, for a Mac without an Enclave. */
function fakeHelper(script: string): string {
  const appPath = mkdtempSync(path.join(tmpdir(), 'transit-key-app-'));
  const dir = path.join(appPath, 'native', 'transit-key');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'transit-key'), `#!/bin/sh\n${script}\n`);
  chmodSync(path.join(dir, 'transit-key'), 0o755);
  return appPath;
}

/** A helper with no Secure Enclave: probe says so, and the key commands exit "unsupported". */
const NO_ENCLAVE = `case "$1" in
  probe) echo '{"available":"false"}' ;;
  *) echo '{"error":"Secure Enclave unavailable"}'; exit 3 ;;
esac`;

const tempDirs: string[] = [];

beforeEach(() => {
  env.userData = mkdtempSync(path.join(tmpdir(), 'transit-key-userdata-'));
  env.appPath = ELECTRON_ROOT;
  env.keyringAvailable = true;
  env.decryptFails = false;
  env.logError.mockClear();
  tempDirs.push(env.userData);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!realEnclaveAvailable())('macOS with a Secure Enclave', () => {
  it('chooses the Secure Enclave, recording no label of the choice', async () => {
    await expectWorkingKey(await launch());
    expect(existsSync(userDataFile(ENCLAVE_FILE))).toBe(true);
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);
    expect(existsSync(userDataFile('transit-key-tier.json'))).toBe(false);
  });

  it('keeps the same key across launches', async () => {
    const first = await expectWorkingKey(await launch());
    const second = await expectWorkingKey(await launch());
    expect(second.equals(first)).toBe(true);
  });

  it('fails loudly, keeping the key, when the Keychain cannot decrypt it, and retries it', async () => {
    const original = await expectWorkingKey(await launch());
    const sealed = readFileSync(userDataFile(ENCLAVE_FILE));

    env.decryptFails = true;
    const transitKey = await launch();
    await expect(transitKey.getTransitPublicKey()).rejects.toThrow(
      'Transit key unavailable (secure_enclave): Keychain cannot decrypt right now'
    );
    expect(env.logError).toHaveBeenCalled();
    expect(readFileSync(userDataFile(ENCLAVE_FILE)).equals(sealed)).toBe(true);
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);

    // The failure is not kept: the next call in the same launch gets the original key.
    env.decryptFails = false;
    expect((await expectWorkingKey(transitKey)).equals(original)).toBe(true);
  });

  it('replaces a broken stored key with a new Enclave key, never a software one', async () => {
    await expectWorkingKey(await launch());
    writeFileSync(userDataFile(ENCLAVE_FILE), seal(Buffer.from('not an Enclave handle')));

    await expectWorkingKey(await launch());
    expect(readFileSync(userDataFile(ENCLAVE_FILE)).toString()).not.toContain(
      Buffer.from('not an Enclave handle').toString('base64')
    );
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);
  });

  it('fails loudly when the helper is missing from the build, without moving to the keyring', async () => {
    const original = await expectWorkingKey(await launch());

    const builtAppPath = env.appPath;
    env.appPath = mkdtempSync(path.join(tmpdir(), 'transit-key-nohelper-'));
    tempDirs.push(env.appPath);
    await expect((await launch()).getTransitPublicKey()).rejects.toThrow(
      /Transit key unavailable \(unknown\): transit-key helper cannot run/
    );
    expect(env.logError).toHaveBeenCalled();
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);

    // With the helper back, the next launch has the same Enclave key.
    env.appPath = builtAppPath;
    expect((await expectWorkingKey(await launch())).equals(original)).toBe(true);
  });
});

describe.runIf(process.platform === 'darwin')('macOS without a Secure Enclave', () => {
  it('uses the OS keyring store and keeps its key across launches', async () => {
    env.appPath = fakeHelper(NO_ENCLAVE);
    tempDirs.push(env.appPath);

    const first = await expectWorkingKey(await launch());
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(true);
    expect((await expectWorkingKey(await launch())).equals(first)).toBe(true);
  });

  it('fails loudly without a keyring', async () => {
    env.appPath = fakeHelper(NO_ENCLAVE);
    tempDirs.push(env.appPath);
    env.keyringAvailable = false;

    await expect((await launch()).getTransitPublicKey()).rejects.toThrow(
      'Transit key unavailable (os_keyring): No OS keyring'
    );
    expect(env.logError).toHaveBeenCalled();
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);
  });

  it('treats a probe that fails as an error, not as "no Secure Enclave"', async () => {
    env.appPath = fakeHelper(`echo '{"error":"helper crashed"}'; exit 1`);
    tempDirs.push(env.appPath);

    await expect((await launch()).getTransitPublicKey()).rejects.toThrow(
      /Transit key unavailable \(unknown\): .*helper crashed/
    );
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);
  });

  it('fails loudly when it holds an Enclave key but reports no Enclave, never making a keyring key', async () => {
    env.appPath = fakeHelper(NO_ENCLAVE);
    tempDirs.push(env.appPath);
    const sealed = seal(Buffer.from('an Enclave handle'));
    writeFileSync(userDataFile(ENCLAVE_FILE), sealed);

    await expect((await launch()).getTransitPublicKey()).rejects.toThrow(
      /Transit key unavailable \(secure_enclave\): this Mac holds a Secure Enclave key .* but reports no Secure Enclave/
    );
    expect(env.logError).toHaveBeenCalled();
    expect(readFileSync(userDataFile(ENCLAVE_FILE)).equals(sealed)).toBe(true);
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(false);
  });

  it('ignores a label left by an earlier build', async () => {
    env.appPath = fakeHelper(NO_ENCLAVE);
    tempDirs.push(env.appPath);
    writeFileSync(userDataFile('transit-key-tier.json'), JSON.stringify({ tier: 'secure_enclave' }));

    await expectWorkingKey(await launch());
    expect(existsSync(userDataFile(KEYRING_FILE))).toBe(true);
  });
});
