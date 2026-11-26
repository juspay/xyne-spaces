import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring, generateTransitKeyPair } from '../dist/crypto/keyring.js';
import { openCallKey } from '../dist/encryption-transformation/call-key.js';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const toBase64 = bytes => Buffer.from(bytes).toString('base64');

/** What the encryption service's transform-response does to a call key, in WebCrypto. */
async function seal(server, clientPublicKey, payload) {
  const clientPoint = Buffer.from(clientPublicKey, 'base64');
  const serverPoint = Buffer.from(server.publicKey, 'base64');
  const clientKey = await crypto.subtle.importKey('raw', clientPoint, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, server.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: Buffer.concat([clientPoint, serverPoint]), info: new TextEncoder().encode('transit/v1') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return `ENC:v1|tk-${server.version}|${toBase64(Buffer.concat([iv, Buffer.from(ct)]))}`;
}

async function setup() {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const server = { version: 4, publicKey: toBase64(await crypto.subtle.exportKey('raw', pair.publicKey)), privateKey: pair.privateKey };
  const serverKeys = { current: 4, keys: [{ version: 4, publicKey: server.publicKey }] };
  const client = await generateTransitKeyPair();
  const keyring = new TransitKeyring(client, serverKeys, async () => serverKeys);
  return { server, client, keyring };
}

test('opens a service-issued key for the call being joined', async () => {
  const { server, client, keyring } = await setup();
  const encryptedKey = await seal(server, client.publicKey, { callId: 'room-1', key: 'K3y==' });
  assert.equal(await openCallKey({ encryptedKey }, 'room-1', keyring), 'K3y==');
});

test('rejects a key issued for another call', async () => {
  const { server, client, keyring } = await setup();
  const encryptedKey = await seal(server, client.publicKey, { callId: 'room-2', key: 'other' });
  await assert.rejects(openCallKey({ encryptedKey }, 'room-1', keyring), /another call/);
});

test("can't be opened with another client's transit key", async () => {
  const { server, keyring } = await setup();
  const someoneElse = await generateTransitKeyPair();
  const encryptedKey = await seal(server, someoneElse.publicKey, { callId: 'room-1', key: 'K3y==' });
  await assert.rejects(openCallKey({ encryptedKey }, 'room-1', keyring));
});

test('accepts the plaintext the response interceptor already decrypted, still bound to the call', async () => {
  const plain = JSON.stringify({ callId: 'room-1', key: 'K3y==' });
  assert.equal(await openCallKey({ encryptedKey: plain }, 'room-1', null), 'K3y==');
  await assert.rejects(openCallKey({ encryptedKey: plain }, 'room-9', null), /another call/);
});

test('passes a derived key through and refuses empty credentials', async () => {
  assert.equal(await openCallKey({ key: 'derived==' }, 'room-1', null), 'derived==');
  await assert.rejects(openCallKey({}, 'room-1', null), /missing/);
  await assert.rejects(openCallKey({ encryptedKey: 'ENC:v1|tk-4|AAAA' }, 'room-1', null), /no transit keyring/);
});
