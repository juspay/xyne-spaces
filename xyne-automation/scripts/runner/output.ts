/** biome-ignore-all lint/suspicious/noConsole: CLI script intentionally uses console for output */
import * as readline from 'node:readline';
import chalk from 'chalk';
import type { StepEntry, TestStats } from '@/scripts/runner/artifacts';
import type { RunMode } from '@/scripts/runner/ports';

export interface OutputRenderer {
  start(commitHash: string, totalSteps: number): void;
  startStep(index: number, title: string): void;
  stepOutput(data: string): void;
  endStep(result: StepEntry): void;
  log(message: string): void;
  printSummary(results: StepEntry[], testStats?: TestStats, reportPath?: string): void;
  cleanup(): void;
}

export function createRenderer(mode: RunMode, forcePlain: boolean): OutputRenderer {
  if (mode === 'ci' || forcePlain || !process.stdout.isTTY) {
    return new PlainRenderer();
  }
  return new TuiRenderer();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
const ANSI_REGEX = /\x1B\[[0-9;]*[A-Za-z]/g;
const NOISE_REGEX = /^[.✔✓✗✕]+$/;

function isNoise(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const stripped = trimmed.replace(ANSI_REGEX, '');
  if (!stripped) return true;
  return NOISE_REGEX.test(stripped);
}

class PlainRenderer implements OutputRenderer {
  private totalSteps = 0;
  private startTime = 0;

  start(commitHash: string, totalSteps: number): void {
    this.totalSteps = totalSteps;
    this.startTime = Date.now();
    console.log(`\n=== XYNE TEST RUNNER ===`);
    console.log(`Commit: ${commitHash}`);
    console.log(`Steps:  ${totalSteps}\n`);
  }

  startStep(index: number, title: string): void {
    console.log(`[  ] Step ${index + 1}/${this.totalSteps} - ${title}`);
  }

  stepOutput(data: string): void {
    for (const line of data.toString().split('\n')) {
      if (!isNoise(line)) console.log(`     ${line}`);
    }
  }

  endStep(result: StepEntry): void {
    const icon = result.status === 'passed' ? 'OK' : result.status === 'failed' ? 'FAIL' : 'SKIP';
    console.log(`[${icon}] ${result.title} (${formatDuration(result.duration)})`);
    if (result.error) console.log(`     Error: ${result.error}`);
  }

  log(message: string): void {
    console.log(message);
  }

  printSummary(results: StepEntry[], testStats?: TestStats, reportPath?: string): void {
    const totalDuration = Date.now() - this.startTime;
    console.log('\n=== SUMMARY ===\n');

    for (const r of results) {
      const icon = r.status === 'passed' ? '[OK]  ' : r.status === 'failed' ? '[FAIL]' : '[SKIP]';
      console.log(`${icon} ${r.title} (${formatDuration(r.duration)})`);
    }

    if (testStats) {
      console.log(
        `\nTests: ${testStats.passed} passed, ${testStats.failed} failed, ${testStats.skipped} skipped (${testStats.total} total)`
      );
    }

    if (reportPath) console.log(`Report: ${reportPath}`);
    console.log(`\nTotal: ${formatDuration(totalDuration)}`);
  }

  cleanup(): void {}
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

class TuiRenderer implements OutputRenderer {
  private totalSteps = 0;
  private startTime = 0;
  private currentStep = '';
  private currentIndex = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private spinnerFrame = 0;
  private stepStartTime = 0;

  start(commitHash: string, totalSteps: number): void {
    this.totalSteps = totalSteps;
    this.startTime = Date.now();
    process.stdout.write('\x1B[?25l');
    console.log('');
    console.log(chalk.bold.cyan('  XYNE TEST RUNNER'));
    console.log(chalk.gray(`  Commit: ${commitHash}`));
    console.log('');
  }

  startStep(index: number, title: string): void {
    this.currentStep = title;
    this.currentIndex = index;
    this.stepStartTime = Date.now();
    this.spinnerFrame = 0;
    this.spinnerTimer = setInterval(() => this.renderSpinnerLine(), SPINNER_INTERVAL);
    this.renderSpinnerLine();
  }

  stepOutput(data: string): void {
    for (const line of data.toString().split('\n')) {
      if (isNoise(line)) continue;
      this.clearCurrentLine();
      console.log(chalk.gray(`    ${line.trim()}`));
      this.renderSpinnerLine();
    }
  }

  endStep(result: StepEntry): void {
    this.stopSpinner();
    this.clearCurrentLine();

    const icon =
      result.status === 'passed'
        ? chalk.green('✓')
        : result.status === 'failed'
          ? chalk.red('✗')
          : chalk.yellow('○');

    const duration = chalk.gray(`(${formatDuration(result.duration)})`);
    const titleColor =
      result.status === 'failed'
        ? chalk.red
        : result.status === 'skipped'
          ? chalk.yellow
          : chalk.white;

    console.log(`  ${icon} ${titleColor(result.title)} ${duration}`);
    if (result.error) console.log(chalk.red(`    ${result.error}`));
  }

  log(message: string): void {
    this.clearCurrentLine();
    console.log(chalk.gray(`  ${message}`));
    if (this.spinnerTimer) this.renderSpinnerLine();
  }

  printSummary(results: StepEntry[], testStats?: TestStats, reportPath?: string): void {
    const totalDuration = Date.now() - this.startTime;
    const failed = results.some((r) => r.status === 'failed');

    console.log('');
    console.log(chalk.bold(failed ? chalk.red('  FAILED') : chalk.green('  PASSED')));
    console.log('');

    const maxTitleLen = Math.max(...results.map((r) => r.title.length));

    for (const r of results) {
      const icon =
        r.status === 'passed'
          ? chalk.green('✓')
          : r.status === 'failed'
            ? chalk.red('✗')
            : chalk.yellow('○');

      const title = r.title.padEnd(maxTitleLen);
      const titleColor =
        r.status === 'failed' ? chalk.red : r.status === 'skipped' ? chalk.yellow : chalk.white;

      console.log(`  ${icon} ${titleColor(title)}  ${chalk.gray(formatDuration(r.duration))}`);
    }

    if (testStats) {
      console.log('');
      const parts: string[] = [];
      if (testStats.passed > 0) parts.push(chalk.green(`${testStats.passed} passed`));
      if (testStats.failed > 0) parts.push(chalk.red(`${testStats.failed} failed`));
      if (testStats.skipped > 0) parts.push(chalk.yellow(`${testStats.skipped} skipped`));
      console.log(`  Tests: ${parts.join(', ')} ${chalk.gray(`(${testStats.total} total)`)}`);
    }

    if (reportPath) {
      console.log('');
      console.log(`  Report: ${chalk.underline.cyan(reportPath)}`);
    }

    console.log('');
    console.log(chalk.gray(`  Total: ${formatDuration(totalDuration)}`));
    console.log('');
  }

  cleanup(): void {
    this.stopSpinner();
    process.stdout.write('\x1B[?25h');
  }

  private renderSpinnerLine(): void {
    const frame = chalk.cyan(SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length]);
    const elapsed = formatDuration(Date.now() - this.stepStartTime);
    const line = `  ${frame} Step ${this.currentIndex + 1}/${this.totalSteps} ${chalk.bold(this.currentStep)} ${chalk.gray(elapsed)}`;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(line);

    this.spinnerFrame++;
  }

  private clearCurrentLine(): void {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }
}
