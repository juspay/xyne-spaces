// The factory re-executes after every jest.resetModules(); caching the
// mock set on globalThis keeps the module-under-test and this test file
// asserting against the same fns.
jest.mock('@/utils/logger', () => {
  const store = globalThis as Record<string, unknown>;
  if (!store.__encryptionLoggerMock) {
    store.__encryptionLoggerMock = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger: store.__encryptionLoggerMock as any,
    stream: { write: jest.fn() },
  };
});

import { logger } from '@/utils/logger';
import {
  createCipheriv,
  randomBytes,
} from 'node:crypto';

const LEGACY_HEX = 'a1'.repeat(32);
const K1_HEX = 'b2'.repeat(32);
const K2_HEX = 'c3'.repeat(32);
const PLAINTEXT = 'smoke-plaintext';

type ServiceModule = typeof import('./encryptionService');

function freshConfig(
  env: { keys?: string; active?: string } = {}
): ReturnType<ServiceModule['loadEncryptionRuntimeConfig']> {
  jest.resetModules();
  delete process.env.ENCRYPTION_KEYS;
  delete process.env.ENCRYPTION_ACTIVE_KEY_ID;

  if (env.keys !== undefined) {
    process.env.ENCRYPTION_KEYS = env.keys;
  }

  if (env.active !== undefined) {
    process.env.ENCRYPTION_ACTIVE_KEY_ID = env.active;
  }

  return require('./encryptionService').loadEncryptionRuntimeConfig();
}

