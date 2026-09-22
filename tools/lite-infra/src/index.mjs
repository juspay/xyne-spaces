#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BIN, DATA, LOGS, RUN, assertPortsFree, fail, killPidFile, log, repoRoot, state } from './util.mjs';
import { PG, startPostgres, stopPostgres, tableExists } from './postgres.mjs';
import { REDIS_PORT, redisPing, startRedis } from './redis.mjs';
import { GCS_PORT, gcsHealthy, startFakeGcs } from './fakegcs.mjs';
import { ZERO_PORT, startZero, zeroHealthy } from './zero.mjs';
import { dbSetup } from './dbsetup.mjs';

const [cmd = 'up', ...rest] = process.argv.slice(2);
const LITE_FLAGS = new Set(['--setup', '--no-demo', '--infra-only']);
const flags = new Set(rest.filter(a => LITE_FLAGS.has(a)));
const passthrough = rest.filter(a => a !== '--' && !LITE_FLAGS.has(a));   // e.g. --all, --plain → dev-interactive (pnpm forwards a literal '--')
const repo = repoRoot();

async function down() {
  // A launcher from another terminal: SIGTERM runs its own shutdown (children + postgres).
  if (killPidFile('lite')) {
    log('lite', 'signalled running launcher, waiting for it to shut down');
    const start = Date.now();
    while (fs.existsSync(`${RUN}/zero.pid`) && Date.now() - start < 20_000) await new Promise(r => setTimeout(r, 300));
  }
  for (const tag of ['zero', 'fake-gcs', 'redis']) if (killPidFile(tag)) log(tag, 'stopped');
  await stopPostgres();
}

async function up() {
  await assertPortsFree([[PG.port, 'postgres'], [REDIS_PORT, 'redis'], [GCS_PORT, 'fake-gcs'], [ZERO_PORT, 'zero-cache'], [ZERO_PORT + 1, 'zero-cache change streamer']]);

  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(`${RUN}/lite.pid`, String(process.pid));
  const children = [];
  let apps = null;
  let exitCode = 0;
  const shutdown = async sig => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    log('lite', `${sig}: stopping...`);
    if (apps && apps.exitCode === null) {
      try { apps.kill('SIGTERM'); } catch {}
      await new Promise(r => { apps.once('exit', r); setTimeout(r, 8000); });
    }
    for (const c of children.reverse()) {
      if (process.env.LITE_DEBUG) process.stderr.write(`[debug] SIGTERM group -${c.pid}\n`);
      try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch {} }
    }
    if (process.env.LITE_DEBUG) process.stderr.write(`[debug] stopping postgres\n`);
    await stopPostgres();
    try { fs.unlinkSync(`${RUN}/lite.pid`); } catch {}
    log('lite', 'core services stopped');
    // A stop the user asked for (Ctrl+C, down:lite, q in the TUI) is not a failure.
    process.exit(/^SIG/.test(sig) || exitCode === 130 || exitCode === 143 ? 0 : exitCode);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.env.LITE_DEBUG) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGPIPE']) process.on(sig, () => process.stderr.write(`[debug] got ${sig}\n`));
    process.on('exit', c => process.stderr.write(`[debug] exit ${c}\n`));
    process.on('uncaughtException', e => process.stderr.write(`[debug] uncaught ${e.stack}\n`));
    process.on('unhandledRejection', e => process.stderr.write(`[debug] unhandled ${e && e.stack || e}\n`));
  }

  try {
    log('lite', `starting core services (service logs: ${LOGS}/<service>.log)`);
    await startPostgres();
    children.push(await startRedis());
    children.push(await startFakeGcs());

    // zero-cache replicates the schema, so the schema has to exist first.
    const seeded = await tableExists('xyne_dev_db', 'workspaces');
    if (!seeded || flags.has('--setup')) {
      log('lite', seeded ? 'running db-setup (--setup)' : 'fresh database: running schema push + seeds (a few minutes the first time)');
      await dbSetup(repo, { demoSeed: !flags.has('--no-demo') });
    } else {
      log('lite', 'database already set up (run with --setup to re-run schema push + seeds)');
    }
    children.push(await startZero(repo));
  } catch (e) {
    log('lite', `startup failed: ${e.message}`);
    exitCode = 1;
    await shutdown('error');
  }

  log('lite', [
    'Core services up.',
    `  Postgres    postgresql://xyne:xyne123@localhost:${PG.port}/xyne_dev_db`,
    `  Redis       redis://localhost:${REDIS_PORT}`,
    `  fake-gcs    http://localhost:${GCS_PORT}`,
    `  zero-cache  http://localhost:${ZERO_PORT}`,
    '  Login       admin@xyne.ai / xynelocal@123',
  ].join('\n'));

  if (flags.has('--infra-only')) {
    log('lite', 'Infra only (--infra-only). Ctrl+C stops everything; data persists in tools/lite-infra/data.');
    await new Promise(() => {});
  }

  // Same app runner as `pnpm run up`. It owns the terminal from here (TUI or concurrently);
  // when it exits (q in the TUI, or Ctrl+C) the core services are stopped too.
  log('lite', 'starting apps (same picker as pnpm run dev)...');
  apps = spawn(process.execPath, [path.join(repo, 'scripts', 'dev-interactive.mjs'), ...passthrough], { cwd: repo, stdio: 'inherit' });
  apps.on('exit', code => { exitCode = code ?? 0; shutdown(`apps exited (${exitCode})`); });
  await new Promise(() => {});
}

async function status() {
  const rows = [
    ['postgres', fs.existsSync(`${PG.dir}/postmaster.pid`)],
    ['redis', await redisPing()],
    ['fake-gcs', await gcsHealthy().catch(() => false)],
    ['zero-cache', await zeroHealthy().catch(() => false)],
  ];
  for (const [name, ok] of rows) log(name === 'zero-cache' ? 'zero' : name, ok ? 'up' : 'down');
}

switch (cmd) {
  case 'up': await up(); break;
  case 'down': await down(); break;
  case 'status': await status(); break;
  case 'db-setup': await dbSetup(repo, { demoSeed: !flags.has('--no-demo') }); break;
  case 'reset':
    await down();
    fs.rmSync(DATA, { recursive: true, force: true });
    log('lite', 'tools/lite-infra/data removed (postgres cluster, redis dump, gcs objects, zero replica)');
    break;
  case 'cleanup':
    // Everything up:lite created on this machine: services, data, downloaded binaries.
    // node_modules (embedded-postgres, zero) stay; pnpm owns those.
    await down();
    fs.rmSync(DATA, { recursive: true, force: true });
    fs.rmSync(BIN, { recursive: true, force: true });
    log('lite', 'tools/lite-infra/data and tools/lite-infra/bin removed; next up:lite re-downloads fake-gcs-server and re-seeds');
    break;
  default:
    fail(`unknown command "${cmd}". Use: up [--setup] [--no-demo] [--infra-only] [--all|--plain] | down | status | db-setup [--no-demo] | reset | cleanup`);
}
