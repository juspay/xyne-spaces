import test from 'node:test';
import assert from 'node:assert/strict';

import { TransitKeyring } from '../dist/crypto/keyring.js';

const TTL = 3600;

function fakeHandshake(calls, { now = () => Date.now() / 1000 } = {}) {
  let minted = 0;
  return async ticket => {
    calls.push(ticket);
    if (ticket !== undefined) return { key: { resumed: ticket }, ticket, expiresAt: now() + TTL };
    minted += 1;
    const issued = `tk-${minted}`;
    return { key: { issued }, ticket: issued, expiresAt: now() + TTL };
  };
}

test('init mints one ticket and current() reuses it', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  const first = await ring.current();
  const second = await ring.current();
  assert.equal(first.key, second.key);
  assert.equal(first.ticket, 'tk-1');
  assert.deepEqual(calls, [undefined]);
});

test('forTicket resumes a foreign ticket once and shares the pending promise', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  const [a, b] = await Promise.all([ring.forTicket('tk-other'), ring.forTicket('tk-other')]);
  assert.equal(a, b);
  assert.deepEqual(a, { resumed: 'tk-other' });
  assert.deepEqual(calls, [undefined, 'tk-other']);
});

test('forTicket returns the active key without a round trip', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  const { key, ticket } = await ring.current();
  assert.equal(await ring.forTicket(ticket), key);
  assert.equal(calls.length, 1);
});

test('a failed resume is not cached', async () => {
  let fail = true;
  const ring = new TransitKeyring(async ticket => {
    if (fail) throw new Error('nope');
    return { key: { ticket }, ticket, expiresAt: Date.now() / 1000 + TTL };
  });
  await assert.rejects(ring.forTicket('tk-x'));
  fail = false;
  assert.deepEqual(await ring.forTicket('tk-x'), { ticket: 'tk-x' });
});

test('an expired active ticket is replaced before encrypting', async () => {
  const calls = [];
  let clock = 1_000_000;
  const ring = new TransitKeyring(fakeHandshake(calls, { now: () => clock }));
  const realNow = Date.now;
  Date.now = () => clock * 1000;
  try {
    const first = await ring.current();
    clock += TTL + 1;
    const second = await ring.current();
    assert.notEqual(first.ticket, second.ticket);
    assert.deepEqual(calls, [undefined, undefined]);
    assert.equal(await ring.forTicket(first.ticket), first.key, 'old key stays readable');
  } finally {
    Date.now = realNow;
  }
});

test('clear drops every key', async () => {
  const calls = [];
  const ring = new TransitKeyring(fakeHandshake(calls));
  await ring.init();
  ring.clear();
  await ring.current();
  assert.equal(calls.length, 2);
});
