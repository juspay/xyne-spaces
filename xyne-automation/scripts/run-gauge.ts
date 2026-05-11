/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'dotenv';
import { environment, config as testConfig } from '@/config';
import { closeLogger, setLoggerFileLabel } from '@/lib/logger';
import { bootstrapBaselineFixture } from '@/fixtures/baseline';
import { closeAllBrowserSessions } from '@/tests/shared/support/browser-manager';

config({ quiet: true });

interface RunMetadata {
  runId: string;
  commitHash: string;
  runSequence: number;
  environment: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'passed' | 'failed';
  exitCode?: number;
  artifactDirectory: string;
  htmlReportDirectory: string;
  gaugeLogFile: string;
  bootstrapLogFile: string;
  runnerDirectory: string;
  parallelCount: number;
  command: string[];
  targets: string[];
  runnerMappings?: Array<{
    runnerNumber: number | null;
    pid: number;
    runnerFolder: string;
    logFile: string;
    contextFile: string;
    label?: string;
  }>;
}

interface RunnerMapping {
  runnerNumber: number | null;
  pid: number;
  runnerFolder: string;
  logFile: string;
  contextFile: string;
  label?: string;
}

if (environment === 'sbx' || environment === 'prod') {
  console.log('\n⏳ Tests for this environment are in progress. Coming soon!\n');
  process.exit(0);
}

const positionalArgs = process.argv.slice(2);
const parallelCount = testConfig.parallel;

function getCommitHash(): string {
  if (process.env.COMMIT_HASH) {
    return process.env.COMMIT_HASH;
  }
  try {
    return execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'no-commit';
  }
}

