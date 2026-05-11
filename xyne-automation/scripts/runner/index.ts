/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import type { StepEntry } from '@/scripts/runner/artifacts';
import { findLatestReport, parseGaugeReport, writeRunMetadata } from '@/scripts/runner/artifacts';
import {
  collectDockerLogs,
  copyReports,
  dockerBuild,
  dockerDown,
  dockerUp,
  runTests,
} from '@/scripts/runner/docker';
import { createRenderer } from '@/scripts/runner/output';
import { buildPortMap, portMapToEnv, type RunMode } from '@/scripts/runner/ports';

interface CLIArgs {
  mode?: RunMode;
  targets: string[];
  plain: boolean;
  parallel?: number;
}

function parseArgs(argv: string[]): CLIArgs {
  const args = argv.slice(2);
  const result: CLIArgs = { targets: [], plain: false };

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      const mode = arg.slice(7);
      if (mode === 'local' || mode === 'ci') {
        result.mode = mode;
      } else {
        console.error(`Invalid mode: ${mode}. Use 'local' or 'ci'.`);
        process.exit(1);
      }
    } else if (arg.startsWith('--parallel=')) {
      const value = Number.parseInt(arg.slice('--parallel='.length), 10);
      if (!Number.isInteger(value) || value < 1) {
        console.error(`Invalid --parallel value: must be a positive integer.`);
        process.exit(1);
      }
      result.parallel = value;
    } else if (arg === '--plain') {
      result.plain = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      result.targets.push(arg);
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
Usage: ts-node scripts/runner/index.ts [options] [targets...]

Options:
  --mode=local|ci    Force mode (auto-detected if omitted)
  --parallel=N       Number of parallel Gauge runners (defaults to 3 in local, 1 in ci)
  --plain            Force plain text output (no TUI)
  -h, --help         Show this help

Targets:
  tests              Run all tests (default)
  tests/01_api       Run API tests only
  tests/02_ui        Run UI tests only
  tests/03_e2e       Run E2E tests only

Examples:
  ts-node scripts/runner/index.ts
  ts-node scripts/runner/index.ts tests/03_e2e
  ts-node scripts/runner/index.ts --mode=ci
  ts-node scripts/runner/index.ts --parallel=2 tests/03_e2e
  ts-node scripts/runner/index.ts --plain tests/01_api
`);
}

function detectMode(cliMode?: RunMode): RunMode {
  if (cliMode) return cliMode;
  if (process.env.JENKINS_URL || process.env.CI) return 'ci';
  return 'local';
}

function getCommitHash(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function hasUncommittedChanges(repoRoot: string): boolean {
  return (
    execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim().length > 0
  );
}

function generateComposeProjectName(): string {
  let branch = process.env.BRANCH_NAME || '';
  if (!branch) {
    try {
      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf-8',
      }).trim();
    } catch {
      branch = 'unknown';
    }
  }

  const sanitized = branch
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 30);

  const executor = process.env.EXECUTOR_NUMBER || '0';
  const build = process.env.BUILD_NUMBER || String(Date.now());

  return `xyne-test-${sanitized}-${executor}-${build}`;
}

function ensureWorktree(repoRoot: string): string {
  const parentDir = path.resolve(repoRoot, '..');
  const worktreePath = path.join(parentDir, 'xyne-automation-worktree');

  if (fs.existsSync(worktreePath)) {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();

    try {
      execFileSync('git', ['reset', '--hard', headSha], { cwd: worktreePath, stdio: 'pipe' });
    } catch (_resetErr) {
      // Worktree is corrupted — remove and recreate
      console.log('Existing worktree is corrupted, removing and recreating...');
      cleanupWorktree(repoRoot, worktreePath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      execFileSync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    }
  } else {
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  }

  return worktreePath;
}

function cleanupWorktree(repoRoot: string, worktreePath: string): void {
  try {
    // First try to remove via git worktree remove (graceful)
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    // If git worktree remove fails, force-delete the directory and prune
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore — directory might not exist
    }
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: repoRoot, stdio: 'pipe' });
    } catch {
      // Ignore prune failures
    }
  }
}

async function shouldUseCurrentWorkspaceForLocalRun(interactive: boolean): Promise<boolean> {
  if (!interactive || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('Uncommitted changes detected. Defaulting to current workspace for local run.');
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      'Uncommitted changes detected. Test current workspace instead of detached HEAD worktree? [Y/n] '
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === '' || normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

async function resolveProjectRoot(
  mode: RunMode,
  repoRoot: string,
  interactive: boolean
): Promise<string> {
  if (mode !== 'local') {
    return repoRoot;
  }

  if (!hasUncommittedChanges(repoRoot)) {
    return ensureWorktree(repoRoot);
  }

  const useCurrentWorkspace = await shouldUseCurrentWorkspaceForLocalRun(interactive);
  if (useCurrentWorkspace) {
    console.log('Using current workspace with uncommitted changes.');
    return repoRoot;
  }

  console.log('Using detached HEAD worktree. Uncommitted local changes excluded.');
  return ensureWorktree(repoRoot);
}

function prepareArtifactDirectory(artifactDir: string): void {
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
}

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv);
  const mode = detectMode(cliArgs.mode);
  const originalRoot = process.cwd();
  const commitHash = getCommitHash(originalRoot);
  const composeProjectName = generateComposeProjectName();

  const artifactDir = path.join(originalRoot, 'xyne-automation', 'reports', `${commitHash}-runner`);
  prepareArtifactDirectory(artifactDir);

  const portMap = await buildPortMap(mode);
  const projectRoot = await resolveProjectRoot(mode, originalRoot, !cliArgs.plain);

  // Docker compose files are in the monorepo root
  // Resolve monorepo root: if running from xyne-automation, go up one level
  const monorepoRoot =
    path.basename(projectRoot) === 'xyne-automation' ? path.dirname(projectRoot) : projectRoot;

  const composeFiles = [
    path.join(monorepoRoot, 'docker-compose.dev.yml'),
    path.join(monorepoRoot, 'docker-compose.test.yml'),
  ];

  // Verify compose files exist
  for (const file of composeFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `Docker compose file not found: ${file}\n` +
          `Monorepo root: ${monorepoRoot}\n` +
          `Project root: ${projectRoot}\n` +
          `Make sure docker-compose.dev.yml and docker-compose.test.yml exist in the monorepo root.`
      );
    }
  }

  const testTargets = cliArgs.targets.length > 0 ? cliArgs.targets : ['tests'];

  const dockerOpts = {
    composeFiles,
    composeProjectName,
    env: {
      DOCKER_BUILDKIT: '1',
      COMPOSE_PROJECT_NAME: composeProjectName,
      ...portMapToEnv(portMap),
    },
    cwd: monorepoRoot,
  };

  const totalSteps = mode === 'ci' ? 6 : 5;
  const renderer = createRenderer(mode, cliArgs.plain);
  const results: StepEntry[] = [];
  let failed = false;
  let shuttingDown = false;
  let stepIndex = 0;

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    renderer.startStep(stepIndex++, 'Copy test reports');
    const copyResult = copyReports(composeProjectName, artifactDir, projectRoot);
    renderer.endStep(copyResult);
    results.push(copyResult);
    if (copyResult.status === 'failed') failed = true;

    collectDockerLogs(
      composeProjectName,
      composeFiles,
      path.join(artifactDir, 'docker-logs'),
      projectRoot
    );

    renderer.startStep(stepIndex++, 'Tear down Docker services');
    const downResult = await dockerDown(dockerOpts, mode === 'ci', artifactDir, renderer);
    renderer.endStep(downResult);
    results.push(downResult);

    // Clean up worktree if one was used (local mode with detached HEAD)
    if (mode === 'local' && projectRoot !== originalRoot) {
      cleanupWorktree(originalRoot, projectRoot);
    }
  };

  const signalHandler = async () => {
    if (shuttingDown) return;
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});

    renderer.log('Interrupted — running cleanup...');
    await cleanup();
    renderer.cleanup();
    process.exit(130);
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  renderer.start(commitHash, totalSteps);

  const runStep = async (fn: () => Promise<StepEntry> | StepEntry): Promise<void> => {
    if (failed) return;

    const result = await fn();
    renderer.endStep(result);
    results.push(result);
    if (result.status === 'failed') failed = true;
  };

  if (mode === 'ci') {
    renderer.startStep(stepIndex, 'Clean old artifacts');
    const cleanStart = Date.now();
    try {
      const reportsDir = path.join(projectRoot, 'xyne-automation', 'reports');
      if (fs.existsSync(reportsDir)) {
        for (const entry of fs.readdirSync(reportsDir)) {
          fs.rmSync(path.join(reportsDir, entry), { recursive: true, force: true });
        }
      }
      const cleanResult: StepEntry = {
        id: 'clean-artifacts',
        title: 'Clean old artifacts',
        status: 'passed',
        duration: Date.now() - cleanStart,
      };
      renderer.endStep(cleanResult);
      results.push(cleanResult);
    } catch (err) {
      const cleanResult: StepEntry = {
        id: 'clean-artifacts',
        title: 'Clean old artifacts',
        status: 'failed',
        duration: Date.now() - cleanStart,
        error: (err as Error).message,
      };
      renderer.endStep(cleanResult);
      results.push(cleanResult);
      failed = true;
    }
    stepIndex++;
  }

  renderer.startStep(stepIndex++, 'Build Docker images');
  await runStep(() => dockerBuild(dockerOpts, artifactDir, renderer));

  if (!failed) {
    renderer.startStep(stepIndex++, 'Start all Docker services');
    await runStep(() => dockerUp(dockerOpts, artifactDir, renderer));
  }

  if (!failed) {
    renderer.startStep(stepIndex++, 'Run Gauge tests');
    const envParallel = Number.parseInt(process.env.PARALLEL ?? '', 10);
    const envParallelValid = Number.isInteger(envParallel) && envParallel >= 1;
    const resolvedParallel =
      cliArgs.parallel ??
      (envParallelValid ? envParallel : undefined) ??
      (mode === 'local' ? 3 : undefined);
    await runStep(() =>
      runTests(dockerOpts, commitHash, testTargets, resolvedParallel, artifactDir, renderer)
    );
  }

  if (!shuttingDown) {
    await cleanup();
  }

  const testStats = parseGaugeReport(artifactDir);
  const reportPath = findLatestReport(artifactDir);

  writeRunMetadata(
    { commitHash, mode, composeProjectName, testTargets, portMap },
    results,
    testStats,
    artifactDir
  );

  if (mode === 'local' && projectRoot !== originalRoot) {
    const worktreeArtifactDir = path.join(
      projectRoot,
      'xyne-automation',
      'reports',
      `${commitHash}-runner`
    );
    try {
      fs.rmSync(worktreeArtifactDir, { recursive: true, force: true });
      fs.cpSync(artifactDir, worktreeArtifactDir, { recursive: true });
    } catch {
      renderer.log('Warning: failed to mirror artifacts to worktree');
    }
  }

  renderer.printSummary(results, testStats ?? undefined, reportPath ?? undefined);
  renderer.cleanup();

  process.removeListener('SIGINT', signalHandler);
  process.removeListener('SIGTERM', signalHandler);

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
