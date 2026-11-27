import test from 'node:test';
import assert from 'node:assert/strict';

import { openCallKey } from '../dist/encryption-transformation/call-key.js';

// What the response interceptor hands over once it has decrypted the service's ciphertext.
const issued = (callId, key) => ({ encryptedKey: JSON.stringify({ callId, key }) });

test('returns the key issued for the call being joined', () => {
  assert.equal(openCallKey(issued('room-1', 'K3y=='), 'room-1'), 'K3y==');
});

test('rejects a key issued for another call', () => {
  assert.throws(() => openCallKey(issued('room-2', 'other'), 'room-1'), /another call/);
});

test('rejects a key that is still ciphertext or has no key', () => {
  assert.throws(() => openCallKey({ encryptedKey: 'ENC:v1|tk-4|AAAA' }, 'room-1'), /not decrypted/);
  assert.throws(() => openCallKey({ encryptedKey: JSON.stringify({ callId: 'room-1' }) }, 'room-1'), /missing/);
});

test('passes a derived key through and refuses empty credentials', () => {
  assert.equal(openCallKey({ key: 'derived==' }, 'room-1'), 'derived==');
  assert.throws(() => openCallKey({}, 'room-1'), /missing/);
});