function cbcBlob(
  keyHex: string,
  plaintext: string,
  keyId?: string
): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const base = `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  return keyId ? `v2:${keyId}:${base}` : base;
}

function freshService(env: {
  keys?: string;
  active?: string;
} = {}): ServiceModule {
  jest.resetModules();
  delete process.env.ENCRYPTION_KEYS;
  delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
  process.env.ENCRYPTION_KEY = LEGACY_HEX;

  if (env.keys !== undefined) {
    process.env.ENCRYPTION_KEYS = env.keys;
  }

  if (env.active !== undefined) {
    process.env.ENCRYPTION_ACTIVE_KEY_ID = env.active;
  }

  return require('./encryptionService');
}

function shape(blob: string): {
  parts: string[];
  isV2: boolean;
  writer: string | null;
} {
  const parts = blob.split(':');
  return {
    parts,
    isV2: parts[0] === 'v2',
    writer: parts[0] === 'v2' ? parts[1] : null,
  };
}

describe('encryptionKeyRingConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEYS;
    delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
  });

  it('legacy mode when ENCRYPTION_KEYS is missing', () => {
    const config = freshConfig();
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_not_configured');
  });

  it('legacy mode when ENCRYPTION_KEYS is blank', () => {
    const config = freshConfig({ keys: '   ' });
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_not_configured');
  });

  it('legacy mode with sanitized warning for malformed JSON', () => {
    const config = freshConfig({ keys: 'not-json' });
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_json_invalid');
    expect((logger.warn as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('legacy mode when JSON is not a ring', () => {
    expect(freshConfig({ keys: '{}' }).reason).toBe(
      'keyring_validation_failed'
    );
    expect(freshConfig({ keys: '[]' }).reason).toBe(
      'keyring_validation_failed'
    );
    expect(freshConfig({ keys: '{}' }).mode).toBe('legacy');
  });

  it('legacy mode on duplicate IDs', () => {
    const config = freshConfig({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k1', key: K2_HEX },
      ]),
    });
    expect(config.mode).toBe('legacy');
    expect(config.reason).toBe('keyring_validation_failed');
  });

  it('normalizes whitespace around an otherwise valid key', () => {
    const config = freshConfig({
      keys: JSON.stringify([{ id: 'k1', key: ` ${K1_HEX} ` }]),
    });
    expect(config.mode).toBe('keyring-read');
    expect(config.keys.get('k1')).toEqual(
      Buffer.from(K1_HEX, 'hex')
    );
  });

  it('valid ring without an active ID selects keyring-read mode', () => {
    const config = freshConfig({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k2', key: K2_HEX },
      ]),
    });
    expect(config.mode).toBe('keyring-read');
    expect(config.reason).toBe('active_key_not_configured');
    expect(config.activeKeyId).toBeNull();
    expect(config.keys.size).toBe(2);
  });

  it('valid ring with an unknown active ID stays in keyring-read mode and warns', () => {
    const config = freshConfig({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k2', key: K2_HEX },
      ]),
      active: 'ghost',
    });
    expect(config.mode).toBe('keyring-read');
    expect(config.reason).toBe('active_key_not_found');
    expect(config.activeKeyId).toBeNull();
    expect(config.keys.size).toBe(2);
    expect((logger.warn as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('valid ring with a matching active ID selects keyring-write mode', () => {
    const config = freshConfig({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k2', key: K2_HEX },
      ]),
      active: 'k2',
    });
    expect(config.mode).toBe('keyring-write');
    expect(config.reason).toBe('keyring_write_enabled');
    expect(config.activeKeyId).toBe('k2');
  });

  it('never logs key material or raw configuration values', () => {
    freshConfig({ keys: `SENTINEL-${LEGACY_HEX}` });
    freshConfig({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k2', key: K2_HEX },
      ]),
      active: 'k1',
    });

    const lines = [
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ].map((args) => args.map(String).join(' '));

    for (const raw of [K1_HEX, K2_HEX, LEGACY_HEX]) {
      for (const line of lines) {
        expect(line).not.toContain(raw);
      }
    }
  });
});

describe('encryptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes and reads the legacy format without a ring', () => {
    const service = freshService();
    const blob = service.encrypt(PLAINTEXT);
    expect(shape(blob).isV2).toBe(false);
    expect(shape(blob).parts).toHaveLength(2);
    expect(service.decrypt(blob)).toBe(PLAINTEXT);
  });

  it('writes legacy with a blank ring value', () => {
    const service = freshService({ keys: '  ' });
    expect(shape(service.encrypt(PLAINTEXT)).isV2).toBe(false);
  });

  it('falls back to legacy writes for an invalid ring', () => {
    const service = freshService({ keys: 'not-json' });
    const blob = service.encrypt(PLAINTEXT);
    expect(shape(blob).isV2).toBe(false);
    expect(service.decrypt(blob)).toBe(PLAINTEXT);
  });

  it('cannot read v2 without a ring', () => {
    const service = freshService();
    expect(() =>
      service.decrypt(cbcBlob(K1_HEX, PLAINTEXT, 'k1'))
    ).toThrow(/requires a valid ENCRYPTION_KEYS/);
  });

  it('keyring-read mode still writes legacy but reads legacy and v2', () => {
    const service = freshService({
      keys: JSON.stringify([{ id: 'k1', key: K1_HEX }]),
    });

    const blob = service.encrypt(PLAINTEXT);
    expect(shape(blob).isV2).toBe(false);
    expect(service.decrypt(blob)).toBe(PLAINTEXT);

    expect(
      service.decrypt(cbcBlob(K1_HEX, 'stored-secret', 'k1'))
    ).toBe('stored-secret');
    expect(
      service.decrypt(cbcBlob(LEGACY_HEX, 'old-secret'))
    ).toBe('old-secret');
  });

  it('keyring-write mode writes v2 with the selected active key and reads everything', () => {
    const service = freshService({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k2', key: K2_HEX },
      ]),
      active: 'k2',
    });

    const blob = service.encrypt(PLAINTEXT);
    const { isV2, writer } = shape(blob);
    expect(isV2).toBe(true);
    expect(writer).toBe('k2');
    expect(service.decrypt(blob)).toBe(PLAINTEXT);

    expect(
      service.decrypt(cbcBlob(K1_HEX, 'older-k1-data', 'k1'))
    ).toBe('older-k1-data');
    expect(
      service.decrypt(cbcBlob(LEGACY_HEX, 'legacy-data'))
    ).toBe('legacy-data');
  });

  it('an unknown active ID keeps writes legacy', () => {
    const service = freshService({
      keys: JSON.stringify([{ id: 'k1', key: K1_HEX }]),
      active: 'ghost',
    });
    expect(shape(service.encrypt(PLAINTEXT)).isV2).toBe(false);
  });

  it('k1 ciphertext remains readable after k2 is added and activated', () => {
    const writtenWithK1 = cbcBlob(K1_HEX, 'k1-era-secret', 'k1');

    const service = freshService({
      keys: JSON.stringify([
        { id: 'k1', key: K1_HEX },
        { id: 'k2', key: K2_HEX },
      ]),
      active: 'k2',
    });

    expect(service.decrypt(writtenWithK1)).toBe(
      'k1-era-secret'
    );
    const newBlob = service.encrypt('k2-era-secret');
    expect(shape(newBlob).writer).toBe('k2');
    expect(service.decrypt(newBlob)).toBe('k2-era-secret');
  });

  it('an unknown v2 key ID fails cleanly without leaking secrets', () => {
    const service = freshService({
      keys: JSON.stringify([{ id: 'k1', key: K1_HEX }]),
      active: 'k1',
    });

    expect(() =>
      service.decrypt(cbcBlob(LEGACY_HEX, 'secret', 'ghost'))
    ).toThrow(/"ghost"/);

    try {
      service.decrypt(cbcBlob(LEGACY_HEX, 'secret', 'ghost'));
      fail('expected decrypt to throw');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      for (const raw of [LEGACY_HEX, K1_HEX, 'secret']) {
        expect(message).not.toContain(raw);
      }
    }
  });

  it('logger output across modes contains no sensitive material', () => {
    freshService();
    freshService({ keys: 'SENTINEL-not-json' });
    freshService({
      keys: JSON.stringify([{ id: 'k1', key: K1_HEX }]),
      active: 'k1',
    });

    const lines = [
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
    ].map((args) => args.map(String).join(' '));

    for (const raw of [
      LEGACY_HEX,
      K1_HEX,
      PLAINTEXT,
      'SENTINEL-not-json',
    ]) {
      for (const line of lines) {
        expect(line).not.toContain(raw);
      }
    }
  });
});
