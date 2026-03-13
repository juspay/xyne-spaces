import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { TestStatistics } from '@/scripts/local-test-runner/test-runner.types';

/**
 * Check if running in plain output mode (non-interactive).
 * Used to determine if we should skip ANSI colors and terminal features.
 */
export function isPlainMode(): boolean {
  return process.env.OUTPUT_MODE === 'plain' || !process.stdout.isTTY;
}

export function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function areDevServicesRunning(): boolean {
  try {
    // Check if any containers are running for the dev compose file
    // -q returns container IDs if running, empty string if not
    const output = execSync('docker compose -f docker-compose.dev.yml ps -q', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'], // suppress stderr
    }).trim();
    return output.length > 0;
  } catch {
    // If docker command fails (e.g. docker not running), assume services aren't running
    return false;
  }
}

/**
 * Strip ANSI escape sequences.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}m${secs}s`;
}

export function titleWithTimer(title: string, elapsed: string): string {
  const cols = process.stdout.columns || 80;
  const timerStr = `[${elapsed}]`;
  const availableWidth = cols - 4;
  const gap = Math.max(1, availableWidth - title.length - timerStr.length);
  return `${title}${' '.repeat(gap)}${timerStr}`;
}

interface CucumberStep {
  result?: {
    status: string;
  };
}

interface CucumberElement {
  steps?: CucumberStep[];
}

interface CucumberReport {
  elements?: CucumberElement[];
}

/**
 * Parse the cucumber JSON report and extract test statistics.
 * Returns null if report file doesn't exist or is malformed.
 */
export function parseCucumberReport(reportPath: string): TestStatistics | null {
  try {
    if (!fs.existsSync(reportPath)) {
      return null;
    }

    const content = fs.readFileSync(reportPath, 'utf-8');
    const report: CucumberReport[] = JSON.parse(content);

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const feature of report) {
      if (!feature.elements) continue;

      for (const element of feature.elements) {
        if (!element.steps) {
          skipped++;
          continue;
        }

        const steps = element.steps;
        if (steps.length === 0) {
          skipped++;
          continue;
        }

        const hasFailed = steps.some((s) => s.result?.status === 'failed');
        const hasSkipped = steps.some((s) => s.result?.status === 'skipped');
        const allPassed = steps.every((s) => s.result?.status === 'passed');

        if (hasFailed) {
          failed++;
        } else if (allPassed) {
          passed++;
        } else if (hasSkipped) {
          skipped++;
        } else {
          // Fallback for any other status
          skipped++;
        }
      }
    }

    return {
      passed,
      failed,
      skipped,
      total: passed + failed + skipped,
    };
  } catch {
    return null;
  }
}

/**
 * Find the latest cucumber report in the report directory.
 * Returns null if no report is found.
 */
export function findLatestCucumberReport(projectRoot: string): string | null {
  const reportDir = path.join(projectRoot, 'xyne-automation/report');

  try {
    if (!fs.existsSync(reportDir)) {
      return null;
    }

    const entries = fs.readdirSync(reportDir, { withFileTypes: true });
    const reportDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const dir of reportDirs) {
      const reportPath = path.join(reportDir, dir, 'cucumber-report.json');
      if (fs.existsSync(reportPath)) {
        return reportPath;
      }
    }

    return null;
  } catch {
    return null;
  }
}
