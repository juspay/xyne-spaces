import crypto from 'crypto';
import { _resetKeyRingCache, getActiveEncryptionKeyId } from './encryptionService';

const KEY_K1 = crypto.randomBytes(32).toString('hex');
const KEY_K2 = crypto.randomBytes(32).toString('hex');

const ENV_KEYS = ['ENCRYPTION_KEY', 'ENCRYPTION_KEYS'] as const;

let savedEnvironment: Record<string, string | undefined>;

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
    const savedValue = savedEnvironment[name];

    if (savedValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedValue;
    }
  }

  _resetKeyRingCache();
});

describe('getActiveEncryptionKeyId', () => {
  it('returns null when the ordered key ring is absent', () => {
    expect(getActiveEncryptionKeyId()).toBeNull();
  });

  it('selects the final entry in ENCRYPTION_KEYS', () => {
    process.env.ENCRYPTION_KEYS = JSON.stringify([
      { id: 'k1', key: KEY_K1 },
      { id: 'k2', key: KEY_K2 },
    ]);

    _resetKeyRingCache();

    expect(getActiveEncryptionKeyId()).toBe('k2');
  });

  it('changes the writer when the array order changes', () => {
    process.env.ENCRYPTION_KEYS = JSON.stringify([
      { id: 'k2', key: KEY_K2 },
      { id: 'k1', key: KEY_K1 },
    ]);

    _resetKeyRingCache();

    expect(getActiveEncryptionKeyId()).toBe('k1');
  });
});
