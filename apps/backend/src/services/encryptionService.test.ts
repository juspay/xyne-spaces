import crypto from 'crypto';
import { _resetKeyRingCache, decrypt, encrypt } from './encryptionService';

const KEY_LEGACY = crypto.randomBytes(32).toString('hex');
const KEY_K1 = crypto.randomBytes(32).toString('hex');
const KEY_K2 = crypto.randomBytes(32).toString('hex');

const ENV_KEYS = ['ENCRYPTION_KEY', 'ENCRYPTION_KEYS'] as const;

let savedEnvironment: Record<string, string | undefined>;

function createOrderedRing(entries: Array<{ id: string; key: string }>): string {
  return JSON.stringify(entries);
}

beforeEach(() => {
  savedEnvironment = {};

  for (const name of ENV_KEYS) {
    savedEnvironment[name] = process.env[name];
    delete process.env[name];
  }

  _resetKeyRingCache();
});

afterEach(() => {
  for (const name of ENV_KEYS) {
    const previous = savedEnvironment[name];

    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }

  _resetKeyRingCache();
});

describe('encryptionService — legacy compatibility', () => {
  it('writes and reads legacy ciphertext when no ordered ring exists', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    _resetKeyRingCache();

    const ciphertext = encrypt('legacy-secret');

    expect(ciphertext.split(':')).toHaveLength(2);
    expect(ciphertext.startsWith('v2:')).toBe(false);
    expect(decrypt(ciphertext)).toBe('legacy-secret');
  });

  it('keeps writing legacy ciphertext when the ordered ring is empty', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = '[]';
    _resetKeyRingCache();

    const ciphertext = encrypt('empty-ring');

    expect(ciphertext.split(':')).toHaveLength(2);
    expect(decrypt(ciphertext)).toBe('empty-ring');
  });

  it('fails clearly when neither a legacy key nor an ordered key exists', () => {
    _resetKeyRingCache();

    expect(() => encrypt('missing-key')).toThrow(/ENCRYPTION_KEY not found/);
  });
});

describe('encryptionService — ordered active writer', () => {
  it('uses the only array entry as the active writer', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    const ciphertext = encrypt('written-with-k1');

    expect(ciphertext.startsWith('v2:k1:')).toBe(true);
    expect(decrypt(ciphertext)).toBe('written-with-k1');
  });

  it('uses the final array entry as the active writer', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
      {
        id: 'k2',
        key: KEY_K2,
      },
    ]);
    _resetKeyRingCache();

    const ciphertext = encrypt('written-with-k2');

    expect(ciphertext.startsWith('v2:k2:')).toBe(true);
    expect(decrypt(ciphertext)).toBe('written-with-k2');
  });

  it('changes the active writer when the array order changes', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;

    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k2',
        key: KEY_K2,
      },
      {
        id: 'k1',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    expect(encrypt('first').startsWith('v2:k1:')).toBe(true);

    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
      {
        id: 'k2',
        key: KEY_K2,
      },
    ]);
    _resetKeyRingCache();

    expect(encrypt('second').startsWith('v2:k2:')).toBe(true);
  });
});

describe('encryptionService — mixed-format rotation reads', () => {
  it('continues reading legacy rows after k1 becomes active', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    _resetKeyRingCache();

    const legacyRow = encrypt('written-before-rotation');

    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    expect(decrypt(legacyRow)).toBe('written-before-rotation');

    const newRow = encrypt('written-after-rotation');

    expect(newRow.startsWith('v2:k1:')).toBe(true);
    expect(decrypt(newRow)).toBe('written-after-rotation');
  });

  it('continues reading k1 rows after k2 becomes active', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    const k1Row = encrypt('sealed-with-k1');

    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
      {
        id: 'k2',
        key: KEY_K2,
      },
    ]);
    _resetKeyRingCache();

    expect(decrypt(k1Row)).toBe('sealed-with-k1');
    expect(encrypt('new-write').startsWith('v2:k2:')).toBe(true);
  });

  it('fails explicitly when a referenced key is retired', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    const k1Row = encrypt('still-needs-k1');

    delete process.env.ENCRYPTION_KEYS;
    _resetKeyRingCache();

    expect(() => decrypt(k1Row)).toThrow(/No encryption key registered for keyId "k1"/);
  });
});

describe('encryptionService — ordered-ring validation', () => {
  it('rejects the previous unordered object format', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    process.env.ENCRYPTION_KEYS = JSON.stringify({
      k1: KEY_K1,
    });
    _resetKeyRingCache();

    expect(() => encrypt('x')).toThrow(/ordered JSON array/);
  });

  it('rejects duplicate key IDs', () => {
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'k1',
        key: KEY_K1,
      },
      {
        id: 'k1',
        key: KEY_K2,
      },
    ]);
    _resetKeyRingCache();

    expect(() => encrypt('x')).toThrow(/Duplicate encryption key id "k1"/);
  });

  it('rejects the reserved legacy key ID', () => {
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'legacy',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    expect(() => encrypt('x')).toThrow(/Invalid key id/);
  });

  it('rejects the reserved version tag as a key ID', () => {
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'v2',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    expect(() => encrypt('x')).toThrow(/Invalid key id/);
  });

  it('rejects IDs containing a colon', () => {
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'invalid:key',
        key: KEY_K1,
      },
    ]);
    _resetKeyRingCache();

    expect(() => encrypt('x')).toThrow(/Invalid key id/);
  });

  it('rejects an incorrectly sized key', () => {
    process.env.ENCRYPTION_KEYS = createOrderedRing([
      {
        id: 'bad',
        key: 'abcd',
      },
    ]);
    _resetKeyRingCache();

    expect(() => encrypt('x')).toThrow(/must be 32 bytes/);
  });

  it('rejects malformed ciphertext', () => {
    process.env.ENCRYPTION_KEY = KEY_LEGACY;
    _resetKeyRingCache();

    expect(() => decrypt('not-a-valid-payload')).toThrow(/Invalid encrypted data format/);
  });
});
