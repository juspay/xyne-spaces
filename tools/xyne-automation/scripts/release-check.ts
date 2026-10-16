/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
// Runs the automation suite on the checked-out release branch (the same Docker run as
// `pnpm run test`) and writes a module-wise HTML report that records the branch, commit and who
// ran it — the evidence to attach to the release ticket before promoting to preprod/prod.
//
// Usage: pnpm release:check [--modules=chat,calls] [--parallel=N] [--allow-dirty]
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RELEASE_MODULES } from '@/scripts/release/modules';

const AUTOMATION_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(AUTOMATION_DIR, '..', '..');

interface Args {
  modules: string[];
  parallel?: string;
  allowDirty: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { modules: [], allowDirty: false };
  for (const arg of argv) {
    if (arg.startsWith('--modules=')) {
      args.modules = arg
        .slice('--modules='.length)
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--parallel=')) {
      args.parallel = arg.slice('--parallel='.length);
    } else if (arg === '--allow-dirty') {
      args.allowDirty = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}\n`);
      printUsage();
      process.exit(2);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage: pnpm release:check [--modules=a,b] [--parallel=N] [--allow-dirty]

Runs the automation suite on the current checkout and writes a module-wise report.

  --modules=a,b   Only these modules (default: all). One of:
                  ${RELEASE_MODULES.map((m) => m.key).join(', ')}
  --parallel=N    Parallel Gauge runners (passed to the runner)
  --allow-dirty   Run even with uncommitted changes (recorded in the report)`);
}

function git(...args: string[]): string {
  return gitRaw(...args).trim();
}

// Untrimmed: `git status --porcelain` lines start with a status column that may be a space.
function gitRaw(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
}

const args = parseArgs(process.argv.slice(2));

const unknown = args.modules.filter((key) => !RELEASE_MODULES.some((m) => m.key === key));
if (unknown.length > 0) {
  console.error(`Unknown module(s): ${unknown.join(', ')}`);
  console.error(`Available: ${RELEASE_MODULES.map((m) => m.key).join(', ')}`);
  process.exit(2);
}

const branch = git('branch', '--show-current') || '(detached HEAD)';
// Same 9-char hash the runner uses to name its artifact folder.
const commit = git('rev-parse', '--short=9', 'HEAD');
const runBy = git('config', 'user.name') || 'unknown';
const uncommittedFiles = gitRaw('status', '--porcelain', '--untracked-files=no')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3));

// Not blocking: unrelated leftovers are common, but a new file (e.g. a spec) is tested without
// being in the commit, so the report lists them.
const untrackedFiles = gitRaw('status', '--porcelain', '--untracked-files=normal')
  .split('\n')
  .filter((line) => line.startsWith('?? '))
  .map((line) => line.slice(3));

// The Docker build uses the working tree, so uncommitted edits would be tested but not recorded
// in the commit — the report would no longer prove what the release contains.
if (uncommittedFiles.length > 0 && !args.allowDirty) {
  console.error('❌ Uncommitted changes — the results would not match the commit:');
  for (const file of uncommittedFiles) console.error(`   ${file}`);
  console.error('\nCommit or stash them, or pass --allow-dirty (the report will list them).');
  process.exit(1);
}

const targets =
  args.modules.length > 0
    ? RELEASE_MODULES.filter((m) => args.modules.includes(m.key)).flatMap((m) => m.folders)
    : ['tests'];

console.log(`Release check: ${branch} @ ${commit}`);
console.log(`Modules: ${args.modules.length > 0 ? args.modules.join(', ') : 'all'}\n`);

const startedAt = new Date().toISOString();
const run = spawnSync(
  path.join(AUTOMATION_DIR, 'scripts', 'run-test.sh'),
  [...(args.parallel ? [`--parallel=${args.parallel}`] : []), ...targets],
  { cwd: REPO_ROOT, stdio: 'inherit' }
);
const finishedAt = new Date().toISOString();

const artifactDir = path.join(AUTOMATION_DIR, 'reports', `${commit}-runner`);
if (!fs.existsSync(path.join(artifactDir, 'json-report', 'result.json'))) {
  console.error(
    `\n❌ No test results in ${path.relative(REPO_ROOT, artifactDir)} — the tests did not run.`
  );
  console.error('   Check docker-logs/startup.log there (e.g. a port already in use).');
  process.exit(run.status || 1);
}

fs.writeFileSync(
  path.join(artifactDir, 'release-check.json'),
  JSON.stringify(
    {
      branch,
      commit,
      runBy,
      startedAt,
      finishedAt,
      modules: args.modules,
      uncommittedFiles,
      untrackedFiles,
    },
    null,
    2
  )
);

const reportFile = path.join(artifactDir, `release-check-${commit}.html`);
const report = spawnSync(
  path.join(AUTOMATION_DIR, 'node_modules', '.bin', 'ts-node'),
  [
    '--project',
    path.join(AUTOMATION_DIR, 'tsconfig.json'),
    path.join(AUTOMATION_DIR, 'scripts', 'build-summary-report.ts'),
    artifactDir,
    reportFile,
  ],
  { cwd: REPO_ROOT, stdio: 'inherit' }
);
if (report.status !== 0) {
  console.error('\n❌ Tests ran, but building the report failed.');
  process.exit(1);
}

console.log(`\n${run.status === 0 ? '✅ All tests passed' : '❌ Some tests failed'}.`);
console.log(`Report: ${path.relative(REPO_ROOT, reportFile)}`);
console.log('Attach it to the release ticket as proof of what was tested.');
process.exit(run.status ?? 1);
