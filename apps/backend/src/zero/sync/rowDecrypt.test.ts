/**
 * Emit-time decryption (node:test, run via tsx — env-free like streamState/packDemux).
 *
 * The contract under test: ciphertext at rest everywhere server-side, decrypt only at the
 * emit boundary, and NO failure mode may block or drop a frame — trouble ships ciphertext.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decryptRowsForEmit, clearDecryptCacheForTests, type DecryptDeps } from './rowDecrypt';

beforeEach(() => clearDecryptCacheForTests());

const enc = (s: string) => `ENC:v1|srv-k1|${Buffer.from(s).toString('base64')}`;
const dec = (v: string) => Buffer.from(v.split('|')[2], 'base64').toString();

function fakeDeps(overrides: Partial<DecryptDeps> = {}) {
  const calls: string[][] = [];
  const deps: DecryptDeps = {
    decryptBatch: async (values) => {
      calls.push([...values]);
      return values.map(dec);
    },
    ...overrides,
  };
  return { deps, calls };
}

const conv = (id: string, md: string) => ({
  tableName: 'conversations',
  row: { conversationId: id, channelId: 'ch1', initial_message_md: md, replies_md: null },
});

test('plaintext fast path: same array reference, provider never called', async () => {
  const { deps, calls } = fakeDeps();
  const items = [conv('c1', 'plain md'), { tableName: 'users', row: { id: 'u1', name: 'x' } }];
  const out = await decryptRowsForEmit(items, deps);
  assert.equal(out, items, 'no ENC values → identical reference');
  assert.equal(calls.length, 0);
});

test('decrypts configured ENC fields; leaves other tables/fields/plaintext untouched', async () => {
  const { deps } = fakeDeps();
  const items = [
    conv('c1', enc('hello')),
    conv('c2', 'already plain'),
    { tableName: 'message_attachments', row: { id: 'a1', originalFilename: enc('not-configured-table') } },
  ];
  const out = await decryptRowsForEmit(items, deps);
  assert.equal(out[0].row.initial_message_md, 'hello');
  assert.equal(out[0].row.conversationId, 'c1', 'other fields intact');
  assert.equal(out[1], items[1], 'plaintext item untouched (same reference)');
  assert.equal(
    out[2].row.originalFilename,
    enc('not-configured-table'),
    'tables outside encryptedFieldsConfig are never touched',
  );
  // input rows must NOT be mutated (they may be memoized ciphertext state elsewhere)
  assert.equal(items[0].row.initial_message_md, enc('hello'));
});

test('content-addressed cache: repeated ciphertext costs one provider call', async () => {
  const { deps, calls } = fakeDeps();
  await decryptRowsForEmit([conv('c1', enc('same'))], deps);
  const out = await decryptRowsForEmit([conv('c2', enc('same'))], deps);
  assert.equal(out[0].row.initial_message_md, 'same');
  assert.equal(calls.length, 1, 'second emit served from cache');
});

test('chunking: more values than chunkSize → multiple provider calls', async () => {
  const { deps, calls } = fakeDeps({ chunkSize: 2 });
  const items = ['a', 'b', 'c', 'd', 'e'].map((s, i) => conv(`c${i}`, enc(s)));
  const out = await decryptRowsForEmit(items, deps);
  assert.deepEqual(calls.map((c) => c.length), [2, 2, 1]);
  assert.deepEqual(out.map((r) => r.row.initial_message_md), ['a', 'b', 'c', 'd', 'e']);
});

test('provider failure: frame ships with ciphertext, no throw', async () => {
  const deps: DecryptDeps = {
    decryptBatch: async () => {
      throw new Error('s2s down');
    },
  };
  const items = [conv('c1', enc('secret'))];
  const out = await decryptRowsForEmit(items, deps);
  assert.equal(out[0].row.initial_message_md, enc('secret'), 'ciphertext preserved on failure');
});

test('timeout: a hung provider cannot wedge the emit', async () => {
  const deps: DecryptDeps = {
    decryptBatch: () => new Promise(() => {}), // never settles
    timeoutMs: 20,
  };
  const out = await decryptRowsForEmit([conv('c1', enc('slow'))], deps);
  assert.equal(out[0].row.initial_message_md, enc('slow'), 'ships ciphertext after the timeout');
});

test('shape-mismatch defense: wrong result length → ciphertext, not misassignment', async () => {
  const deps: DecryptDeps = {
    decryptBatch: async (values) => values.map(dec).slice(0, -1), // one short
  };
  const items = [conv('c1', enc('x')), conv('c2', enc('y'))];
  const out = await decryptRowsForEmit(items, deps);
  assert.equal(out[0].row.initial_message_md, enc('x'), 'no positional guessing on mismatch');
  assert.equal(out[1].row.initial_message_md, enc('y'));
});

test('partial failure isolation: a failing chunk leaves other chunks decrypted', async () => {
  let call = 0;
  const deps: DecryptDeps = {
    chunkSize: 1,
    decryptBatch: async (values) => {
      call += 1;
      if (call === 2) throw new Error('flaky');
      return values.map(dec);
    },
  };
  const items = [conv('c1', enc('ok1')), conv('c2', enc('bad')), conv('c3', enc('ok2'))];
  const out = await decryptRowsForEmit(items, deps);
  assert.equal(out[0].row.initial_message_md, 'ok1');
  assert.equal(out[1].row.initial_message_md, enc('bad'), 'failed chunk ships ciphertext');
  assert.equal(out[2].row.initial_message_md, 'ok2');
});
