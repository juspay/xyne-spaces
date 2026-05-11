/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StepEntry } from '@/scripts/runner/artifacts';
import type { OutputRenderer } from '@/scripts/runner/output';

interface DockerOpts {
  composeFiles: string[];
  composeProjectName: string;
  env: Record<string, string>;
  cwd: string;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
const ANSI_REGEX = /\x1B\[[0-9;]*[A-Za-z]/g;

function composeArgs(opts: DockerOpts): string[] {
  return [...opts.composeFiles.flatMap((f) => ['-f', f]), '-p', opts.composeProjectName];
}

function exec(
  command: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; logFile?: string },
  renderer: OutputRenderer
): Promise<Omit<StepEntry, 'id' | 'title'>> {
  const startTime = Date.now();
  let logStream: fs.WriteStream | null = null;

  if (opts.logFile) {
    const dir = path.dirname(opts.logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logStream = fs.createWriteStream(opts.logFile, { flags: 'a' });
  }

  return new Promise((resolve) => {
    const child = spawn([command, ...args].join(' '), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const handleData = (data: Buffer) => {
      const str = data.toString();
      renderer.stepOutput(str);
      if (logStream) logStream.write(str.replace(ANSI_REGEX, ''));
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('close', (code) => {
      logStream?.end();
      resolve({
        status: code === 0 ? 'passed' : 'failed',
        duration: Date.now() - startTime,
        error: code !== 0 ? `Exit code ${code}` : undefined,
      });
    });

    child.on('error', (err) => {
      logStream?.end();
      resolve({
        status: 'failed',
        duration: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

export async function dockerBuild(
  opts: DockerOpts,
  artifactDir: string,
  renderer: OutputRenderer
): Promise<StepEntry> {
  const logDir = path.join(artifactDir, 'docker-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const buildArgs = ['compose', ...composeArgs(opts), 'build'];
  if (process.env.NO_CACHE === 'true') {
    buildArgs.push('--no-cache');
  }
  buildArgs.push('backend', 'dashboard', 'xyne-automation');
  const result = await exec(
    'docker',
    buildArgs,
    { cwd: opts.cwd, env: opts.env, logFile: path.join(logDir, 'build.log') },
    renderer
  );
  return { ...result, id: 'docker-build', title: 'Build Docker images' };
}

export async function dockerUp(
  opts: DockerOpts,
  artifactDir: string,
  renderer: OutputRenderer
): Promise<StepEntry> {
  const logDir = path.join(artifactDir, 'docker-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const result = await exec(
    'docker',
    ['compose', ...composeArgs(opts), 'up', '-d', '--wait'],
    { cwd: opts.cwd, env: opts.env, logFile: path.join(logDir, 'startup.log') },
    renderer
  );
  return { ...result, id: 'docker-up', title: 'Start all Docker services' };
}

export async function runTests(
  opts: DockerOpts,
  commitHash: string,
  targets: string[],
  parallel: number | undefined,
  artifactDir: string,
  renderer: OutputRenderer
): Promise<StepEntry> {
  const logDir = path.join(artifactDir, 'docker-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const testCommand = buildTestCommand(targets);
  const envArgs = ['-e', `COMMIT_HASH=${commitHash}`];
  if (parallel) envArgs.push('-e', `PARALLEL=${parallel}`);

  const result = await exec(
    'docker',
    [
      'compose',
      ...composeArgs(opts),
      'exec',
      ...envArgs,
      'xyne-automation',
      'sh',
      '-c',
      `'${testCommand}'`,
    ],
    { cwd: opts.cwd, env: opts.env, logFile: path.join(logDir, 'exec.log') },
    renderer
  );
  return { ...result, id: 'run-tests', title: 'Run Gauge tests' };
}

export function copyReports(
  composeProjectName: string,
  artifactDir: string,
  cwd: string
): StepEntry {
  const startTime = Date.now();
  const container = `${composeProjectName}-automation`;
  const tempDir = path.join(artifactDir, '.temp-reports');

  try {
    // Copy container reports to temp location
    execFileSync('docker', ['cp', `${container}:/app/reports/.`, tempDir], {
      cwd,
      stdio: 'pipe',
    });

    // Find the run subfolder (format: {commitHash}-{sequence})
    const entries = fs.readdirSync(tempDir, { withFileTypes: true });
    const runDir = entries.find((e) => e.isDirectory());

    if (runDir) {
      // Move contents from temp subfolder to artifactDir root
      const runDirPath = path.join(tempDir, runDir.name);
      for (const entry of fs.readdirSync(runDirPath)) {
        const src = path.join(runDirPath, entry);
        const dest = path.join(artifactDir, entry);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(src, dest);
      }
    }

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      id: 'copy-reports',
      title: 'Copy test reports',
      status: 'passed',
      duration: Date.now() - startTime,
    };
  } catch (err) {
    // Clean up temp directory on failure
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return {
      id: 'copy-reports',
      title: 'Copy test reports',
      status: 'failed',
      duration: Date.now() - startTime,
      error: (err as Error).message,
    };
  }
}

export async function dockerDown(
  opts: DockerOpts,
  removeImages: boolean,
  artifactDir: string,
  renderer: OutputRenderer
): Promise<StepEntry> {
  const logDir = path.join(artifactDir, 'docker-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const args = ['compose', ...composeArgs(opts), 'down', '--volumes', '--remove-orphans'];
  if (removeImages) args.push('--rmi', 'local');

  const result = await exec(
    'docker',
    args,
    { cwd: opts.cwd, env: opts.env, logFile: path.join(logDir, 'shutdown.log') },
    renderer
  );
  return { ...result, id: 'docker-down', title: 'Tear down Docker services' };
}

export function collectDockerLogs(
  composeProjectName: string,
  _composeFiles: string[],
  outputDir: string,
  cwd: string
): void {
  // Service list and skip-empty logic live in the bash script so there's a single
  // canonical implementation usable from any CI shell context.
  const scriptPath = path.join(cwd, 'xyne-automation', 'scripts', 'collect-ci-artifacts.sh');
  try {
    execFileSync('bash', [scriptPath, outputDir, composeProjectName], {
      cwd,
      stdio: 'pipe',
      timeout: 5 * 60 * 1000,
    });
  } catch {
    // Best-effort: the script swallows per-service errors itself, so a top-level
    // throw means something structural (bash unavailable, script missing) — leave
    // the caller to continue without logs rather than failing the whole run.
  }
}

export function buildTestCommand(targets: string[]): string {
  if (targets.length === 0 || (targets.length === 1 && targets[0] === 'tests')) {
    return 'npm run test';
  }

  return targets
    .map((t) => {
      if (t === 'tests/01_api') return 'npm run test:api';
      if (t === 'tests/02_ui') return 'npm run test:ui';
      if (t === 'tests/03_e2e') return 'npm run test:e2e';
      return `npx ts-node --project tsconfig.json scripts/run-gauge.ts ${JSON.stringify(t)}`;
    })
    .join(' && ');
}
