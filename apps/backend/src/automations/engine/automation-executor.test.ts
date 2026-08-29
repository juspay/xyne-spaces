import { z } from 'zod';

jest.mock('@/database/repositories', () => ({
  repositories: {
    automationWorkflows: { getById: jest.fn() },
  },
}));

jest.mock('@/database/repositories/workflowExecutionStateUtils', () => ({
  persistAutomationPauseState: jest.fn(),
  persistAutomationState: jest.fn(),
  getAutomationPauseState: jest.fn(),
}));

jest.mock('./variable-resolver', () => ({
  VariableResolver: class {
    resolve(value: unknown): unknown {
      return value;
    }
  },
  stripNullForOptionalKeys: (value: unknown) => value,
}));

jest.mock('./condition-evaluator', () => ({
  ConditionEvaluator: class {
    evaluate(): boolean {
      return true;
    }
  },
}));

jest.mock('../triggers/trigger-registry', () => ({
  triggerRegistry: { has: jest.fn().mockReturnValue(false), get: jest.fn() },
}));

jest.mock('../types/workflow-adapter', () => ({
  isExecutableAutomationWorkflowType: jest.fn().mockReturnValue(true),
  mayDrainInFlight: jest.fn().mockReturnValue(false),
  parseAutomationConfig: jest.fn(),
  parseAutomationMetadata: jest.fn(),
  readAutomationMeta: jest.fn().mockReturnValue({ error: null, chain: [] }),
}));
import type { PrismaClient } from '@prisma/client';
import { AutomationExecutor, parseNestedStepIndex } from './automation-executor';
import { PauseStep } from './pause-step';
import { automationContextStorage } from './automation-context-storage';
import { BaseActionStep } from '../steps/base-step';
import { StepRegistry } from '../steps/step-registry';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import type { AutomationStepConfig } from '../types/automation-config';

const EmptyConfig = z.object({});

class RecordingStep extends BaseActionStep<typeof EmptyConfig, Record<string, unknown>> {
  readonly type: string;
  readonly configSchema = EmptyConfig;
  readonly name = 'Recording step';
  readonly description = 'Records executions for the test';
  readonly outputSchema = z.record(z.unknown());
  readonly category = StepCategory.EXTERNAL;

  constructor(
    type: string,
    private readonly calls: string[]
  ) {
    super();
    this.type = type;
  }

  async execute(): Promise<Record<string, unknown>> {
    this.calls.push(this.type);
    return { ok: true };
  }
}

class PausingAgentStep extends BaseActionStep<typeof EmptyConfig, Record<string, unknown>> {
  readonly type = 'RUN_AGENT';
  readonly configSchema = EmptyConfig;
  readonly name = 'Agent';
  readonly description = 'Pauses until a callback arrives';
  readonly outputSchema = z.record(z.unknown());
  readonly category = StepCategory.AI;
  executeCalls = 0;
  resumeCalls = 0;

  async execute(): Promise<Record<string, unknown>> {
    this.executeCalls += 1;
    const stepName = automationContextStorage.getStore()?.stepName;
    throw new PauseStep('waiting for agent', {
      externalRef: 'agent-run',
      statePatch: { callbackStepName: stepName },
    });
  }

  async onResume(rowData: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.resumeCalls += 1;
    return {
      result: rowData.agentRawResult,
      resumedStepName: rowData.stepName,
    };
  }
}

type StepRow = { status: string; data: string | null };

function createPrismaMock(rows: Map<string, StepRow>): PrismaClient {
  return {
    workflowExecution: {
      findUnique: jest.fn().mockResolvedValue({ workspaceId: 'workspace-1' }),
    },
    workflowStep: {
      upsert: jest.fn(async ({ where, create, update }) => {
        const key = where.workflowExecutionId_stepName.stepName as string;
        const previous = rows.get(key);
        rows.set(key, {
          status: (previous ? update.status : create.status) as string,
          data:
            ((previous ? update.data : create.data) as string | undefined) ??
            previous?.data ??
            null,
        });
      }),
      update: jest.fn(async ({ where, data }) => {
        const key = where.workflowExecutionId_stepName.stepName as string;
        rows.set(key, {
          status: data.status as string,
          data: (data.data as string | undefined) ?? rows.get(key)?.data ?? null,
        });
      }),
      findUnique: jest.fn(async ({ where }) => {
        const key = where.workflowExecutionId_stepName.stepName as string;
        const row = rows.get(key);
        return row ? { data: row.data } : null;
      }),
    },
  } as unknown as PrismaClient;
}

