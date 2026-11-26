import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring, generateTransitKeyPair, toBase64 } from '../dist/crypto/keyring.js';
import { encryptField } from '../dist/crypto/field-decrypt.js';
import { decryptPokeMessage, createDecryptingWebSocket } from '../dist/crypto/sync-decrypt.js';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const SYNC_URL = 'wss://zero.example/sync/v51/connect?clientID=c1';
const FIELDS = {
  form_entity_values: { fields: ['textValue', 'a', 'b'], enforceClientEncryption: true },
  messages: { fields: ['content'], enforceClientEncryption: true },
  tickets: { fields: ['title'], enforceClientEncryption: false },
};
const fields = () => FIELDS;

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
  close() {
    this.closed = (this.closed ?? 0) + 1;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, reason: '', wasClean: true }));
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 400));

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

  const out = await decryptPokeMessage(message, ring, FIELDS);
  assert.equal(out[0], 'pokePart');
  assert.equal(out[1].pokeID, 'p1');
  assert.deepEqual(out[1].rowsPatch[0].value, { id: 'v1', textValue: 'Chennai', numberValue: 42 });
  assert.deepEqual(out[1].rowsPatch[1].merge, { textValue: 'Mumbai' });
  assert.deepEqual(out[1].rowsPatch[2], message[1].rowsPatch[2]);
  assert.deepEqual(out[1].rowsPatch[3], message[1].rowsPatch[3]);
});

test('decryptPokeMessage returns null when there is nothing to decrypt', async () => {
  const ring = await keyring();
  assert.equal(await decryptPokeMessage(['pong', {}], ring, FIELDS), null);
  assert.equal(await decryptPokeMessage(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { a: 'x' } }] }], ring, FIELDS), null);
});

test('a field that fails to decrypt stays encrypted; its siblings still decrypt', async () => {
  const ring = await keyring();
  const bad = 'ENC:v1|tk-1|bm90LXJlYWwtY2lwaGVydGV4dC1ieXRlcw==';
  const out = await decryptPokeMessage(['pokePart', { rowsPatch: [
    { op: 'put', tableName: 'form_entity_values', value: { a: bad, b: await encryptField('ok', ring) } },
  ] }], ring, FIELDS);
  assert.equal(out[1].rowsPatch[0].value.a, bad);
  assert.equal(out[1].rowsPatch[0].value.b, 'ok');
});

test('the sync socket hands listeners decrypted messages, in arrival order', async () => {
  const ring = await keyring();
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
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

test('other sockets pass messages through untouched', async () => {
  const ring = await keyring();
  const encrypted = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { a: await encryptField('x', ring) } }] }]);

  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
  const canvas = new Socket('wss://app.example/canvas/socket');
  const canvasSeen = [];
  canvas.addEventListener('message', event => canvasSeen.push(event.data));
  canvas.receive(encrypted);
  assert.deepEqual(canvasSeen, [encrypted]);
});

test('a message that cannot be decrypted is not delivered: the socket closes so Zero resyncs', async () => {
  const ring = await keyring();
  const frame = async text => JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: await encryptField(text, ring) } }] }]);
  const bad = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: 'ENC:v1|tk-1|bm90LXJlYWwtY2lwaGVydGV4dC1ieXRlcw==' } }] }]);

  for (const [label, source, data] of [['failed decrypt', () => ring, bad], ['no keyring', () => null, await frame('Chennai')]]) {
    const Socket = createDecryptingWebSocket(FakeSocket, source, fields);
    const ws = new Socket(SYNC_URL);
    const seen = [];
    ws.addEventListener('message', event => seen.push(event.data));
    ws.addEventListener('close', () => seen.push('close'));
    ws.receive(data);
    ws.receive(JSON.stringify(['pokeEnd', { pokeID: 'p1' }]));
    await settle();
    assert.deepEqual(seen, ['close'], label);
    assert.equal(ws.closed, 1, label);
  }
});

