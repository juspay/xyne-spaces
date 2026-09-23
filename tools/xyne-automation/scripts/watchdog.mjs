#!/usr/bin/env node
/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
// Watchdog: runs the suite, records every scenario's result in a ledger kept outside the
// repo, and reports which scenarios are failing *consistently* (N runs in a row) versus
// flaking. The fix/PR half of the job is the agent's — see watchdog.md.
//
// Plain .mjs, not ts-node like its neighbours: `preflight` is the orca precheck and has to
// answer before the package's own toolchain is guaranteed to be installed.
//
// Usage: watchdog.mjs preflight            container runtime up + no run in flight (orca precheck)
//        watchdog.mjs run [targets...]     run the suite, record it, print the verdict
//        watchdog.mjs verify <targets...>  run given specs to check a fix, without recording
//        watchdog.mjs verdict [--json]     print the verdict from the ledger, run nothing
//        watchdog.mjs gate off --reason <t> disable the merge-queue test gate (RUN_TEST_CASE)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR =
  process.env.WATCHDOG_STATE_DIR ?? path.join(os.homedir(), '.xyne-automation-watchdog');
const LEDGER = path.join(STATE_DIR, 'history.jsonl');
const LOCK = path.join(STATE_DIR, 'run.lock');
const CONSECUTIVE = Number(process.env.WATCHDOG_CONSECUTIVE ?? 3);
const WINDOW = Number(process.env.WATCHDOG_WINDOW ?? 6);
const KEEP_RUNS = 50;
// Past this much consistent breakage the suite is not a signal any more, it is a roadblock:
// the merge-queue gate comes off so the team is not stuck behind it while it gets fixed.
const GATE_OFF_COUNT = Number(process.env.WATCHDOG_GATE_OFF_COUNT ?? 5);
const GATE_OFF_RATIO = Number(process.env.WATCHDOG_GATE_OFF_RATIO ?? 0.2);
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;
const SUITE_TIMEOUT_MS = 150 * 60 * 1000;
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const REPORTS_DIR = path.join(REPO_ROOT, 'tools/xyne-automation/reports');

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const dockerReady = () => sh('docker', ['info'], { stdio: 'ignore' }).status === 0;

// ---------------------------------------------------------------- preflight

function startRuntime() {
  // OrbStack or Docker Desktop, whichever is installed. Unattended runs can't ask.
  const app = ['OrbStack', 'Docker'].find((a) => fs.existsSync(`/Applications/${a}.app`));
  if (!app) return false;
  console.log(`Container runtime is down — starting ${app}...`);
  sh('open', ['-ga', app]);
  for (let i = 0; i < 60; i++) {
    sleep(2000);
    if (dockerReady()) return true;
  }
  return false;
}

function preflight() {
  const lock = readJson(LOCK);
  if (lock && Date.now() - lock.startedAt < LOCK_STALE_MS) {
    console.log(
      `A watchdog run started ${new Date(lock.startedAt).toISOString()} is still in flight — skipping.`
    );
    process.exit(1);
  }
  if (!dockerReady() && !startRuntime()) {
    console.log('Container runtime unavailable — skipping.');
    process.exit(1);
  }
  console.log('Ready.');
}

// ---------------------------------------------------------------- run

