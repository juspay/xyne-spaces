#!/usr/bin/env node
// Load test for the sync server over the sync wire protocol (v51), against a running
// xyne-spaces backend (ENABLE_DEV_AUTH=true), its Postgres, and the server.
//
// Phases (each timed and reported):
//   1. setup    – log the load users in through the backend's dev login, make them
//                 members of the target channel (straight in Postgres, as a workspace
//                 admin would through the UI), and open the writer sockets.
//   2. seed     – writers create `--seed` conversations in the channel through the
//                 real `conversations.send` mutation, `--seed-batch` mutations per
//                 push; like a protocol client, a writer has one push in flight at a
//                 time; then `--seed-replies` replies spread over the threads the
//                 subscribers will open.
//   3. hydrate  – open `--connections` subscriber sockets, each with the same query
//                 set the chat screen registers (channel list, latest conversations,
//                 users, unread activities, and `--threads` open threads); measure
//                 the time from socket open to `connected`, to the first poke, and to
//                 every query reporting `got`.
//   4. steady   – for `--duration` seconds the writers push mutations at `--rate`
//                 per second in total: `--reply-share` of them replies into existing
//                 threads (`messages.send`), the rest start new conversations
//                 (`conversations.send`). Every subscriber that receives the row
//                 records the delay from the writer's send to its own receipt.
//   5. drain    – wait for the last rows to land, close everything, report.
//
//   node scripts/load-protocol.mjs --connections 200 --seed 2000 --rate 50 --duration 60
//
// Options (env in brackets): --api [E2E_API] --gateway [E2E_GATEWAY] --pg [E2E_PG]
// --connections N --users K --writers W --batch B (mutations per push in the steady phase, 1)
// --seed-batch B2 (mutations per push while seeding, 10) --push-timeout MS (30000)
// --seed M --seed-replies M2 --threads T --rate R --tps T2 (transactions a
// second in the steady phase when --writes is sql, 20: a transaction carries
// R/T2 rows, so a ladder that outgrows a query's LIMIT per transaction needs more)
// --duration S --reply-share F --writes mutations|sql (mutations go through the
// application server the way a client's do; sql writes the same rows straight into
// PostgreSQL, so the measured throughput is this server's own pipeline — the
// replication feed, the engine and the fan-out — with no application server in it)
// --channel ID --channels C (spread the subscribers and the writes over C DEFAULT
// channels, the first being --channel or the workspace's oldest and the rest
// `load-ch-<k>`, created if missing: each update then reaches CONNECTIONS/C
// subscribers, the shape that measures transactions a second rather than fan-out)
// --stats URL (the server's /stats; reset when the steady phase starts and read
// at its end; default: the gateway's host and port) --pid PID (sample this process's CPU/RSS)
// --container NAME (sample `docker stats` instead) --out FILE (statistics; add --raw for every
// delivery delay) --label TEXT --quiet
// --auth-pool FILE (a JSON list of identities with a `token`, `userID` and
// `workspaceID`, the way the regression rig's harness keeps them: the users are
// taken from it in order and the token goes in the connection's handshake, so no
// test login is needed) --thread-query NAME (the per-conversation query, conversationMessages)
// --client-schema FILE (a JSON client schema to send in initConnection; the TypeScript
// reference server requires one for a new client group, this server does not) --post-handshake
// (send initConnection as the first message instead of in the handshake header, the way
// a client with a large schema does; on by default when --client-schema is given)
// The `ws` package is found through E2E_WS, `ws`, or ../node_modules/ws.

