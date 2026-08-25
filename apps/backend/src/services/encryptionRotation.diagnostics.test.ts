import { rotateCiphertext, rotateEncryptedJsonStrings } from './encryptionRotation';
import { _resetKeyRingCache, encrypt } from './encryptionService';

const LEGACY_KEY = '11'.repeat(32);
const K1 = '22'.repeat(32);
const K2 = '33'.repeat(32);

const originalEnvironment = {
  legacy: process.env.ENCRYPTION_KEY,
  keys: process.env.ENCRYPTION_KEYS,
};

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function configure(entries: Array<{ id: string; key: string }>): void {
  process.env.ENCRYPTION_KEY = LEGACY_KEY;
  process.env.ENCRYPTION_KEYS = JSON.stringify(entries);
  _resetKeyRingCache();
}

afterEach(() => {
  restoreEnvironment('ENCRYPTION_KEY', originalEnvironment.legacy);
  restoreEnvironment('ENCRYPTION_KEYS', originalEnvironment.keys);
  _resetKeyRingCache();
});

describe('encryptionRotation diagnostics', () => {
  test('preserves the missing-key failure reason', () => {
    configure([{ id: 'k1', key: K1 }]);
    const k1Ciphertext = encrypt('diagnostic-secret');

    configure([{ id: 'k2', key: K2 }]);

    const result = rotateCiphertext(k1Ciphertext, 'k2', false);

    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/No encryption key registered for keyId "k1"/);
    expect(result.error).not.toContain('diagnostic-secret');
  });

  test('surfaces bounded JSON rotation failure samples', () => {
    configure([{ id: 'k1', key: K1 }]);
    const k1Ciphertext = encrypt('nested-secret');

    configure([{ id: 'k2', key: K2 }]);

    const result = rotateEncryptedJsonStrings(
      {
        secret: `enc:${k1Ciphertext}`,
        ordinary: 'unchanged',
      },
      'k2',
      false
    );

    expect(result.changed).toBe(false);
    expect(result.stats.failed).toBe(1);
    expect(result.stats.failureSamples).toHaveLength(1);
    expect(result.stats.failureSamples[0]).toMatch(/No encryption key registered for keyId "k1"/);
    expect(result.stats.failureSamples[0]).not.toContain('nested-secret');
    expect(result.value.ordinary).toBe('unchanged');
  });
});