function getNextRunSequence(reportsRoot: string, commitHash: string): number {
  if (!fs.existsSync(reportsRoot)) {
    return 1;
  }

  const prefix = `${commitHash}-`;
  const sequences = fs
    .readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => Number.parseInt(entry.name.slice(prefix.length), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return sequences.length > 0 ? Math.max(...sequences) + 1 : 1;
}

const reportsRoot = path.resolve(process.cwd(), 'reports');
const commitHash = getCommitHash();
const runSequence = getNextRunSequence(reportsRoot, commitHash);
const runDirectoryName = `${commitHash}-${runSequence}`;
const runArtifactDirectory = path.join(reportsRoot, runDirectoryName);
const gaugeLogFile = path.join(runArtifactDirectory, 'gauge.log');
const bootstrapLogFile = path.join(runArtifactDirectory, 'runner', 'baseline', 'runner.log');
const runnerDirectory = path.join(runArtifactDirectory, 'runner');
const htmlReportDirectory = path.join(runArtifactDirectory, 'html-report');
const runMetadataFile = path.join(runArtifactDirectory, 'run-metadata.json');

fs.mkdirSync(runArtifactDirectory, { recursive: true });

console.log(`\n📁 Run artifacts: ${path.relative(process.cwd(), runArtifactDirectory)}\n`);

const args = [
  'run',
  '--sort=alpha',
  '--max-retries-count',
  String(testConfig.retries),
  '-p',
  '-n',
  String(parallelCount),
  ...(positionalArgs.length > 0 ? positionalArgs : ['tests']),
];

function writeRunMetadata(metadata: RunMetadata): void {
  fs.writeFileSync(runMetadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function collectRunnerMappings(rootRunnerDirectory: string): RunnerMapping[] {
  if (!fs.existsSync(rootRunnerDirectory)) {
    return [];
  }

  const mappings: RunnerMapping[] = [];

  for (const entry of fs.readdirSync(rootRunnerDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const logFile = path.join(rootRunnerDirectory, entry.name, 'runner.log');
    const contextFile = path.join(rootRunnerDirectory, entry.name, 'context.json');

    if (!fs.existsSync(contextFile)) {
      continue;
    }

    if (entry.name === 'baseline') {
      mappings.push({
        runnerNumber: 0,
        pid: 0,
        runnerFolder: entry.name,
        logFile,
        contextFile,
        label: 'baseline',
      });
      continue;
    }

    try {
      const contextData = JSON.parse(fs.readFileSync(contextFile, 'utf8')) as {
        runnerNumber?: number | null;
        runnerPid?: number;
        runnerFolder?: string;
      };
      const contextRunnerNumber = contextData.runnerNumber;
      const folderRunnerNumber = Number.parseInt(entry.name, 10);
      const hasNumericFolder = Number.isInteger(folderRunnerNumber) && folderRunnerNumber > 0;
      const normalizedRunnerNumber =
        contextRunnerNumber !== undefined &&
        contextRunnerNumber !== null &&
        Number.isInteger(contextRunnerNumber) &&
        contextRunnerNumber > 0
          ? contextRunnerNumber
          : hasNumericFolder
            ? folderRunnerNumber
            : null;

      let pid =
        contextData.runnerPid !== undefined &&
        Number.isInteger(contextData.runnerPid) &&
        contextData.runnerPid > 0
          ? contextData.runnerPid
          : 0;
      if (pid === 0) {
        try {
          const logContent = fs.readFileSync(logFile, 'utf8');
          const firstLine = logContent.split('\n')[0];
          if (firstLine) {
            const logEntry = JSON.parse(firstLine) as { pid?: number };
            pid = logEntry.pid ?? 0;
          }
        } catch {
          // Skip malformed/empty log files
        }
      }

      mappings.push({
        runnerNumber: normalizedRunnerNumber,
        pid,
        runnerFolder: contextData.runnerFolder ?? entry.name,
        logFile,
        contextFile,
        label: contextData.runnerFolder ?? entry.name,
      });
    } catch {
      // Skip malformed entries
    }
  }

  return mappings.sort((left, right) => {
    if (left.runnerNumber === 0) return -1;
    if (right.runnerNumber === 0) return 1;
    if (left.runnerNumber !== null && right.runnerNumber !== null) {
      return left.runnerNumber - right.runnerNumber;
    }
    if (left.runnerNumber !== null) return -1;
    if (right.runnerNumber !== null) return 1;
    return left.runnerFolder.localeCompare(right.runnerFolder);
  });
}

function writeFinalRunMetadata(exitCode: number): void {
  const runnerMappings = collectRunnerMappings(runnerDirectory);

  writeRunMetadata({
    ...initialRunMetadata,
    finishedAt: new Date().toISOString(),
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    runnerMappings,
  });
}

const initialRunMetadata: RunMetadata = {
  runId: runDirectoryName,
  commitHash,
  runSequence,
  environment,
  startedAt: new Date().toISOString(),
  status: 'running',
  artifactDirectory: runArtifactDirectory,
  htmlReportDirectory,
  gaugeLogFile,
  bootstrapLogFile,
  runnerDirectory,
  parallelCount,
  command: ['gauge', ...args],
  targets: positionalArgs.length > 0 ? positionalArgs : ['tests'],
};

writeRunMetadata(initialRunMetadata);

const gaugeLogStream = fs.createWriteStream(gaugeLogFile, { flags: 'w' });

function forwardChunk(
  chunk: string | Buffer,
  destination: NodeJS.WriteStream,
  logStream: fs.WriteStream
): void {
  destination.write(chunk);
  logStream.write(chunk);
}

async function main(): Promise<void> {
  process.env.gauge_reports_dir = runArtifactDirectory;
  process.env.XYNE_RUN_ARTIFACT_DIR = runArtifactDirectory;
  process.env.XYNE_RUN_ID = runDirectoryName;
  const defaultConsoleLogging = environment === 'local' || environment === 'local-test';
  const requestedConsoleLogging =
    process.env.XYNE_LOG_TO_STDOUT ?? (defaultConsoleLogging ? 'true' : 'false');

  process.env.XYNE_LOG_TO_STDOUT = requestedConsoleLogging;

  console.log('🧱 Preparing baseline fixtures before starting Gauge workers...');
  setLoggerFileLabel('runner/baseline/runner');

  try {
    await bootstrapBaselineFixture();
  } finally {
    await closeAllBrowserSessions();
    await closeLogger();
  }

  console.log(`✅ Baseline fixtures ready. Starting ${parallelCount} parallel runner(s).\n`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn('gauge', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        gauge_reports_dir: runArtifactDirectory,
        XYNE_RUN_ARTIFACT_DIR: runArtifactDirectory,
        XYNE_RUN_ID: runDirectoryName,
      },
    });

    child.stdout?.on('data', (chunk) => {
      forwardChunk(chunk, process.stdout, gaugeLogStream);
    });

    child.stderr?.on('data', (chunk) => {
      forwardChunk(chunk, process.stderr, gaugeLogStream);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  await new Promise<void>((resolve) => {
    gaugeLogStream.end(() => {
      resolve();
    });
  });

  writeFinalRunMetadata(exitCode);

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  gaugeLogStream.end(() => {
    writeFinalRunMetadata(1);
    process.exitCode = 1;
    console.error(error);
  });
});
