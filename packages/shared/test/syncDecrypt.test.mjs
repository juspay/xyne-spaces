import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring, generateTransitKeyPair, toBase64 } from '../dist/crypto/keyring.js';
import { encryptField } from '../dist/crypto/field-decrypt.js';
import { decryptPokeMessage, createDecryptingWebSocket } from '../dist/crypto/sync-decrypt.js';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const SYNC_URL = 'wss://zero.example/sync/v51/connect?clientID=c1';

async function keyring() {
  const pair = await generateTransitKeyPair();
  const server = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const published = { current: 1, keys: [{ version: 1, publicKey: toBase64(await crypto.subtle.exportKey('raw', server.publicKey)) }] };
  return new TransitKeyring(pair, published, async () => published);
}

/** Stands in for the browser WebSocket: an EventTarget the test feeds messages into. */
class FakeSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = String(url);
  }
  receive(data) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('decryptPokeMessage decrypts put and update rows, leaves the rest as they are', async () => {
  const ring = await keyring();
  const message = ['pokePart', {
    pokeID: 'p1',
    rowsPatch: [
      { op: 'put', tableName: 'form_entity_values', value: { id: 'v1', textValue: await encryptField('Chennai', ring), numberValue: 42 } },
      { op: 'update', tableName: 'form_entity_values', id: { id: 'v2' }, merge: { textValue: await encryptField('Mumbai', ring) } },
      { op: 'put', tableName: 'tickets', value: { id: 't1', title: 'plain title' } },
      { op: 'del', tableName: 'form_entity_values', id: { id: 'v3' } },
    ],
  }];

  const out = await decryptPokeMessage(message, ring);
  assert.equal(out[0], 'pokePart');
  assert.equal(out[1].pokeID, 'p1');
  assert.deepEqual(out[1].rowsPatch[0].value, { id: 'v1', textValue: 'Chennai', numberValue: 42 });
  assert.deepEqual(out[1].rowsPatch[1].merge, { textValue: 'Mumbai' });
  assert.deepEqual(out[1].rowsPatch[2], message[1].rowsPatch[2]);
  assert.deepEqual(out[1].rowsPatch[3], message[1].rowsPatch[3]);
});

test('decryptPokeMessage returns null when there is nothing to decrypt', async () => {
  const ring = await keyring();
  assert.equal(await decryptPokeMessage(['pong', {}], ring), null);
  assert.equal(await decryptPokeMessage(['pokePart', { rowsPatch: [{ op: 'put', tableName: 't', value: { a: 'x' } }] }], ring), null);
});

test('a field that fails to decrypt stays encrypted; its siblings still decrypt', async () => {
  const ring = await keyring();
  const bad = 'ENC:v1|tk-1|bm90LXJlYWwtY2lwaGVydGV4dC1ieXRlcw==';
  const out = await decryptPokeMessage(['pokePart', { rowsPatch: [
    { op: 'put', tableName: 'form_entity_values', value: { a: bad, b: await encryptField('ok', ring) } },
  ] }], ring);
  assert.equal(out[1].rowsPatch[0].value.a, bad);
  assert.equal(out[1].rowsPatch[0].value.b, 'ok');
});

test('the sync socket hands listeners decrypted messages, in arrival order', async () => {
  const ring = await keyring();
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(JSON.parse(event.data)));

  const encrypted = ['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: await encryptField('Chennai', ring) } }] }];
  ws.receive(JSON.stringify(encrypted));
  ws.receive(JSON.stringify(['pokeEnd', { pokeID: 'p1' }]));
  await settle();

  assert.equal(seen.length, 2);
  assert.equal(seen[0][1].rowsPatch[0].value.textValue, 'Chennai');
  assert.deepEqual(seen[1], ['pokeEnd', { pokeID: 'p1' }]);
});

test('other sockets, and the sync socket without a keyring, pass messages through untouched', async () => {
  const ring = await keyring();
  const encrypted = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 't', value: { a: await encryptField('x', ring) } }] }]);

  const Socket = createDecryptingWebSocket(FakeSocket, () => ring);
  const canvas = new Socket('wss://app.example/canvas/socket');
  const canvasSeen = [];
  canvas.addEventListener('message', event => canvasSeen.push(event.data));
  canvas.receive(encrypted);
  assert.deepEqual(canvasSeen, [encrypted]);

  const NoKey = createDecryptingWebSocket(FakeSocket, () => null);
  const sync = new NoKey(SYNC_URL);
  const syncSeen = [];
  sync.addEventListener('message', event => syncSeen.push(event.data));
  sync.receive(encrypted);
  assert.deepEqual(syncSeen, [encrypted]);
});
