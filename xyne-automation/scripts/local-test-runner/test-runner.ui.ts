import chalk from 'chalk';

import { formatDuration, git } from '@/scripts/local-test-runner/test-runner.helpers';

// Helper for ANSI escape codes
const ESC = '\x1B[';
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_SCREEN = `${ESC}2J`;
const HOME = `${ESC}H`;

import { StepResult, TestStatistics } from '@/scripts/local-test-runner/test-runner.types';

export class TestRunnerUI {
  private headerHeight = 0;
  private currentStepIndex = 0;
  private totalSteps = 0;
  private currentTitle = '';
  private spinnerInterval: NodeJS.Timeout | null = null;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private stepStartTime = 0;
  private scriptStartTime = 0;

  // Cache git info
  private gitHash = '';
  private gitDate = '';
  private isSummaryShown = false;

  constructor(totalSteps: number) {
    this.totalSteps = totalSteps;
  }

  public start(): void {
    this.scriptStartTime = Date.now();
    this.gitHash = git('rev-parse --short HEAD');
    this.gitDate = git("log -1 --pretty=format:'%ar'").replace(/^'|'$/g, '');

    process.stdout.write(HIDE_CURSOR);
    process.stdout.write(CLEAR_SCREEN);
    process.stdout.write(HOME);

    this.printHeader();
    this.setupScrollRegion();
  }

