import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

// embedded-postgres registers async-exit-hook at import time, which hijacks SIGINT/SIGTERM/
// SIGHUP and calls process.exit(128 + signal) as soon as its own hook has run. That would
// end the launcher halfway through its ordered shutdown, so drop those listeners here
// (this module is evaluated before index.mjs installs the launcher's handlers).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeAllListeners(sig);
import pg from 'pg';
import { DATA, log, logFile } from './util.mjs';

// Same identity the repo's docker/init-db.sh and .env.local use.
export const PG = {
  port: Number(process.env.PG_PORT ?? 5433),
  user: 'xyne',
  password: 'xyne123',
  clawUser: 'claw',
  clawPassword: 'claw123',
  dir: path.join(DATA, 'postgres'),
};

export function pgUrl(db, user = PG.user, password = PG.password) {
  return `postgresql://${user}:${password}@127.0.0.1:${PG.port}/${db}`;
}

let pgLogStream;
const pgLog = () => (pgLogStream ??= logFile('postgres'));

function instance() {
  return new EmbeddedPostgres({
    databaseDir: PG.dir,
    user: PG.user,
    password: PG.password,
    port: PG.port,
    persistent: true,
    // What docker/init-db.sh sets with ALTER SYSTEM; zero-cache needs logical replication.
    postgresFlags: [
      '-c', 'wal_level=logical',
      '-c', 'max_replication_slots=20',
      '-c', 'max_wal_senders=20',
      '-c', 'max_connections=300',
      '-c', 'listen_addresses=127.0.0.1,localhost',
    ],
    onLog: m => pgLog().write(`${m}\n`),
    onError: m => { const t = m instanceof Error ? m.message : String(m); pgLog().write(`${t}\n`); if (process.env.LITE_VERBOSE) log('postgres', t); },
  });
}

async function query(db, sql, user, password) {
  const client = new pg.Client({ connectionString: pgUrl(db, user, password) });
  await client.connect();
  try { return await client.query(sql); } finally { await client.end(); }
}

async function ensureDatabase(name, owner) {
  const r = await query('postgres', `SELECT 1 FROM pg_database WHERE datname = '${name}'`);
  if (r.rowCount) { log('postgres', `${name} already exists`); return; }
  await query('postgres', `CREATE DATABASE ${name} OWNER ${owner}`);
  log('postgres', `created ${name} (owner ${owner})`);
}

export async function startPostgres() {
  const db = instance();
  const initialised = fs.existsSync(path.join(PG.dir, 'PG_VERSION'));
  if (!initialised) {
    log('postgres', 'first run: initialising cluster (downloads ~30MB of PostgreSQL 16 binaries once)');
    await db.initialise();
  }
  await db.start();
  await query('postgres', 'SELECT 1');

  // Mirror docker/init-db.sh.
  await query('postgres', `DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG.clawUser}') THEN
      CREATE ROLE ${PG.clawUser} LOGIN PASSWORD '${PG.clawPassword}';
    END IF; END $$;`);
  await ensureDatabase('xyne_dev_db', PG.user);
  await ensureDatabase('xyne_common', PG.user);
  await ensureDatabase('claw_auth_db', PG.clawUser);
  await query('xyne_common', `CREATE SCHEMA IF NOT EXISTS common AUTHORIZATION ${PG.user}`);
  log('postgres', `ready on 127.0.0.1:${PG.port} (xyne_dev_db, xyne_common, claw_auth_db)`);
  return db;
}

/**
 * Stop whatever postmaster owns data/postgres, even one started by another launcher
 * process: SIGINT is Postgres' "fast shutdown", and postmaster.pid disappears when done.
 */
export async function stopPostgres() {
  const pidFile = path.join(PG.dir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').split('\n')[0]);
  try { process.kill(pid, 'SIGINT'); } catch { try { fs.unlinkSync(pidFile); } catch {} return; }
  const start = Date.now();
  while (fs.existsSync(pidFile) && Date.now() - start < 15_000) await new Promise(r => setTimeout(r, 200));
  if (fs.existsSync(pidFile)) { try { process.kill(pid, 'SIGKILL'); fs.unlinkSync(pidFile); } catch {} }
  log('postgres', 'stopped');
}

export async function tableExists(db, table) {
  try {
    const r = await query(db, `SELECT to_regclass('public.${table}') AS t`);
    return r.rows[0]?.t !== null;
  } catch { return false; }
}
