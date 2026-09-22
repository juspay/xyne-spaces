import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // tools/lite-infra
export const REPO = path.resolve(ROOT, '..', '..');                                     // repo root
export const DATA = process.env.LITE_DATA ? path.resolve(process.env.LITE_DATA) : path.join(ROOT, 'data');   // LITE_DATA: alternate data dir
export const BIN = path.join(ROOT, 'bin');
export const RUN = path.join(DATA, 'run');
export const LOGS = path.join(DATA, 'logs');
/** Set while the launcher tears down so child exits are not reported as failures. */
export const state = { shuttingDown: false };

/** Append-only log file per service. Service output goes here, not to the terminal. */
export function logFile(tag) {
  fs.mkdirSync(LOGS, { recursive: true });
  return fs.createWriteStream(path.join(LOGS, `${tag}.log`), { flags: 'a' });
}

const COLORS = { postgres: 34, redis: 31, 'fake-gcs': 33, zero: 35, lite: 36, 'db-setup': 32 };
export function log(tag, msg) {
  const c = COLORS[tag] ?? 37;
  for (const line of String(msg).split('\n')) {
    if (line.trim()) process.stdout.write(`\x1b[${c}m[${tag}]\x1b[0m ${line}\n`);
  }
}
export function fail(msg) {
  log('lite', `ERROR: ${msg}`);
  process.exit(1);
}

export function repoRoot() {
  if (!fs.existsSync(path.join(REPO, 'apps', 'backend', 'package.json'))) fail(`repo root not found at ${REPO}`);
  return REPO;
}

/** Minimal .env parser: KEY=VALUE, last one wins, quotes stripped, comments ignored. */
export function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const hash = val.indexOf(' #');
    if (hash > -1 && !/^["']/.test(val)) val = val.slice(0, hash).trim();
    if (/^(["']).*\1$/.test(val)) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/**
 * A port counts as busy if something answers a TCP connect on it. (Trying to bind is not
 * enough on macOS: a wildcard listener from Docker/OrbStack still lets 127.0.0.1 bind.)
 */
export function portFree(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.createConnection({ port, host });
    s.setTimeout(700);
    s.once('connect', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(true));
  });
}

export async function assertPortsFree(entries) {
  const busy = [];
  for (const [port, label] of entries) if (!(await portFree(port))) busy.push(`${port} (${label})`);
  if (busy.length) fail(`ports already in use: ${busy.join(', ')}. Stop whatever holds them: the Docker stack (pnpm run services:stop) or an old lite run (pnpm run down:lite).`);
}

export async function waitFor(label, probe, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await probe()) return; } catch {}
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s`);
}

export async function httpOk(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  return res.ok;
}

export function which(cmd) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

/**
 * Spawn a long-running service. Its output goes to data/logs/<tag>.log (and to the
 * terminal too with LITE_VERBOSE=1). Detached into its own process group so a Ctrl+C
 * aimed at the apps does not kill the databases out from under them; shutdown() stops
 * services explicitly, in order.
 */
export function launch(tag, cmd, args, { env, cwd } = {}) {
  fs.mkdirSync(RUN, { recursive: true });
  const out = logFile(tag);
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.pipe(out, { end: false });
    if (process.env.LITE_VERBOSE) stream.on('data', d => log(tag, d));
  }
  fs.writeFileSync(path.join(RUN, `${tag}.pid`), String(child.pid));
  child.on('exit', code => {
    out.end();
    if (!state.shuttingDown) log(tag, `exited unexpectedly with code ${code}; see ${path.join(LOGS, `${tag}.log`)}`);
    try { fs.unlinkSync(path.join(RUN, `${tag}.pid`)); } catch {}
  });
  return child;
}

/** What each pid file's process must look like, so a stale pid that got reused is never killed. */
const EXPECTED_COMMAND = { redis: /redis-server|valkey-server/, 'fake-gcs': /fake-gcs-server/, zero: /zero-cache|@rocicorp\/zero/, lite: /lite-infra\/src\/index\.mjs/ };

export function killPidFile(tag, signal = 'SIGTERM') {
  const f = path.join(RUN, `${tag}.pid`);
  if (!fs.existsSync(f)) return false;
  const pid = Number(fs.readFileSync(f, 'utf8'));
  try { fs.unlinkSync(f); } catch {}
  let command = '';
  try { command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return false; }
  if (!EXPECTED_COMMAND[tag]?.test(command)) { log(tag, `stale pid file (pid ${pid} is now "${command.trim().slice(0, 60)}"), ignoring`); return false; }
  try { process.kill(pid, signal); } catch { return false; }
  return true;
}

/** Run a command to completion in the foreground, streaming output. */
export function run(tag, cmd, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => log(tag, d));
    child.stderr.on('data', d => log(tag, d));
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}
