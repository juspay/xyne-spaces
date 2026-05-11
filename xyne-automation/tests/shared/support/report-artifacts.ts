import * as fs from 'node:fs';
import * as path from 'node:path';
import type { APIResponse, Response } from '@playwright/test';
import type { ExecutionContext } from 'gauge-ts';
import { type BrowserSession, testContext } from '@/tests/shared/runtime/test-context';

interface ResponseSnapshot {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
}

interface SessionSnapshot {
  name: string;
  browserType: string;
  viewportWidth: number;
  viewportHeight: number;
  currentUrl: string;
}

interface TestContextSnapshot {
  activeSessionName: string | null;
  activeSession: SessionSnapshot | null;
  sessions: Record<string, SessionSnapshot>;
  storedUsers: Record<
    string,
    typeof testContext.storedUsers extends Map<string, infer TValue> ? TValue : never
  >;
  lastResponse: ResponseSnapshot | null;
  hasApiRequestContext: boolean;
}

interface ContextSnapshotEnvelope {
  runId: string;
  runnerNumber: number | null;
  runnerPid: number;
  runnerFolder: string;
  capturedAt: string;
  suite: {
    before: TestContextSnapshot | null;
    after: TestContextSnapshot | null;
  };
  scenarios: Array<{
    index: number;
    specName: string | null | undefined;
    specFile: string | null | undefined;
    scenarioName: string | null | undefined;
    before: TestContextSnapshot | null;
    after: TestContextSnapshot | null;
    startedAt?: string;
    finishedAt?: string;
  }>;
}

let currentScenarioIndex = 0;

function getRunArtifactDirectory(): string | null {
  return process.env.XYNE_RUN_ARTIFACT_DIR ?? null;
}

function getRunnerNumber(context: ExecutionContext): number | null {
  const contextWithRunnerId = context as ExecutionContext & {
    getRunnerId?: () => number | null | undefined;
  };
  const runnerId = contextWithRunnerId.getRunnerId?.();

  if (runnerId === null || runnerId === undefined) {
    return null;
  }

  return runnerId === 0 ? 1 : runnerId;
}

function getRunnerFolder(context: ExecutionContext): string {
  const runnerNumber = getRunnerNumber(context);
  return runnerNumber === null ? `pid-${process.pid}` : String(runnerNumber);
}

function getRunnerDirectory(context: ExecutionContext): string | null {
  const runArtifactDirectory = getRunArtifactDirectory();

  if (!runArtifactDirectory) {
    return null;
  }

  return path.join(runArtifactDirectory, 'runner', getRunnerFolder(context));
}

function createResponseSnapshot(response: APIResponse | Response | null): ResponseSnapshot | null {
  if (!response) {
    return null;
  }

  return {
    url: response.url(),
    status: response.status(),
    ok: response.ok(),
    headers: response.headers(),
  };
}

function createSessionSnapshot(name: string, session: BrowserSession): SessionSnapshot {
  const { page } = session;

  return {
    name,
    browserType: session.browserType,
    viewportWidth: session.viewportWidth,
    viewportHeight: session.viewportHeight,
    currentUrl: page.isClosed() ? 'about:blank' : page.url(),
  };
}

function createTestContextSnapshot(): TestContextSnapshot {
  const sessionsSnapshot: Record<string, SessionSnapshot> = {};

  for (const [name, session] of testContext.sessions.entries()) {
    sessionsSnapshot[name] = createSessionSnapshot(name, session);
  }

  const activeSessionName = testContext.activeSessionName;
  const activeSession = testContext.activeSession;

  return {
    activeSessionName,
    activeSession:
      activeSessionName && activeSession
        ? createSessionSnapshot(activeSessionName, activeSession)
        : null,
    sessions: sessionsSnapshot,
    storedUsers: Object.fromEntries(testContext.storedUsers.entries()),
    lastResponse: createResponseSnapshot(testContext.lastResponse),
    hasApiRequestContext: testContext.apiRequestContext !== null,
  };
}

function getContextFilePath(context: ExecutionContext): string | null {
  const runnerDirectory = getRunnerDirectory(context);

  if (!runnerDirectory) {
    return null;
  }

  return path.join(runnerDirectory, 'context.json');
}

function createEmptyContextEnvelope(context: ExecutionContext): ContextSnapshotEnvelope {
  return {
    runId: process.env.XYNE_RUN_ID ?? 'unknown-run',
    runnerNumber: getRunnerNumber(context),
    runnerPid: process.pid,
    runnerFolder: getRunnerFolder(context),
    capturedAt: new Date().toISOString(),
    suite: {
      before: null,
      after: null,
    },
    scenarios: [],
  };
}

