import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring } from '../dist/crypto/keyring.js';

const EPOCH_SECONDS = 900;

function fakeHandshake(calls) {
  return async epoch => {
    const resolved = epoch ?? Math.floor(Date.now() / 1000 / EPOCH_SECONDS);
    calls.push(resolved);
    return { key: { epoch: resolved }, epoch: resolved, epochSeconds: EPOCH_SECONDS };
  };
}

test('init fetches the current epoch once and current() reuses it', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  const first = await ring.current();
  const second = await ring.current();
  assert.equal(first.key, second.key);
  assert.equal(calls.length, 1);
  assert.equal(first.epoch, calls[0]);
});

test('forEpoch fetches a missing epoch once and shares the pending promise', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  const target = calls[0] - 1;
  const [a, b] = await Promise.all([ring.forEpoch(target), ring.forEpoch(target)]);
  assert.equal(a, b);
  assert.deepEqual(calls, [calls[0], target]);
});

test('a failed fetch is not cached', async () => {
  let fail = true;
  const ring = new TransitKeyring(async epoch => {
    if (fail) throw new Error('nope');
    return { key: { epoch }, epoch, epochSeconds: EPOCH_SECONDS };
  });
  await assert.rejects(ring.forEpoch(5));
  fail = false;
  const key = await ring.forEpoch(5);
  assert.deepEqual(key, { epoch: 5 });
});

test('epochs older than previous are evicted when a newer one arrives', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  const current = calls[0];
  await ring.forEpoch(current - 1);
  await ring.forEpoch(current - 2);
  await ring.forEpoch(current + 1);
  calls.length = 0;
  await ring.forEpoch(current - 2);
  assert.deepEqual(calls, [current - 2], 'evicted epoch is fetched again');
  await ring.forEpoch(current);
  assert.deepEqual(calls, [current - 2], 'retained epoch is not fetched again');
});

test('clear drops every key', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  ring.clear();
  await ring.current();
  assert.equal(calls.length, 2);
});
