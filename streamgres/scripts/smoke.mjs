#!/usr/bin/env node
// A self-contained check of a running sync server, with nothing of the application
// behind it: a PostgreSQL with `wal_level = logical`, the server, and this script as
// both the client speaking the sync protocol and the application server the sync
// server asks for each query's AST (the server takes no AST from a client). It creates
// one table, subscribes, and checks that the rows hydrate, that an insert, an update out of
// the filter and a delete made straight in PostgreSQL arrive as pokes, that a JSON
// column is filtered by value however the stored value was spelled (a number with a
// padded fraction, a `json` object with its own spacing and key order), that the feed
// keeps being heard while nobody writes, that a client which comes back after writes is sent
// what it missed from its cookie, that a tab joining a live client group without a
// cookie is sent the group's state while the first tab goes on hearing, that a tab
// behind its group is sent the pokes it missed, that a client whose schema the server
// cannot serve is refused, that a read of more than half the row limit is reported by
// query name, and, when SMOKE_COLLECTOR is given, that the collector has received the
// server's metrics over OTLP. Exits 0 on PASS.
//
//   node scripts/smoke.mjs            (Node 22 or later: the built-in WebSocket)
//
// Environment: SMOKE_PG (postgresql://postgres:postgres@localhost:5432/postgres),
// SMOKE_GATEWAY (ws://localhost:4848/sync), SMOKE_HTTP (http://localhost:4848),
// STREAMGRES_APP_ID (xyne) and STREAMGRES_SHARD (0), which name the `<app>_<shard>` schema,
// SMOKE_COLLECTOR (the collector's Prometheus endpoint, http://localhost:9464/metrics;
// unset skips that check), and SMOKE_APP_PORT (4849), where this script serves the
// query endpoint: the server must run with STREAMGRES_QUERY_URL pointing at
// http://127.0.0.1:<SMOKE_APP_PORT>/query. The server is expected to run with
// STREAMGRES_ROW_LIMIT=600, so the 400 seeded rows make a heavy read. The table must
// exist before the server starts (it reads the catalog once): run with `--prepare` first.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PG = process.env.SMOKE_PG ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const GATEWAY = process.env.SMOKE_GATEWAY ?? 'ws://localhost:4848/sync';
const METRICS_PREFIX = process.env.STREAMGRES_METRICS_PREFIX ?? 'xyne_sync';
const metric = (name) => `${METRICS_PREFIX}_${name}`;
const HTTP = process.env.SMOKE_HTTP ?? 'http://localhost:4848';
const COLLECTOR = process.env.SMOKE_COLLECTOR;
const APP_PORT = Number(process.env.SMOKE_APP_PORT ?? 4849);
const SEEDED = 400;
const t0 = Date.now();
const log = (...a) => console.log(`${String(Date.now() - t0).padStart(6)}ms`, ...a);
const fail = (why) => { console.error('FAIL:', why); process.exit(1); };
const sql = (text) => execFileSync('psql', [PG, '-v', 'ON_ERROR_STOP=1', '-Atc', text]).toString().trim();

if (process.argv.includes('--prepare')) {
  sql(`DROP TABLE IF EXISTS smoke_items;
       CREATE TABLE smoke_items (id text PRIMARY KEY, status text NOT NULL, points integer NOT NULL, meta jsonb, tag jsonb, score jsonb, loose json, bucket text, "createdAt" timestamptz NOT NULL DEFAULT now());
       INSERT INTO smoke_items (id, status, points, meta, tag, score, loose, bucket) SELECT 'seed-' || n, 'OPEN', n, jsonb_build_object('n', n), to_jsonb('t' || (n % 5)), (CASE WHEN n % 5 = 0 THEN '1.50' ELSE '2' END)::jsonb, (CASE WHEN n % 5 = 0 THEN '{ "k":1.50,   "a":[1e1], "k": 1.50 }' ELSE '{"k":2}' END)::json, 'b' || (n % 10) FROM generate_series(1, ${SEEDED}) n;
       INSERT INTO smoke_items (id, status, points) VALUES ('closed-1', 'DONE', 0);`);
  log(`prepared smoke_items with ${SEEDED} open rows and one closed`);
  process.exit(0);
}