import { randomUUID } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const WebSocket = (() => {
  for (const candidate of [process.env.E2E_WS, 'ws', path.join(here, '..', 'node_modules', 'ws')].filter(Boolean)) {
    try { return requireHere(candidate); } catch { /* next */ }
  }
  console.error('the `ws` package is needed: npm i ws, or point E2E_WS at a copy');
  process.exit(2);
})();

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const API = opt('api', process.env.E2E_API ?? 'http://localhost:3001/api');
const GATEWAY = opt('gateway', process.env.E2E_GATEWAY ?? 'ws://localhost:4848/sync');
const PG = opt('pg', process.env.E2E_PG ?? 'postgresql://xyne:xyne123@localhost:5499/xyne_dev_db');
const CONNECTIONS = +opt('connections', 50);
const USERS = +opt('users', 10);
const WRITERS = +opt('writers', 4);
const BATCH = +opt('batch', 1);
const SEED_BATCH = +opt('seed-batch', 10);
const PUSH_TIMEOUT = +opt('push-timeout', 30_000);
const SEED = +opt('seed', 0);
const SEED_REPLIES = +opt('seed-replies', 0);
const THREADS = +opt('threads', 3);
const RATE = +opt('rate', 20);
const TPS = Math.max(1, +opt('tps', 20));
const DURATION = +opt('duration', 30);
const REPLY_SHARE = +opt('reply-share', 0.3);
const CHANNEL = opt('channel', '');
const CHANNELS = Math.max(1, +opt('channels', 1));
const PID = opt('pid', '');
const CONTAINER = opt('container', '');
const OUT = opt('out', '');
const LABEL = opt('label', '');
const QUIET = flag('quiet');
const DUMP = flag('dump-tables');
const RAW = flag('raw');
const WRITES = opt('writes', 'mutations');
const AUTH_POOL = opt('auth-pool', process.env.E2E_AUTH_POOL ?? '');
const THREAD_QUERY = opt('thread-query', 'conversationMessages');
const CLIENT_SCHEMA = opt('client-schema', '') ? JSON.parse(readFileSync(opt('client-schema', ''), 'utf8')) : undefined;
const POST_HANDSHAKE = flag('post-handshake') || CLIENT_SCHEMA !== undefined;
const STATS = opt('stats', GATEWAY.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/[^/]*$/, '') + '/stats');
const t0 = Date.now();
const log = (...a) => console.log(`${String(Date.now() - t0).padStart(7)}ms`, ...a);
const debug = (...a) => { if (!QUIET) log(...a); };
const fail = (why) => { log('FAIL', why); process.exit(1); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const psql = (sql) => execFileSync('psql', [PG, '-Atc', sql]).toString().trim();
const pk = (v) => JSON.stringify(v.messageId ?? v.conversationId ?? v.id);

/// Percentiles and extremes of a list of numbers.
function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, min: s[0], p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99), max: s[s.length - 1], mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
}
const fmt = (st) => st.n ? `n=${st.n} p50=${st.p50} p90=${st.p90} p99=${st.p99} max=${st.max} (ms)` : 'n=0';

async function login(email) {
  const res = await fetch(`${API}/test/auth/login?email=${encodeURIComponent(email)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const body = await res.json();
  if (!body.user) fail(`login failed for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return { cookie: res.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), userId: body.user.id, workspaceId: body.user.workspaceId, email };
}

function ensureMember(user, channelId) {
  psql(`INSERT INTO channel_participants ("workspaceId", id, "channelId", "userId", role) SELECT '${user.workspaceId}', 'cp-load-${randomUUID().slice(0, 8)}', '${channelId}', '${user.userId}', 'MEMBER' WHERE NOT EXISTS (SELECT 1 FROM channel_participants WHERE "channelId" = '${channelId}' AND "userId" = '${user.userId}');
    INSERT INTO channel_user_status ("workspaceId", id, "channelId", "userId") SELECT '${user.workspaceId}', 'cus-load-${randomUUID().slice(0, 8)}', '${channelId}', '${user.userId}' WHERE NOT EXISTS (SELECT 1 FROM channel_user_status WHERE "channelId" = '${channelId}' AND "userId" = '${user.userId}');`);
}

/// Process samples: CPU percent and RSS of the server, from `ps` or `docker stats`.
const samples = [];
function sample() {
  if (PID) {
    execFile('ps', ['-o', '%cpu=,rss=', '-p', PID], (err, out) => {
      if (err) return;
      const [cpu, rss] = out.trim().split(/\s+/).map(Number);
      samples.push({ t: Date.now() - t0, cpu, rss_mb: Math.round(rss / 1024) });
    });
  } else if (CONTAINER) {
    execFile('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', CONTAINER], (err, out) => {
      if (err) return;
      const m = /([\d.]+)%\s+([\d.]+)([KMG])iB/.exec(out);
      if (!m) return;
      const mb = +m[2] * ({ K: 1 / 1024, M: 1, G: 1024 }[m[3]]);
      samples.push({ t: Date.now() - t0, cpu: +m[1], rss_mb: Math.round(mb) });
    });
  }
}

