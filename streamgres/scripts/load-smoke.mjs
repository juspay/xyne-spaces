#!/usr/bin/env node
// A self-contained load on a running sync server, with nothing of the application
// behind it (the table of scripts/smoke.mjs, prepared with `smoke.mjs --prepare`, and a
// server started with STREAMGRES_ROW_LIMIT of at least 600 and STREAMGRES_QUERY_URL at
// http://127.0.0.1:<SMOKE_APP_PORT>/query, the query endpoint this script serves, as
// smoke.mjs does, since the server takes no AST from a client). Every connection is a
// client group of its own holding one of ten 40-row buckets of the table; one psql
// session then writes `--writes` updates a second for `--duration` seconds, each reaching
// the tenth of the connections that hold its bucket (so the load generator, one process,
// is not what is measured), and the time from handing a write to psql until a client
// holds it is what is measured.
// With `--away N`, N of the connections then leave, the writes go on for `--away-s`
// seconds, and they come back with their cookies: how they were answered (caught up from
// their cookie, or told to start over) and how long until they hold the latest write.
//
//   node scripts/load-smoke.mjs --connections 300 --writes 100 --duration 20 [--away 100]
//
// Prints one JSON object: deliveries, latency percentiles in ms, and the server's own
// stage timings and thread CPU from /stats over the run. Node 22 or later.

import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const label = (() => { const i = process.argv.indexOf('--label'); return i > 0 ? process.argv[i + 1] : ''; })();
const PID = arg('pid', 0);
const CONNECTIONS = arg('connections', 100), WRITES = arg('writes', 100), DURATION = arg('duration', 20), AWAY = arg('away', 0), AWAY_S = arg('away-s', 5);
const PG = process.env.SMOKE_PG ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const GATEWAY = process.env.SMOKE_GATEWAY ?? 'ws://localhost:4848/sync';
const HTTP = process.env.SMOKE_HTTP ?? 'http://localhost:4848';
const APP_PORT = Number(process.env.SMOKE_APP_PORT ?? 4849);
const bucket = (n) => ({ table: 'smoke_items', where: { type: 'simple', op: '=', left: { type: 'column', name: 'bucket' }, right: { type: 'literal', value: `b${n % 10}` } }, orderBy: [['id', 'asc']] });