function buildContext(): AutomationContext {
  return {
    automation: { id: 'automation-1', workspaceId: 'workspace-1', createdById: 'user-1' },
    trigger: {} as AutomationContext['trigger'],
    steps: {},
    __meta: { error: null, chain: [] },
  };
}

describe('nested automation pause/resume', () => {
  it('resumes the exact nested agent step without rerunning earlier side effects', async () => {
    const rows = new Map<string, StepRow>();
    const calls: string[] = [];
    const agent = new PausingAgentStep();
    const registry = new StepRegistry();
    registry.register(new RecordingStep('BEFORE', calls));
    registry.register(agent);
    registry.register(new RecordingStep('AFTER', calls));

    const executor = new AutomationExecutor(createPrismaMock(rows), registry);
    const walkNested = (
      executor as unknown as {
        walkNestedBranch(
          steps: AutomationStepConfig[],
          context: AutomationContext,
          runId: string,
          pathPrefix: string,
          resumeStepName?: string
        ): Promise<void>;
      }
    ).walkNestedBranch.bind(executor);
    const context = buildContext();
    const steps = [
      { id: 'before', type: 'BEFORE', config: {} },
      { id: 'agent', type: 'RUN_AGENT', config: {} },
      { id: 'after', type: 'AFTER', config: {} },
    ] as AutomationStepConfig[];
    const pathPrefix = 'step_0__if_true';
    const agentStepName = `${pathPrefix}__step_1`;

    await expect(
      automationContextStorage.run(
        { runId: 'run-1', automationId: 'automation-1', chain: [] },
        () => walkNested(steps, context, 'run-1', pathPrefix)
      )
    ).rejects.toBeInstanceOf(PauseStep);

    expect(calls).toEqual(['BEFORE']);
    expect(agent.executeCalls).toBe(1);
    expect(context.__meta?.resumeStepName).toBe(agentStepName);
    expect(JSON.parse(rows.get(agentStepName)?.data ?? '{}')).toMatchObject({
      callbackStepName: agentStepName,
    });

    const waitingData = JSON.parse(rows.get(agentStepName)?.data ?? '{}') as Record<
      string,
      unknown
    >;
    rows.set(agentStepName, {
      status: 'EXTERNAL_WAIT',
      data: JSON.stringify({ ...waitingData, agentRawResult: { answer: 'done' } }),
    });

    await automationContextStorage.run(
      { runId: 'run-1', automationId: 'automation-1', chain: [] },
      () => walkNested(steps, context, 'run-1', pathPrefix, agentStepName)
    );

    expect(calls).toEqual(['BEFORE', 'AFTER']);
    expect(agent.executeCalls).toBe(1);
    expect(agent.resumeCalls).toBe(1);
    expect(context.steps.agent?.output).toEqual({
      result: { answer: 'done' },
      resumedStepName: agentStepName,
    });
    expect(context.__meta?.resumeStepName).toBeUndefined();
    expect(rows.get(agentStepName)?.status).toBe('COMPLETED');
  });

  it('locates the direct child index for conditional and switch paths', () => {
    expect(parseNestedStepIndex('step_3__if_true', 'step_3__if_true__step_2')).toBe(2);
    expect(parseNestedStepIndex('step_1__case_0', 'step_1__case_0__step_4__if_false__step_1')).toBe(
      4
    );
    expect(parseNestedStepIndex('step_1__default', 'step_1__case_0__step_0')).toBeNull();
  });
});
