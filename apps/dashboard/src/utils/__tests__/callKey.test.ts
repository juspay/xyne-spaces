import { describe, expect, it } from 'vitest';
import { openCallKey } from '../callKey';

// What the response interceptor hands over once it has decrypted the service's ciphertext.
const issued = (callId: string, key?: string) => ({
  encryptedKey: JSON.stringify({ callId, key }),
});

describe('openCallKey', () => {
  it('returns the key issued for the call being joined', () => {
    expect(openCallKey(issued('room-1', 'K3y=='), 'room-1')).toBe('K3y==');
  });

  it('rejects a key issued for another call', () => {
    expect(() => openCallKey(issued('room-2', 'other'), 'room-1')).toThrow(/another call/);
  });

  it('rejects a key that is still ciphertext or has no key', () => {
    expect(() => openCallKey({ encryptedKey: 'ENC:v1|tk-4|AAAA' }, 'room-1')).toThrow(
      /not decrypted/,
    );
    expect(() => openCallKey(issued('room-1'), 'room-1')).toThrow(/missing/);
  });

  it('passes a derived key through and refuses empty credentials', () => {
    expect(openCallKey({ key: 'derived==' }, 'room-1')).toBe('derived==');
    expect(() => openCallKey({}, 'room-1')).toThrow(/missing/);
  });
});