/// The queries, by the names the clients ask for them: `column` takes a column and a
/// value as its arguments, the others take none.
const column = (name, value) => ({ table: 'smoke_items', where: { type: 'simple', op: '=', left: { type: 'column', name }, right: { type: 'literal', value } }, orderBy: [['id', 'asc']] });
const queries = {
  open: () => column('status', 'OPEN'),
  tagged: () => column('tag', 't3'),
  column,
};
const put = (hash, name, ...args) => ({ op: 'put', hash, name, args, ttl: 300000 });

/// The application server, as far as the sync server needs one: the query endpoint,
/// answering `["transform", [{id, name, args}...]]` with each query's AST, or an error
/// for a name it does not know. The sync server takes no AST from a client, so every
/// subscription below passes through here.
const app = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'POST' || path !== '/query') { response.writeHead(404).end(); return; }
    const [tag, requests] = JSON.parse(body);
    if (tag !== 'transform') { response.writeHead(400).end(); return; }
    const answered = requests.map(({ id, name, args }) => {
      const make = queries[name];
      return make ? { id, name, ast: make(...(args ?? [])) } : { error: 'app', id, name, message: `no query named ${name}` };
    });
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ kind: 'QueryResponse', queries: answered }));
  });
});
await new Promise((resolve, reject) => { app.once('error', reject); app.listen(APP_PORT, '127.0.0.1', resolve); });
log(`serving the query endpoint at http://127.0.0.1:${APP_PORT}/query`);

/// One connection with its own view of the rows it was sent; `group` and `baseCookie`
/// make it a tab of an existing client group, or a client coming back.
function connect(name, { clientSchema, patch = [], group, baseCookie = '', rows }) {
  const state = { name, rows: rows ?? new Map(), got: new Set(), pokes: 0, puts: 0, cookie: null, bases: [], errors: [], closed: false, waiters: [] };
  const init = ['initConnection', { desiredQueriesPatch: patch, ...(clientSchema ? { clientSchema } : {}) }];
  const sec = encodeURIComponent(Buffer.from(JSON.stringify({ initConnectionMessage: init })).toString('base64'));
  state.group = group ?? `g-${name}-${randomUUID().slice(0, 8)}`;
  const url = `${GATEWAY}/sync/v51/connect?clientID=c-${name}&clientGroupID=${state.group}&userID=smoke&baseCookie=${encodeURIComponent(baseCookie)}&ts=1&lmid=0&wsid=${name}`;
  const ws = new WebSocket(url, [sec]);
  state.ws = ws;
  const wake = () => { state.waiters = state.waiters.filter((w) => !w()); };
  ws.addEventListener('message', (event) => {
    const [tag, body] = JSON.parse(event.data);
    if (tag === 'pokeStart') { state.bases.push(body.baseCookie); } else if (tag === 'pokePart') {
      for (const op of body.rowsPatch ?? []) {
        if (op.op === 'put') { state.rows.set(op.value.id, op.value); state.puts += 1; }
        if (op.op === 'del') state.rows.delete(op.id.id);
      }
      for (const op of body.gotQueriesPatch ?? []) { if (op.op === 'put') state.got.add(op.hash); }
    } else if (tag === 'pokeEnd') { state.pokes += 1; state.cookie = body.cookie; } else if (tag === 'error') { state.errors.push(body); }
    wake();
  });
  ws.addEventListener('close', () => { state.closed = true; wake(); });
  ws.addEventListener('error', () => wake());
  state.until = (what, test, ms = 15000) => new Promise((resolve) => {
    const timer = setTimeout(() => fail(`${name}: timed out waiting for ${what}`), ms);
    const check = () => { if (!test(state)) return false; clearTimeout(timer); resolve(state); return true; };
    if (!check()) state.waiters.push(check);
  });
  return state;
}

