#!/usr/bin/env node
// An end-to-end check of the sync server as a protocol client (v51) sees it, against a
// running xyne-spaces backend (port 3001, ENABLE_DEV_AUTH=true), its Postgres, and
// the server (port 4848). Two dev users log in; A subscribes to browsableChannels,
// both are made members of the first channel straight in Postgres (the poke must
// deliver the rows), A subscribes to channelConversations, starts a conversation
// through the real conversations.send mutation, subscribes to its thread, B
// subscribes to the same thread from another client group, A replies (B must see
// it), A drops the thread query (with ttl 0 so the release is immediate), A reconnects with its current cookie (no reset) and once with a stale one
// (reset); a client whose schema fits is served whole rows, and one whose schema names
// what the server does not have is refused with SchemaVersionNotSupported. Exits 0 on PASS.
//
//   node scripts/e2e-protocol.mjs
//
// Environment: E2E_API (http://localhost:3001/api), E2E_GATEWAY
// (ws://localhost:4848/sync), E2E_PG (the backend's database URL), E2E_WS (the
// path of the `ws` package when it is not resolvable from here).

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const WebSocket = (() => {
  const candidates = [process.env.E2E_WS, 'ws', path.join(here, '..', 'node_modules', 'ws')].filter(Boolean);
  for (const candidate of candidates) {
    try { return requireHere(candidate); } catch { /* next */ }
  }
  console.error('the `ws` package is needed: npm i ws, or point E2E_WS at a copy');
  process.exit(2);
})();

const API = process.env.E2E_API ?? 'http://localhost:3001/api';
const GATEWAY = process.env.E2E_GATEWAY ?? 'ws://localhost:4848/sync';
const PG = process.env.E2E_PG ?? 'postgresql://xyne:xyne123@localhost:5499/xyne_dev_db';
const t0 = Date.now();
const log = (...a) => console.log(`${String(Date.now() - t0).padStart(6)}ms`, ...a);
const fail = (why) => { log('FAIL', why); process.exit(1); };
setTimeout(() => fail('timeout'), 60_000);
const pk = (v) => JSON.stringify(v.messageId ?? v.conversationId ?? v.id);

