import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import {
  AfterScenario,
  AfterStep,
  AfterSuite,
  BeforeScenario,
  BeforeStep,
  BeforeSuite,
  CustomScreenshotWriter,
  type ExecutionContext,
  Gauge,
} from 'gauge-ts';
import { config } from '@/config';
import { closeLogger, gaugeLogger, setLoggerFileLabel } from '@/lib/logger';
import { appendScenarioProgressEvent } from '@/lib/test-progress';
import { loadBaselineFixtureIntoWorkerContext } from '@/fixtures/baseline';
import { testContext } from '@/tests/shared/runtime/test-context';
import {
  closeAllBrowserSessions,
  disposeApiRequestContext,
  resetAllBrowserSessionsForReuse,
} from '@/tests/shared/support/browser-manager';
import {
  getHumanRunnerLabel,
  writeAfterScenarioTestContextSnapshot,
  writeAfterSuiteTestContextSnapshot,
  writeBeforeScenarioTestContextSnapshot,
  writeBeforeSuiteTestContextSnapshot,
} from '@/tests/shared/support/report-artifacts';

const stepStartTimes = new Map<string, number>();
let stepExecutionCounter = 0;

export default class HooksSteps {
  @BeforeSuite()
  public async logSuiteStart(context: ExecutionContext): Promise<void> {
    setLoggerFileLabel(getHumanRunnerLabel(context));
    writeBeforeSuiteTestContextSnapshot(context);

    await loadBaselineFixtureIntoWorkerContext();
  }

  @BeforeScenario()
  public async logScenarioStart(context: ExecutionContext): Promise<void> {
    writeBeforeScenarioTestContextSnapshot(context);
  }

  @BeforeStep()
  public async logStepStart(context: ExecutionContext): Promise<void> {
    const step = context.getCurrentStep();
    if (!step) return;
    const stepName = step.getDynamicText() ?? step.getText() ?? 'unknown';
    const executionIndex = stepExecutionCounter++;
    const key = `${process.pid}:${executionIndex}:${stepName}`;
    stepStartTimes.set(key, Date.now());
    gaugeLogger.info(`Step START: ${stepName}`);
  }

  @AfterStep()
  public async logStepEnd(context: ExecutionContext): Promise<void> {
    const step = context.getCurrentStep();
    if (!step) return;
    const stepName = step.getDynamicText() ?? step.getText() ?? 'unknown';
    // Find the matching key by runnerId and stepName (last occurrence)
    const runnerId = process.pid;
    let matchedKey: string | undefined;
    for (const key of stepStartTimes.keys()) {
      if (key.startsWith(`${runnerId}:`) && key.endsWith(`:${stepName}`)) {
        matchedKey = key;
      }
    }
    const startTime = matchedKey ? stepStartTimes.get(matchedKey) : undefined;
    const durationMs = startTime ? Date.now() - startTime : -1;
    if (matchedKey) {
      stepStartTimes.delete(matchedKey);
    }

    const isFailing = step.getIsFailing() ?? false;
    const errorMessage = step.getErrorMessage();

    if (isFailing) {
      gaugeLogger.error(`Step FAIL: ${stepName}`, { durationMs, error: errorMessage });
      Gauge.writeMessage(`✗ ${stepName} — ${errorMessage ?? 'unknown error'} (${durationMs}ms)`);
    } else {
      gaugeLogger.info(`Step PASS: ${stepName}`, { durationMs });
      Gauge.writeMessage(`✓ ${stepName} (${durationMs}ms)`);
    }
  }

  @AfterScenario()
  public async cleanupScenario(context: ExecutionContext): Promise<void> {
    writeAfterScenarioTestContextSnapshot(context);

    await resetAllBrowserSessionsForReuse();
    testContext.resetScenarioState();

    const progressFile = config.testProgressFile;
    const scenario = context.getCurrentScenario();
    const specification = context.getCurrentSpec();
    const scenarioName = scenario?.getName();
    const specificationFile = specification?.getFileName();

    if (progressFile && scenario && scenarioName && specificationFile) {
      appendScenarioProgressEvent(progressFile, {
        scenarioId: `${specificationFile}:${scenarioName}`,
        scenarioName,
        status: scenario.getIsFailing() ? 'failed' : 'passed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  @AfterSuite()
  public async cleanupSuite(context: ExecutionContext): Promise<void> {
    writeAfterSuiteTestContextSnapshot(context);
    await closeAllBrowserSessions();
    await disposeApiRequestContext();
    await closeLogger();
  }

  // Captures the active Playwright page on step failure (gauge invokes this when
  // screenshot_on_failure=true). The default gauge writer relies on a display
  // server which doesn't exist in our headless CI containers, hence the explicit
  // Playwright-driven implementation. Returns the screenshot file path so gauge
  // can embed it in the HTML report.
  @CustomScreenshotWriter()
  public async writeScreenshot(): Promise<string> {
    const dir = process.env.gauge_screenshots_dir;
    if (!dir) return '';

    let page: Page;
    try {
      page = testContext.activePage;
    } catch {
      // No active browser session yet (failure happened before page launch).
      return '';
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `screenshot-${randomUUID()}.png`;
      await page.screenshot({ path: path.join(dir, fileName), fullPage: false });
      // Gauge joins this with gauge_screenshots_dir itself — return basename only.
      return fileName;
    } catch (error) {
      gaugeLogger.warn(
        `Failed to capture screenshot: ${error instanceof Error ? error.message : String(error)}`
      );
      return '';
    }
  }
}
