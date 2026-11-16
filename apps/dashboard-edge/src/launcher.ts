// Container entrypoint (PID 1). The runtime image is distroless Node (no shell,
// envsubst or curl), so this replaces the former shell entrypoint: render the
// nginx config from its templates, run the edge app on loopback (restarted
// whenever it exits; nginx keeps serving cached objects meanwhile), wait for it
// to answer, then run nginx in the foreground for the life of the container.
// As PID 1 it handles every signal it forwards and reaps its own children (the
// app and the nginx master; nginx reaps its workers), so no init is needed.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { constants } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { log, setLogLevel } from './log.js';

const EDGE_HOME = '/opt/edge';
const RUN_DIR = '/var/run/edge';
const CACHE_DIR = '/var/cache/edge';
const NGINX = '/usr/sbin/nginx';
const APP_MAIN = fileURLToPath(new URL('./main.js', import.meta.url));

/** Same defaults as the shell entrypoint (`${VAR:-default}`: unset or empty). */
const DEFAULTS: Record<string, string> = {
  LOG_LEVEL: 'info',
  CACHE_MAX_SIZE: '2g',
  CACHE_INACTIVE: '7d',
  CACHE_TTL: '30d',
  EDGE_APP_ADDR: '127.0.0.1',
  EDGE_APP_PORT: '9101',
  EDGE_SYSLOG_PORT: '9102',
};

/** Template -> rendered file, and the only variables substituted in it (as `envsubst '$A $B'`). */
const TEMPLATES: ReadonlyArray<{ from: string; to: string; vars: readonly string[] }> = [
  {
    from: `${EDGE_HOME}/nginx.conf.template`,
    to: `${RUN_DIR}/nginx.conf`,
    vars: ['LOG_LEVEL', 'CACHE_MAX_SIZE', 'CACHE_INACTIVE', 'EDGE_APP_PORT', 'EDGE_SYSLOG_PORT'],
  },
  {
    from: `${EDGE_HOME}/proxy-origin.conf.template`,
    to: `${RUN_DIR}/proxy-origin.conf`,
    vars: ['CACHE_TTL'],
  },
];

/** nginx gets every signal the container receives, as when it was exec'd by the shell. */
const FORWARDED: readonly NodeJS.Signals[] = [
  'SIGTERM',
  'SIGINT',
  'SIGQUIT',
  'SIGHUP',
  'SIGUSR1',
  'SIGUSR2',
  'SIGWINCH',
];

const HEALTH_ATTEMPTS = 100;
const HEALTH_INTERVAL_MS = 200;
const APP_RESTART_DELAY_MS = 1000;
const APP_STOP_TIMEOUT_MS = 12_000;

let app: ChildProcess | null = null;
let nginx: ChildProcess | null = null;
let stopping = false;

/**
 * envsubst with an explicit variable list: `$NAME` and `${NAME}` are replaced
 * only for the listed names (unset -> empty), every other `$` is left for nginx.
 */
function substitute(text: string, vars: readonly string[]): string {
  return text.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (whole: string, braced: string | undefined, bare: string | undefined) => {
      const name = braced ?? bare ?? '';
      return vars.includes(name) ? (process.env[name] ?? '') : whole;
    },
  );
}

/** Shell-style exit status: the code, or 128 + signal number. */
function status(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  return 128 + (signal ? constants.signals[signal] : 0);
}

function startApp(): void {
  const child = spawn(process.execPath, ['--use-openssl-ca', APP_MAIN], { stdio: 'inherit' });
  app = child;
  let done = false;
  const restart = (exitStatus: number): void => {
    if (done) {
      return;
    }
    done = true;
    app = null;
    if (stopping) {
      return;
    }
    log.warn(`edge app exited with ${exitStatus}, restarting in 1s`);
    setTimeout(startApp, APP_RESTART_DELAY_MS);
  };
  child.on('error', (err) => {
    log.error('edge app failed to start', { err });
    restart(127);
  });
  child.on('exit', (code, signal) => restart(status(code, signal)));
}

/** True when the app answers below 400, like `curl -sf`. */
function healthy(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(url, { timeout: 1000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 400);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function waitForApp(): Promise<void> {
  const url = `http://${process.env.EDGE_APP_ADDR}:${process.env.EDGE_APP_PORT}/_edge/healthz`;
  for (let i = 1; i <= HEALTH_ATTEMPTS; i++) {
    if (stopping || (await healthy(url))) {
      return;
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
  log.error('edge app did not become healthy');
}

/** Stop the app (it flushes its metrics on SIGTERM), then leave with `exitStatus`. */
async function exit(exitStatus: number): Promise<void> {
  stopping = true;
  const child = app;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), APP_STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }
  process.exit(exitStatus);
}

function startNginx(): void {
  // -e: the compiled-in startup error log (/var/log/nginx) doesn't exist here.
  const child = spawn(NGINX, ['-e', 'stderr', '-c', `${RUN_DIR}/nginx.conf`, '-g', 'daemon off;'], {
    stdio: 'inherit',
  });
  nginx = child;
  child.on('error', (err) => {
    log.error('nginx failed to start', { err });
    void exit(1);
  });
  child.on('exit', (code, signal) => void exit(status(code, signal)));
}

async function main(): Promise<void> {
  for (const [name, value] of Object.entries(DEFAULTS)) {
    if (!process.env[name]) {
      process.env[name] = value;
    }
  }
  setLogLevel(process.env.LOG_LEVEL ?? 'info');

  for (const signal of FORWARDED) {
    process.on(signal, () => {
      if (nginx) {
        nginx.kill(signal);
      } else {
        // Before nginx runs there is nothing to hand the signal to: stop, as the shell did.
        void exit(128 + constants.signals[signal]);
      }
    });
  }

  mkdirSync(RUN_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const t of TEMPLATES) {
    writeFileSync(t.to, substitute(readFileSync(t.from, 'utf8'), t.vars));
  }

  startApp();
  await waitForApp();
  if (!stopping) {
    startNginx();
  }
}

main().catch((err: unknown) => {
  log.error('launcher failed', { err });
  void exit(1);
});
