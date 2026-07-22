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

const pass1Args = [
  'run',
  '--sort=alpha',
  // Exclude quarantined (known-flaky) scenarios.
  '--tags',
  '!quarantine',
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
  command: ['gauge', ...pass1Args],
  targets: positionalArgs.length > 0 ? positionalArgs : ['tests'],
};

writeRunMetadata(initialRunMetadata);

const gaugeLogStream = fs.createWriteStream(gaugeLogFile, { flags: 'w' });

function forwardChunk(
  chunk: string | Buffer,
  destination: NodeJS.WriteStream,
  logStream: fs.WriteStream,
  toConsole: boolean
): void {
  if (toConsole) {
    destination.write(chunk);
  }
  logStream.write(chunk);
}

interface GaugeExecutionStatus {
  scePassed?: number;
  sceFailed?: number;
  sceSkipped?: number;
}

function readFailedItems(): string[] {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), '.gauge', 'failures.json'), 'utf8')
    ) as { FailedItems?: string[] };
    return Array.isArray(data.FailedItems) ? data.FailedItems : [];
  } catch {
    return [];
  }
}

function readExecutionStatus(): GaugeExecutionStatus | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), '.gauge', 'executionStatus.json'), 'utf8')
    ) as GaugeExecutionStatus;
  } catch {
    return null;
  }
}

function writeGaugeStatus(
  pass1Passed: number,
  pass1Failed: number,
  pass1Skipped: number,
  stillFailing: number
): void {
  const status = {
    passed: pass1Passed + pass1Failed - stillFailing,
    failed: stillFailing,
    skipped: pass1Skipped,
    total: pass1Passed + pass1Failed + pass1Skipped,
  };
  fs.writeFileSync(
    path.join(runArtifactDirectory, 'gauge-status.json'),
    `${JSON.stringify(status, null, 2)}\n`,
    'utf8'
  );
}

function adjustCountSpan(html: string, className: string, delta: number): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(class="${escaped}"[^>]*>\\s*<span class="value">)(\\d+)(</span>)`);
  return html.replace(re, (_full, pre, value, post) => `${pre}${Number(value) + delta}${post}`);
}

// Patch the pass-1 index.html to final status: pie data-results, count spans, spec rows.
function reconcileHtmlReport(recoveredSpecHtmlPaths: string[], recoveredScenarios: number): void {
  const recoveredSpecs = recoveredSpecHtmlPaths.length;
  const indexFile = path.join(runArtifactDirectory, 'html-report', 'index.html');
  if ((recoveredSpecs === 0 && recoveredScenarios === 0) || !fs.existsSync(indexFile)) {
    return;
  }

  let html = fs.readFileSync(indexFile, 'utf8');

  html = html.replace(
    /(<svg id="pie-chart" data-results=")(\d+),(\d+),(\d+)(")/,
    (_full, pre, failed, passed, skipped, post) =>
      `${pre}${Number(failed) - recoveredSpecs},${Number(passed) + recoveredSpecs},${skipped}${post}`
  );
  html = html.replace(
    /(<title>Failed: )(\d+)(\/\d+<\/title>)/,
    (_full, pre, value, post) => `${pre}${Number(value) - recoveredSpecs}${post}`
  );
  html = html.replace(
    /(<title>Passed: )(\d+)(\/\d+<\/title>)/,
    (_full, pre, value, post) => `${pre}${Number(value) + recoveredSpecs}${post}`
  );

  html = adjustCountSpan(html, 'fail spec-filter', -recoveredSpecs);
  html = adjustCountSpan(html, 'pass spec-filter', recoveredSpecs);
  html = adjustCountSpan(html, 'fail scenario-stats', -recoveredScenarios);
  html = adjustCountSpan(html, 'pass scenario-stats', recoveredScenarios);

  for (const specHtml of recoveredSpecHtmlPaths) {
    const escaped = specHtml.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(href="${escaped}">\\s*<li class=")failed( spec-name")`);
    html = html.replace(re, '$1passed$2');
  }

  fs.writeFileSync(indexFile, html, 'utf8');
}

function logBanner(message: string): void {
  const line = `${message}\n`;
  process.stdout.write(line);
  gaugeLogStream.write(line);
}

function runGauge(gaugeArgs: string[], reportsDir: string, verbose: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('gauge', gaugeArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        gauge_reports_dir: reportsDir,
        XYNE_RUN_ARTIFACT_DIR: runArtifactDirectory,
        XYNE_RUN_ID: runDirectoryName,
      },
    });

    child.stdout?.on('data', (chunk) =>
      forwardChunk(chunk, process.stdout, gaugeLogStream, verbose)
    );
    child.stderr?.on('data', (chunk) =>
      forwardChunk(chunk, process.stderr, gaugeLogStream, verbose)
    );
    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve(code ?? 1));
  });
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

  let exitCode = await runGauge(pass1Args, runArtifactDirectory, true);

  // Read pass-1 counts before any deferred pass overwrites executionStatus.json.
  const pass1Status = readExecutionStatus();
  const pass1Passed = pass1Status?.scePassed ?? 0;
  const pass1Failed = pass1Status?.sceFailed ?? 0;
  const pass1Skipped = pass1Status?.sceSkipped ?? 0;

  const maxDeferredPasses = Math.max(0, testConfig.retries);
  const retryReportsDir = path.join(runArtifactDirectory, '.retry-tmp');
  const pass1FailedItems = exitCode === 0 ? [] : readFailedItems();
  let stillFailing = pass1FailedItems.length;

  if (exitCode !== 0 && stillFailing > 0 && maxDeferredPasses > 0) {
    const initialFailures = readFailedItems();
    logBanner('\n════════════════════════ RETRIES ════════════════════════');
    logBanner(
      `${initialFailures.length} scenario(s) failed on the first pass — retrying serially at end of run:`
    );
    for (const item of initialFailures) {
      logBanner(`   • ${item}`);
    }

    for (let attempt = 1; exitCode !== 0 && attempt <= maxDeferredPasses; attempt++) {
      const failedItems = readFailedItems();
      if (failedItems.length === 0) {
        break;
      }
      logBanner(
        `\n🔁 Attempt ${attempt}/${maxDeferredPasses} — re-running ${failedItems.length} scenario(s)...`
      );
      exitCode = await runGauge(['run', '--sort=alpha', ...failedItems], retryReportsDir, false);
      stillFailing = exitCode === 0 ? 0 : readFailedItems().length;
      logBanner(
        `   ✔ ${Math.max(0, pass1Failed - stillFailing)} recovered, ${stillFailing} still failing`
      );
    }

    logBanner(
      stillFailing === 0
        ? `\n✅ All ${pass1Failed} failed scenario(s) recovered on retry.`
        : `\n❌ ${stillFailing} scenario(s) still failing after ${maxDeferredPasses} retry pass(es).`
    );
    logBanner('══════════════════════════════════════════════════════════\n');
  }

  fs.rmSync(retryReportsDir, { recursive: true, force: true });

  const specOf = (item: string): string => item.replace(/:\d+$/, '');
  const finalFailedSpecs = new Set((stillFailing === 0 ? [] : readFailedItems()).map(specOf));
  const recoveredSpecHtmlPaths = [...new Set(pass1FailedItems.map(specOf))]
    .filter((spec) => !finalFailedSpecs.has(spec))
    .map((spec) => spec.replace(/\.spec$/, '.html'));
  reconcileHtmlReport(recoveredSpecHtmlPaths, Math.max(0, pass1Failed - stillFailing));

  if (pass1Status) {
    writeGaugeStatus(pass1Passed, pass1Failed, pass1Skipped, stillFailing);
  }

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
