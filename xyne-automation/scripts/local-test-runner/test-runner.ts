import fs from 'fs';
import path from 'path';

import { setupEnv } from '@/scripts/local-test-runner/test-runner.env';
import {
  areDevServicesRunning,
  findLatestCucumberReport,
  parseCucumberReport,
} from '@/scripts/local-test-runner/test-runner.helpers';
import { runStep } from '@/scripts/local-test-runner/test-runner.step';
import { StepDef, TestStatistics } from '@/scripts/local-test-runner/test-runner.types';
import { TestRunnerUI } from '@/scripts/local-test-runner/test-runner.ui';

async function runTests(): Promise<void> {
  const projectRoot = process.env.PROJECT_ROOT || process.cwd();
  process.chdir(projectRoot);

  const { composeProjectName, failedStage } = setupEnv();
  const env = {
    COMPOSE_PROJECT_NAME: composeProjectName,
    FAILED_STAGE: failedStage,
  };

  const isDevRunning = areDevServicesRunning();
  const composeFiles = ['-f', 'docker-compose.dev.yml', '-f', 'docker-compose.test.yml'];

  const completedSteps = new Set<string>();
  const attemptedSteps = new Set<string>();

  // Define Log Paths
  const LOG_DIR = path.join(projectRoot, 'xyne-automation/report');
  const DOCKER_STARTUP_LOG = path.join(LOG_DIR, 'docker-startup.log');
  const CONTAINER_LOG = path.join(LOG_DIR, 'container.log');
  const AUTOMATION_LOG = path.join(LOG_DIR, 'automation.log');

  // Ensure log directory exists and clear old logs
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  fs.writeFileSync(DOCKER_STARTUP_LOG, '');
  fs.writeFileSync(CONTAINER_LOG, '');

  const steps: StepDef[] = [
    {
      title: 'Stopping existing services',
      command: 'npm',
      args: ['run', 'services:stop'],
      condition: isDevRunning,
      skipReason: 'Dev services are not running',
    },
    {
      title: 'Cleaning up automation reports',
      command: 'rm',
      args: ['-rf', 'xyne-automation/report/*'],
    },
    {
      title: 'Building Docker services (backend, dashboard, xyne-automation)',
      command: 'docker',
      args: ['compose', ...composeFiles, 'build', 'backend', 'dashboard', 'xyne-automation'],
      env,
      logFile: DOCKER_STARTUP_LOG,
    },
    {
      title: 'Starting Docker services and waiting for readiness',
      command: 'docker',
      args: ['compose', ...composeFiles, 'up', '-d', '--wait'],
      env,
      logFile: DOCKER_STARTUP_LOG,
    },
    {
      title: 'Running the tests',
      command: 'docker',
      args: [
        'compose',
        ...composeFiles,
        'exec',
        '-e',
        'TEST_ENV=local-test',
        '-e',
        'ENABLE_BROWSER_CONSOLE_LOGS=false',
        'xyne-automation',
        'sh',
        '-c',
        "'npm run test'",
      ],
      env,
      logFile: AUTOMATION_LOG,
    },
  ];

  const cleanupSteps: StepDef[] = [
    {
      title: 'Copying automation reports',
      command: 'docker',
      args: ['cp', `${composeProjectName}-automation:/app/report/.`, 'xyne-automation/report/'],
      condition: () => attemptedSteps.has('Running the tests'),
      skipReason: 'Tests were not run',
    },
    {
      title: 'Collecting Docker service logs',
      command: 'sh',
      args: [
        '-c',
        [
          `printf -- "=== Backend Logs ===\\n\\n" > "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color backend >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "=== Dashboard Logs ===\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color dashboard >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "=== Other Logs ===\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "--- Postgres Logs ---\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color postgres >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "--- Redis Logs ---\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color redis >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "--- Zero-cache Logs ---\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color zero-cache >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "--- Fake-GCS Logs ---\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color fake-gcs >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "--- LiveKit Logs ---\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color livekit >> "${CONTAINER_LOG}" 2>&1 || true`,
          `printf -- "\\n\\n" >> "${CONTAINER_LOG}"`,
          `printf -- "--- Transcription-Agent Logs ---\\n\\n" >> "${CONTAINER_LOG}"`,
          `docker compose ${composeFiles.join(' ')} logs --no-color transcription-agent >> "${CONTAINER_LOG}" 2>&1 || true`,
        ].join(' && '),
      ],
      env,
      condition: () =>
        attemptedSteps.has('Building Docker services (backend, dashboard, xyne-automation)') ||
        attemptedSteps.has('Starting Docker services and waiting for readiness'),
      skipReason: 'Docker services were not built or started',
    },
    {
      title: 'Cleaning up Docker containers, networks, volumes, and images',
      command: 'docker',
      args: ['compose', ...composeFiles, 'down', '--volumes', '--remove-orphans', '--rmi', 'local'],
      env,
      condition: () =>
        attemptedSteps.has('Building Docker services (backend, dashboard, xyne-automation)') ||
        attemptedSteps.has('Starting Docker services and waiting for readiness'),
      skipReason: 'Docker services were not built or started',
    },
    {
      title: 'Starting back the DEV services',
      command: 'npm',
      args: ['run', 'services'],
      condition: () => completedSteps.has('Stopping existing services'),
      skipReason: 'Dev services are not stopped by this run',
    },
  ];

  const totalSteps = steps.length + cleanupSteps.length;
  const ui = new TestRunnerUI(totalSteps);

  try {
    ui.start();

    process.on('SIGINT', () => {
      ui.showCursor();
    });

    let firstError: unknown = null;
    let stepIndex = 0;

    // Run main steps
    for (const step of steps) {
      const pending = [...steps.slice(stepIndex + 1), ...cleanupSteps].map((s) => s.title);

      if (firstError) {
        ui.addResult({
          title: step.title,
          status: 'skipped',
          duration: 0,
          description: 'Skipped due to previous failure',
        });
        stepIndex++;
        continue;
      }

      ui.startStep(stepIndex, step.title);
      attemptedSteps.add(step.title);
      const stepStart = Date.now();

      try {
        const result = await runStep(step, pending, ui);
        ui.addResult(result);
        if (result.status === 'passed') {
          completedSteps.add(step.title);
        }
        ui.endStep(true);
      } catch (error) {
        const duration = Date.now() - stepStart;
        ui.addResult({
          title: step.title,
          status: 'failed',
          duration: duration,
          error: error instanceof Error ? error.message : String(error),
        });
        ui.endStep(false);
        firstError = error;
      }
      stepIndex++;
    }

    // Run cleanup steps
    for (const step of cleanupSteps) {
      // If we haven't started (e.g. interrupt), we still try cleanup but it might be weird to show them as "steps"?
      // But standard consistency says yes.
      // If main steps failed, we proceed with cleanup steps.

      const pending = cleanupSteps.slice(stepIndex - steps.length + 1).map((s) => s.title);
      ui.startStep(stepIndex, step.title);
      const stepStart = Date.now();

      try {
        const result = await runStep(step, pending, ui);
        ui.addResult(result);
        ui.endStep(true);
      } catch (error) {
        // Cleanup step failed
        const duration = Date.now() - stepStart;
        ui.addResult({
          title: step.title,
          status: 'failed',
          duration: duration,
          error: error instanceof Error ? error.message : String(error),
        });
        ui.endStep(false);
        // We don't stop cleanup if one cleanup step fails, usually.
        // But if `docker down` fails, maybe we should stop?
        // Let's continue best-effort.
        if (!firstError) firstError = error;
      }
      stepIndex++;
    }

    // ui.log('');
    // ui.log('All tests passed successfully!');
    // Summary already prints this.

    // Parse cucumber report if tests were run
    let testStats: TestStatistics | undefined;
    let htmlReportPath: string | undefined;

    if (attemptedSteps.has('Running the tests')) {
      const reportPath = findLatestCucumberReport(projectRoot);
      if (reportPath) {
        testStats = parseCucumberReport(reportPath) || undefined;
        const htmlPath = reportPath.replace('.json', '.html');
        if (fs.existsSync(htmlPath)) {
          htmlReportPath = htmlPath;
        }
      }
    }

    ui.printSummary(testStats, htmlReportPath);

    if (firstError) {
      throw firstError;
    }
  } catch {
    // Error handling is done inside loop for steps and summary printed.
    // We just exit with 1 here.
    process.exitCode = 1;
  } finally {
    ui.cleanup();
  }
}

runTests();
