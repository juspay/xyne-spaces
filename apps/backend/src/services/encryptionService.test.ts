import crypto from 'crypto';
import { encrypt, decrypt, _resetKeyRingCache } from './encryptionService';

const KEY_LEGACY = crypto.randomBytes(32).toString('hex'); // -> keyId "legacy"
const KEY_K1 = crypto.randomBytes(32).toString('hex');
const KEY_K2 = crypto.randomBytes(32).toString('hex');

// Snapshot and restore the encryption-related env around each test so the key
// ring is rebuilt deterministically per case.
const ENV_KEYS = ['ENCRYPTION_KEY', 'ENCRYPTION_KEYS', 'ENCRYPTION_ACTIVE_KEY_ID'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  _resetKeyRingCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetKeyRingCache();
});

describe('encryptionService — legacy behaviour (no rotation configured)', () => {
  it('emits the legacy "iv:ct" format and round-trips', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    _resetKeyRingCache();

    const ct = encrypt('hello-secret');
    expect(ct.split(':')).toHaveLength(2);
    expect(ct.startsWith('v2:')).toBe(false);
    expect(decrypt(ct)).toBe('hello-secret');
  });

  it('throws when ENCRYPTION_KEY is missing', () => {
    _resetKeyRingCache();
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY not found/);
  });
});

describe('encryptionService — versioned writes after activation', () => {
  it('emits "v2:<keyId>:iv:ct" and round-trips when a key is activated', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = JSON.stringify({ k1: KEY_K1 });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'k1';
    _resetKeyRingCache();

    const ct = encrypt('rotate-me');
    const parts = ct.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v2');
    expect(parts[1]).toBe('k1');
    expect(decrypt(ct)).toBe('rotate-me');
  });

  it('can activate the legacy key by id and still emit versioned output', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'legacy';
    _resetKeyRingCache();

    const ct = encrypt('x');
    expect(ct.startsWith('v2:legacy:')).toBe(true);
    expect(decrypt(ct)).toBe('x');
  });
});

describe('encryptionService — mixed-format decryption during rotation', () => {
  it('decrypts OLD legacy rows after the active key has moved to k1', () => {
    // Row written before rotation (legacy format, legacy key).
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    _resetKeyRingCache();
    const oldRow = encrypt('written-before-rotation');
    expect(oldRow.startsWith('v2:')).toBe(false);

    // Now rotate: legacy still in ring, active key is k1.
    process.env.ENCRYPTION_KEYS = JSON.stringify({ k1: KEY_K1 });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'k1';
    _resetKeyRingCache();

    // Old row still decrypts, new writes use k1.
    expect(decrypt(oldRow)).toBe('written-before-rotation');
    const newRow = encrypt('written-after-rotation');
    expect(newRow.startsWith('v2:k1:')).toBe(true);
    expect(decrypt(newRow)).toBe('written-after-rotation');
  });

  it('decrypts a v2 row written under a key that is no longer active', () => {
    // Write under k1 as active.
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = JSON.stringify({ k1: KEY_K1, k2: KEY_K2 });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'k1';
    _resetKeyRingCache();
    const k1Row = encrypt('sealed-with-k1');

    // Advance active key to k2; k1 still present in the ring for reads.
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'k2';
    _resetKeyRingCache();
    expect(decrypt(k1Row)).toBe('sealed-with-k1');
    expect(encrypt('x').startsWith('v2:k2:')).toBe(true);
  });
});

describe('encryptionService — retirement & validation', () => {
  it('throws when decrypting a v2 row whose key was retired from the ring', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = JSON.stringify({ k1: KEY_K1 });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'k1';
    _resetKeyRingCache();
    const k1Row = encrypt('still-needs-k1');

    // Retire k1 (drop it from the ring) — the Phase 3 mistake guard.
    delete process.env.ENCRYPTION_KEYS;
    delete process.env.ENCRYPTION_ACTIVE_KEY_ID;
    _resetKeyRingCache();
    expect(() => decrypt(k1Row)).toThrow(/No encryption key registered for keyId "k1"/);
  });

  it('rejects an activation id that is not in the ring', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'ghost';
    _resetKeyRingCache();
    expect(() => encrypt('x')).toThrow(/not present in the key ring/);
  });

  it('rejects a malformed ciphertext', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    _resetKeyRingCache();
    expect(() => decrypt('not-a-valid-payload')).toThrow(/Invalid encrypted data format/);
  });

  it('rejects a wrongly-sized key in the ring', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = JSON.stringify({ bad: 'abcd' });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = 'legacy';
    _resetKeyRingCache();
    expect(() => encrypt('x')).toThrow(/must be 32 bytes/);
  });
});
