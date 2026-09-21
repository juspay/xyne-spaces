/**
 * IvmHost behavior tests (node:test, run via tsx — see the sync-suite convention).
 *
 * Drives the REAL host + the REAL channelLatestMultipleConversationsV4 base AST through
 * the wire sequences that broke in the field (2026-09 shadow-off arc): the fan-out
 * window shift, seed/resume orderings, and the optimistic-overlay lifecycle
 * (normalization, watermark retirement, echo gating, late-replay re-admission).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { IvmHost, type WireRow, type Row } from './ivmHost.js';
import { resolveBaseAst, astToFormat } from './registry.js';
import type { Context } from '../zero/schema.js';

const ctx = { userID: 'u1', workspaceId: 'w1', role: 'MEMBER' } as unknown as Context;
const ARGS = { channelId: 'ch1', isMember: true, limit: 25 };

function conv(i: number, over: Partial<Row> = {}): Row {
  return {
    conversationId: `c${String(i).padStart(4, '0')}`,
    channelId: 'ch1',
    createdBy: 'u1',
    initialMessageId: `m${i}`,
    workspaceId: 'w1',
    parentMessageId: null,
    lastActivityAt: 1000 + i,
    replyCount: 0,
    pinned: false,
    ticketId: null,
    metadata: null,
    callId: null,
    replies_md: null,
    ticket_md: null,
    initial_message_md: `msg ${i}`,
    parent_message_md: null,
    sub_tickets_md: null,
    doNotPostToChannel: null,
    createdAt: 1000 + i,
    threadType: null,
    ...over,
  };
}
const wire = (r: Row): WireRow => ({ tableName: 'conversations', row: r });
const delKey = (r: Row): string => `conversations:${String(r.conversationId)}`;

function setup(instanceKey = 'inst1', hash = 'hash1') {
  const host = new IvmHost();
  const ast = resolveBaseAst('channelLatestMultipleConversationsV4', ctx, ARGS);
  assert.ok(ast, 'base AST must resolve');
  let latest: readonly Row[] = [];
  host.materialize(hash, ast, astToFormat(ast), (rows) => {
    latest = rows;
  });
  const ids = () => latest.map((r) => r.conversationId);
  const rows = () => latest;
  void instanceKey;
  return { host, ids, rows, hash };
}

test('window shift: snapshot 25, then del(oldest)+put(new) x3 — stays 25 with news', () => {
  const { host, ids } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  assert.equal(ids().length, 25);

  for (let n = 0; n < 3; n++) {
    const newest = conv(26 + n);
    const oldest = conv(1 + n);
    host.applyDelta('inst1', [wire(newest)], [delKey(oldest)], `0${2 + n}`);
    const cur = ids();
    assert.ok(cur.includes(newest.conversationId), `delta ${n}: new row must surface`);
    assert.ok(!cur.includes(oldest.conversationId), `delta ${n}: oldest must be gone`);
    assert.equal(cur.length, 25, `delta ${n}: window must remain 25`);
  }
});

test('CONTRACT: a wire put missing a filter column is silently dropped by the pipeline', () => {
  // Documents why rows entering the source MUST be schema-complete: Zero pushes the query
  // where-clause into the source connection, and `IS NULL` compiles to `=== null` — an
  // absent (undefined) column fails it and the ADD never reaches any view. Server wire
  // rows always carry every column; optimistic rows are normalized (see next test).
  const { host, ids } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  const newest = conv(26);
  delete (newest as Record<string, unknown>).doNotPostToChannel;
  host.applyDelta('inst1', [wire(newest)], [delKey(conv(1))], '02');
  const cur = ids();
  assert.ok(!cur.includes('c0026'), 'incomplete row is dropped (delete still applies)');
  assert.equal(cur.length, 24);
});

test('optimistic set with MISSING optional columns surfaces (schema normalization)', () => {
  const { host, ids } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  // the exact mutator shape from mutators.ts conversations.insert — no doNotPostToChannel,
  // no ticketId/callId/md columns
  const optimistic: Row = {
    conversationId: 'c9999',
    channelId: 'ch1',
    workspaceId: 'w1',
    createdBy: 'u1',
    initialMessageId: 'm9999',
    lastActivityAt: 2000,
    replyCount: 0,
    pinned: false,
    createdAt: 2000,
    initial_message_md: 'x',
  };
  host.applyOptimistic(11, [{ kind: 'set', table: 'conversations', row: optimistic }]);
  assert.ok(ids().includes('c9999'), 'normalized optimistic row must pass the pipeline predicate');
  assert.equal(ids().length, 25, 'window stays at limit');

  // the confirming delta (full server row) + del of the evicted oldest
  host.applyDelta('inst1', [wire(conv(9999, { conversationId: 'c9999', createdAt: 2000 }))], [delKey(conv(1))], '02');
  const cur = ids();
  assert.ok(cur.includes('c9999'), 'row survives the confirming delta');
  assert.ok(!cur.includes('c0001'), 'delete still applies');
});

test('optimistic set of NEW conv, then confirming delta', () => {
  const { host, ids } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  const newest = conv(26);
  host.applyOptimistic(7, [{ kind: 'set', table: 'conversations', row: newest }]);
  assert.ok(ids().includes('c0026'), 'optimistic add must surface');
  host.noteMutationSettled(7, true);
  host.applyDelta('inst1', [wire(conv(26))], [delKey(conv(1))], '02');
  const cur = ids();
  assert.ok(cur.includes('c0026'), 'row must survive confirm');
  assert.equal(cur.length, 25);
});

test('lmid watermark + echo-gated sweep: no premature drop, retire after echo', () => {
  const { host, ids } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  const newest = conv(26);
  host.applyOptimistic(7, [{ kind: 'set', table: 'conversations', row: newest }]);
  assert.ok(ids().includes('c0026'));

  // watermark advances via the poke (noteLmid) BEFORE the fan-out echo — sweep must NOT
  // drop the overlay yet (no confirmed row → the send would vanish)
  host.noteLmid(7);
  host.reconcileConfirmed();
  assert.ok(ids().includes('c0026'), 'settled-but-unechoed overlay must not drop');

  // echo lands → sweep retires flicker-free (row now confirmed-backed)
  host.applyDelta('inst1', [wire(conv(26))], [delKey(conv(1))], '02');
  host.reconcileConfirmed();
  const cur = ids();
  assert.ok(cur.includes('c0026'), 'row remains after retirement');
  assert.equal(cur.length, 25);
});

test('rejected mutation reverts immediately via noteMutationSettled(false)', () => {
  const { host, ids } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  host.applyOptimistic(9, [{ kind: 'set', table: 'conversations', row: conv(27) }]);
  assert.ok(ids().includes('c0027'));
  host.noteMutationSettled(9, false);
  assert.ok(!ids().includes('c0027'), 'rejected overlay must revert');
  assert.equal(ids().length, 25, 'window refills from source');
});

test('echo-before-ack retires at ack (event-driven), no sweep needed', async () => {
  const { host, ids, rows } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  const md26 = () => rows().find((r) => r.conversationId === 'c0026')?.initial_message_md;

  host.applyOptimistic(7, [
    { kind: 'set', table: 'conversations', row: conv(26, { initial_message_md: 'CLIENT-md-unsent' }) },
  ]);
  assert.equal(md26(), 'CLIENT-md-unsent');

  // ECHO first (the wire row already carries server truth: coalesced insert+flip)…
  host.applyDelta('inst1', [wire(conv(26, { initial_message_md: 'SERVER-md-sent' }))], [delKey(conv(1))], '02');
  // …overlay still masks (mutation not yet settled) — by design
  assert.equal(md26(), 'CLIENT-md-unsent');

  // the ack arrives ~60ms later (the live ordering) — retirement must happen NOW, not at a sweep
  host.noteMutationSettled(7, true);
  await new Promise((r) => setTimeout(r, 0)); // let the scheduled reconcile microtask run
  assert.equal(md26(), 'SERVER-md-sent', 'overlay must retire at ack (event-driven), exposing server truth');
  assert.equal(ids().length, 25);
});

test('watermark-only settle (noteLmid) also retires at ack after echo', async () => {
  const { host, ids, rows } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  host.applyOptimistic(8, [
    { kind: 'set', table: 'conversations', row: conv(26, { initial_message_md: 'CLIENT' }) },
  ]);
  host.applyDelta('inst1', [wire(conv(26, { initial_message_md: 'SERVER' }))], [delKey(conv(1))], '02');
  host.noteLmid(8);
  await new Promise((r) => setTimeout(r, 0));
  const row26 = rows().find((r) => r.conversationId === 'c0026');
  assert.equal(row26?.initial_message_md, 'SERVER', 'watermark advance alone must retire the echoed overlay');
  assert.ok(ids().includes('c0026'));
});

test('INVARIANT: late rebase replay after retirement must NOT re-mask the confirmed row', async () => {
  // Zero's rebase replays and the confirmation watermark ride different pipelines; with
  // rapid sends a replay from an EARLIER poke can land AFTER the ack retired this
  // mutation's overlay. Re-recording would re-mask the confirmed row with the
  // client-built (by-construction staler) version — the "clock icon flap".
  const { host, rows } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');

  // record every md value the view ever emits for c0026 — catches even one-flush flaps
  const mdHistory: unknown[] = [];
  const record = () => {
    const md = rows().find((r) => r.conversationId === 'c0026')?.initial_message_md;
    if (md !== undefined && md !== mdHistory[mdHistory.length - 1]) mdHistory.push(md);
  };

  const clientOp = { kind: 'set' as const, table: 'conversations', row: conv(26, { initial_message_md: 'CLIENT' }) };
  host.applyOptimistic(7, [clientOp]);
  record();
  host.applyDelta('inst1', [wire(conv(26, { initial_message_md: 'SERVER' }))], [delKey(conv(1))], '02');
  record();
  host.noteMutationSettled(7, true); // ack → event-driven retirement
  await new Promise((r) => setTimeout(r, 0));
  record();
  assert.equal(mdHistory[mdHistory.length - 1], 'SERVER', 'retired at ack');

  // THE RACE: a rebase replay from an earlier poke lands AFTER retirement and re-records
  host.applyOptimistic(7, [clientOp]);
  record();
  assert.equal(
    rows().find((r) => r.conversationId === 'c0026')?.initial_message_md,
    'SERVER',
    'late replay of a settled+echoed mutation must be dropped, not re-recorded',
  );
  assert.ok(
    !mdHistory.slice(mdHistory.indexOf('SERVER')).includes('CLIENT'),
    `no CLIENT flap after SERVER truth; history=${JSON.stringify(mdHistory)}`,
  );
});

test('INVARIANT: settled-but-UNECHOED replay still records (new-message flicker protection)', () => {
  const { host, rows } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  // ack arrives BEFORE the echo (slow fan-out): overlay must stay so the new message doesn't vanish
  host.applyOptimistic(9, [{ kind: 'set', table: 'conversations', row: conv(27, { initial_message_md: 'CLIENT' }) }]);
  host.noteMutationSettled(9, true);
  // late replay before echo — must still be recorded (row would otherwise disappear)
  host.applyOptimistic(9, [{ kind: 'set', table: 'conversations', row: conv(27, { initial_message_md: 'CLIENT' }) }]);
  assert.equal(
    rows().find((r) => r.conversationId === 'c0027')?.initial_message_md,
    'CLIENT',
    'unechoed settled overlay must survive until the echo lands',
  );
});

test('switch-return: seed 25 then resume-replay of recent put-deltas', () => {
  const { host, ids } = setup();
  const seeds = Array.from({ length: 25 }, (_, k) => ({
    tableName: 'conversations',
    row: conv(k + 1),
    version: '01',
  }));
  host.applySeed('inst1', seeds);
  assert.equal(ids().length, 25);
  host.applyDelta('inst1', [wire(conv(26))], [delKey(conv(1))], '02');
  host.applyDelta('inst1', [wire(conv(27))], [delKey(conv(2))], '03');
  const cur = ids();
  assert.ok(cur.includes('c0026') && cur.includes('c0027'), 'replayed puts must surface');
  assert.equal(cur.length, 25);
});

test('race: resume deltas arrive BEFORE the IDB seed lands', () => {
  const { host, ids } = setup();
  // deltas first (fast server, slow IDB)
  host.applyDelta('inst1', [wire(conv(26))], [delKey(conv(1))], '02');
  host.applyDelta('inst1', [wire(conv(27))], [delKey(conv(2))], '03');
  // then the seed: the window persisted at switch-away (c1..c25 @01)
  const seeds = Array.from({ length: 25 }, (_, k) => ({
    tableName: 'conversations',
    row: conv(k + 1),
    version: '01',
  }));
  host.applySeed('inst1', seeds);
  const cur = ids();
  assert.ok(cur.includes('c0026') && cur.includes('c0027'), 'late seed must not clobber newer deltas');
  assert.ok(!cur.includes('c0001') && !cur.includes('c0002'), 'deleted-while-racing rows must not resurrect');
  assert.equal(cur.length, 25);
});

test('re-subscribe: drop instance + release view, re-materialize, seed, replay', () => {
  const { host, ids, hash } = setup();
  const snap = Array.from({ length: 25 }, (_, k) => conv(k + 1));
  host.applySnapshot('inst1', snap.map(wire), '01');
  // switch away
  host.release(hash);
  host.dropInstance('inst1');
  // switch back: fresh pipeline (same hash), seed from disk, resume replay
  const ast = resolveBaseAst('channelLatestMultipleConversationsV4', ctx, ARGS);
  let latest: readonly Row[] = [];
  host.materialize(hash, ast, astToFormat(ast), (rows) => {
    latest = rows;
  });
  const ids2 = () => latest.map((r) => r.conversationId);
  const seeds = snap.map((r) => ({ tableName: 'conversations', row: r, version: '01' }));
  host.applySeed('inst1', seeds);
  assert.equal(ids2().length, 25, 'seed must repaint 25');
  host.applyDelta('inst1', [wire(conv(26))], [delKey(conv(1))], '02');
  const cur = ids2();
  assert.ok(cur.includes('c0026'), 'replayed put must surface after re-subscribe');
  assert.equal(cur.length, 25);
  void ids;
});
