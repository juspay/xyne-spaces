import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring, generateTransitKeyPair, toBase64 } from '../dist/crypto/keyring.js';
import { decryptField, encryptField } from '../dist/crypto/field-decrypt.js';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

async function keyring() {
  const pair = await generateTransitKeyPair();
  const server = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const published = { current: 1, keys: [{ version: 1, publicKey: toBase64(await crypto.subtle.exportKey('raw', server.publicKey)) }] };
  return new TransitKeyring(pair, published, async () => published);
}

test('toBase64 handles buffers far beyond the argument-spread limit', () => {
  const bytes = new Uint8Array(2_000_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const encoded = toBase64(bytes);
  assert.equal(encoded, Buffer.from(bytes).toString('base64'));
  assert.equal(toBase64(bytes.buffer), encoded);
});

test('encryptField round-trips a message larger than the spread limit', async () => {
  const ring = await keyring();
  const plaintext = 'x'.repeat(300_000);
  const ciphertext = await encryptField(plaintext, ring, 'content');
  assert.ok(ciphertext.startsWith('ENC:v1|tk-1|'));
  assert.equal(await decryptField(ciphertext, ring), plaintext);
});

test('encryptField round-trips the empty string and multibyte text', async () => {
  const ring = await keyring();
  for (const plaintext of ['', 'héllo wörld 😀', '\u0000']) {
    assert.equal(await decryptField(await encryptField(plaintext, ring), ring), plaintext);
  }
});