const a = connect('A', { patch: [put('open', 'open')] });
await a.until('hydration', (s) => s.got.has('open'));
if (a.errors.length) fail('A was refused: ' + JSON.stringify(a.errors[0]));
if (a.rows.size !== SEEDED) fail(`A hydrated ${a.rows.size} rows, expected ${SEEDED}`);
const seed = a.rows.get('seed-7');
if (seed?.points !== 7 || seed?.meta?.n !== 7 || typeof seed?.createdAt !== 'number') fail('a row did not arrive whole and typed: ' + JSON.stringify(seed));
log(`A hydrated ${a.rows.size} rows, whole and typed (json embedded, time as milliseconds)`);

sql(`INSERT INTO smoke_items (id, status, points) VALUES ('live-1', 'OPEN', 1), ('live-closed', 'DONE', 2)`);
await a.until('the inserted row', (s) => s.rows.has('live-1'));
if (a.rows.has('live-closed')) fail('a row outside the filter was delivered');
sql(`UPDATE smoke_items SET status = 'DONE' WHERE id = 'seed-1'`);
await a.until('the row that left the filter', (s) => !s.rows.has('seed-1'));
sql(`UPDATE smoke_items SET points = 70 WHERE id = 'seed-7'`);
await a.until('the updated row', (s) => s.rows.get('seed-7')?.points === 70);
sql(`DELETE FROM smoke_items WHERE id = 'live-1'`);
await a.until('the deleted row', (s) => !s.rows.has('live-1'));
log('an insert, an update out of the filter, an update in place and a delete all arrived by poke');

const j = connect('J', { patch: [put('tagged', 'tagged')] });
await j.until('the JSON filter', (s) => s.got.has('tagged') || s.errors.length > 0);
if (j.errors.length) fail('a filter on a JSON column was refused: ' + JSON.stringify(j.errors[0]));
if (j.rows.size !== SEEDED / 5 || [...j.rows.values()].some((r) => r.tag !== 't3')) fail(`tag = "t3" delivered ${j.rows.size} rows, expected ${SEEDED / 5}`);
sql(`UPDATE smoke_items SET tag = '"t3"' WHERE id = 'seed-5'`);
await j.until('a row entering the JSON filter', (s) => s.rows.has('seed-5'));
sql(`UPDATE smoke_items SET tag = '"t0"' WHERE id = 'seed-5'`);
await j.until('a row leaving the JSON filter', (s) => !s.rows.has('seed-5'));
j.ws.close();
log(`a JSON column filtered by value: ${SEEDED / 5} rows, and rows enter and leave the filter live`);

const n = connect('N', { patch: [put('scored', 'column', 'score', 1.5), put('loose', 'column', 'loose', { a: [10], k: 1.5 })] });
await n.until('the JSON number and object filters', (s) => (s.got.has('scored') && s.got.has('loose')) || s.errors.length > 0);
if (n.errors.length) fail('a filter on a JSON number or object was refused: ' + JSON.stringify(n.errors[0]));
if (n.rows.size !== SEEDED / 5 || [...n.rows.values()].some((r) => r.score !== 1.5 || r.loose?.k !== 1.5 || r.loose?.a?.[0] !== 10)) fail(`score = 1.5 (stored as 1.50) and loose = {a:[10],k:1.5} (stored with its own spelling) delivered ${n.rows.size} rows, expected ${SEEDED / 5}`);
sql(`UPDATE smoke_items SET score = '1.500', loose = '{"a":[10.0],"k":15e-1}' WHERE id = 'seed-6'`);
await n.until('a row entering the JSON number filter', (s) => s.rows.get('seed-6')?.score === 1.5);
sql(`UPDATE smoke_items SET score = '2', loose = '{"k":2}' WHERE id = 'seed-6'`);
await n.until('a row leaving the JSON number filter', (s) => !s.rows.has('seed-6'));
n.ws.close();
log(`a number stored as 1.50 is found by 1.5, a json object by its value whatever its spelling: ${SEEDED / 5} rows, live changes included`);

