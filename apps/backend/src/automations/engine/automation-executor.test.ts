jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/database/repositories', () => ({
  repositories: { workflows: { findById: jest.fn() } },
}));
jest.mock('@/database/repositories/workflowExecutionStateUtils', () => ({
  persistAutomationPauseState: jest.fn(),
  persistAutomationState: jest.fn(),
  getAutomationPauseState: jest.fn(),
}));
jest.mock('../triggers/trigger-registry', () => ({
  triggerRegistry: { has: () => false, get: () => null },
}));
// marked ships ESM that jest's transform ignores — stub the two calls the resolver makes.
jest.mock('marked', () => ({
  marked: { parse: (t: string) => t, parseInline: (t: string) => t },
}));
// @xyne/shared's root barrel is ESM — stub the two values pulled in transitively.
jest.mock('@xyne/shared', () => ({
  WorkflowEventType: { NO_OP: 'NO_OP', TICKET_CREATED: 'TICKET_CREATED' },
  TAG_FORMAT_REGEX: /^[a-z0-9_-]+$/i,
}));

import { z } from 'zod';
import type { PrismaClient, Workflow } from '@prisma/client';
import { AutomationExecutor } from './automation-executor';
import { PauseStep } from './pause-step';
import { StepRegistry } from '../steps/step-registry';
import { SwitchStep } from '../steps/switch.step';
import { BaseActionStep } from '../steps/base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { repositories } from '@/database/repositories';
import {
  getAutomationPauseState,
  persistAutomationPauseState,
  persistAutomationState,
} from '@/database/repositories/workflowExecutionStateUtils';

const RUN_ID = 'run-1';
const WORKFLOW_ID = 'wf-1';
const WORKSPACE_ID = 'ws-1';

// The switch matches case_1, whose branch is [before, pausing]. The pausing step
// stands in for RUN_AGENT: it suspends on execute and yields its result onResume.
const AUTOMATION_CONFIG = {
  trigger: { type: 'TICKET_CREATED', config: {} },
  steps: [
    {
      id: 'sw',
      type: 'SWITCH',
      config: {
        cases: [
          {
            condition: { variable: '{{trigger.kind}}', operator: 'eq', value: 'no-match' },
            steps: [{ id: 'skipped', type: 'TEST_BEFORE', config: {} }],
          },
          {
            condition: { variable: '{{trigger.kind}}', operator: 'eq', value: 'match' },
            steps: [
              { id: 'before', type: 'TEST_BEFORE', config: {} },
              { id: 'pausing', type: 'TEST_PAUSING', config: {} },
            ],
          },
        ],
        default: [],
      },
    },
    { id: 'after', type: 'TEST_AFTER', config: {} },
  ],
};

const PAUSED_STEP_NAME = 'step_0__case_1__step_1';

const calls = { before: 0, pausingExecute: 0, pausingResume: 0, after: 0 };

class CountingStep extends BaseActionStep<z.ZodTypeAny> {
  constructor(
    readonly type: string,
    private readonly counter: () => void,
  ) {
    super();
  }
  readonly configSchema = z.object({});
  readonly name = 'counting';
  readonly description = 'test step';
  readonly outputSchema = z.object({});
  readonly category = StepCategory.AI;
  async execute(): Promise<Record<string, unknown>> {
    this.counter();
    return { ran: true };
  }
}

class PausingStepStub extends BaseActionStep<z.ZodTypeAny> {
  readonly type = 'TEST_PAUSING';
  readonly configSchema = z.object({});
  readonly name = 'pausing';
  readonly description = 'suspends like RUN_AGENT';
  readonly outputSchema = z.object({});
  readonly category = StepCategory.AI;
  async execute(): Promise<Record<string, unknown>> {
    calls.pausingExecute += 1;
    throw new PauseStep('waiting on external system', { externalRef: 'ext-1' });
  }
  async onResume(rowData: Record<string, unknown>): Promise<Record<string, unknown>> {
    calls.pausingResume += 1;
    return { answer: rowData['callbackResult'] };
  }
}

