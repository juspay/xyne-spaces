import type { z } from 'zod';
import { PrismaClient, type Workflow } from '@prisma/client';
import { repositories } from '@/database/repositories';
import {
  persistAutomationPauseState,
  persistAutomationState,
  getAutomationPauseState,
} from '@/database/repositories/workflowExecutionStateUtils';
import { AutomationStatus, AutomationRunStatus } from '../types/status';
import type { AutomationStepConfig } from '../types/automation-config';
import type { AutomationContext } from '../types/context';
import type { TriggerType } from '../types/trigger-types';
import { CONTROL_FLOW_STEP_TYPES } from '../types/known-types';
import type { StepRegistry } from '../steps/step-registry';
import { BaseActionStep, BaseControlFlowStep, BaseStep, StepKind } from '../steps/base-step';
import { VariableResolver, stripNullForOptionalKeys } from './variable-resolver';
import { automationContextStorage } from './automation-context-storage';
import { PauseStep } from './pause-step';
import { DataNotReadyError, isTransientError, RetryableError } from './retryability';
import {
  AUTOMATION_WORKFLOW_TYPE,
  mayDrainInFlight,
  parseAutomationConfig,
  parseAutomationMetadata,
  readAutomationMeta,
} from '../types/workflow-adapter';
import { triggerRegistry } from '../triggers/trigger-registry';
import { logger } from '@/utils/logger';

type WalkResult =
  | { kind: 'completed' }
  | { kind: 'paused'; atIndex: number; externalRef: string | undefined };

interface PreparedRun {
  ctx: AutomationContext;
  chain: readonly string[];
  startIndex: number;
  label: 'STARTED' | 'RESUMED';
  resumeStepName?: string;
}

interface StepCallContext {
  runId: string;
  stepName: string;
  isResuming: boolean;
  resumeStepName?: string;
  persistedData?: Record<string, unknown>;
}

interface StepExecutionResult {
  branchKey?: string;
}

interface PersistedStepRow {
  status: string | null;
  data: string | null;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export class AutomationExecutor {
  private readonly resolver: VariableResolver;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly stepRegistry: StepRegistry,
    options: {
      variableResolver?: VariableResolver;
    } = {},
  ) {
    this.resolver = options.variableResolver ?? new VariableResolver();
  }

