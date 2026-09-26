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

describe('encryptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEYS;
    delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
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