test('after three resyncs in a row the message is delivered as it is; a whole applied poke resets the count', async () => {
  const ring = await keyring();
  let source = () => null;
  const Socket = createDecryptingWebSocket(FakeSocket, () => source(), fields);
  const encrypted = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: await encryptField('Chennai', ring) } }] }]);
  const pokeEnd = JSON.stringify(['pokeEnd', { pokeID: 'p1' }]);
  const connect = async (...frames) => {
    const ws = new Socket(SYNC_URL);
    const seen = [];
    ws.addEventListener('message', event => seen.push(event.data));
    for (const frame of frames) ws.receive(frame);
    await settle();
    return { ws, seen };
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { ws, seen } = await connect(encrypted);
    assert.deepEqual(seen, [], `attempt ${attempt}`);
    assert.equal(ws.closed, 1, `attempt ${attempt}`);
  }
  const fourth = await connect(encrypted);
  assert.deepEqual(fourth.seen, [encrypted]);
  assert.equal(fourth.ws.closed, undefined);

  source = () => ring;
  const good = await connect(encrypted, pokeEnd);
  assert.equal(JSON.parse(good.seen[0])[1].rowsPatch[0].value.textValue, 'Chennai');
  source = () => null;
  const afterReset = await connect(encrypted);
  assert.deepEqual(afterReset.seen, []);
  assert.equal(afterReset.ws.closed, 1);
});

test('a poke part that decrypts does not reset the count while a later part keeps failing', async () => {
  const ring = await keyring();
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
  const good = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: await encryptField('Chennai', ring) } }] }]);
  const bad = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: 'ENC:v1|tk-1|bm90LXJlYWwtY2lwaGVydGV4dC1ieXRlcw==' } }] }]);
  const closes = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ws = new Socket(SYNC_URL);
    ws.receive(good);
    ws.receive(bad);
    await settle();
    closes.push(ws.closed ?? 0);
  }
  assert.deepEqual(closes, [1, 1, 1, 0]);
});

test('with client encryption off, ciphertext passes through without a resync', async () => {
  const ring = await keyring();
  const encrypted = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: await encryptField('x', ring) } }] }]);
  const Socket = createDecryptingWebSocket(FakeSocket, () => 'disabled', fields);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(event.data));
  ws.receive(encrypted);
  assert.deepEqual(seen, [encrypted]);
  assert.equal(ws.closed, undefined);
});

test('a failed authentication check is not retried', async () => {
  const ring = await keyring();
  let lookups = 0;
  const counting = { forKeyId: keyId => { lookups++; return ring.forKeyId(keyId); } };
  const bad = 'ENC:v1|tk-1|bm90LXJlYWwtY2lwaGVydGV4dC1ieXRlcw==';
  await decryptPokeMessage(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { a: bad } }] }], counting, FIELDS);
  assert.equal(lookups, 1);
});

test('a close that arrives behind a held message is delivered after it, with its code', async () => {
  const ring = await keyring();
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', () => seen.push('message'));
  ws.addEventListener('close', event => seen.push(`close:${event.code}`));

  ws.receive(JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { a: await encryptField('x', ring) } }] }]));
  const close = typeof CloseEvent === 'function' ? new CloseEvent('close', { code: 1006 }) : Object.assign(new Event('close'), { code: 1006 });
  ws.dispatchEvent(close);
  await settle();

  assert.deepEqual(seen, ['message', 'close:1006']);
});

test('a pong is not held behind a message that is still being decrypted', async () => {
  const ring = await keyring();
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(JSON.parse(event.data)[0]));

  ws.receive(JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { a: await encryptField('x', ring) } }] }]));
  ws.receive(JSON.stringify(['pong', {}]));
  assert.deepEqual(seen, ['pong']);
  await settle();
  assert.deepEqual(seen, ['pong', 'pokePart']);
});