const r1 = connect('R1', { patch: [put('open', 'open')] });
await r1.until('hydration', (s) => s.got.has('open'));
const leftAt = r1.cookie;
r1.ws.close();
await r1.until('the close', (s) => s.closed);
sql(`INSERT INTO smoke_items (id, status, points) VALUES ('away-1', 'OPEN', 1), ('away-2', 'OPEN', 2);
     UPDATE smoke_items SET points = 71 WHERE id = 'seed-7'; UPDATE smoke_items SET points = 72 WHERE id = 'seed-7';
     DELETE FROM smoke_items WHERE id = 'away-2'; UPDATE smoke_items SET status = 'DONE' WHERE id = 'seed-9';`);
await new Promise((resolve) => setTimeout(resolve, 1500));
const r2 = connect('R2', { group: r1.group, baseCookie: leftAt, rows: r1.rows, patch: [put('open', 'open')] });
await r2.until('what it missed', (s) => s.errors.length > 0 || (s.rows.has('away-1') && s.rows.get('seed-7')?.points === 72 && !s.rows.has('seed-9')));
if (r2.errors.length) fail('a client back with its cookie was told to start over: ' + JSON.stringify(r2.errors[0]));
if (r2.bases[0] !== leftAt) fail(`the catch-up should start from ${leftAt}, it started from ${r2.bases[0]}`);
if (r2.puts > 5 || r2.rows.has('away-2')) fail(`the catch-up should carry the net of what changed, it carried ${r2.puts} puts`);
log(`a client back after six writes was sent their net from its cookie ${leftAt}: ${r2.puts} puts, no fresh sync`);

const t2 = connect('T2', { group: r1.group, patch: [put('open', 'open')] });
await t2.until('the group\'s state', (s) => s.errors.length > 0 || s.got.has('open'));
if (t2.errors.length) fail('a tab without a cookie was refused by a live group: ' + JSON.stringify(t2.errors[0]));
if (t2.bases[0] !== null || t2.rows.size !== r2.rows.size) fail(`the late tab should hold the group's ${r2.rows.size} rows from nothing, it holds ${t2.rows.size} from ${t2.bases[0]}`);
sql(`INSERT INTO smoke_items (id, status, points) VALUES ('both-1', 'OPEN', 1)`);
await Promise.all([r2.until('the write, at the first tab', (s) => s.rows.has('both-1')), t2.until('the write, at the late tab', (s) => s.rows.has('both-1'))]);
log(`a tab joined the live group without a cookie: sent its ${t2.rows.size - 1} rows, and the first tab went on hearing`);

const behindAt = t2.cookie;
t2.ws.close();
await t2.until('the close', (s) => s.closed);
sql(`INSERT INTO smoke_items (id, status, points) VALUES ('behind-1', 'OPEN', 1)`);
await r2.until('the first missed write', (s) => s.rows.has('behind-1'));
sql(`DELETE FROM smoke_items WHERE id = 'both-1'`);
await r2.until('the second missed write', (s) => !s.rows.has('both-1'));
const t3 = connect('T3', { group: r1.group, baseCookie: behindAt, rows: t2.rows });
await t3.until('the pokes it missed', (s) => s.errors.length > 0 || (s.rows.has('behind-1') && !s.rows.has('both-1')));
if (t3.errors.length) fail('a tab behind its group was told to start over: ' + JSON.stringify(t3.errors[0]));
if (t3.bases[0] !== behindAt || t3.cookie !== r2.cookie || t3.puts > 2) fail(`the tab should be replayed from ${behindAt} to ${r2.cookie}; it went from ${t3.bases[0]} to ${t3.cookie} with ${t3.puts} puts`);
log(`a tab behind its group was sent the ${t3.pokes} pokes it missed, from ${behindAt} to ${t3.cookie}`);
r2.ws.close(); t3.ws.close();

