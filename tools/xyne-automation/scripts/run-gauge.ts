/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'dotenv';
import { environment, config as testConfig } from '@/config';
import { closeLogger, setLoggerFileLabel } from '@/lib/logger';
import { formatTestProgress, TestProgressTracker } from '@/lib/test-progress';
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
  totalScenarios: number;
  progressFile: string;
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
const targets = positionalArgs.length > 0 ? positionalArgs : ['tests'];
const excludedScenarioTag = 'quarantine';
const scenarioTagFilter = `!${excludedScenarioTag}`;

interface ParsedScenario {
  line: number;
  tags: Set<string>;
}

function collectSpecSelections(testTargets: string[]): Map<string, Set<number> | null> {
  const selections = new Map<string, Set<number> | null>();

  const addSelection = (filePath: string, line?: number): void => {
    const absolutePath = path.resolve(filePath);
    if (!selections.has(absolutePath) || line === undefined) {
      selections.set(absolutePath, line === undefined ? null : new Set([line]));
      return;
    }

    selections.get(absolutePath)?.add(line);
  };

  const addDirectory = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) addDirectory(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.spec')) addSelection(entryPath);
    }
  };

  for (const target of testTargets) {
    const scenarioTarget = target.match(/^(.*\.spec):(\d+)$/);
    const targetPath = path.resolve(scenarioTarget?.[1] ?? target);
    if (!fs.existsSync(targetPath)) continue;

    const targetStats = fs.statSync(targetPath);
    if (targetStats.isDirectory()) addDirectory(targetPath);
    else if (targetStats.isFile() && targetPath.endsWith('.spec')) {
      addSelection(targetPath, scenarioTarget ? Number.parseInt(scenarioTarget[2], 10) : undefined);
    }
  }

  return selections;
}

function parseScenarios(specFile: string): ParsedScenario[] {
  const lines = fs.readFileSync(specFile, 'utf8').split('\n');
  const specTags = new Set<string>();
  const scenarios: ParsedScenario[] = [];
  let currentScenario: ParsedScenario | null = null;

  for (const [index, line] of lines.entries()) {
    if (/^##\s+/.test(line)) {
      if (currentScenario) scenarios.push(currentScenario);
      currentScenario = { line: index + 1, tags: new Set(specTags) };
      continue;
    }

    const tagLine = line.match(/^\s*tags:\s*(.+)$/i);
    if (!tagLine) continue;

    const destination = currentScenario?.tags ?? specTags;
    for (const tag of tagLine[1].split(',')) {
      destination.add(tag.trim());
    }
  }

  if (currentScenario) scenarios.push(currentScenario);
  return scenarios;
}

function countScenariosWithTag(testTargets: string[], tag: string): number {
  let count = 0;

  for (const [specFile, selectedLines] of collectSpecSelections(testTargets)) {
    const scenarios = parseScenarios(specFile);

    for (const [index, scenario] of scenarios.entries()) {
      const nextScenarioLine = scenarios[index + 1]?.line ?? Number.POSITIVE_INFINITY;
      const isSelected =
        selectedLines === null ||
        [...selectedLines].some(
          (selectedLine) => selectedLine >= scenario.line && selectedLine < nextScenarioLine
        );

      if (isSelected && scenario.tags.has(tag)) count++;
    }
  }

  return count;
}

function countScenarios(testTargets: string[]): number {
  const output = execFileSync('gauge', ['-m', 'list', '--scenarios', ...testTargets], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const scenarios = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as { type?: unknown; message?: unknown };
        return parsed.type === 'out' &&
          typeof parsed.message === 'string' &&
          parsed.message !== '[Scenarios]'
          ? [parsed.message]
          : [];
      } catch {
        return [];
      }
    });

  const runnableScenarios =
    scenarios.length - countScenariosWithTag(testTargets, excludedScenarioTag);

  if (runnableScenarios <= 0) {
    throw new Error(`Gauge did not find any scenarios for: ${testTargets.join(', ')}`);
  }

  return runnableScenarios;
}

const totalScenarios = countScenarios(targets);

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
const progressFile = path.join(runArtifactDirectory, 'test-progress.jsonl');

fs.mkdirSync(runArtifactDirectory, { recursive: true });
fs.writeFileSync(progressFile, '', 'utf8');

console.log(`\n📁 Run artifacts: ${path.relative(process.cwd(), runArtifactDirectory)}\n`);

const gaugeArgs = [
  'run',
  '--sort=alpha',
  // Retry failed scenarios; gauge rejects `--max-retries-count 0`, so only pass it when retries > 0.
  ...(testConfig.retries > 0 ? ['--max-retries-count', String(testConfig.retries)] : []),
  // Exclude quarantined (known-flaky) scenarios.
  '--tags',
  scenarioTagFilter,
  '-p',
  '-n',
  String(parallelCount),
  ...targets,
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
  command: ['gauge', ...gaugeArgs],
  targets,
  totalScenarios,
  progressFile,
};

writeRunMetadata(initialRunMetadata);

const gaugeLogStream = fs.createWriteStream(gaugeLogFile, { flags: 'w' });

function writeProgressLine(line: string): void {
  console.log(line);
  gaugeLogStream.write(`${line}\n`);
}

