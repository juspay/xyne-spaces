import {
  classifyCiphertext,
  rotateCiphertext,
  rotateEncryptedJsonStrings,
} from './encryptionRotation';
import { _resetKeyRingCache, decrypt, encrypt } from './encryptionService';

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

function configure(activeKeyId?: 'k1' | 'k2'): void {
  process.env.ENCRYPTION_KEY = LEGACY_KEY;

  if (!activeKeyId) {
    // An absent ordered ring makes encrypt() produce legacy iv:ciphertext.
    delete process.env.ENCRYPTION_KEYS;
  } else {
    // The final ordered entry is the active writer.
    const orderedKeys =
      activeKeyId === 'k1'
        ? [
            { id: 'k2', key: K2 },
            { id: 'k1', key: K1 },
          ]
        : [
            { id: 'k1', key: K1 },
            { id: 'k2', key: K2 },
          ];

    process.env.ENCRYPTION_KEYS = JSON.stringify(orderedKeys);
  }

  _resetKeyRingCache();
}

function createLegacyCiphertext(plaintext: string): string {
  configure();
  return encrypt(plaintext);
}

function createVersionedCiphertext(plaintext: string, keyId: 'k1' | 'k2'): string {
  configure(keyId);
  return encrypt(plaintext);
}

afterEach(() => {
  restoreEnvironment('ENCRYPTION_KEY', originalEnvironment.legacy);
  restoreEnvironment('ENCRYPTION_KEYS', originalEnvironment.keys);
  _resetKeyRingCache();
});

describe('encryptionRotation', () => {
  test('classifies legacy, active, other-key and malformed values', () => {
    const legacy = createLegacyCiphertext('legacy-value');
    const active = createVersionedCiphertext('active-value', 'k1');
    const other = createVersionedCiphertext('other-value', 'k2');

    expect(classifyCiphertext(legacy, 'k1')).toEqual({
      kind: 'legacy',
      keyId: 'legacy',
    });

    expect(classifyCiphertext(active, 'k1')).toEqual({
      kind: 'active',
      keyId: 'k1',
    });

    expect(classifyCiphertext(other, 'k1')).toEqual({
      kind: 'other-key',
      keyId: 'k2',
    });

    expect(classifyCiphertext('not-ciphertext', 'k1')).toEqual({
      kind: 'malformed',
    });
  });

  test('dry-run verifies decryptability without changing ciphertext', () => {
    const legacy = createLegacyCiphertext('dry-run-value');
    configure('k1');

    const result = rotateCiphertext(legacy, 'k1', false);

    expect(result.outcome).toBe('would-rotate');
    expect(result.value).toBe(legacy);
  });

  test('apply re-encrypts legacy ciphertext with the active key', () => {
    const legacy = createLegacyCiphertext('rotate-me');
    configure('k1');

    const result = rotateCiphertext(legacy, 'k1', true);

    expect(result.outcome).toBe('rotated');
    expect(result.value).toMatch(/^v2:k1:/);
    expect(decrypt(result.value)).toBe('rotate-me');
  });

  test('already-active ciphertext remains unchanged', () => {
    const active = createVersionedCiphertext('keep-me', 'k1');
    configure('k1');

    const result = rotateCiphertext(active, 'k1', true);

    expect(result.outcome).toBe('already-active');
    expect(result.value).toBe(active);
  });

  test('rotates nested enc values without changing unrelated strings', () => {
    const legacy = createLegacyCiphertext('nested-secret');
    configure('k1');

    const input = {
      steps: [
        {
          config: {
            headers: {
              authorization: `enc:${legacy}`,
              ordinary: 'plain-value',
            },
          },
        },
      ],
    };

    const result = rotateEncryptedJsonStrings(input, 'k1', true);
    const rotated = result.value.steps[0].config.headers.authorization;

    expect(result.changed).toBe(true);
    expect(rotated).toMatch(/^enc:v2:k1:/);
    expect(decrypt(rotated.slice('enc:'.length))).toBe('nested-secret');
    expect(result.value.steps[0].config.headers.ordinary).toBe('plain-value');
    expect(result.stats.rotated).toBe(1);
  });

  test('rejects using legacy as the backfill destination', () => {
    expect(() => classifyCiphertext('not-ciphertext', 'legacy')).toThrow('must not be "legacy"');
  });
});