/// One protocol connection.
class Conn {
  constructor(name, user, patch, sink) {
    this.name = name; this.user = user; this.sink = sink;
    this.group = 'lg-' + randomUUID().slice(0, 10); this.client = 'lc-' + randomUUID().slice(0, 8);
    this.got = new Map(); this.rows = 0; this.bytes = 0; this.pokes = 0; this.errors = []; this.seenKeys = new Set();
    this.opened = Date.now(); this.connectedAt = 0; this.firstPokeAt = 0; this.hydratedAt = 0; this.closed = false;
    this.wanted = new Set(patch.map(p => p.hash)); this.mutationId = 0; this.pending = new Map(); this.pushLatencies = []; this.inflight = null; this.timedOut = 0;
    const init = ['initConnection', { desiredQueriesPatch: patch, activeClients: [this.client], ...(CLIENT_SCHEMA ? { clientSchema: CLIENT_SCHEMA } : {}) }];
    const sec = encodeURIComponent(Buffer.from(JSON.stringify({ initConnectionMessage: POST_HANDSHAKE ? null : init, authToken: user.token })).toString('base64'));
    const url = `${GATEWAY}/sync/v51/connect?clientID=${this.client}&clientGroupID=${this.group}&userID=${user.userId}&baseCookie=&ts=1&lmid=0&wsid=${name}&profileID=load`;
    this.ws = new WebSocket(url, [sec], { headers: { ...(user.cookie ? { Cookie: user.cookie } : {}), Origin: 'http://localhost:5173' }, perMessageDeflate: false });
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    if (POST_HANDSHAKE) this.ws.on('open', () => this.send(init));
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('close', (code) => { this.closed = true; this.closeCode = code; this.resolveReady(); });
    this.ws.on('error', (e) => { this.errors.push({ kind: 'socket', message: e.message }); });
  }
  onMessage(data) {
    const text = data.toString();
    this.bytes += text.length;
    const [tag, body] = JSON.parse(text);
    switch (tag) {
      case 'connected': this.connectedAt = Date.now(); break;
      case 'pokePart': {
        for (const op of body.rowsPatch ?? []) {
          this.rows += 1;
          if (op.op === 'put') this.sink.onPut(this, op.tableName, op.value);
        }
        for (const op of body.gotQueriesPatch ?? []) { if (op.op === 'put') this.got.set(op.hash, Date.now()); else this.got.delete(op.hash); }
        for (const [client, id] of Object.entries(body.lastMutationIDChanges ?? {})) {
          if (client !== this.client) continue;
          for (const [mid, sent] of this.pending) { if (mid <= id) { this.pushLatencies.push(Date.now() - sent); this.pending.delete(mid); } }
        }
        break;
      }
      case 'pokeEnd': {
        this.pokes += 1;
        if (!this.firstPokeAt) this.firstPokeAt = Date.now();
        if (!this.hydratedAt && [...this.wanted].every(h => this.got.has(h))) { this.hydratedAt = Date.now(); this.resolveReady(); }
        break;
      }
      case 'pushResponse': {
        if (body.error) this.errors.push({ kind: 'push', message: JSON.stringify(body).slice(0, 200) });
        for (const m of body.mutations ?? []) { if (m.result && 'error' in m.result) this.errors.push({ kind: 'mutation', message: JSON.stringify(m.result).slice(0, 200) }); }
        this.settle();
        break;
      }
      case 'error': this.errors.push(body); if (body.kind === 'PushFailed') this.settle(); else this.resolveReady(); break;
      case 'transformError': {
        this.errors.push({ kind: 'transform', message: JSON.stringify(body).slice(0, 300) });
        for (const refused of Array.isArray(body) ? body : []) { if (refused && refused.id) this.wanted.delete(refused.id); }
        if (!this.hydratedAt && [...this.wanted].every(h => this.got.has(h))) { this.hydratedAt = Date.now(); this.resolveReady(); }
        break;
      }
      default: break;
    }
  }
  send(m) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  /// One push carrying `mutations` (a list of `[name, args]`), the way a client
  /// flushes its pending queue; the returned promise resolves when the response
  /// (or a `PushFailed`) arrives, or rejects after `PUSH_TIMEOUT`. One at a time.
  push(mutations) {
    if (this.inflight) throw new Error(`${this.name}: a push is already in flight`);
    const now = Date.now();
    const list = mutations.map(([name, args]) => { this.mutationId += 1; this.pending.set(this.mutationId, now); return { type: 'custom', id: this.mutationId, clientID: this.client, name, args: [args], timestamp: now }; });
    this.send(['push', { clientGroupID: this.group, mutations: list, pushVersion: 1, timestamp: now, requestID: `${this.name}-${this.mutationId}` }]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.inflight = null; this.timedOut += 1; reject(new Error(`${this.name}: no push response within ${PUSH_TIMEOUT} ms`)); }, PUSH_TIMEOUT);
      this.inflight = () => { clearTimeout(timer); this.inflight = null; resolve(); };
    });
  }
  /// A push response (or failure) arrived.
  settle() { const done = this.inflight; if (done) done(); }
  close() { try { this.ws.close(1000); } catch { /* closed */ } }
}