function startProgressMonitor(): () => void {
  const tracker = new TestProgressTracker(progressFile, totalScenarios);
  writeProgressLine(formatTestProgress(tracker.getStats()));

  const drain = () => {
    for (const update of tracker.drain()) {
      writeProgressLine(formatTestProgress(update.stats, update.event));
    }
  };

  const timer = setInterval(drain, 200);

  return () => {
    clearInterval(timer);
    drain();
  };
}

let stopCurrentProgressMonitor: (() => void) | undefined;

function stopProgressMonitoring(): void {
  stopCurrentProgressMonitor?.();
  stopCurrentProgressMonitor = undefined;
}

function forwardChunk(
  chunk: string | Buffer,
  destination: NodeJS.WriteStream,
  logStream: fs.WriteStream
): void {
  destination.write(chunk);
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
  firstPassPassed: number,
  firstPassFailed: number,
  firstPassSkipped: number,
  stillFailing: number
): void {
  const status = {
    passed: firstPassPassed + firstPassFailed - stillFailing,
    failed: stillFailing,
    skipped: firstPassSkipped,
    total: firstPassPassed + firstPassFailed + firstPassSkipped,
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

function reconcileHtmlReport(recoveredSpecHtmlPaths: string[], recoveredScenarios: number): void {
  const recoveredSpecs = recoveredSpecHtmlPaths.length;
  const indexFile = path.join(htmlReportDirectory, 'index.html');
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
  writeProgressLine(message);
}

function runGauge(args: string[], reportsDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('gauge', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        gauge_reports_dir: reportsDir,
        XYNE_RUN_ARTIFACT_DIR: runArtifactDirectory,
        XYNE_RUN_ID: runDirectoryName,
      },
    });

    child.stdout?.on('data', (chunk) => forwardChunk(chunk, process.stdout, gaugeLogStream));
    child.stderr?.on('data', (chunk) => forwardChunk(chunk, process.stderr, gaugeLogStream));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  process.env.gauge_reports_dir = runArtifactDirectory;
  process.env.XYNE_RUN_ARTIFACT_DIR = runArtifactDirectory;
  process.env.XYNE_RUN_ID = runDirectoryName;
  process.env.XYNE_TEST_PROGRESS_FILE = progressFile;
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

  stopCurrentProgressMonitor = startProgressMonitor();
  let exitCode = await runGauge(gaugeArgs, runArtifactDirectory);

  // Gauge has already applied the inline --max-retries-count budget. Snapshot only
  // the scenarios that exhausted those retries, then give that array a final pass.
  const firstPassStatus = readExecutionStatus();
  const firstPassPassed = firstPassStatus?.scePassed ?? 0;
  const firstPassFailed = firstPassStatus?.sceFailed ?? 0;
  const firstPassSkipped = firstPassStatus?.sceSkipped ?? 0;
  const failedAfterInlineRetries = exitCode === 0 ? [] : readFailedItems();
  let remainingFailedItems = [...failedAfterInlineRetries];

  const maxDeferredPasses = Math.max(0, testConfig.retries);
  const retryReportsDirectory = path.join(runArtifactDirectory, '.retry-tmp');

  if (remainingFailedItems.length > 0 && maxDeferredPasses > 0) {
    logBanner('\n════════════════════ END-OF-RUN RETRIES ════════════════════');
    logBanner(
      `${remainingFailedItems.length} scenario(s) exhausted inline retries; retrying them serially at the end:`
    );
    for (const item of remainingFailedItems) {
      logBanner(`   • ${item}`);
    }

    for (let attempt = 1; remainingFailedItems.length > 0; attempt++) {
      if (attempt > maxDeferredPasses) break;

      logBanner(
        `\n🔁 Final pass ${attempt}/${maxDeferredPasses} — re-running ${remainingFailedItems.length} scenario(s)...`
      );
      exitCode = await runGauge(
        ['run', '--sort=alpha', ...remainingFailedItems],
        retryReportsDirectory
      );
      remainingFailedItems = exitCode === 0 ? [] : readFailedItems();

      logBanner(
        `   ✔ ${Math.max(0, firstPassFailed - remainingFailedItems.length)} recovered, ${remainingFailedItems.length} still failing`
      );
    }

    logBanner(
      remainingFailedItems.length === 0
        ? `\n✅ All ${firstPassFailed} failed scenario(s) recovered in the end-of-run retries.`
        : `\n❌ ${remainingFailedItems.length} scenario(s) still failing after ${maxDeferredPasses} end-of-run retry pass(es).`
    );
    logBanner('════════════════════════════════════════════════════════════\n');
  }

  stopProgressMonitoring();
  fs.rmSync(retryReportsDirectory, { recursive: true, force: true });

  const specOf = (item: string): string => item.replace(/:\d+$/, '');
  const finalFailedSpecs = new Set(remainingFailedItems.map(specOf));
  const recoveredSpecHtmlPaths = [...new Set(failedAfterInlineRetries.map(specOf))]
    .filter((spec) => !finalFailedSpecs.has(spec))
    .map((spec) => spec.replace(/\.spec$/, '.html'));
  reconcileHtmlReport(
    recoveredSpecHtmlPaths,
    Math.max(0, firstPassFailed - remainingFailedItems.length)
  );

  if (firstPassStatus) {
    writeGaugeStatus(
      firstPassPassed,
      firstPassFailed,
      firstPassSkipped,
      remainingFailedItems.length
    );
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
  stopProgressMonitoring();
  gaugeLogStream.end(() => {
    writeFinalRunMetadata(1);
    process.exitCode = 1;
    console.error(error);
  });
});