function latestRunDir() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const dirs = fs
    .readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('-runner'))
    .map((e) => path.join(REPORTS_DIR, e.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

// retry-recovery.json identifies scenarios as `<spec>:<line>`, but result.json carries only
// headings — so read the line numbers back out of the spec file.
function scenarioLines(specPath) {
  const lines = new Map();
  try {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'tools/xyne-automation', specPath), 'utf8');
    source.split('\n').forEach((line, index) => {
      const heading = line.match(/^##\s+(.*?)\s*$/);
      if (heading) lines.set(heading[1], index + 1);
    });
  } catch {
    // Spec file gone (renamed between run and read) — every lookup misses, so nothing reads
    // as recovered. Failing loud beats silently downgrading a real failure to flaky.
  }
  return lines;
}

// Gauge nests failures under steps and concepts, and a concept's children can sit under
// `items` as well as `steps` — walking only `steps` loses the error entirely and reports a
// blank reason, which is worse than useless when it is the only clue a run leaves behind.
function firstError(scenario) {
  const visit = (items) => {
    for (const it of items ?? []) {
      if (it.itemType === 'step' && it.result?.status === 'failed') {
        return `${it.stepText}: ${it.result.errorMessage ?? ''}`;
      }
      for (const key of ['steps', 'items', 'concepts']) {
        const found = it[key] && visit(it[key]);
        if (found) return found;
      }
    }
    return '';
  };
  const found = visit([
    ...(scenario.contexts ?? []),
    ...(scenario.items ?? []),
    ...(scenario.teardowns ?? []),
  ]);
  if (found) return found;
  for (const k of ['beforeScenarioHookFailure', 'afterScenarioHookFailure']) {
    if (scenario[k]) return `${k}: ${scenario[k].errorMessage ?? ''}`;
  }
  return '';
}

function collect(runDir) {
  const result = readJson(path.join(runDir, 'json-report', 'result.json'));
  if (!result) return null;
  // run-gauge re-runs first-pass failures at the end and records them as `<spec>:<line>`;
  // anything retried but not still failing recovered, and result.json still calls it failed.
  // Match the line too — matching by spec alone marks every scenario in a spec as still
  // failing the moment one sibling does.
  const recovery = readJson(path.join(runDir, 'retry-recovery.json')) ?? {
    retriedAtEnd: [],
    stillFailing: [],
  };
  const retried = new Set(recovery.retriedAtEnd ?? []);
  const stillFailing = new Set(recovery.stillFailing ?? []);

  const scenarios = {};
  const errors = {};
  for (const spec of result.specResults ?? []) {
    const file = spec.fileName.replace(/^.*?(tests\/)/, '$1');
    const lineOf = scenarioLines(file);
    for (const sc of spec.scenarios ?? []) {
      const id = `${file}::${sc.scenarioHeading}`;
      if (sc.executionStatus === 'failed') {
        const key = `${file}:${lineOf.get(sc.scenarioHeading)}`;
        const recovered = retried.has(key) && !stillFailing.has(key);
        scenarios[id] = recovered ? 'flaky' : 'failed';
        errors[id] = firstError(sc).replace(/\s+/g, ' ').trim().slice(0, 400);
      } else {
        scenarios[id] =
          sc.executionStatus === 'skipped'
            ? 'skipped'
            : (sc.retriesCount ?? 1) > 1
              ? 'flaky'
              : 'passed';
      }
    }
  }
  const meta = readJson(path.join(runDir, 'run-metadata.json')) ?? {};
  const tally = (s) => Object.values(scenarios).filter((v) => v === s).length;
  return {
    at: new Date().toISOString(),
    commit: meta.commitHash ?? 'unknown',
    runDir,
    totals: {
      passed: tally('passed'),
      failed: tally('failed'),
      flaky: tally('flaky'),
      skipped: tally('skipped'),
    },
    suiteHookFailure: Boolean(result.beforeSuiteHookFailure || result.afterSuiteHookFailure),
    scenarios,
    errors,
  };
}

function append(entry) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const kept = fs.existsSync(LEDGER)
    ? fs
        .readFileSync(LEDGER, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-(KEEP_RUNS - 1))
    : [];
  fs.writeFileSync(LEDGER, `${[...kept, JSON.stringify(entry)].join('\n')}\n`);
}

