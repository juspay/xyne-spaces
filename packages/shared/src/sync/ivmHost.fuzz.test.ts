/**
 * IvmHost randomized-interleaving fuzz (node:test, run via tsx).
 *
 * Seeded, reproducible scenarios over the full client event surface — snapshot / delta /
 * seed / optimistic / settle / sweep / switch-away+return — checked against a reference
 * model of the backend window. A failure prints its seed + step trace for replay.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { IvmHost, type WireRow, type Row } from './ivmHost.js';
import { resolveBaseAst, astToFormat } from './registry.js';
import type { Context } from '../zero/schema.js';

const ctx = { userID: 'u1', workspaceId: 'w1', role: 'MEMBER' } as unknown as Context;
const LIMIT = 8; // small window → more boundary action
const ARGS = { channelId: 'ch1', isMember: true, limit: LIMIT };

function conv(i: number): Row {
  return {
    conversationId: `c${String(i).padStart(5, '0')}`,
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
  };
}
const wire = (r: Row): WireRow => ({ tableName: 'conversations', row: r });
const delKey = (r: Row): string => `conversations:${String(r.conversationId)}`;

/** Deterministic LCG. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

interface ServerState {
  /** alive convs by number, ascending id/createdAt */
  alive: number[];
  next: number;
  version: number;
  /** the op log: each entry = one delta frame {puts, dels, version} */
  log: { puts: number[]; dels: number[]; version: string }[];
}

function windowOf(server: ServerState): number[] {
  return [...server.alive].sort((a, b) => b - a).slice(0, LIMIT);
}

const V = (n: number) => String(n).padStart(6, '0');

/** Server: a new conversation arrives; window shifts. Emits the delta the backend fan-out would. */
function serverNewConv(server: ServerState): { puts: number[]; dels: number[]; version: string } {
  const before = new Set(windowOf(server));
  server.alive.push(server.next);
  const id = server.next;
  server.next += 1;
  server.version += 1;
  const after = new Set(windowOf(server));
  const dels = [...before].filter((x) => !after.has(x));
  const frame = { puts: [id], dels, version: V(server.version) };
  server.log.push(frame);
  return frame;
}

function runScenario(seed: number, steps: number, trace: string[]): void {
  const rnd = lcg(seed);
  const host = new IvmHost();
  const hash = 'fuzzhash';
  const instanceKey = 'fuzz-inst';
  const ast = resolveBaseAst('channelLatestMultipleConversationsV4', ctx, ARGS);
  let latest: readonly Row[] = [];
  const materialize = () =>
    host.materialize(hash, ast, astToFormat(ast), (rows) => {
      latest = rows;
    });
  materialize();

  const server: ServerState = { alive: [], next: 1, version: 1, log: [] };
  // boot: 12 convs exist; client gets a snapshot of the window
  for (let i = 0; i < 12; i++) serverNewConv(server);
  const applySnapshot = () => {
    server.version += 1;
    host.applySnapshot(instanceKey, windowOf(server).map((n) => wire(conv(n))), V(server.version));
    appliedThrough = server.log.length; // snapshot is current: replay nothing older
  };
  let appliedThrough = server.log.length; // how many log frames the client has applied
  applySnapshot();

  // persisted store mirror (what IDB would hold): last snapshot rows + applied deltas
  let disk: { rows: number[]; through: number } = { rows: windowOf(server), through: appliedThrough };

  const applyFrame = (f: { puts: number[]; dels: number[]; version: string }) => {
    host.applyDelta(instanceKey, f.puts.map((n) => wire(conv(n))), f.dels.map((n) => delKey(conv(n))), f.version);
  };

  let subscribed = true;
  let pendingMid = 0;

  for (let s = 0; s < steps; s++) {
    const r = rnd();
    if (!subscribed) {
      // while away the server moves on
      if (r < 0.6) {
        serverNewConv(server);
        trace.push('away-newconv');
      } else {
        // switch back: seed from disk, then resume-replay everything since disk.through
        materialize();
        const seeds = disk.rows
          .filter((n) => true)
          .map((n) => ({ tableName: 'conversations', row: conv(n), version: V(1) }));
        host.applySeed(instanceKey, seeds);
        for (let i = disk.through; i < server.log.length; i++) applyFrame(server.log[i]);
        appliedThrough = server.log.length;
        disk = { rows: windowOf(server), through: appliedThrough };
        subscribed = true;
        trace.push('return+seed+replay');
      }
      continue;
    }
    if (r < 0.45) {
      // a new conversation lands; delta streams to the client
      const f = serverNewConv(server);
      applyFrame(f);
      appliedThrough = server.log.length;
      disk = { rows: windowOf(server), through: appliedThrough };
      trace.push(`delta put=${f.puts[0]} dels=${f.dels.join('/')}`);
    } else if (r < 0.6) {
      // optimistic send: client creates the next conv optimistically, server confirms later
      const id = server.next; // client generates the same id the server will use
      pendingMid += 1;
      host.applyOptimistic(pendingMid, [{ kind: 'set', table: 'conversations', row: conv(id) }]);
      trace.push(`optimistic set=${id} mid=${pendingMid}`);
      if (rnd() < 0.7) {
        host.noteMutationSettled(pendingMid, true);
        trace.push(`settle ok mid=${pendingMid}`);
        if (rnd() < 0.5) {
          host.reconcileConfirmed(); // the sweep fires before the fan-out echo
          trace.push('sweep');
        }
        const f = serverNewConv(server); // the confirmed row fans out
        applyFrame(f);
        appliedThrough = server.log.length;
        disk = { rows: windowOf(server), through: appliedThrough };
        trace.push(`echo put=${f.puts[0]} dels=${f.dels.join('/')}`);
      } else {
        host.noteMutationSettled(pendingMid, false); // rejected → revert
        trace.push(`settle FAIL mid=${pendingMid}`);
      }
    } else if (r < 0.75) {
      host.reconcileConfirmed();
      trace.push('sweep');
    } else if (r < 0.9) {
      // switch away
      host.release(hash);
      host.dropInstance(instanceKey);
      subscribed = false;
      trace.push('switch-away');
    } else {
      applySnapshot();
      disk = { rows: windowOf(server), through: appliedThrough };
      trace.push('fresh-snapshot');
    }
  }

  // wind down: return if away, settle everything, sweep, and let the last echo land
  if (!subscribed) {
    materialize();
    const seeds = disk.rows.map((n) => ({ tableName: 'conversations', row: conv(n), version: V(1) }));
    host.applySeed(instanceKey, seeds);
    for (let i = disk.through; i < server.log.length; i++) applyFrame(server.log[i]);
    trace.push('final-return');
  }
  host.reconcileConfirmed();

  const expected = windowOf(server).map((n) => conv(n).conversationId);
  const got = latest.map((x) => x.conversationId);
  assert.deepEqual(
    got,
    expected,
    `seed=${seed}\nexpected=${JSON.stringify(expected)}\ngot     =${JSON.stringify(got)}\ntrace:\n${trace.join('\n')}`,
  );
}

test('fuzz: 400 seeded scenarios x 40 steps', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const trace: string[] = [];
    try {
      runScenario(seed, 40, trace);
    } catch (e) {
      console.log(`FUZZ FAILURE seed=${seed}`);
      throw e;
    }
  }
});