  async runExecution(executionId: string): Promise<unknown> {
    const existing = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });
    if (!existing) {
      throw new DataNotReadyError('workflow execution', executionId);
    }
    if (existing.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
      logger.warn(
        `[automations] runExecution: row ${executionId} workflowType=${existing.workflowType ?? '∅'} — not an automation, dropping`,
      );
      return undefined;
    }

    const workflow = await repositories.workflows.findById(existing.workflowId);
    if (!workflow) {
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.CANCELLED },
      });
      logger.warn(
        `[automations] runExecution: workflow ${existing.workflowId} missing — run ${executionId} CANCELLED`,
      );
      return undefined;
    }
    if (workflow.status !== AutomationStatus.ACTIVE && !mayDrainInFlight(workflow)) {
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.CANCELLED },
      });
      logger.info(
        `[automations] runExecution: workflow ${workflow.id} is ${workflow.status} (no longer live) — run ${executionId} CANCELLED`,
      );
      return undefined;
    }

    const config = parseAutomationConfig(workflow.context);
    const metadata = parseAutomationMetadata(workflow.metadata);
    const isResume = existing.status === AutomationRunStatus.EXTERNAL_WAIT;
    const isFresh =
      existing.status === AutomationRunStatus.PENDING ||
      existing.status === AutomationRunStatus.SCHEDULED;
    if (!isFresh && !isResume) {
      logger.warn(
        `[automations] runExecution: row ${executionId} status=${existing.status} — no handler, skipping`,
      );
      return undefined;
    }

    const prep = await this.prepareRun(
      executionId,
      workflow,
      config,
      metadata,
      isResume,
    );
    if (!prep) return undefined;
    return this.commitAndRun(executionId, workflow, config, prep);
  }

  private async commitAndRun(
    executionId: string,
    workflow: Workflow,
    config: ReturnType<typeof parseAutomationConfig>,
    prep: PreparedRun,
  ): Promise<unknown> {
    prep.ctx.__meta = { ...(prep.ctx.__meta ?? {}), error: null, chain: prep.chain };
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: AutomationRunStatus.RUNNING },
    });
    await persistAutomationState(executionId, { context: JSON.stringify(prep.ctx) });
    logger.info(
      `[automations] run ${prep.label} runId=${executionId} automation=${workflow.id} startIndex=${prep.startIndex} steps=${config.steps.length}`,
    );
    return this.runSteps(
      executionId,
      prep.ctx,
      prep.chain,
      config.steps,
      prep.startIndex,
      prep.resumeStepName,
    );
  }

  private async prepareRun(
    executionId: string,
    workflow: Workflow,
    config: ReturnType<typeof parseAutomationConfig>,
    metadata: ReturnType<typeof parseAutomationMetadata>,
    isResume: boolean,
  ): Promise<PreparedRun | null> {
    const pauseState = await getAutomationPauseState(executionId);
    if (!pauseState?.context) {
      if (isResume) {
        throw new Error(
          `[automations] prepareRun: pause state missing or empty for resume of ${executionId}`,
        );
      }
      logger.error(
        `[automations] prepareRun: state.context unparseable for ${executionId} — marking FAILED`,
      );
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.FAILED },
      });
      return null;
    }
    let initialCtx: AutomationContext;
    try {
      initialCtx = JSON.parse(pauseState.context) as AutomationContext;
    } catch {
      if (isResume) {
        throw new Error(
          `[automations] prepareRun: pause state context unparseable for resume of ${executionId}`,
        );
      }
      logger.error(
        `[automations] prepareRun: state.context unparseable for ${executionId} — marking FAILED`,
      );
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.FAILED },
      });
      return null;
    }
    const chain: readonly string[] = readAutomationMeta(pauseState.context).chain;

    if (isResume) {
      const resumeStepName = await this.resolveResumeStepName(
        executionId,
        initialCtx.__meta?.waitingStepName,
        pauseState.currentStepIndex,
      );
      return {
        ctx: initialCtx,
        chain,
        // Replay from the root. Completed rows hydrate context and persisted
        // branch keys route us back to a nested resume target deterministically.
        startIndex: 0,
        label: 'RESUMED',
        resumeStepName,
      };
    }

    // Backward-compatible intake for executions created before the worker began
    // persisting its authoritative hydration/filter decision.
    const triggerType = config.trigger.type as TriggerType;
    const originalTriggerData =
      ((initialCtx.trigger as { data?: Record<string, unknown> } | undefined)?.data) ?? {};
    const triggerImpl = triggerRegistry.has(triggerType)
      ? triggerRegistry.get(triggerType)
      : null;
    const hydratedTriggerData = await this.hydrateTriggerData(
      triggerImpl,
      originalTriggerData,
      workflow.id,
    );

    const filterConfig = (config.trigger.config ?? {}) as Record<string, unknown>;
    if (triggerImpl && !triggerImpl.matchFilters(filterConfig, hydratedTriggerData)) {
      const skeleton = this.buildContext(
        workflow.id,
        workflow.workspaceId,
        metadata.createdById,
        triggerType,
        hydratedTriggerData,
      );
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: AutomationRunStatus.SKIPPED },
      });
      skeleton.__meta = { error: null, chain };
      await persistAutomationState(executionId, { context: JSON.stringify(skeleton) });
      logger.info(
        `[automations] prepareRun: filter mismatched at run-time — automation=${workflow.id} run=${executionId} skipping`,
      );
      return null;
    }

    const freshContext = this.buildContext(
      workflow.id,
      workflow.workspaceId,
      metadata.createdById,
      triggerType,
      hydratedTriggerData,
    );
    return { ctx: freshContext, chain, startIndex: 0, label: 'STARTED' };
  }

  private async resolveResumeStepName(
    runId: string,
    contextStepName: string | undefined,
    legacyStepIndex: number,
  ): Promise<string> {
    // The persisted hierarchical name is authoritative. The numeric index is
    // retained only for executions paused before waitingStepName was introduced.
    const stepName = contextStepName ?? `step_${legacyStepIndex}`;

    const row = await this.readStepRow(runId, stepName);
    if (!row) {
      throw new Error(
        `[automations] resume target ${stepName} does not exist for execution ${runId}`,
      );
    }

    if (row.status !== AutomationRunStatus.EXTERNAL_WAIT) {
      throw new Error(
        `[automations] resume target ${stepName} has status=${row.status}, expected EXTERNAL_WAIT`,
      );
    }

    return stepName;
  }

  private async invokeResume(
    actionImpl: BaseActionStep<z.ZodSchema, Record<string, unknown>>,
    runId: string,
    stepName: string,
    resolvedInput: Record<string, unknown>,
    context: AutomationContext,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.workflowStep.findUnique({
      where: { workflowExecutionId_stepName: { workflowExecutionId: runId, stepName } },
      select: { data: true },
    });
    if (!row) {
      throw new Error(
        `[automations] resume target ${stepName} disappeared for execution ${runId}`,
      );
    }
    const rowData = this.parsePersistedData(row.data);
    if (row.data && !rowData) {
      throw new Error(
        `[automations] resume target ${stepName} has invalid persisted data for execution ${runId}`,
      );
    }

    if (typeof actionImpl.onResume === 'function') {
      return actionImpl.onResume(rowData ?? {}, resolvedInput, context);
    }
    const fallback = rowData?.['output'];
    return (fallback && typeof fallback === 'object' && !Array.isArray(fallback)
      ? (fallback as Record<string, unknown>)
      : {});
  }

  private async hydrateTriggerData(
    triggerImpl: { hydratePayload?(p: Record<string, unknown>): Promise<Record<string, unknown>> } | null,
    triggerData: Record<string, unknown>,
    automationId: string,
  ): Promise<Record<string, unknown>> {
    if (!triggerImpl || typeof triggerImpl.hydratePayload !== 'function') return triggerData;
    try {
      return await triggerImpl.hydratePayload(triggerData);
    } catch (err) {
      logger.error(
        `[automations] hydratePayload failed for legacy execution automation=${automationId}:`,
        err,
      );
      throw new RetryableError(
        `hydratePayload failed for automation=${automationId}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  private buildContext(
    automationId: string,
    workspaceId: string,
    createdById: string,
    triggerType: TriggerType,
    triggerData: Record<string, unknown>,
  ): AutomationContext {
    const trigger = {
      type: triggerType,
      ...triggerData,
      data: triggerData,
    } as unknown as AutomationContext['trigger'];
    return {
      automation: { id: automationId, workspaceId, createdById },
      trigger,
      steps: {},
    };
  }

  private async runSteps(
    runId: string,
    context: AutomationContext,
    chain: readonly string[],
    steps: AutomationStepConfig[],
    startIndex: number,
    resumeStepName?: string,
  ): Promise<unknown> {
    const automationId = context.automation.id;
    try {
      const walkResult = await automationContextStorage.run<Promise<WalkResult>>(
        { runId, automationId, chain },
        () => this.walkSteps(steps, context, runId, startIndex, resumeStepName),
      );

      if (walkResult.kind === 'paused') {
        logger.info(
          `AutomationExecutor: run ${runId} PAUSED at step=${context.__meta?.waitingStepName ?? `step_${walkResult.atIndex}`} (externalRef=${walkResult.externalRef ?? '∅'})`,
        );
        return undefined;
      }

      const completed = await this.prisma.workflowExecution.update({
        where: { id: runId },
        data: { status: AutomationRunStatus.COMPLETED },
      });
      context.__meta = { ...(context.__meta ?? {}), error: null, chain };
      delete context.__meta.waitingStepName;
      await persistAutomationState(runId, {
        context: JSON.stringify(context),
        currentStepIndex: steps.length,
      });
      logger.info(`AutomationExecutor: run ${runId} COMPLETED for automation ${automationId}`);
      return completed;
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      await this.prisma.workflowExecution.update({
        where: { id: runId },
        data: { status: AutomationRunStatus.FAILED },
      });
      context.__meta = { ...(context.__meta ?? {}), error: errMessage, chain };
      await persistAutomationState(runId, {
        context: JSON.stringify(context),
      });
      if (!isTransientError(err)) {
        logger.error(
          `AutomationExecutor: run ${runId} FAILED terminally (deterministic error, no retry) for automation ${automationId}: ${errMessage}`,
        );
        return undefined;
      }
      logger.error(
        `AutomationExecutor: run ${runId} FAILED (transient — Bull will retry) for automation ${automationId}: ${errMessage}`,
      );
      throw err;
    }
  }

  private async walkSteps(
    steps: AutomationStepConfig[],
    context: AutomationContext,
    runId: string,
    startIndex: number = 0,
    resumeStepName?: string,
  ): Promise<WalkResult> {
    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i] as AutomationStepConfig;
      const stepName = `step_${i}`;
      const isResuming = resumeStepName === stepName;

      try {
        await this.walkPersistedStep(step, context, {
          runId,
          stepName,
          isResuming,
          resumeStepName,
        });
      } catch (err) {
        if (PauseStep.is(err)) {
          const waitingStepName = err.waitingStepName ?? stepName;
          context.__meta = {
            ...(context.__meta ?? {}),
            error: null,
            waitingStepName,
          };
          await persistAutomationPauseState(runId, {
            context: JSON.stringify(context),
            currentStepIndex: i,
          });
          await this.prisma.workflowExecution.update({
            where: { id: runId },
            data: { status: AutomationRunStatus.EXTERNAL_WAIT },
          });
          return { kind: 'paused', atIndex: i, externalRef: err.externalRef };
        }
        throw err;
      }
    }
    return { kind: 'completed' };
  }

  private async walkPersistedStep(
    step: AutomationStepConfig,
    context: AutomationContext,
    callCtx: StepCallContext,
  ): Promise<void> {
    // Read the row before the RUNNING upsert. This is what lets an automation
    // retry replay a completed action without firing its side effect again.
    const row = await this.readStepRow(callCtx.runId, callCtx.stepName);
    const persistedData = this.parsePersistedData(row?.data);
    const replayed = this.replayIfCompleted(row, step, context);

    if (!replayed && !callCtx.isResuming) {
      await this.upsertStepRow(callCtx.runId, callCtx.stepName, step, 'RUNNING', null);
    }

    try {
      // A completed control-flow row also owns completed descendant rows. Walk
      // that branch on replay so their outputs are hydrated into context, while
      // the persisted branch key prevents the condition from being reevaluated.
      const replayControlChildren =
        replayed &&
        CONTROL_FLOW_STEP_TYPES.has(step.type) &&
        this.readBranchKey(persistedData) !== undefined;
      const result =
        !replayed || replayControlChildren
          ? await this.executeStep(step, context, {
              ...callCtx,
              persistedData,
            })
          : {};
      const branchKey = result.branchKey ?? this.readBranchKey(persistedData);
      await this.markStepCompleted(
        callCtx.runId,
        callCtx.stepName,
        context.steps[step.id],
        branchKey,
      );
    } catch (err) {
      if (PauseStep.is(err)) {
        // The first persisted frame to observe the pause is the action that
        // actually stopped. Parent control-flow frames retain the same target
        // while also becoming EXTERNAL_WAIT, allowing replay to route through
        // their persisted branch keys on resume.
        const isWaitingStep = err.waitingStepName === undefined;
        const waitingStepName = err.waitingStepName ?? callCtx.stepName;
        err.waitingStepName = waitingStepName;
        const currentData =
          this.parsePersistedData(
            (await this.readStepRow(callCtx.runId, callCtx.stepName))?.data,
          ) ?? persistedData;
        await this.markStepWaiting(
          callCtx.runId,
          callCtx.stepName,
          context.steps[step.id],
          isWaitingStep ? err.statePatch : undefined,
          waitingStepName,
          currentData,
        );
        throw err;
      }

      const errMessage = err instanceof Error ? err.message : String(err);
      // A control-flow step writes its branch key before walking children. Read
      // the row again so a later child failure does not erase that selection.
      const failureData =
        this.parsePersistedData((await this.readStepRow(callCtx.runId, callCtx.stepName))?.data) ??
        persistedData;
      await this.markStepFailed(
        callCtx.runId,
        callCtx.stepName,
        errMessage,
        context.steps[step.id],
        failureData,
      );
      throw err;
    }
  }

  private async walkNestedBranch(
    steps: AutomationStepConfig[],
    context: AutomationContext,
    runId: string,
    parentStepName: string,
    branchKey: string,
    resumeStepName?: string,
  ): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as AutomationStepConfig;
      const stepName = `${parentStepName}.${branchKey}.step_${i}`;
      await this.walkPersistedStep(step, context, {
        runId,
        stepName,
        isResuming: resumeStepName === stepName,
        resumeStepName,
      });
    }
  }

  private async upsertStepRow(
    runId: string,
    stepName: string,
    step: AutomationStepConfig,
    status: 'RUNNING' | 'EXTERNAL_WAIT',
    payload: unknown,
  ): Promise<void> {
    const data = payload === null ? null : JSON.stringify(payload);
    const executorType =
      CONTROL_FLOW_STEP_TYPES.has(step.type) ? 'conditional' : 'deterministic';
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: runId },
      select: { workspaceId: true },
    });
    if (!execution?.workspaceId) {
      throw new Error(`Could not find workspaceId for workflow execution ${runId}`);
    }
    await this.prisma.workflowStep.upsert({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      create: {
        workflowExecutionId: runId,
        workspaceId: execution.workspaceId,
        stepName,
        stepExecutorType: executorType,
        status,
        ...(data ? { data } : {}),
      },
      update: {
        status,
        ...(data ? { data } : {}),
      },
    });
  }

  private async readStepRow(runId: string, stepName: string): Promise<PersistedStepRow | null> {
    return this.prisma.workflowStep.findUnique({
      where: { workflowExecutionId_stepName: { workflowExecutionId: runId, stepName } },
      select: { status: true, data: true },
    });
  }

  private parsePersistedData(raw: string | null | undefined): Record<string, unknown> | undefined {
    if (typeof raw !== 'string') return undefined;
    const parsed = safeParseJson(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  }

  private readBranchKey(data: Record<string, unknown> | undefined): string | undefined {
    return typeof data?.branchKey === 'string' ? data.branchKey : undefined;
  }

  private async persistBranchSelection(
    runId: string,
    stepName: string,
    step: AutomationStepConfig,
    branchKey: string,
  ): Promise<void> {
    const row = await this.readStepRow(runId, stepName);
    const existing = this.parsePersistedData(row?.data) ?? {};
    const existingBranchKey = this.readBranchKey(existing);
    if (existingBranchKey !== undefined && existingBranchKey !== branchKey) {
      throw new Error(
        `Step "${step.id}" (${step.type}) attempted to change persisted branch from ${existingBranchKey} to ${branchKey}`,
      );
    }

    await this.prisma.workflowStep.update({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      data: {
        data: JSON.stringify({ ...existing, type: step.type, branchKey }),
      },
    });
  }

  // Rehydrate a completed step's stored entry so a retry skips its side effect
  // but downstream steps still resolve. Returns false unless the output is replayable.
  private replayIfCompleted(
    row: PersistedStepRow | null,
    step: AutomationStepConfig,
    context: AutomationContext,
  ): boolean {
    if (row?.status !== 'COMPLETED' || typeof row.data !== 'string') {
      return false;
    }
    const stored = this.parsePersistedData(row.data);
    const output = stored?.['output'];
    const outputIsObject =
      !!output && typeof output === 'object' && !Array.isArray(output);
    if (
      !stored ||
      typeof stored !== 'object' ||
      !('output' in stored) ||
      (output !== null && output !== undefined && !outputIsObject)
    ) {
      return false;
    }
    const outputRecord =
      outputIsObject
        ? (output as Record<string, unknown>)
        : ((output ?? {}) as Record<string, unknown>);
    const storedInput = stored['input'];
    context.steps[step.id] = {
      type: step.type,
      ...(storedInput && typeof storedInput === 'object' && !Array.isArray(storedInput)
        ? { input: storedInput as Record<string, unknown> }
        : {}),
      output: outputRecord,
    };
    logger.info(
      `[automations] step REPLAY id=${step.id} type=${step.type} (already COMPLETED)`,
    );
    return true;
  }

  private async markStepCompleted(
    runId: string,
    stepName: string,
    ctxEntry: { input?: unknown; output: unknown } | undefined,
    branchKey?: string,
  ): Promise<void> {
    const data = {
      ...(ctxEntry ?? { output: null }),
      ...(branchKey ? { branchKey } : {}),
    };
    await this.prisma.workflowStep.update({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      data: {
        status: 'COMPLETED',
        data: JSON.stringify(data),
      },
    });
  }

  private async markStepWaiting(
    runId: string,
    stepName: string,
    ctxEntry: { input?: unknown; output: unknown } | undefined,
    statePatch?: Record<string, unknown>,
    waitingStepName?: string,
    persistedData?: Record<string, unknown>,
  ): Promise<void> {
    const merged = {
      ...(persistedData ?? {}),
      ...(ctxEntry ?? { output: null }),
      ...(statePatch ?? {}),
      ...(waitingStepName ? { waitingStepName } : {}),
    };
    await this.prisma.workflowStep.update({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      data: {
        status: 'EXTERNAL_WAIT',
        data: JSON.stringify(merged),
      },
    });
  }

  private async markStepFailed(
    runId: string,
    stepName: string,
    error: string,
    ctxEntry: { input?: unknown; output: unknown } | undefined,
    persistedData?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.workflowStep.update({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      data: {
        status: 'FAILED',
        data: JSON.stringify({ ...(persistedData ?? {}), ...(ctxEntry ?? {}), error }),
      },
    });
  }

  private async executeStep(
    step: AutomationStepConfig,
    context: AutomationContext,
    callCtx: StepCallContext,
  ): Promise<StepExecutionResult> {
    const stepImpl = this.stepRegistry.get(step.type);

    // Give the step its authoritative persisted key without mutating the
    // caller's ALS store. Nested runs automatically restore the parent key.
    const store = automationContextStorage.getStore();
    if (!store) return this.executeStepBody(step, context, callCtx, stepImpl);
    return automationContextStorage.run(
      { ...store, stepName: callCtx.stepName },
      () => this.executeStepBody(step, context, callCtx, stepImpl),
    );
  }

  private async executeStepBody(
    step: AutomationStepConfig,
    context: AutomationContext,
    callCtx: StepCallContext,
    stepImpl: BaseStep<z.ZodSchema, Record<string, unknown>>,
  ): Promise<StepExecutionResult> {
    if (stepImpl.kind === StepKind.CONTROL) {
      const controlImpl = stepImpl as BaseControlFlowStep<typeof stepImpl.configSchema, Record<string, unknown>>;
      const safeResult = controlImpl.configSchema.safeParse(step.config);
      if (!safeResult.success) {
        const issueList = safeResult.error.issues
          .map(i => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new Error(
          `Step "${step.id}" (${step.type}) config validation failed:\n${issueList}`,
        );
      }
      const t0 = Date.now();
      logger.info(`[automations] step START id=${step.id} type=${step.type}`);
      const persistedBranchKey = this.readBranchKey(callCtx.persistedData);
      let selectedBranchKey = persistedBranchKey;
      const output = await controlImpl.execute(safeResult.data, context, {
        getPersistedBranchKey: () => persistedBranchKey,
        walkBranch: async (steps, ctx, branchKey) => {
          if (selectedBranchKey !== undefined && selectedBranchKey !== branchKey) {
            throw new Error(
              `Step "${step.id}" (${step.type}) attempted to execute branch ${branchKey} after ${selectedBranchKey} was selected`,
            );
          }
          selectedBranchKey = branchKey;
          await this.persistBranchSelection(
            callCtx.runId,
            callCtx.stepName,
            step,
            branchKey,
          );
          await this.walkNestedBranch(
            steps,
            ctx,
            callCtx.runId,
            callCtx.stepName,
            branchKey,
            callCtx.resumeStepName,
          );
        },
      });
      context.steps[step.id] = { type: step.type, output };
      logger.info(
        `[automations] step OK    id=${step.id} type=${step.type} elapsedMs=${Date.now() - t0}`,
      );
      return { branchKey: selectedBranchKey };
    }

    const resolvedConfig = stripNullForOptionalKeys(
      this.resolver.resolve(step.config, context) as Record<string, unknown>,
      stepImpl.configSchema,
    );

    const safeResult = stepImpl.configSchema.safeParse(resolvedConfig);
    if (!safeResult.success) {
      const issueList = safeResult.error.issues
        .map(i => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(
        `Step "${step.id}" (${step.type}) config validation failed after variable resolution:\n${issueList}`,
      );
    }

    const resolvedInput = safeResult.data as Record<string, unknown>;
    const persistedInput = stepImpl.redactInput
      ? stepImpl.redactInput(resolvedInput)
      : resolvedInput;
    context.steps[step.id] = { type: step.type, input: persistedInput, output: {} };

    const actionImpl = stepImpl as BaseActionStep<typeof stepImpl.configSchema, Record<string, unknown>>;
    const t0 = Date.now();
    logger.info(
      `[automations] step ${callCtx.isResuming ? 'RESUME' : 'START'} id=${step.id} type=${step.type}`,
    );
    try {
      const output = callCtx.isResuming
        ? await this.invokeResume(actionImpl, callCtx.runId, callCtx.stepName, resolvedInput, context)
        : await actionImpl.execute(resolvedInput, context);
      context.steps[step.id] = { type: step.type, input: persistedInput, output };
      logger.info(
        `[automations] step OK    id=${step.id} type=${step.type} elapsedMs=${Date.now() - t0}`,
      );
    } catch (err) {
      if (PauseStep.is(err)) {
        logger.info(
          `[automations] step PAUSED id=${step.id} type=${step.type} elapsedMs=${Date.now() - t0} reason=${err.message}`,
        );
      } else {
        logger.error(
          `[automations] step FAIL  id=${step.id} type=${step.type} elapsedMs=${Date.now() - t0} err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }
    return {};
  }

}