/// Everything the run learns, in one place.
const run = {
  label: LABEL, started: new Date().toISOString(),
  config: { CONNECTIONS, USERS, WRITERS, BATCH, SEED_BATCH, SEED, SEED_REPLIES, THREADS, RATE, DURATION, REPLY_SHARE, CHANNELS, GATEWAY },
  phases: {}, receive: [], receiveThread: [], expected: 0, expectedThread: 0, sent: 0, sentThread: 0, mutationErrors: 0,
};
/// Where a delivered row's send time is read from: the ids are client-chosen, so
/// the writer stamps its send time into the conversation id (`lcv-<t36>-<n>`) of a
/// new conversation and the message id (`lm-r-<t36>-<n>`) of a thread reply.
const stampOf = (table, value) => {
  const m = table === 'conversations' ? /^lcv-([0-9a-z]+)-\d+$/.exec(value.conversationId ?? '') : table === 'messages' ? /^lm-r-([0-9a-z]+)-\d+$/.exec(value.messageId ?? '') : null;
  return m ? { kind: table === 'conversations' ? 'c' : 'r', sent: parseInt(m[1], 36), key: `${table}:${table === 'messages' ? value.messageId : value.conversationId}` } : null;
};
let steadyStart = Infinity;
const sinkFor = () => ({
  onPut(conn, table, value) {
    if (DUMP) { run.tables ??= {}; run.tables[table] = (run.tables[table] ?? 0) + 1; }
    const stamp = stampOf(table, value);
    if (!stamp || stamp.sent < steadyStart || conn.seenKeys.has(stamp.key)) return;
    conn.seenKeys.add(stamp.key);
    const delay = Date.now() - stamp.sent;
    if (stamp.kind === 'c') run.receive.push(delay); else { run.receiveThread.push(delay); if (DUMP) { run.threadDetail ??= {}; (run.threadDetail[value.conversationId] ??= { expected: 0, received: 0 }).received += 1; } }
  },
});

