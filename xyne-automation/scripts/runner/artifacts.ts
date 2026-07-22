import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TestStats {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface StepEntry {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

interface GaugeScenario {
  executionStatus: string;
}

interface GaugeSpec {
  scenarios?: GaugeScenario[];
}

export function findLatestReport(reportDir: string): string | null {
  if (!fs.existsSync(reportDir)) return null;

  const directHtmlReport = path.join(reportDir, 'html-report', 'index.html');
  if (fs.existsSync(directHtmlReport)) return directHtmlReport;

  const dirs = fs
    .readdirSync(reportDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const htmlReport = path.join(reportDir, dir, 'html-report', 'index.html');
    if (fs.existsSync(htmlReport)) return htmlReport;
  }

  return null;
}

export function parseGaugeReport(reportDir: string): TestStats | null {
  if (!fs.existsSync(reportDir)) return null;

  const statusStats = parseGaugeStatusFile(reportDir);
  if (statusStats) return statusStats;

  const directResultPath = path.join(reportDir, 'html-report', 'result.js');
  if (fs.existsSync(directResultPath)) return parseResultJs(directResultPath);

  const dirs = fs
    .readdirSync(reportDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const resultPath = path.join(reportDir, dir, 'html-report', 'result.js');
    if (fs.existsSync(resultPath)) return parseResultJs(resultPath);
  }

  return null;
}

function readGaugeStatus(filePath: string): TestStats | null {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<TestStats>;
    const passed = data.passed ?? 0;
    const failed = data.failed ?? 0;
    const skipped = data.skipped ?? 0;
    return { passed, failed, skipped, total: passed + failed + skipped };
  } catch {
    return null;
  }
}

function parseGaugeStatusFile(reportDir: string): TestStats | null {
  const direct = path.join(reportDir, 'gauge-status.json');
  if (fs.existsSync(direct)) return readGaugeStatus(direct);

  const dirs = fs
    .readdirSync(reportDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const candidate = path.join(reportDir, dir, 'gauge-status.json');
    if (fs.existsSync(candidate)) return readGaugeStatus(candidate);
  }

  return null;
}

function parseResultJs(filePath: string): TestStats | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const jsonMatch = content.match(/var defined\s*=\s*({[\s\S]*});?\s*$/);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[1]);
    const specs: GaugeSpec[] = data.suiteResult?.specResults || [];

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const spec of specs) {
      if (!spec.scenarios) continue;
      for (const scenario of spec.scenarios) {
        switch (scenario.executionStatus) {
          case 'pass':
            passed++;
            break;
          case 'fail':
            failed++;
            break;
          case 'skip':
            skipped++;
            break;
        }
      }
    }

    return { passed, failed, skipped, total: passed + failed + skipped };
  } catch {
    return null;
  }
}

export function writeRunMetadata(
  config: {
    commitHash: string;
    mode: string;
    composeProjectName: string;
    testTargets: string[];
    portMap: Record<string, number>;
  },
  results: StepEntry[],
  testStats: TestStats | null,
  outputDir: string
): void {
  const metadata = {
    runId: `${config.commitHash}-${Date.now()}`,
    commitHash: config.commitHash,
    timestamp: new Date().toISOString(),
    mode: config.mode,
    composeProjectName: config.composeProjectName,
    testTargets: config.testTargets,
    portMap: config.portMap,
    steps: results.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      duration: r.duration,
      error: r.error,
    })),
    testStatistics: testStats,
    exitCode: results.some((r) => r.status === 'failed') ? 1 : 0,
  };

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(path.join(outputDir, 'runner-summary.json'), JSON.stringify(metadata, null, 2));
}
