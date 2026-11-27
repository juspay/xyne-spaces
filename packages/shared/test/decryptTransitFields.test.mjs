import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring, generateTransitKeyPair, toBase64 } from '../dist/crypto/keyring.js';
import { encryptField } from '../dist/crypto/field-decrypt.js';
import { decryptTransitFields } from '../dist/crypto/decrypt-transit-fields.js';
import { setCryptoLogger } from '../dist/crypto/crypto-logger.js';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

async function keyring() {
  const pair = await generateTransitKeyPair();
  const server = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const published = { current: 1, keys: [{ version: 1, publicKey: toBase64(await crypto.subtle.exportKey('raw', server.publicKey)) }] };
  return new TransitKeyring(pair, published, async () => published);
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };

test('decryptTransitFields leaves text that only starts with ENC: alone', async () => {
  setCryptoLogger(silent);
  const ring = await keyring();
  const response = { title: 'ENC: plan', items: ['ENC:', 'ENC:v1|tk-1|short'] };
  assert.deepEqual(await decryptTransitFields(response, ring), response);
});

test('decryptTransitFields decrypts nested ciphertext', async () => {
  setCryptoLogger(silent);
  const ring = await keyring();
  const response = { chat: { body: await encryptField('hello', ring) }, list: [await encryptField('a', ring)] };
  assert.deepEqual(await decryptTransitFields(response, ring), { chat: { body: 'hello' }, list: ['a'] });
});

test('decryptTransitFields keeps a field it cannot decrypt and still decrypts the rest', async () => {
  const errors = [];
  setCryptoLogger({ ...silent, error: (_event, data) => errors.push(data) });
  const ring = await keyring();
  const foreign = await encryptField('not for this client', await keyring());
  const response = { foreign, mine: await encryptField('mine', ring) };
  assert.deepEqual(await decryptTransitFields(response, ring), { foreign, mine: 'mine' });
  assert.equal(errors.length, 1);
});