function readContextEnvelope(context: ExecutionContext): ContextSnapshotEnvelope {
  const contextFilePath = getContextFilePath(context);

  if (!contextFilePath) {
    return createEmptyContextEnvelope(context);
  }

  if (!fs.existsSync(contextFilePath)) {
    return createEmptyContextEnvelope(context);
  }

  try {
    return JSON.parse(fs.readFileSync(contextFilePath, 'utf8')) as ContextSnapshotEnvelope;
  } catch {
    return createEmptyContextEnvelope(context);
  }
}

function writeContextEnvelope(context: ExecutionContext, envelope: ContextSnapshotEnvelope): void {
  const contextFilePath = getContextFilePath(context);

  if (!contextFilePath) {
    return;
  }

  fs.mkdirSync(path.dirname(contextFilePath), { recursive: true });
  fs.writeFileSync(contextFilePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}

export function getHumanRunnerNumber(context: ExecutionContext): number | null {
  return getRunnerNumber(context);
}

export function getHumanRunnerLabel(context: ExecutionContext): string {
  const runnerNumber = getRunnerNumber(context);

  if (runnerNumber === null) {
    return `runner/${getRunnerFolder(context)}/runner`;
  }

  return `runner/${runnerNumber}/runner`;
}

function advanceScenarioIndex(): number {
  currentScenarioIndex += 1;
  return currentScenarioIndex;
}

function getCurrentScenarioIndex(): number {
  return currentScenarioIndex;
}

export function writeBeforeScenarioTestContextSnapshot(context: ExecutionContext): void {
  const scenarioIndex = advanceScenarioIndex();
  const envelope = readContextEnvelope(context);
  const startedAt = new Date().toISOString();

  envelope.capturedAt = startedAt;
  envelope.scenarios.push({
    index: scenarioIndex,
    specName: context.getCurrentSpec()?.getName(),
    specFile: context.getCurrentSpec()?.getFileName(),
    scenarioName: context.getCurrentScenario()?.getName(),
    before: createTestContextSnapshot(),
    after: null,
    startedAt,
  });

  writeContextEnvelope(context, envelope);
}

export function writeAfterScenarioTestContextSnapshot(context: ExecutionContext): void {
  const scenarioIndex = getCurrentScenarioIndex();
  const envelope = readContextEnvelope(context);
  const finishedAt = new Date().toISOString();
  const scenario = [...envelope.scenarios].reverse().find((entry) => entry.index === scenarioIndex);

  if (!scenario) {
    envelope.scenarios.push({
      index: scenarioIndex,
      specName: context.getCurrentSpec()?.getName(),
      specFile: context.getCurrentSpec()?.getFileName(),
      scenarioName: context.getCurrentScenario()?.getName(),
      before: null,
      after: createTestContextSnapshot(),
      finishedAt,
    });
  } else {
    scenario.after = createTestContextSnapshot();
    scenario.finishedAt = finishedAt;
  }

  envelope.capturedAt = finishedAt;
  writeContextEnvelope(context, envelope);
}

export function writeBeforeSuiteTestContextSnapshot(context: ExecutionContext): void {
  const envelope = readContextEnvelope(context);
  envelope.capturedAt = new Date().toISOString();
  envelope.suite.before = createTestContextSnapshot();
  writeContextEnvelope(context, envelope);
}

export function writeAfterSuiteTestContextSnapshot(context: ExecutionContext): void {
  const envelope = readContextEnvelope(context);
  envelope.capturedAt = new Date().toISOString();
  envelope.suite.after = createTestContextSnapshot();
  writeContextEnvelope(context, envelope);
}

export function writeBaselineContextSnapshot(phase: 'before' | 'after'): void {
  const runArtifactDirectory = getRunArtifactDirectory();

  if (!runArtifactDirectory) {
    return;
  }

  const contextFilePath = path.join(runArtifactDirectory, 'runner', 'baseline', 'context.json');

  let envelope: ContextSnapshotEnvelope;
  if (fs.existsSync(contextFilePath)) {
    try {
      envelope = JSON.parse(fs.readFileSync(contextFilePath, 'utf8')) as ContextSnapshotEnvelope;
    } catch {
      envelope = {
        runId: process.env.XYNE_RUN_ID ?? 'unknown-run',
        runnerNumber: null,
        runnerPid: process.pid,
        runnerFolder: 'baseline',
        capturedAt: new Date().toISOString(),
        suite: { before: null, after: null },
        scenarios: [],
      };
    }
  } else {
    envelope = {
      runId: process.env.XYNE_RUN_ID ?? 'unknown-run',
      runnerNumber: null,
      runnerPid: process.pid,
      runnerFolder: 'baseline',
      capturedAt: new Date().toISOString(),
      suite: { before: null, after: null },
      scenarios: [],
    };
  }

  envelope.capturedAt = new Date().toISOString();
  envelope.suite[phase] = createTestContextSnapshot();

  fs.mkdirSync(path.dirname(contextFilePath), { recursive: true });
  fs.writeFileSync(contextFilePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}