/// The query endpoint the sync server asks for each query's AST: `bucket` takes the
/// connection's index as its argument.
const app = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'POST' || path !== '/query') { response.writeHead(404).end(); return; }
    const [tag, requests] = JSON.parse(body);
    if (tag !== 'transform') { response.writeHead(400).end(); return; }
    const answered = requests.map(({ id, name, args }) => (name === 'bucket' ? { id, name, ast: bucket(Number(args?.[0] ?? 0)) } : { error: 'app', id, name, message: `no query named ${name}` }));
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ kind: 'QueryResponse', queries: answered }));
  });
});
await new Promise((resolve, reject) => { app.once('error', reject); app.listen(APP_PORT, '127.0.0.1', resolve); });
const fail = (why) => { console.error('FAIL:', why); process.exit(1); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (sorted, p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10 : null);

const sentAt = new Map();
const perBucket = new Array(10).fill(0);
const latencies = [];
let highest = 0;

/// One connection; `resume` makes it the same client group coming back with its cookie.
function connect(index, resume) {
  const state = resume ?? { index, group: `g-load-${index}-${randomUUID().slice(0, 8)}`, cookie: '', hydrated: false, seen: 0 };
  state.errors = []; state.closed = false; state.firstBase = undefined; state.putsSinceConnect = 0;
  const init = ['initConnection', { desiredQueriesPatch: [{ op: 'put', hash: 'open', name: 'bucket', args: [index], ttl: 300000 }] }];
  const sec = encodeURIComponent(Buffer.from(JSON.stringify({ initConnectionMessage: init })).toString('base64'));
  const url = `${GATEWAY}/sync/v51/connect?clientID=c-${state.group}&clientGroupID=${state.group}&userID=load&baseCookie=${encodeURIComponent(state.cookie)}&ts=1&lmid=0&wsid=w${index}-${Date.now() % 100000}`;
  const ws = new WebSocket(url, [sec]);
  state.ws = ws;
  ws.addEventListener('message', (event) => {
    const now = performance.now();
    const [tag, body] = JSON.parse(event.data);
    if (tag === 'pokeStart') { if (state.firstBase === undefined) state.firstBase = body.baseCookie; }
    else if (tag === 'pokePart') {
      for (const op of body.rowsPatch ?? []) {
        if (op.op !== 'put') continue;
        state.putsSinceConnect += 1;
        const seq = op.value.points;
        if (seq >= 1_000_000) { state.seen = Math.max(state.seen, seq); const at = sentAt.get(seq); if (at !== undefined && state.measuring) latencies.push(now - at); }
      }
      if ((body.gotQueriesPatch ?? []).some((g) => g.hash === 'open')) state.hydrated = true;
    } else if (tag === 'pokeEnd') { state.cookie = body.cookie; }
    else if (tag === 'error') { state.errors.push(body.kind); }
  });
  ws.addEventListener('close', () => { state.closed = true; });
  return state;
}

/// Writes at `rate` a second for `seconds`, through one psql session.
async function write(psql, rate, seconds) {
  const gap = 1000 / rate; const started = performance.now(); let n = 0;
  while (performance.now() - started < seconds * 1000) {
    highest += 1; const seq = 1_000_000 + highest;
    sentAt.set(seq, performance.now());
    psql.stdin.write(`UPDATE smoke_items SET points = ${seq} WHERE id = 'seed-${1 + (highest % 400)}';\n`);
    perBucket[(1 + (highest % 400)) % 10] += 1;
    n += 1;
    const due = started + n * gap; const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
  }
  return n;
}

/// The server process's CPU time so far, in seconds, when `--pid` names it.
const cpuSeconds = () => {
  if (!PID) return null;
  const text = execFileSync('ps', ['-o', 'time=', '-p', String(PID)]).toString().trim();
  const parts = text.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
};
const stats = async (reset) => (await fetch(`${HTTP}/stats${reset ? '?reset=1' : ''}`)).json();
const clients = Array.from({ length: CONNECTIONS }, (_, i) => connect(i));
const hydrateStarted = performance.now();
while (!clients.every((c) => c.hydrated)) {
  if (clients.some((c) => c.errors.length)) fail('a connection was refused: ' + clients.find((c) => c.errors.length).errors[0]);
  if (performance.now() - hydrateStarted > 120000) fail('hydration did not finish in two minutes');
  await sleep(50);
}
const hydrateMs = Math.round(performance.now() - hydrateStarted);
const psql = spawn('psql', [PG, '-q', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'ignore', 'inherit'] });
await write(psql, WRITES, 2);
await sleep(500);
await stats(true);
for (const c of clients) c.measuring = true;
const cpuBefore = cpuSeconds();
perBucket.fill(0);
const written = await write(psql, WRITES, DURATION);
const expected = clients.reduce((n, c) => n + perBucket[c.index % 10], 0);
const cpuAfter = cpuSeconds();
await sleep(1500);
for (const c of clients) c.measuring = false;
const after = await stats(false);
latencies.sort((a, b) => a - b);
const stage = (name) => { const h = after.stages_us?.[name] ?? {}; return { n: h.count, p50_ms: (h.p50_us ?? 0) / 1000, p99_ms: (h.p99_us ?? 0) / 1000, mean_ms: (h.mean_us ?? 0) / 1000 }; };
const report = {
  label, connections: CONNECTIONS, writes_per_s: WRITES, seconds: DURATION, hydrate_all_ms: hydrateMs,
  written, expected_deliveries: expected, delivered: latencies.length,
  latency_ms: { p50: pct(latencies, 0.5), p90: pct(latencies, 0.9), p99: pct(latencies, 0.99), max: pct(latencies, 1) },
  server: { end_to_end: stage('end_to_end'), groups_flush: stage('groups_flush'), engine_step: stage('engine_step'), engine_to_groups: stage('engine_to_groups'), groups_to_socket: stage('groups_to_socket') },
  server_cpu_s_over_the_window: PID ? Math.round((cpuAfter - cpuBefore) * 100) / 100 : null, cpu_s: after.threads_cpu_s, rss_mb: Math.round((after.gauges?.process_rss_bytes ?? 0) / 1048576), pokes: after.counts?.pokes, rows_serialized: after.counts?.rows_serialized, rows_shared: after.counts?.rows_shared,
};

if (AWAY > 0) {
  const leaving = clients.slice(0, AWAY);
  for (const c of leaving) c.ws.close();
  while (!leaving.every((c) => c.closed)) await sleep(20);
  const missed = await write(psql, WRITES, AWAY_S);
  await sleep(300);
  const latest = new Array(10).fill(0);
  for (let n = highest; n > highest - 400 && n > 0; n -= 1) { const b = (1 + (n % 400)) % 10; if (!latest[b]) latest[b] = 1_000_000 + n; }
  const backStarted = performance.now();
  const back = leaving.map((c) => connect(c.index, c));
  const deadline = performance.now() + 60000;
  const current = (c) => c.seen >= latest[c.index % 10];
  while (!back.every((c) => current(c) || c.errors.length) && performance.now() < deadline) await sleep(10);
  const caughtUp = back.filter((c) => current(c) && !c.errors.length);
  report.away = {
    connections: AWAY, seconds_away: AWAY_S, writes_missed: missed,
    caught_up_from_their_cookie: caughtUp.filter((c) => c.firstBase !== null && c.firstBase !== undefined).length,
    told_to_start_over: back.filter((c) => c.errors.length).length,
    ms_until_all_hold_the_latest_write: Math.round(performance.now() - backStarted),
    puts_per_returning_connection: caughtUp.length ? Math.round(caughtUp.reduce((n, c) => n + c.putsSinceConnect, 0) / caughtUp.length) : null,
    connects: Object.fromEntries(Object.entries((await stats(false)).counts ?? {}).filter(([k]) => k.startsWith('connects_'))),
  };
}
console.log(JSON.stringify(report, null, 1));
psql.stdin.end();
for (const c of clients) c.ws?.close();
setTimeout(() => process.exit(0), 300);