const fits = { tables: { smoke_items: { columns: { id: { type: 'string' }, points: { type: 'number' }, meta: { type: 'json' } }, primaryKey: ['id'] } } };
const b = connect('B', { clientSchema: fits, patch: [put('open', 'open')] });
await b.until('hydration', (s) => s.got.has('open') || s.errors.length > 0);
if (b.errors.length) fail('a fitting client schema was refused: ' + JSON.stringify(b.errors[0]));
const ahead = { tables: { smoke_items: { columns: { id: { type: 'string' }, noSuchColumn: { type: 'string' } }, primaryKey: ['id'] } } };
const c = connect('C', { clientSchema: ahead, patch: [put('open', 'open')] });
await c.until('the refusal', (s) => s.closed);
if (c.errors[0]?.kind !== 'SchemaVersionNotSupported' || c.pokes > 0) fail('a client ahead of the database was not refused as the reference server refuses it: ' + JSON.stringify(c.errors));
log('a fitting client schema was served and one naming an unknown column was refused with SchemaVersionNotSupported');

const stats = await (await fetch(`${HTTP}/stats`)).json();
const limit = stats.gauges.read_row_limit;
const heavy = stats.heavy_queries?.[0];
if (limit !== 600) fail(`the server should run with STREAMGRES_ROW_LIMIT=600, it reports ${limit}`);
if (!heavy || heavy.table !== 'smoke_items' || heavy.rows < SEEDED - 1 || heavy.percent_of_limit < 60) fail('the heavy read was not reported: ' + JSON.stringify(stats.heavy_queries));
await new Promise((resolve) => setTimeout(resolve, 3000));
const metrics = await (await fetch(`${HTTP}/metrics`)).text();
const silent = Number(new RegExp(`^${metric('feed_heartbeat_age_seconds')} (\\S+)`, 'm').exec(metrics)?.[1] ?? NaN);
if (!(silent < 2.5)) fail(`the feed was last heard ${silent} s ago with nobody writing; PostgreSQL's keepalives should keep it under the snapshot rotation`);
log(`with nobody writing for three seconds the feed was last heard ${silent} s ago, and nothing was written to be heard`);
for (const needle of [metric('connects_total{owed="state"} 1'), metric('connects_total{owed="log"} 1'), metric('connects_total{owed="start_over"} 0'), metric('read_row_limit 600'), metric('reads_near_limit_total{over="50"}'), metric('query_read_rows_max{'), metric('connections_total{event="refused",reason="client_schema"} 1'), metric('end_to_end_seconds_bucket')]) {
  if (!metrics.includes(needle)) fail(`/metrics lacks ${needle}`);
}
log(`the read of ${heavy.rows} rows (${heavy.percent_of_limit}% of the limit of ${limit}) is reported under its query, and /metrics carries it`);

if (COLLECTOR) {
  const deadline = Date.now() + 30000;
  let seen = '';
  while (Date.now() < deadline) {
    seen = await (await fetch(COLLECTOR)).text().catch(() => '');
    if (new RegExp(`^${metric('read_row_limit')}\\{[^}]*\\} 600$`, 'm').test(seen) && new RegExp(`^${metric('connections_total')}\\{[^}]*event="refused"[^}]*\\} 1$`, 'm').test(seen) && seen.includes(metric('end_to_end_seconds_bucket'))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (Date.now() >= deadline) fail('the collector did not receive the metrics over OTLP:\n' + seen.split('\n').filter((l) => l.startsWith(metric('read'))).join('\n'));
  const names = (text) => new Set(text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/[{ ].*/, '')));
  const pushed = names(seen);
  const missing = [...names(metrics)].filter((n) => !pushed.has(n));
  if (missing.length) fail('series served at /metrics and not at the collector: ' + missing.join(', '));
  log(`the collector holds every series /metrics serves (${pushed.size} names), pushed over OTLP`);
}

a.ws.close(); b.ws.close(); app.close();
log('PASS');
setTimeout(() => process.exit(0), 200);