  private center(text: string): string {
    const width = process.stdout.columns || 80;
    // eslint-disable-next-line no-control-regex
    const plainText = text.replace(/\u001b\[\d+m/g, ''); // strip ansi for length calculation
    const padding = Math.max(0, Math.floor((width - plainText.length) / 2));
    return ' '.repeat(padding) + text;
  }

  private printHeader(): void {
    // Layout:
    // 1: empty
    // 2: empty
    // 3: TITLE (Centered)
    // 4: empty
    // 5: Info (Centered): Commit | Date | Total Time
    // 6: Divider
    // 7: Status Line (Centered)
    // 8: Divider

    const width = process.stdout.columns || 80;
    const title = chalk.cyan.bold('🧪 XYNE AUTOMATION TEST RUNNER');

    // Initial info line (Total Time 0s)
    const info = this.formatInfoLine('0s');

    const div = chalk.gray('─'.repeat(width));

    const lines = ['', '', this.center(title), '', this.center(info), div, '', div];

    process.stdout.write(lines.join('\n') + '\n');
    this.headerHeight = lines.length;
  }

  private formatInfoLine(totalTime: string): string {
    return `${chalk.gray('Commit:')} ${chalk.white(this.gitHash)}   ${chalk.gray('Commit Time:')} ${chalk.white(this.gitDate)}   ${chalk.gray('Run Time:')} ${chalk.white(totalTime)}`;
  }

  private setupScrollRegion(): void {
    const top = this.headerHeight + 1;
    const bottom = process.stdout.rows || 24;
    process.stdout.write(`${ESC}${top};${bottom}r`);
    this.moveToLogArea();
  }

  private moveToLogArea(): void {
    process.stdout.write(`${ESC}${this.headerHeight + 1};1H`);
  }

  private updateStatusLine(statusIcon: string, color: (s: string) => string): void {
    process.stdout.write(`${ESC}s`); // Save cursor

    // --- Update Info Line (Row 4) ---
    const totalElapsed = formatDuration(Date.now() - this.scriptStartTime);
    const infoLineContent = this.center(this.formatInfoLine(totalElapsed));

    process.stdout.write(`${ESC}5;1H`); // Move to Row 4
    process.stdout.write(`${ESC}2K`); // Clear line
    process.stdout.write(infoLineContent);

    // --- Update Status Line (Row 6) ---
    const stepText = `Step ${this.currentStepIndex + 1}/${this.totalSteps}`;
    const stepElapsed = this.stepStartTime
      ? formatDuration(Date.now() - this.stepStartTime)
      : '0ms';

    // "⠙ Step 3/7 - Building Docker services... (19.5s)"
    // Centered.
    const rawStatus = `${statusIcon}  ${chalk.bold(stepText)} - ${this.currentTitle}  ${chalk.gray(`(${stepElapsed})`)}`;
    const coloredStatus = `${color(statusIcon)}  ${chalk.bold(stepText)} - ${this.currentTitle}  ${chalk.gray(`(${stepElapsed})`)}`;

    // We need to center based on visible length, but print the colored version.
    // My center() helper strips ansi, but it returns padding + text.
    // I can calculate padding manually.
    const width = process.stdout.columns || 80;
    // eslint-disable-next-line no-control-regex
    const visibleLength = rawStatus.replace(/\u001b\[\d+m/g, '').length; // Approximate visible length (statusIcon is 1 char)
    // Actually statusIcon might be 1 char.
    const padding = Math.max(0, Math.floor((width - visibleLength) / 2));

    process.stdout.write(`${ESC}7;1H`); // Move to Row 6
    process.stdout.write(`${ESC}2K`); // Clear line
    process.stdout.write(' '.repeat(padding) + coloredStatus);

    process.stdout.write(`${ESC}u`); // Restore cursor
  }

  public startStep(index: number, title: string): void {
    this.clearLogs();
    this.currentStepIndex = index;
    this.currentTitle = title;
    this.stepStartTime = Date.now();

    if (this.spinnerInterval) clearInterval(this.spinnerInterval);

    this.frameIndex = 0;
    this.spinnerInterval = setInterval(() => {
      const frame = this.spinnerFrames[this.frameIndex++ % this.spinnerFrames.length];
      this.updateStatusLine(frame, chalk.cyan);
    }, 80);

    this.updateStatusLine(this.spinnerFrames[0], chalk.cyan);
  }

  public endStep(success: boolean): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    const icon = success ? '✔' : '✖';
    const color = success ? chalk.green : chalk.red;
    this.updateStatusLine(icon, color);
  }

  public clearLogs(): void {
    this.moveToLogArea();
    process.stdout.write(`${ESC}0J`); // Clear screen from cursor down
  }

  public log(data: string): void {
    // Ensure we are in the scroll region (not strictly necessary if we just write to stdout,
    // effectively logs append to bottom, forcing scroll if in region)
    // But to be safe, we just write.
    // The standard behavior of a scroll region is that text written at the bottom scrolls the region.

    // We should strip empty lines or control chars if they mess up layout, but raw output is usually fine.
    process.stdout.write(data);
    if (!data.endsWith('\n')) process.stdout.write('\n');
  }

  public write(data: string): void {
    process.stdout.write(data);
  }

  private stepResults: StepResult[] = [];

  public addResult(result: StepResult): void {
    this.stepResults.push(result);
  }

  public overrideStatusLine(text: string): void {
    process.stdout.write(`${ESC}s`); // Save cursor

    // Clear Row 7
    process.stdout.write(`${ESC}7;1H`);
    process.stdout.write(`${ESC}2K`);

    const centered = this.center(chalk.bold.cyan(text));
    process.stdout.write(centered);

    process.stdout.write(`${ESC}u`); // Restore cursor
  }

  private summaryHeight = 0;

  public printSummary(testStats?: TestStatistics, htmlReportPath?: string): void {
    this.isSummaryShown = true;

    // Reset scroll region so summary prints normally without being cut off
    process.stdout.write(`${ESC}r`);
    this.clearLogs();

    // Re-print header or ensure we are below it?
    // Actually if we reset scroll region, the header might be lost if we cleared screen or scrolled.
    // Ideally we want to print summary below the header.
    // `clearLogs` clears from `headerHeight + 1` down.

    this.overrideStatusLine('EXECUTION SUMMARY');
    this.summaryHeight = 0; // Reset

    // Header for Summary
    const width = process.stdout.columns || 80;
    // const div = chalk.gray('─'.repeat(width)); // Dividers are part of header, nicely framing the status line.

    // User requested to remove title and dividers for summary section
    // and just show the list of steps cleanly.
    // Also right align the timer.

    // Removed initial spacing as per request "why soo much empty spaces"

    if (this.stepResults.length > 0) {
      this.stepResults.forEach((result) => {
        const icon =
          result.status === 'passed'
            ? chalk.green('✔')
            : result.status === 'failed'
              ? chalk.red('✖')
              : chalk.yellow('○');

        const durationStr = chalk.gray(`(${formatDuration(result.duration)})`);

        // Construct left side: Icon + Title
        const leftPart = ` ${icon}  ${result.title}`;

        // Strip ansi for length calc
        // eslint-disable-next-line no-control-regex
        const visibleLeftLen = leftPart.replace(/\u001b\[\d+m/g, '').length;
        // eslint-disable-next-line no-control-regex
        const visibleRightLen = durationStr.replace(/\u001b\[\d+m/g, '').length;

        // Push to rightmost end. width - 0.
        // Using Math.max(1, ...) to ensure at least one space if title is too long.
        const paddingLen = Math.max(1, width - visibleLeftLen - visibleRightLen);
        const padding = ' '.repeat(paddingLen);

        let line = `${leftPart}${padding}${durationStr}`;
        this.summaryHeight += 1;

        if (result.description) {
          line += `\n     - ${chalk.gray(result.description)}`;
          this.summaryHeight += 1;
        }

        if (result.error) {
          line += `\n     - ${chalk.red('Error:')} ${result.error}`;
          this.summaryHeight += 1; // Assuming error is 1 line, might be more but handling basic case
        }

        // Show test case statistics immediately after "Running the tests" step
        if (result.title === 'Running the tests' && testStats) {
          const statsStr = `${chalk.green(`${testStats.passed} passed`)}, ${chalk.red(`${testStats.failed} failed`)}, ${chalk.yellow(`${testStats.skipped} skipped`)}, ${testStats.total} total`;
          line += `\n     - ${chalk.gray('Test Cases:')} ${statsStr}`;
          this.summaryHeight += 1;

          if (htmlReportPath) {
            line += `\n     - ${chalk.gray('Click or copy paste into your browser:')} ${chalk.blue.underline(`file://${htmlReportPath}`)}`;
            this.summaryHeight += 1;
          }
        }

        this.log(line);
        // Removed extra spacing as per request
      });
    } else {
      this.log(chalk.yellow('No steps executed.'));
      this.summaryHeight += 1;
    }

    const div = chalk.gray('─'.repeat(width));
    this.log('');
    this.log(div);
    this.log('');
    this.summaryHeight += 3;
  }

  public showCursor(): void {
    process.stdout.write(SHOW_CURSOR);
  }

  public cleanup(): void {
    if (this.spinnerInterval) clearInterval(this.spinnerInterval);

    process.stdout.write(`${ESC}r`);

    if (this.isSummaryShown) {
      const lineCount = this.summaryHeight > 0 ? this.summaryHeight : 1;
      const targetY = Math.min(this.headerHeight + 1 + lineCount, process.stdout.rows || 24);
      process.stdout.write(`${ESC}${targetY};1H`);
      process.stdout.write('\n');
    } else {
      process.stdout.write(`${ESC}${process.stdout.rows || 24};1H`);
      process.stdout.write('\n');
    }

    this.showCursor();
  }
}
