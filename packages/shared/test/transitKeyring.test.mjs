import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring, generateTransitKeyPair, parseTransitKeyId, transitKeyId } from '../dist/crypto/keyring.js';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const toBase64 = bytes => Buffer.from(bytes).toString('base64');

/** A server key pair as the encryption service holds it: raw private key for ECDH, public point published. */
async function serverKey(version) {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  return { version, publicKey: toBase64(await crypto.subtle.exportKey('raw', pair.publicKey)), privateKey: pair.privateKey };
}

/** The service side of the derivation: ECDH(server private, client point), HKDF with salt = client || server. */
async function serverDerive(server, clientPublicKey) {
  const clientPoint = Buffer.from(clientPublicKey, 'base64');
  const serverPoint = Buffer.from(server.publicKey, 'base64');
  const clientKey = await crypto.subtle.importKey('raw', clientPoint, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, server.privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = Buffer.concat([clientPoint, serverPoint]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('transit/v1') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function roundTrip(encryptKey, decryptKey, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptKey, new TextEncoder().encode(text));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decryptKey, ct));
}

const published = keys => ({ current: Math.max(...keys.map(k => k.version)), keys: keys.map(({ version, publicKey }) => ({ version, publicKey })) });

test('client and server derive the same key for each server version', async () => {
  const pair = await generateTransitKeyPair();
  const v1 = await serverKey(1);
  const v2 = await serverKey(2);
  const ring = new TransitKeyring(pair, published([v1, v2]), async () => published([v1, v2]));
  assert.equal(ring.clientPublicKey, pair.publicKey);

  const { key, keyId } = await ring.current();
  assert.equal(keyId, 'tk-2');
  assert.equal(await roundTrip(await serverDerive(v2, pair.publicKey), key, 'hello'), 'hello');
  assert.equal(await roundTrip(key, await serverDerive(v2, pair.publicKey), 'back'), 'back');
  assert.equal(await roundTrip(await serverDerive(v1, pair.publicKey), await ring.forKeyId('tk-1'), 'old'), 'old');
  await assert.rejects(roundTrip(await serverDerive(v1, pair.publicKey), key, 'x'), 'versions have distinct keys');
});

test('derivation is cached per version and clear drops it', async () => {
  const pair = await generateTransitKeyPair();
  const v1 = await serverKey(1);
  const ring = new TransitKeyring(pair, published([v1]), async () => published([v1]));
  const a = await ring.current();
  const b = await ring.forKeyId('tk-1');
  assert.equal(a.key, b);
  ring.clear();
  assert.notEqual((await ring.current()).key, a.key);
});

test('an unseen version refetches the server keys once, then derives', async () => {
  const pair = await generateTransitKeyPair();
  const v1 = await serverKey(1);
  const v2 = await serverKey(2);
  let fetches = 0;
  const ring = new TransitKeyring(pair, published([v1]), async () => {
    fetches += 1;
    return published([v1, v2]);
  });
  const [a, b] = await Promise.all([ring.forKeyId('tk-2'), ring.forKeyId('tk-2')]);
  assert.equal(a, b);
  assert.equal(fetches, 1);
  assert.equal(await roundTrip(await serverDerive(v2, pair.publicKey), a, 'rotated'), 'rotated');
  assert.equal((await ring.current()).keyId, 'tk-2', 'writes move to the new current version');
});

test('a version the server no longer lists is an error', async () => {
  const pair = await generateTransitKeyPair();
  const v2 = await serverKey(2);
  const ring = new TransitKeyring(pair, published([v2]), async () => published([v2]));
  await assert.rejects(ring.forKeyId('tk-1'), /version 1 is not available/);
  await assert.rejects(ring.forKeyId('dek-abc'), /Not a transit key id/);
});

test('key ids round-trip', () => {
  assert.equal(transitKeyId(7), 'tk-7');
  assert.equal(parseTransitKeyId('tk-7'), 7);
  assert.equal(parseTransitKeyId('tk-'), null);
  assert.equal(parseTransitKeyId('tk-x'), null);
  assert.equal(parseTransitKeyId('cm123'), null);
});
