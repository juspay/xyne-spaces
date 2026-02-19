import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import chalk from 'chalk';

import { formatDuration } from '@/scripts/local-test-runner/test-runner.helpers';
import { StepDef, StepResult } from '@/scripts/local-test-runner/test-runner.types';
import { TestRunnerUI } from '@/scripts/local-test-runner/test-runner.ui';

export async function runStep(
  step: StepDef,
  pendingTitles: string[],
  ui: TestRunnerUI
): Promise<StepResult> {
  const { title, command, args, preRun, condition, logFile } = step;

  const shouldRun = typeof condition === 'function' ? condition() : (condition ?? true);

  // If condition is false, we just return skipped result.
  if (!shouldRun) {
    ui.log(`${chalk.yellow('○')} ${chalk.gray(title + ' [SKIPPED]')}`);
    const reason = typeof step.skipReason === 'function' ? step.skipReason() : step.skipReason;
    if (reason) {
      ui.log(chalk.gray(`     | - ${reason}`));
    }
    return {
      title,
      status: 'skipped',
      duration: 0,
      description: reason,
    };
  }

  if (preRun) preRun();

  const start = Date.now();

  let logStream: fs.WriteStream | null = null;
  if (logFile) {
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // 'a' for append, so multiple steps can write to same file if configured
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
  }

  const child = spawn(command, args, {
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env, ...step.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handleData = (data: Buffer): void => {
    const text = data.toString();
    ui.write(text);
    if (logStream) {
      // Strip ANSI codes before writing to log file for cleaner logs?
      // Or keep them for colored logs if viewed in terminal?
      // Usually log files are better without ANSI codes for grep ability, but with 'less -R' user can view colors.
      // User asked for "logs to file", usually implies raw text.
      // But let's keep it simple and just write raw output first.
      // Actually stripping ANSI is safer for general text editors.
      // eslint-disable-next-line no-control-regex
      const cleanText = text.replace(/\x1B\[\d+m/g, '');
      logStream.write(cleanText);
    }
  };

  child.stdout?.on('data', handleData);
  child.stderr?.on('data', handleData);

  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (logStream) {
        logStream.end();
      }

      const duration = Date.now() - start;
      const elapsed = formatDuration(duration);

      if (code === 0) {
        ui.log(chalk.green(`✔ ${title} completed in ${elapsed}`));
        resolve({
          title,
          status: 'passed',
          duration,
        });
      } else {
        const errorMsg = `Step "${title}" failed with exit code ${code}`;
        ui.log(chalk.red(`✖ ${title} failed in ${elapsed} with exit code ${code}`));
        reject(new Error(errorMsg));
      }
    });

    child.on('error', (err) => {
      if (logStream) {
        logStream.end();
      }
      ui.log(chalk.red(`✖ Error: ${err.message}`));
      reject(err);
    });
  });
}