function execSuite(targets) {
  preflight();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  try {
    if (!fs.existsSync(path.join(REPO_ROOT, 'tools/xyne-automation/node_modules/.bin/ts-node'))) {
      sh(
        'pnpm',
        ['install', '--frozen-lockfile', '--prod=false', '--filter', 'xyne-automation...'],
        { cwd: REPO_ROOT, stdio: 'inherit' }
      );
    }
    // run-test.sh directly, not via `pnpm run test`: no arg-forwarding surprises.
    const runner = path.join(REPO_ROOT, 'tools/xyne-automation/scripts/run-test.sh');
    const suite = sh(runner, ['--plain', ...targets], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: SUITE_TIMEOUT_MS,
    });
    // A killed run leaves its stack up, and the next cycle inherits the port conflicts.
    if (suite.error?.code === 'ETIMEDOUT') {
      console.error(`\nSuite exceeded ${SUITE_TIMEOUT_MS / 60000}m — tearing down its containers.`);
      const ids =
        sh('docker', ['ps', '-aq', '--filter', 'name=xyne-test-'])
          .stdout?.trim()
          .split('\n')
          .filter(Boolean) ?? [];
      if (ids.length > 0) sh('docker', ['rm', '-f', ...ids]);
    }
    const runDir = latestRunDir();
    return { suite, entry: runDir ? collect(runDir) : null };
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

function run(targets) {
  const { suite, entry } = execSuite(targets);
  if (!entry) {
    // No report at all: the stack never came up. Not a test failure — don't let it
    // poison the streak count.
    append({
      at: new Date().toISOString(),
      error: 'suite produced no report',
      exitCode: suite.status,
    });
    console.error(
      '\nSuite produced no Gauge report — treat as infrastructure failure, not a test failure.'
    );
    process.exit(2);
  }
  entry.exitCode = suite.status;
  append(entry);
  verdict(process.argv.includes('--json'));
}

// Verifying a candidate fix runs a handful of specs — recording that partial result
// would reset every other scenario's streak, so verify never touches the ledger.
function verify(targets) {
  if (targets.length !== 1) {
    // The runner chains multiple targets with `&&` and gives each its own report dir, so a
    // failure in the first silently skips the rest and only one report survives.
    console.error('verify takes exactly one spec target — run it once per spec.');
    process.exit(2);
  }
  const { suite, entry } = execSuite(targets);
  if (!entry) {
    console.error('\nNo Gauge report — the stack did not come up.');
    process.exit(2);
  }
  const bad = Object.entries(entry.scenarios).filter(([, v]) => v === 'failed' || v === 'flaky');
  console.log(
    `\n${targets.join(' ')} — ${entry.totals.passed} passed, ${entry.totals.failed} failed, ${entry.totals.flaky} flaky`
  );
  for (const [id, status] of bad)
    console.log(`  ${status.toUpperCase()} ${id}\n    ${entry.errors[id] ?? ''}`);
  process.exit(bad.length === 0 && suite.status === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- verdict

function buildVerdict() {
  const runs = (
    fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean) : []
  )
    .map((l) => JSON.parse(l))
    .filter((r) => r.scenarios)
    .reverse(); // newest first
  const latest = runs[0];
  if (!latest) return { latest: null, consistent: [], confirming: [], flaky: [] };

  const window = runs.slice(0, WINDOW);
  const out = {
    latest: { at: latest.at, commit: latest.commit, totals: latest.totals, runDir: latest.runDir },
    consistent: [],
    confirming: [],
    flaky: [],
  };

  for (const [id, status] of Object.entries(latest.scenarios)) {
    if (status !== 'failed' && status !== 'flaky') continue;
    // Streak counts only runs where the scenario actually executed.
    let streak = 0;
    for (const r of runs) {
      const s = r.scenarios[id];
      if (s === undefined || s === 'skipped') continue;
      if (s === 'failed') streak++;
      else break;
    }
    const badRuns = window.filter(
      (r) => r.scenarios[id] === 'failed' || r.scenarios[id] === 'flaky'
    ).length;
    const seen = window.filter(
      (r) => r.scenarios[id] !== undefined && r.scenarios[id] !== 'skipped'
    ).length;
    const item = { id, streak, seen, badRuns, error: latest.errors?.[id] ?? '' };
    if (streak >= CONSECUTIVE) out.consistent.push(item);
    else if (status === 'flaky' || (badRuns > 1 && streak <= 1)) out.flaky.push(item);
    else out.confirming.push(item);
  }
  return out;
}

function verdict(asJson) {
  const v = buildVerdict();
  if (asJson) {
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  if (!v.latest) {
    console.log('No recorded runs yet.');
    return;
  }
  const t = v.latest.totals;
  console.log(
    `\nLatest run ${v.latest.commit} at ${v.latest.at} — ${t.passed} passed, ${t.failed} failed, ${t.flaky} flaky, ${t.skipped} skipped`
  );
  console.log(`Artifacts: ${v.latest.runDir}`);
  const list = (title, items, note) => {
    if (items.length === 0) return;
    console.log(`\n${title}`);
    for (const i of items)
      console.log(`  ${i.id}\n    ${note(i)}${i.error ? `\n    ${i.error}` : ''}`);
  };
  list(
    `CONSISTENT (failed ${CONSECUTIVE}+ runs in a row — fix these)`,
    v.consistent,
    (i) => `${i.streak} consecutive failures`
  );
  list(
    `CONFIRMING (failing, not yet ${CONSECUTIVE} in a row — leave alone)`,
    v.confirming,
    (i) => `${i.streak}/${CONSECUTIVE} consecutive`
  );
  list(
    'FLAKY (passes and fails across the window — leave alone)',
    v.flaky,
    (i) => `${i.badRuns}/${i.seen} recent runs bad`
  );
  if (v.consistent.length === 0) {
    console.log('\nNo consistent failures. Nothing to fix.');
    return;
  }
  const executed =
    Object.values(v.latest.totals).reduce((a, b) => a + b, 0) - v.latest.totals.skipped;
  if (
    v.consistent.length >= GATE_OFF_COUNT ||
    v.consistent.length / Math.max(executed, 1) > GATE_OFF_RATIO
  ) {
    console.log(
      `\nGATE: ${v.consistent.length} of ${executed} executed scenarios are consistently failing.`
    );
    console.log('This is too broad to fix in one cycle — take the merge-queue gate off:');
    console.log('  node tools/xyne-automation/scripts/watchdog.mjs gate off --reason "<why>"');
  }
}

// ---------------------------------------------------------------- gate

// The merge-queue gate is `vars.RUN_TEST_CASE` in ci.yml's `test` job. Writing it needs only
// collaborator access, not admin. Off is automatable — it unblocks everyone's merge queue and
// the downside is the status quo. On is not: a wrong re-enable blocks the whole team.
function gate(target, reason) {
  if (target !== 'off') {
    console.error('Only `gate off` is automated. Re-enabling the gate is a human decision —');
    console.error('say so in your summary when the suite has earned it.');
    process.exit(2);
  }
  if (!reason) {
    console.error('gate off needs --reason "<why>"');
    process.exit(2);
  }

  const current = sh('gh', ['variable', 'list', '--json', 'name,value'], { cwd: REPO_ROOT });
  const vars = JSON.parse(current.stdout || '[]');
  const now = vars.find((v) => v.name === 'RUN_TEST_CASE')?.value;
  if (now !== 'true') {
    console.log(`RUN_TEST_CASE is already "${now}" — nothing to do.`);
    return;
  }
  const set = sh('gh', ['variable', 'set', 'RUN_TEST_CASE', '--body', 'false'], { cwd: REPO_ROOT });
  if (set.status !== 0) {
    console.error(`Could not write RUN_TEST_CASE: ${set.stderr ?? ''}`);
    process.exit(1);
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(STATE_DIR, 'gate.log'),
    `${JSON.stringify({ at: new Date().toISOString(), from: 'true', to: 'false', reason })}\n`
  );
  console.log(`RUN_TEST_CASE set to false — ${reason}`);
  console.log(
    'Say so in your summary and open an issue: the merge queue no longer runs the suite.'
  );
}

export { buildVerdict, collect };

if (process.argv[1] === import.meta.filename) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = rest.filter((a) => !a.startsWith('--'));
  if (cmd === 'preflight') preflight();
  else if (cmd === 'run') run(args);
  else if (cmd === 'verify') verify(args);
  else if (cmd === 'verdict') verdict(rest.includes('--json'));
  else if (cmd === 'gate') {
    const at = rest.indexOf('--reason');
    gate(args[0], at === -1 ? undefined : rest[at + 1]);
  } else {
    console.error(
      'usage: watchdog.mjs preflight | run [targets...] | verify <targets...> | verdict [--json] | gate off --reason <text>'
    );
    process.exit(2);
  }
}