describe('AutomationExecutor — pause and resume inside a control-flow branch', () => {
  let stepRows: Map<string, { stepName: string; status: string; data: string | null }>;
  let execution: { id: string; workflowId: string; workflowType: string; status: string; workspaceId: string };
  let pauseState: { context: string | null; currentStepIndex: number } | null;
  let finalContext: AutomationContext | null;
  let executor: AutomationExecutor;

  const stepKey = (where: { workflowExecutionId_stepName: { stepName: string } }): string =>
    where.workflowExecutionId_stepName.stepName;

  beforeEach(() => {
    jest.clearAllMocks();
    calls.before = 0;
    calls.pausingExecute = 0;
    calls.pausingResume = 0;
    calls.after = 0;
    stepRows = new Map();
    finalContext = null;
    execution = {
      id: RUN_ID,
      workflowId: WORKFLOW_ID,
      workflowType: 'Automations',
      status: 'PENDING',
      workspaceId: WORKSPACE_ID,
    };
    // The event router seeds the initial context before the worker picks the run up.
    pauseState = {
      context: JSON.stringify({
        automation: { id: WORKFLOW_ID, workspaceId: WORKSPACE_ID, createdById: 'user-1' },
        trigger: { type: 'TICKET_CREATED', kind: 'match', data: { kind: 'match' } },
        steps: {},
        __meta: { error: null, chain: [] },
      }),
      currentStepIndex: 0,
    };

    (repositories.workflows.findById as jest.Mock).mockResolvedValue({
      id: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      status: 'ACTIVE',
      context: JSON.stringify(AUTOMATION_CONFIG),
      metadata: JSON.stringify({ description: null, createdById: 'user-1' }),
    } as unknown as Workflow);

    (getAutomationPauseState as jest.Mock).mockImplementation(async () => pauseState);
    (persistAutomationPauseState as jest.Mock).mockImplementation(
      async (_id: string, data: { context: string; currentStepIndex: number }) => {
        pauseState = { context: data.context, currentStepIndex: data.currentStepIndex };
      },
    );
    (persistAutomationState as jest.Mock).mockImplementation(
      async (_id: string, data: { context: string }) => {
        finalContext = JSON.parse(data.context) as AutomationContext;
      },
    );

    const prisma = {
      workflowExecution: {
        findUnique: async () => execution,
        update: async ({ data }: { data: { status: string } }) => {
          execution = { ...execution, ...data };
          return execution;
        },
      },
      workflowStep: {
        findMany: async () => Array.from(stepRows.values()),
        findUnique: async ({ where }: { where: Parameters<typeof stepKey>[0] }) =>
          stepRows.get(stepKey(where)) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: Parameters<typeof stepKey>[0];
          create: { stepName: string; status: string; data?: string };
          update: { status: string; data?: string };
        }) => {
          const key = stepKey(where);
          const existing = stepRows.get(key);
          stepRows.set(
            key,
            existing
              ? { ...existing, ...update }
              : { stepName: create.stepName, status: create.status, data: create.data ?? null },
          );
        },
        update: async ({
          where,
          data,
        }: {
          where: Parameters<typeof stepKey>[0];
          data: { status: string; data?: string };
        }) => {
          const key = stepKey(where);
          const existing = stepRows.get(key);
          // Mirrors Prisma P2025 — surfaces any attempt to update a row we never created.
          if (!existing) throw new Error(`no workflow_step row for "${key}"`);
          stepRows.set(key, { ...existing, ...data });
        },
      },
    } as unknown as PrismaClient;

    const registry = new StepRegistry();
    registry.register(new SwitchStep());
    registry.register(new CountingStep('TEST_BEFORE', () => (calls.before += 1)));
    registry.register(new CountingStep('TEST_AFTER', () => (calls.after += 1)));
    registry.register(new PausingStepStub());

    executor = new AutomationExecutor(prisma, registry);
  });

  it('pauses inside the matched case instead of failing, and records the branch path', async () => {
    await executor.runExecution(RUN_ID);

    expect(execution.status).toBe('EXTERNAL_WAIT');
    expect(calls.before).toBe(1);
    expect(calls.pausingExecute).toBe(1);
    expect(calls.after).toBe(0);

    // The nested step gets a real row — the old code created none, so the claw
    // callback had nothing to resolve against.
    expect(stepRows.get(PAUSED_STEP_NAME)?.status).toBe('EXTERNAL_WAIT');
    expect(stepRows.get('step_0__case_1__step_0')?.status).toBe('COMPLETED');

    const persisted = JSON.parse(pauseState?.context ?? '{}') as AutomationContext;
    expect(persisted.__pauseBranchPath).toEqual([
      { branchKey: { kind: 'case', index: 1 }, index: 1, stepName: PAUSED_STEP_NAME },
    ]);
  });

  it('resumes into the branch without replaying completed steps, and keeps outputs', async () => {
    await executor.runExecution(RUN_ID);
    expect(calls.before).toBe(1);

    // Stand in for the claw callback writing its result onto the waiting row.
    const waiting = stepRows.get(PAUSED_STEP_NAME);
    stepRows.set(PAUSED_STEP_NAME, {
      ...(waiting as { stepName: string; status: string; data: string | null }),
      data: JSON.stringify({ callbackResult: 'from-callback' }),
    });

    await executor.runExecution(RUN_ID);

    expect(execution.status).toBe('COMPLETED');

    // No replay: the sibling before the pause and the pausing step itself each ran once.
    expect(calls.before).toBe(1);
    expect(calls.pausingExecute).toBe(1);
    expect(calls.pausingResume).toBe(1);
    // The step after the switch runs exactly once, on resume.
    expect(calls.after).toBe(1);

    // The resumed step's output reaches the context...
    expect(finalContext?.steps['pausing']?.output).toEqual({ answer: 'from-callback' });
    // ...and the switch keeps its own output, so downstream {{sw.output.matchedIndex}} resolves.
    expect(finalContext?.steps['sw']?.output).toEqual({ matchedIndex: 1 });
    // The condition is not re-evaluated on resume — the unmatched case stays untouched.
    expect(stepRows.has('step_0__case_0__step_0')).toBe(false);
    expect(finalContext?.__pauseBranchPath).toBeUndefined();
  });
});