// ---- 1. setup -------------------------------------------------------------------
const phase = (name) => {
  const start = Date.now();
  log(`== ${name}`);
  return () => {
    run.phases[name] = { ...(run.phases[name] ?? {}), ms: Date.now() - start };
    log(`== ${name} done in ${Date.now() - start} ms`);
  };
};
let done = phase('setup');
const users = [];
/// The identities: the pool's first `--users` entries, or that many test logins.
if (AUTH_POOL) {
  const pool = JSON.parse(readFileSync(AUTH_POOL, 'utf8'));
  for (let i = 0; i < USERS; i++) { const entry = pool[i % pool.length]; users.push({ cookie: '', token: entry.token, userId: entry.userID, workspaceId: entry.workspaceID, email: entry.email ?? entry.userID }); }
} else {
  for (let i = 0; i < USERS; i++) users.push(await login(`test-user-email-9${String(i).padStart(3, '0')}@xyne-test.local`));
}
const workspaceId = users[0].workspaceId;
const channelId = CHANNEL || psql(`select id from channels where "workspaceId"='${workspaceId}' and "scopeType"='DEFAULT' order by "createdAt" limit 1`);
if (!channelId) fail('no DEFAULT channel in the workspace');
/// The channels the subscribers and the writes are spread over: the primary
/// one first, then `load-ch-<k>`, each a copy of the primary with its own id and
/// name, created when missing.
const channelIds = [channelId];
for (let k = 1; k < CHANNELS; k++) {
  const name = `load-ch-${k}`;
  let id = psql(`select id from channels where "workspaceId"='${workspaceId}' and name='${name}' limit 1`);
  if (!id) {
    id = `ch-load-${k}-${randomUUID().slice(0, 8)}`;
    psql(`insert into channels select (json_populate_record(c, '${JSON.stringify({ id, name }).replace(/'/g, "''")}'::json)).* from channels c where id='${channelId}'`);
  }
  channelIds.push(id);
}
for (const u of users) for (const id of channelIds) ensureMember(u, id);
/// The channel of subscriber `i` and of write `i`.
const channelOf = (i) => channelIds[i % CHANNELS];
/// How many subscribers listen to channel `k`.
const listeners = (k) => Math.floor(CONNECTIONS / CHANNELS) + (k < CONNECTIONS % CHANNELS ? 1 : 0);
log(`${users.length} users are members of ${channelIds.length} channel(s) (${channelId}${CHANNELS > 1 ? ' and ' + (CHANNELS - 1) + ' more' : ''})`);
/// The server's own measurements (its /stats endpoint), or null.
async function serverStats(reset) {
  try {
    const response = await fetch(STATS + (reset ? '?reset=1' : ''));
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
const writerPatch = [{ op: 'put', hash: 'w-channels', name: 'userVisibleChannelsV3', args: [], ttl: 300000 }];
const writers = [];
for (let i = 0; i < WRITERS; i++) writers.push(new Conn(`W${i}`, users[i % users.length], writerPatch, sinkFor('writer')));
await Promise.all(writers.map(w => w.ready));
if (writers.some(w => w.errors.length)) fail('writer connection error: ' + JSON.stringify(writers.flatMap(w => w.errors).slice(0, 2)));
const sampler = (PID || CONTAINER) ? setInterval(sample, 1000) : null;
done();

// ---- 2. seed --------------------------------------------------------------------
const conversations = [];
/// Run `total` mutations across the writers, `batch` per push, each writer with
/// one push in flight; `make(i)` returns `[name, args]` and is called in order.
/// Returns the elapsed milliseconds; a push that times out is counted and skipped.
async function drive(total, batch, make) {
  let next = 0;
  const started = Date.now();
  await Promise.all(writers.map(async (w) => {
    while (next < total) {
      const count = Math.min(batch, total - next);
      const mutations = Array.from({ length: count }, () => make(next++, w));
      try { await w.push(mutations); } catch (error) { log(error.message); }
    }
  }));
  return Date.now() - started;
}
if (SEED > 0) {
  done = phase('seed');
  const ms = await drive(SEED, SEED_BATCH, (i) => {
    const conversationId = 'lcv-seed-' + randomUUID().slice(0, 12);
    conversations.push(conversationId);
    return ['conversations.send', { channelId, content: `seed ${i} ${'x'.repeat(120)}`, type: 'USER', conversationId, messageId: 'lm-' + randomUUID().slice(0, 12), timestamp: Date.now() }];
  });
  run.phases.seed = { ms, mutations: SEED, per_second: Math.round(SEED / (ms / 1000)), push_latency: stats(writers.flatMap(w => w.pushLatencies)) };
  log(`seeded ${SEED} conversations in ${ms} ms (${run.phases.seed.per_second}/s); push→lmid ${fmt(run.phases.seed.push_latency)}`);
  for (const w of writers) w.pushLatencies.length = 0;
} else {
  conversations.push(...psql(`select "conversationId" from conversations where "channelId"='${channelId}' order by "createdAt" desc limit 200`).split('\n').filter(Boolean));
  log(`${conversations.length} existing conversations in the channel`);
}
const threadPool = conversations.slice(0, Math.max(THREADS * 4, 20));
if (SEED_REPLIES > 0 && threadPool.length) {
  done = phase('seed-replies');
  const ms = await drive(SEED_REPLIES, SEED_BATCH, (i) => ['messages.send', { conversationId: threadPool[i % threadPool.length], content: `seed reply ${i} ${'y'.repeat(80)}`, type: 'USER', timestamp: Date.now(), messageId: 'lm-seed-' + randomUUID().slice(0, 12) }]);
  run.phases['seed-replies'] = { ms, mutations: SEED_REPLIES, per_second: Math.round(SEED_REPLIES / (ms / 1000)), threads: threadPool.length, push_latency: stats(writers.flatMap(w => w.pushLatencies)) };
  log(`seeded ${SEED_REPLIES} replies over ${threadPool.length} threads in ${ms} ms (${run.phases['seed-replies'].per_second}/s)`);
  for (const w of writers) w.pushLatencies.length = 0;
}

// ---- 3. hydrate -----------------------------------------------------------------
done = phase('hydrate');
const subscribers = [];
const subscriberPatch = (i) => [
  { op: 'put', hash: 'q-channels', name: 'userVisibleChannelsV3', args: [], ttl: 300000 },
  { op: 'put', hash: 'q-latest', name: 'channelLatestMultipleConversationsV3', args: [{ channelId: channelOf(i), isMember: true, limit: 25 }], ttl: 300000 },
  { op: 'put', hash: 'q-page', name: 'channelConversationsPaginatedV3', args: [{ channelId: channelOf(i), isMember: true, start: { createdAt: Date.now() - 3_600_000 }, direction: 'forward', limit: 50 }], ttl: 300000 },
  { op: 'put', hash: 'q-users', name: 'getUsersV2', args: [{ lastUpdatedAt: 0 }], ttl: 300000 },
  { op: 'put', hash: 'q-unread', name: 'userUnreadActivities', args: [], ttl: 300000 },
  ...Array.from({ length: Math.min(THREADS, threadPool.length) }, (_, k) => {
    const conversationId = threadPool[(i * THREADS + k) % threadPool.length];
    return { op: 'put', hash: `q-thread-${conversationId}`, name: THREAD_QUERY, args: [{ conversationId }], ttl: 300000 };
  }),
];
for (let i = 0; i < CONNECTIONS; i++) {
  subscribers.push(new Conn(`S${i}`, users[i % users.length], subscriberPatch(i), sinkFor('subscriber')));
  if (i % 100 === 99) await sleep(10);
}
const hydrateDeadline = Date.now() + 120_000;
await Promise.race([Promise.all(subscribers.map(s => s.ready)), sleep(120_000)]);
const hydrated = subscribers.filter(s => s.hydratedAt);
const hydrateMs = Date.now() - (hydrateDeadline - 120_000);
const queriesEach = subscriberPatch(0).length;
const openedFirst = Math.min(...subscribers.map(s => s.opened));
const hydratedLast = hydrated.length ? Math.max(...hydrated.map(s => s.hydratedAt)) : openedFirst;
const registrationMs = Math.max(1, hydratedLast - openedFirst);
run.phases.hydrate = {
  ms: hydrateMs, connections: CONNECTIONS, hydrated: hydrated.length,
  queries_each: queriesEach,
  subscriptions: CONNECTIONS * queriesEach,
  registration_ms: registrationMs,
  queries_per_second: Math.round((hydrated.length * queriesEach) / (registrationMs / 1000)),
  errors: subscribers.filter(s => s.errors.length).length,
  to_connected: stats(subscribers.filter(s => s.connectedAt).map(s => s.connectedAt - s.opened)),
  to_first_poke: stats(subscribers.filter(s => s.firstPokeAt).map(s => s.firstPokeAt - s.opened)),
  to_hydrated: stats(hydrated.map(s => s.hydratedAt - s.opened)),
  rows_per_connection: stats(subscribers.map(s => s.rows)), kb_per_connection: stats(subscribers.map(s => Math.round(s.bytes / 1024))),
};
log(`hydrated ${hydrated.length}/${CONNECTIONS} holding ${run.phases.hydrate.subscriptions} subscriptions (${run.phases.hydrate.queries_each} queries each; ${run.phases.hydrate.queries_per_second} registered/s over ${registrationMs} ms); connected ${fmt(run.phases.hydrate.to_connected)}; first poke ${fmt(run.phases.hydrate.to_first_poke)}; all queries got ${fmt(run.phases.hydrate.to_hydrated)}; rows/conn p50=${run.phases.hydrate.rows_per_connection.p50} kb/conn p50=${run.phases.hydrate.kb_per_connection.p50}`);
if (run.phases.hydrate.errors) log('connection errors:', JSON.stringify(subscribers.flatMap(s => s.errors).slice(0, 3)));
done();

// ---- 4. steady ------------------------------------------------------------------
done = phase('steady');
const threadSubscribers = new Map();
for (const s of subscribers) for (const h of s.wanted) if (h.startsWith('q-thread-')) { const id = h.slice(9); threadSubscribers.set(id, (threadSubscribers.get(id) ?? 0) + 1); }
const total = Math.round(RATE * DURATION);
await serverStats(true);
steadyStart = Date.now();
let seq = 0;
/// Write the steady phase's rows straight into PostgreSQL, `--tps` transactions
/// a second carrying `--rate` rows a second between them: what the mutators
/// write, without the application server in the path, so the measurement is this
/// server's own pipeline. Timestamps go in as UTC, the way the application's own
/// writes store them, so the rows sort together.
async function driveSql(total) {
  const author = users[0];
  const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;
  const perBatch = Math.max(1, Math.round(RATE / TPS));
  const deadline = steadyStart + DURATION * 1000 + 5_000;
  let done = 0;
  let due = steadyStart;
  let failures = 0;
  while (done < total && Date.now() < deadline) {
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    const count = Math.min(perBatch, total - done);
    const now = Date.now();
    const rows = [];
    const messages = [];
    for (let k = 0; k < count; k++) {
      const i = done + k;
      const conversationId = `lcv-${now.toString(36)}-${i}`;
      const messageId = `lm-c-${now.toString(36)}-${i}`;
      run.sent += 1; run.expected += listeners(i % CHANNELS);
      rows.push(`(${quote(conversationId)}, ${quote(channelOf(i))}, ${quote(author.userId)}, ${quote(messageId)}, ${quote(workspaceId)}, (now() at time zone 'utc'))`);
      messages.push(`(${quote(messageId)}, ${quote(conversationId)}, ${quote(author.userId)}, ${quote(workspaceId)}, ${quote(`load conversation ${i} by sql`)}, (now() at time zone 'utc'))`);
    }
    const sql = `SET statement_timeout = '5s'; BEGIN; INSERT INTO messages ("messageId", "conversationId", "senderId", "workspaceId", content, "createdAt") VALUES ${messages.join(', ')}; INSERT INTO conversations ("conversationId", "channelId", "createdBy", "initialMessageId", "workspaceId", "createdAt") VALUES ${rows.join(', ')}; COMMIT;`;
    try {
      await new Promise((resolve, reject) => {
        execFile('psql', [PG, '-q', '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], { timeout: 10_000 }, (error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      failures += 1;
      if (failures <= 3) log('sql batch failed:', String(error.message).replace(/\s+/g, ' ').slice(0, 200));
    }
    done += count;
    due += (1000 * count) / RATE;
  }
  run.phases.sql_writer = { rows: done, batches_failed: failures, finished_early: done < total };
  if (done < total) log(`sql writer stopped at ${done} of ${total} rows (deadline)`);
}

/// The next mutation of the steady phase: a thread reply or a new conversation.
function nextMutation(w) {
  const i = seq++;
  const now = Date.now();
  if (Math.random() < REPLY_SHARE && threadPool.length) {
    const conversationId = threadPool[i % threadPool.length];
    run.sentThread += 1; run.expectedThread += threadSubscribers.get(conversationId) ?? 0;
    if (DUMP) { run.threadDetail ??= {}; (run.threadDetail[conversationId] ??= { expected: 0, received: 0 }).expected += threadSubscribers.get(conversationId) ?? 0; }
    return ['messages.send', { conversationId, content: `load reply ${i} from ${w.name}`, type: 'USER', timestamp: now, messageId: `lm-r-${now.toString(36)}-${i}` }];
  }
  const conversationId = `lcv-${now.toString(36)}-${i}`;
  run.sent += 1; run.expected += listeners(i % CHANNELS);
  return ['conversations.send', { channelId: channelOf(i), content: `load conversation ${i} from ${w.name}`, type: 'USER', conversationId, messageId: 'lm-c-' + randomUUID().slice(0, 12), timestamp: now }];
}
if (WRITES === 'sql') {
  await driveSql(total);
} else {
  await Promise.all(writers.map(async (w, k) => {
    const perWriter = RATE / writers.length;
    let due = steadyStart + (k * 1000) / RATE;
    while (seq < total && Date.now() - steadyStart < DURATION * 1000 + 5_000) {
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
      if (seq >= total) break;
      const count = Math.min(BATCH, total - seq);
      const mutations = Array.from({ length: count }, () => nextMutation(w));
      try { await w.push(mutations); } catch (error) { log(error.message); }
      due += (1000 * count) / perWriter;
    }
  }));
}
const steadyMs = Date.now() - steadyStart;
done();

// ---- 5. drain -------------------------------------------------------------------
done = phase('drain');
const target = run.expected + run.expectedThread;
for (let i = 0; i < 100 && run.receive.length + run.receiveThread.length < target; i++) await sleep(100);
if (sampler) clearInterval(sampler);
run.mutationErrors = writers.reduce((n, w) => n + w.errors.filter(e => e.kind === 'mutation' || e.kind === 'push' || e.kind === 'PushFailed').length, 0);
run.pushTimeouts = writers.reduce((n, w) => n + w.timedOut, 0);
run.phases.steady = {
  ms: steadyMs, mutations: run.sent + run.sentThread, per_second: Math.round((run.sent + run.sentThread) / (steadyMs / 1000)),
  push_latency: stats(writers.flatMap(w => w.pushLatencies)),
  conversation_fanout: { sent: run.sent, expected: run.expected, received: run.receive.length, delivery: stats(run.receive) },
  thread_fanout: { sent: run.sentThread, expected: run.expectedThread, received: run.receiveThread.length, delivery: stats(run.receiveThread) },
  subscriber_rows: stats(subscribers.map(s => s.rows)), subscriber_kb: stats(subscribers.map(s => Math.round(s.bytes / 1024))),
  dropped_connections: subscribers.filter(s => s.closed).length,
  process: samples.length ? { cpu_mean: Math.round(samples.reduce((a, s) => a + s.cpu, 0) / samples.length), cpu_max: Math.max(...samples.map(s => s.cpu)), rss_mb_max: Math.max(...samples.map(s => s.rss_mb)) } : null,
};
run.server = await serverStats(false);
const st = run.phases.steady;
log(`steady: ${st.mutations} mutations in ${st.ms} ms (${st.per_second}/s); push→lmid ${fmt(st.push_latency)}`);
log(`channel fan-out: ${st.conversation_fanout.received}/${st.conversation_fanout.expected} rows delivered; ${fmt(st.conversation_fanout.delivery)}`);
log(`thread fan-out: ${st.thread_fanout.received}/${st.thread_fanout.expected} rows delivered; ${fmt(st.thread_fanout.delivery)}`);
log(`dropped connections: ${st.dropped_connections}; mutation errors: ${run.mutationErrors}; push timeouts: ${run.pushTimeouts}; process: ${JSON.stringify(st.process)}`);
if (run.server) {
  const us = (name) => { const h = run.server.stages_us[name]; return `${h.p50_us}/${h.p99_us}`; };
  const c = run.server.counts;
  log(`server stages p50/p99 µs: feed→engine ${us('feed_to_engine')}, engine ${us('engine_step')}, engine→groups ${us('engine_to_groups')}, flush ${us('groups_flush')}, groups→socket ${us('groups_to_socket')}, end-to-end ${us('end_to_end')}; transactions ${c.transactions}, pokes ${c.pokes}, frames ${c.frames}, rows serialized ${c.rows_serialized}, shared ${c.rows_shared}`);
}
if (run.mutationErrors) log('first errors:', JSON.stringify(writers.flatMap(w => w.errors).slice(0, 3)));
if (DUMP) { log('conversation samples:', JSON.stringify(run.samples)); log('puts per table:', JSON.stringify(run.tables)); log('threads:', JSON.stringify(Object.entries(run.threadDetail ?? {}).filter(([, v]) => v.expected !== v.received).map(([k, v]) => `${k}: ${v.received}/${v.expected} subs=${threadSubscribers.get(k)}`))); }
for (const c of [...writers, ...subscribers]) c.close();
done();
run.finished = new Date().toISOString();
if (OUT) {
  const report = RAW ? run : { ...run, receive: undefined, receiveThread: undefined };
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  log('wrote', OUT);
}
const ok = st.dropped_connections === 0 && run.mutationErrors === 0 && run.pushTimeouts === 0 && st.conversation_fanout.received >= st.conversation_fanout.expected * 0.999;
log(ok ? 'PASS' : 'FAIL');
setTimeout(() => process.exit(ok ? 0 : 1), 200);