test('only the configured fields of tables enforced for client encryption are decrypted', async () => {
  const ring = await keyring();
  const content = await encryptField('hello', ring);
  const other = await encryptField('not configured', ring);
  const title = await encryptField('not enforced', ring);
  const message = ['pokePart', { rowsPatch: [
    { op: 'put', tableName: 'messages', value: { id: 'm1', content, other } },
    { op: 'put', tableName: 'tickets', value: { id: 't1', title } },
    { op: 'put', tableName: 'channels', value: { id: 'c1', name: title } },
  ] }];

  const out = await decryptPokeMessage(message, ring, FIELDS);
  assert.deepEqual(out[1].rowsPatch[0].value, { id: 'm1', content: 'hello', other });
  assert.deepEqual(out[1].rowsPatch[1], message[1].rowsPatch[1]);
  assert.deepEqual(out[1].rowsPatch[2], message[1].rowsPatch[2]);
});

test('a frame with ciphertext only in tables that are not enforced is not held', async () => {
  const ring = await keyring();
  const message = ['pokePart', { rowsPatch: [{ op: 'put', tableName: 'tickets', value: { id: 't1', title: await encryptField('x', ring) } }] }];
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(event.data));
  ws.receive(JSON.stringify(message));
  assert.deepEqual(seen, [JSON.stringify(message)]);
});

test('tables added to the config later are decrypted from the next frame on', async () => {
  const ring = await keyring();
  let config = {};
  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, () => config);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(JSON.parse(event.data)[1].rowsPatch[0].value.content));
  const frame = JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'messages', value: { content: await encryptField('hello', ring) } }] }]);

  ws.receive(frame);
  config = FIELDS;
  ws.receive(frame);
  await settle();
  assert.match(seen[0], /^ENC:/);
  assert.equal(seen[1], 'hello');
});

test("the proxy's __tableName tag is dropped from every row", async () => {
  const ring = await keyring();
  const message = ['pokePart', { rowsPatch: [
    { op: 'put', tableName: 'messages', value: { id: 'm1', content: await encryptField('hello', ring), __tableName: 'messages' } },
    { op: 'update', tableName: 'channels', id: { id: 'c1' }, merge: { name: 'general', __tableName: 'channels' } },
  ] }];
  const out = await decryptPokeMessage(message, ring, FIELDS);
  assert.deepEqual(out[1].rowsPatch[0].value, { id: 'm1', content: 'hello' });
  assert.deepEqual(out[1].rowsPatch[1].merge, { name: 'general' });

  const Socket = createDecryptingWebSocket(FakeSocket, () => ring, fields);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(JSON.parse(event.data)[1].rowsPatch[0].merge));
  ws.receive(JSON.stringify(['pokePart', { rowsPatch: [message[1].rowsPatch[1]] }]));
  await settle();
  assert.deepEqual(seen, [{ name: 'general' }]);
});

test('a field whose first decrypt attempt fails is retried', async () => {
  const ring = await keyring();
  const textValue = await encryptField('Chennai', ring);
  let calls = 0;
  const flaky = { forKeyId: keyId => (calls++ === 0 ? Promise.reject(new Error('key fetch failed')) : ring.forKeyId(keyId)) };

  const out = await decryptPokeMessage(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue } }] }], flaky, FIELDS);
  assert.equal(out[1].rowsPatch[0].value.textValue, 'Chennai');
  assert.equal(calls, 2);
});

test('a held message that fails to deliver does not block the ones behind it', async () => {
  const ring = await keyring();
  class FailsOnce extends FakeSocket {
    dispatchEvent(event) {
      if (event.type === 'message' && String(event.data).includes('"first"')) throw new Error('listener setup failed');
      return super.dispatchEvent(event);
    }
  }
  const Socket = createDecryptingWebSocket(FailsOnce, () => ring, fields);
  const ws = new Socket(SYNC_URL);
  const seen = [];
  ws.addEventListener('message', event => seen.push(JSON.parse(event.data)[1].rowsPatch[0].value.textValue));

  const frame = async text => JSON.stringify(['pokePart', { rowsPatch: [{ op: 'put', tableName: 'form_entity_values', value: { textValue: await encryptField(text, ring) } }] }]);
  ws.receive(await frame('first'));
  ws.receive(await frame('second'));
  ws.receive(await frame('third'));
  await settle();

  assert.deepEqual(seen, ['second', 'third']);
});