async function login(email) {
  const res = await fetch(`${API}/test/auth/login?email=${encodeURIComponent(email)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const body = await res.json();
  if (!body.user) fail('login failed: ' + JSON.stringify(body));
  return { cookie: res.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), userId: body.user.id, workspaceId: body.user.workspaceId, email };
}

function ensureMember(user, channelId) {
  const sql = `INSERT INTO channel_participants ("workspaceId", id, "channelId", "userId", role) SELECT '${user.workspaceId}', 'cp-e2e-${randomUUID().slice(0, 8)}', '${channelId}', '${user.userId}', 'MEMBER' WHERE NOT EXISTS (SELECT 1 FROM channel_participants WHERE "channelId" = '${channelId}' AND "userId" = '${user.userId}');
    INSERT INTO channel_user_status ("workspaceId", id, "channelId", "userId") SELECT '${user.workspaceId}', 'cus-e2e-${randomUUID().slice(0, 8)}', '${channelId}', '${user.userId}' WHERE NOT EXISTS (SELECT 1 FROM channel_user_status WHERE "channelId" = '${channelId}' AND "userId" = '${user.userId}');`;
  execFileSync('psql', [PG, '-Atc', sql]);
}

/// One protocol connection with its own view of the rows it was sent.
function connect(name, user, group, client, { baseCookie = '', lmid = 0, patch = [], clientSchema, onFrame }) {
  const state = { name, rows: {}, got: new Set(), lmid: 0, cookie: null, pokes: 0, pongs: 0, pushResponses: 0, errors: [], closed: false, ws: null };
  const init = ['initConnection', { desiredQueriesPatch: patch, activeClients: [client], ...(clientSchema ? { clientSchema } : {}) }];
  const sec = encodeURIComponent(Buffer.from(JSON.stringify({ initConnectionMessage: init, authToken: undefined })).toString('base64'));
  const url = `${GATEWAY}/sync/v51/connect?clientID=${client}&clientGroupID=${group}&userID=${user.userId}&baseCookie=${encodeURIComponent(baseCookie)}&ts=1&lmid=${lmid}&wsid=${name}&profileID=p1`;
  const ws = new WebSocket(url, [sec], { headers: { Cookie: user.cookie, Origin: 'http://localhost:5173' } });
  state.ws = ws;
  state.send = (m) => { log(`${name} ->`, m[0], JSON.stringify(m[1]).slice(0, 140)); ws.send(JSON.stringify(m)); };
  let nextMutation = lmid;
  state.push = (mname, args) => { nextMutation += 1; state.send(['push', { clientGroupID: group, mutations: [{ type: 'custom', id: nextMutation, clientID: client, name: mname, args: [args], timestamp: Date.now() }], pushVersion: 1, timestamp: Date.now(), requestID: `${name}-r${nextMutation}` }]); return nextMutation; };
  state.thread = (conversationId) => [...(state.rows.messages?.values() ?? [])].filter(m => m.conversationId === conversationId);
  ws.on('message', (data) => {
    const [tag, body] = JSON.parse(data.toString());
    if (tag === 'pokePart') {
      for (const op of body.rowsPatch ?? []) {
        state.rows[op.tableName] ??= new Map();
        if (op.op === 'put') state.rows[op.tableName].set(pk(op.value), op.value);
        if (op.op === 'del') state.rows[op.tableName].delete(pk(op.id));
      }
      for (const op of body.gotQueriesPatch ?? []) { if (op.op === 'put') state.got.add(op.hash); else state.got.delete(op.hash); }
      for (const [c, id] of Object.entries(body.lastMutationIDChanges ?? {})) { if (c === client) state.lmid = id; }
      const rp = body.rowsPatch ?? [];
      log(`${name} <-`, tag, `rows=${rp.length}`, rp.length ? `(${[...new Set(rp.map(o => o.op + ':' + o.tableName))].join(', ')})` : '', body.gotQueriesPatch ? `got=${JSON.stringify(body.gotQueriesPatch)}` : '', body.lastMutationIDChanges ? `lmid=${JSON.stringify(body.lastMutationIDChanges)}` : '', body.desiredQueriesPatches ? 'desired' : '');
    } else if (tag === 'pokeEnd') {
      state.pokes += 1; state.cookie = body.cookie; log(`${name} <-`, tag, body.cookie); onFrame(state, tag, body);
    } else if (tag === 'pushResponse') {
      state.pushResponses += 1; log(`${name} <-`, tag, JSON.stringify(body).slice(0, 160));
      const errors = (body.mutations ?? []).filter(m => m.result && 'error' in m.result);
      if (errors.length) fail('mutation error: ' + JSON.stringify(errors));
    } else if (tag === 'pong') {
      state.pongs += 1; log(`${name} <-`, tag); onFrame(state, tag, body);
    } else if (tag === 'error') {
      state.errors.push(body); log(`${name} <-`, tag, JSON.stringify(body)); onFrame(state, tag, body);
    } else {
      log(`${name} <-`, tag, JSON.stringify(body).slice(0, 120)); onFrame(state, tag, body);
    }
  });
  ws.on('open', () => log(`${name} socket open`));
  ws.on('close', (code) => { state.closed = true; log(`${name} socket closed`, code); onFrame(state, 'close', code); });
  ws.on('error', (e) => log(`${name} socket error`, e.message));
  return state;
}

const A = await login('test-user-email-42@xyne-test.local');
const B = await login('test-user-email-43@xyne-test.local');
log('A =', A.email, 'B =', B.email);
const groupA = 'ga-' + randomUUID().slice(0, 8);
const groupB = 'gb-' + randomUUID().slice(0, 8);
let stage = 'browsable';
let channelId, conversationId;
let a2, b;

const a = connect('A1', A, groupA, 'ca', { patch: [{ op: 'put', hash: 'h1', name: 'browsableChannels', args: [], ttl: 300000 }], onFrame: advance });

function advance() {
  switch (stage) {
    case 'browsable': {
      if (!a.got.has('h1')) return;
      const channels = [...(a.rows.channels?.values() ?? [])];
      const pick = channels.find(c => c.scopeType === 'DEFAULT') ?? channels[0];
      if (!pick) return fail('no channel visible');
      channelId = pick.id;
      log(`A sees ${channels.length} channel(s); using ${pick.name}; making A and B members straight in Postgres`);
      ensureMember(A, channelId); ensureMember(B, channelId);
      stage = 'joined';
      return;
    }
    case 'joined': {
      const members = [...(a.rows.channel_participants?.values() ?? [])].filter(p => p.channelId === channelId).map(p => p.userId);
      if (!(members.includes(A.userId) && members.includes(B.userId))) return;
      log('both membership rows arrived at A by poke from the replication stream');
      stage = 'conversations';
      a.send(['changeDesiredQueries', { desiredQueriesPatch: [{ op: 'put', hash: 'h2', name: 'channelConversations', args: [{ channelId, isMember: true }], ttl: 300000 }] }]);
      return;
    }
    case 'conversations': {
      if (!a.got.has('h2')) return;
      conversationId = 'cv-' + randomUUID().slice(0, 8);
      stage = 'started';
      a.push('conversations.send', { channelId, content: 'hello from the sync server e2e', type: 'USER', conversationId, messageId: 'm-' + randomUUID().slice(0, 8), timestamp: Date.now() });
      return;
    }
    case 'started': {
      if (!(a.lmid >= 1 && [...(a.rows.conversations?.values() ?? [])].some(c => c.conversationId === conversationId))) return;
      log('A: the new conversation arrived by poke with lastMutationID', a.lmid);
      stage = 'thread';
      a.send(['changeDesiredQueries', { desiredQueriesPatch: [{ op: 'put', hash: 'h3', name: 'conversationMessages', args: [{ conversationId }], ttl: 0 }] }]);
      return;
    }
    case 'thread': {
      if (!a.got.has('h3')) return;
      log(`A: thread has ${a.thread(conversationId).length} message(s); B connects and subscribes to the same thread`);
      stage = 'b-joins';
      b = connect('B1', B, groupB, 'cb', { patch: [{ op: 'put', hash: 'h3', name: 'conversationMessages', args: [{ conversationId }], ttl: 300000 }], onFrame: advance });
      return;
    }
    case 'b-joins': {
      if (!b?.got.has('h3')) return;
      log(`B: thread has ${b.thread(conversationId).length} message(s) at subscription`);
      if (b.thread(conversationId).length !== 1) return fail('B should see the first message');
      stage = 'reply';
      a.push('messages.send', { conversationId, content: 'a reply that B must see', type: 'USER', timestamp: Date.now(), messageId: 'm-' + randomUUID().slice(0, 8) });
      return;
    }
    case 'reply': {
      if (!(a.lmid >= 2 && a.thread(conversationId).length === 2 && b.thread(conversationId).length === 2)) return;
      log('A confirmed its reply (lastMutationID 2) and B received it by poke');
      stage = 'reconnect';
      const cookie = a.cookie;
      a.ws.close(1000, 'reconnecting');
      setTimeout(() => {
        a2 = connect('A2', A, groupA, 'ca', { baseCookie: cookie, lmid: 2, patch: [{ op: 'put', hash: 'h1', name: 'browsableChannels', args: [], ttl: 300000 }, { op: 'put', hash: 'h2', name: 'channelConversations', args: [{ channelId, isMember: true }], ttl: 300000 }, { op: 'put', hash: 'h3', name: 'conversationMessages', args: [{ conversationId }], ttl: 300000 }], onFrame: advance });
      }, 200);
      return;
    }
    case 'reconnect': {
      if (!a2 || a2.errors.length) { if (a2?.errors.length) fail('reconnect with the current cookie was refused'); return; }
      if (a2.pokes < 1) return;
      log(`A2 reconnected at cookie ${a2.cookie} without a reset (${Object.values(a2.rows).reduce((n, m) => n + m.size, 0)} rows re-sent)`);
      stage = 'stale';
      const stale = connect('A3', A, groupA, 'ca', { baseCookie: '0001', lmid: 2, patch: [], onFrame: (s, tag) => {
        if (tag === 'error' && s.errors[0]?.kind === 'InvalidConnectionRequestBaseCookie') { log('A3 with a stale cookie was told to start over, as intended'); stage = 'schema-fits'; advance(); }
      } });
      return;
    }
    case 'schema-fits': {
      stage = 'schema-fits-wait';
      const fits = { tables: { channels: { columns: { id: { type: 'string' }, name: { type: 'string' } }, primaryKey: ['id'] } } };
      const s1 = connect('S1', A, 'gs-' + randomUUID().slice(0, 8), 'cs1', { clientSchema: fits, patch: [{ op: 'put', hash: 'h1', name: 'browsableChannels', args: [], ttl: 300000 }], onFrame: (s, tag) => {
        if (tag === 'error') return fail('a client whose schema fits was refused: ' + JSON.stringify(s.errors[0]));
        if (stage === 'schema-fits-wait' && s.got.has('h1')) {
          const row = [...(s.rows.channels?.values() ?? [])][0];
          if (!row || Object.keys(row).length <= 2) return fail('rows should travel whole, whatever the client schema declares');
          log(`S1 declared two columns of channels and was served whole rows (${Object.keys(row).length} columns)`);
          s.ws.close(1000); stage = 'schema-ahead'; advance();
        }
      } });
      return;
    }
    case 'schema-ahead': {
      stage = 'schema-ahead-wait';
      const ahead = { tables: {
        channels: { columns: { id: { type: 'string' }, noSuchColumn: { type: 'string' }, name: { type: 'number' } }, primaryKey: ['name'] },
        no_such_table: { columns: { id: { type: 'string' } }, primaryKey: ['id'] },
      } };
      connect('S2', A, 'gs-' + randomUUID().slice(0, 8), 'cs2', { clientSchema: ahead, patch: [{ op: 'put', hash: 'h1', name: 'browsableChannels', args: [], ttl: 300000 }], onFrame: (s, tag) => {
        if (tag === 'pokeEnd') return fail('a client whose schema the server cannot serve was served');
        if (tag === 'error') {
          const { kind, message } = s.errors[0];
          if (kind !== 'SchemaVersionNotSupported') return fail('expected SchemaVersionNotSupported, got ' + kind);
          for (const needle of ['"no_such_table" table does not exist', '"noSuchColumn" column does not exist', 'upstream type "string" does not match the client type "number"', 'primaryKey <name>']) {
            if (!message.includes(needle)) return fail('the refusal does not say: ' + needle);
          }
        }
        if (tag === 'close') {
          if (s.errors.length !== 1) return fail('S2 was closed without being told why');
          log('S2 named a table, a column, a type and a key the server does not have: refused with SchemaVersionNotSupported and closed');
          stage = 'done'; advance();
        }
      } });
      return;
    }
    case 'done': {
      stage = 'finished';
      log(`SUMMARY A1 pokes=${a.pokes} B1 pokes=${b.pokes} A2 pokes=${a2.pokes} pushResponses=${a.pushResponses} lmid=${a.lmid} B thread=${b.thread(conversationId).length}`);
      log('PASS');
      b.ws.close(1000); a2.ws.close(1000);
      setTimeout(() => process.exit(0), 300);
      return;
    }
    default:
      return;
  }
}
