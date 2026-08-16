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
import type { StepType } from '../types/step-types';
import { CONTROL_FLOW_STEP_TYPES, ControlFlowStepType } from '../types/known-types';
import type { StepRegistry } from '../steps/step-registry';
import { BaseActionStep, BaseControlFlowStep, StepKind } from '../steps/base-step';
import { VariableResolver, stripNullForOptionalKeys } from './variable-resolver';
import { automationContextStorage } from './automation-context-storage';
import {
  PauseStep,
  branchKeyEquals,
  branchKeyToString,
  type BranchKey,
  type PauseBranchSegment,
} from './pause-step';
import {
  isExecutableAutomationWorkflowType,
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
  resumeAtIndex?: number;
  resumeBranchPath?: readonly PauseBranchSegment[];
}

function readPauseBranchPath(context: AutomationContext): readonly PauseBranchSegment[] {
  return context.__pauseBranchPath ?? [];
}

function writePauseBranchPath(
  context: AutomationContext,
  path: readonly PauseBranchSegment[],
): void {
  if (path.length === 0) delete context.__pauseBranchPath;
  else context.__pauseBranchPath = [...path];
}

const EXTERNAL_WAIT_STATUS = 'EXTERNAL_WAIT';

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseStepIndexFromName(name: string): number | null {
  const m = /^step_(\d+)$/.exec(name);
  if (!m) return null;
  const n = Number.parseInt(m[1] as string, 10);
  return Number.isInteger(n) ? n : null;
}

interface BranchOwnerConfig {
  if_true?: unknown[];
  if_false?: unknown[];
  default?: unknown[];
  cases?: { steps?: unknown[] }[];
}

function resolveBranchSteps(
  config: BranchOwnerConfig,
  branchKey: BranchKey,
): AutomationStepConfig[] | null {
  switch (branchKey.kind) {
    case 'if_true':
      return (config.if_true as AutomationStepConfig[] | undefined) ?? null;
    case 'if_false':
      return (config.if_false as AutomationStepConfig[] | undefined) ?? null;
    case 'default':
      return (config.default as AutomationStepConfig[] | undefined) ?? null;
    case 'case':
      return (config.cases?.[branchKey.index]?.steps as AutomationStepConfig[] | undefined) ?? null;
  }
}

// Maps a trigger's event type to the key (on the flattened `trigger` object built by
// buildContext()) holding the id of the entity that fired it — used to stamp debug
// correlation columns on WorkflowStep rows. WEBHOOK is intentionally omitted: it has
// no natural entity id to correlate on.
const TRIGGER_ENTITY_ID_KEY: Readonly<Record<string, string>> = {
  TICKET_CREATED: 'ticketId',
  TICKET_UPDATED: 'ticketId',
  TICKET_COMMENTED: 'ticketId',
  EMAIL_RECEIVED: 'emailId',
  EMAIL_SENT: 'emailId',
  MESSAGE_RECEIVED: 'messageId',
  CALL_EVENT: 'callId',
  TAG_GENERATED: 'sourceId',
};

function resolveDebugEntity(
  trigger: AutomationContext['trigger'],
): { entityType: string; entityId: string } | null {
  const key = TRIGGER_ENTITY_ID_KEY[trigger.type];
  if (!key) return null;
  const id = (trigger as Record<string, unknown>)[key];
  return typeof id === 'string' && id.length > 0
    ? { entityType: trigger.type, entityId: id }
    : null;
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
      logger.warn(`[automations] runExecution: row ${executionId} not found, dropping`);
      return undefined;
    }
    if (!isExecutableAutomationWorkflowType(existing.workflowType)) {
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

    const isResume = existing.status === EXTERNAL_WAIT_STATUS;
    const isFresh =
      existing.status === AutomationRunStatus.PENDING ||
      existing.status === AutomationRunStatus.SCHEDULED;
    if (!isFresh && !isResume) {
      logger.warn(
        `[automations] runExecution: row ${executionId} status=${existing.status} — no handler, skipping`,
      );
      return undefined;
    }

    const prep = await this.prepareRun(executionId, workflow, config, metadata, isResume);
    if (!prep) return undefined;
    return this.commitAndRun(executionId, workflow, config, prep);
  }

  private async commitAndRun(
    executionId: string,
    workflow: Workflow,
    config: ReturnType<typeof parseAutomationConfig>,
    prep: PreparedRun,
  ): Promise<unknown> {
    prep.ctx.__meta = { error: null, chain: prep.chain };
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
      prep.resumeAtIndex,
      prep.resumeBranchPath,
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
      const stepRows = await this.prisma.workflowStep.findMany({
        where: { workflowExecutionId: executionId },
      });
      for (const row of stepRows) {
        if (!row.stepName || !row.data) continue;
        const idx = parseStepIndexFromName(row.stepName);
        if (idx === null) continue;
        const stepConfig = config.steps[idx];
        if (!stepConfig) continue;
        const parsedRow = safeParseJson(row.data);
        if (parsedRow !== undefined && parsedRow !== null && typeof parsedRow === 'object') {
          const fromRow = parsedRow as {
            type?: StepType;
            input?: Record<string, unknown>;
            output?: unknown;
          };
          initialCtx.steps[stepConfig.id] = {
            type: fromRow.type ?? stepConfig.type,
            ...(fromRow.input !== undefined ? { input: fromRow.input } : {}),
            output: (fromRow.output ?? {}) as Record<string, unknown>,
          };
        }
      }
      const pausedIndex = pauseState.currentStepIndex;
      const resumeBranchPath = readPauseBranchPath(initialCtx);
      writePauseBranchPath(initialCtx, []);
      return {
        ctx: initialCtx,
        chain,
        startIndex: pausedIndex,
        label: 'RESUMED',
        resumeAtIndex: pausedIndex,
        ...(resumeBranchPath.length > 0 ? { resumeBranchPath } : {}),
      };
    }

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
    const rowData: Record<string, unknown> =
      row?.data && typeof row.data === 'string'
        ? (safeParseJson(row.data) as Record<string, unknown> | undefined) ?? {}
        : {};

    if (typeof actionImpl.onResume === 'function') {
      return actionImpl.onResume(rowData, resolvedInput, context);
    }
    const fallback = rowData['output'];
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
      logger.warn(
        `[automations] hydratePayload failed for automation=${automationId}, using snapshot:`,
        err,
      );
      return triggerData;
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
    resumeAtIndex?: number,
    resumeBranchPath?: readonly PauseBranchSegment[],
  ): Promise<unknown> {
    const automationId = context.automation.id;
    try {
      const walkResult = await automationContextStorage.run<Promise<WalkResult>>(
        { runId, automationId, chain },
        () => this.walkSteps(steps, context, runId, startIndex, resumeAtIndex, resumeBranchPath),
      );

      if (walkResult.kind === 'paused') {
        logger.info(
          `AutomationExecutor: run ${runId} PAUSED at index=${walkResult.atIndex} (externalRef=${walkResult.externalRef ?? '∅'})`,
        );
        return undefined;
      }

      const completed = await this.prisma.workflowExecution.update({
        where: { id: runId },
        data: { status: AutomationRunStatus.COMPLETED },
      });
      context.__meta = { error: null, chain };
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
      context.__meta = { error: errMessage, chain };
      await persistAutomationState(runId, {
        context: JSON.stringify(context),
      });
      logger.error(
        `AutomationExecutor: run ${runId} FAILED for automation ${automationId}: ${errMessage}`,
      );
      throw err;
    }
  }

  private async walkSteps(
    steps: AutomationStepConfig[],
    context: AutomationContext,
    runId: string,
    startIndex: number = 0,
    resumeAtIndex?: number,
    resumeBranchPath?: readonly PauseBranchSegment[],
  ): Promise<WalkResult> {
    const debugEntity = resolveDebugEntity(context.trigger);
    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i] as AutomationStepConfig;
      const stepName = `step_${i}`;
      const isResuming = resumeAtIndex === i;

      if (!isResuming) {
        await this.upsertStepRow(runId, stepName, step, 'RUNNING', null, debugEntity);
      }

      try {
        await this.executeStep(step, context, {
          runId,
          stepName,
          isResuming,
          ...(isResuming && resumeBranchPath && resumeBranchPath.length > 0
            ? { resumeBranchPath }
            : {}),
        });

        const stepCtxEntry = context.steps[step.id];
        await this.markStepCompleted(runId, stepName, stepCtxEntry);
      } catch (err) {
        if (PauseStep.is(err)) {
          if (err.branchPath.length === 0) {
            await this.markStepWaiting(runId, stepName, context.steps[step.id], err.statePatch);
          }
          writePauseBranchPath(context, err.branchPath);
          await persistAutomationPauseState(runId, {
            context: JSON.stringify(context),
            currentStepIndex: i,
          });
          await this.prisma.workflowExecution.update({
            where: { id: runId },
            data: { status: EXTERNAL_WAIT_STATUS },
          });
          return { kind: 'paused', atIndex: i, externalRef: err.externalRef };
        }
        const errMessage = err instanceof Error ? err.message : String(err);
        await this.markStepFailed(runId, stepName, errMessage, context.steps[step.id]);
        throw err;
      }
    }
    return { kind: 'completed' };
  }

  private async walkNestedBranch(
    steps: AutomationStepConfig[],
    context: AutomationContext,
    runId: string,
    parentStepName: string,
    branchKey: BranchKey,
    resumePath: readonly PauseBranchSegment[] = [],
  ): Promise<void> {
    const [resumeHere, ...deeperResume] = resumePath;
    const resumeAt =
      resumeHere && branchKeyEquals(resumeHere.branchKey, branchKey) ? resumeHere.index : null;
    const startIndex = resumeAt ?? 0;
    const branchLabel = branchKeyToString(branchKey);

    for (let j = startIndex; j < steps.length; j++) {
      const step = steps[j] as AutomationStepConfig;
      const stepName = `${parentStepName}__${branchLabel}__step_${j}`;
      const isResuming = resumeAt === j;

      if (!isResuming) {
        await this.upsertStepRow(runId, stepName, step, 'RUNNING', null);
      }

      try {
        await this.executeStep(step, context, {
          runId,
          stepName,
          isResuming,
          ...(isResuming && deeperResume.length > 0 ? { resumeBranchPath: deeperResume } : {}),
        });
        await this.markStepCompleted(runId, stepName, context.steps[step.id]);
      } catch (err) {
        if (PauseStep.is(err)) {
          await this.markStepWaiting(runId, stepName, context.steps[step.id], err.statePatch);
          err.branchPath.unshift({ branchKey, index: j, stepName });
          throw err;
        }
        await this.markStepFailed(
          runId,
          stepName,
          err instanceof Error ? err.message : String(err),
          context.steps[step.id],
        );
        throw err;
      }
    }
  }

  private async upsertStepRow(
    runId: string,
    stepName: string,
    step: AutomationStepConfig,
    status: 'RUNNING' | 'EXTERNAL_WAIT',
    payload: unknown,
    debugEntity?: { entityType: string; entityId: string } | null,
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
        ...(debugEntity
          ? { entityType: debugEntity.entityType, entityId: debugEntity.entityId }
          : {}),
      },
      update: {
        status,
        ...(data ? { data } : {}),
      },
    });
  }

  private async markStepCompleted(
    runId: string,
    stepName: string,
    ctxEntry: { input?: unknown; output: unknown } | undefined,
  ): Promise<void> {
    await this.prisma.workflowStep.update({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      data: {
        status: 'COMPLETED',
        data: JSON.stringify(ctxEntry ?? { output: null }),
      },
    });
  }

  private async markStepWaiting(
    runId: string,
    stepName: string,
    ctxEntry: { input?: unknown; output: unknown } | undefined,
    statePatch?: Record<string, unknown>,
  ): Promise<void> {
    const base = ctxEntry ?? { output: null };
    const merged = statePatch ? { ...base, ...statePatch } : base;
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
  ): Promise<void> {
    await this.prisma.workflowStep.update({
      where: {
        workflowExecutionId_stepName: { workflowExecutionId: runId, stepName },
      },
      data: {
        status: 'FAILED',
        data: JSON.stringify({ ...(ctxEntry ?? {}), error }),
      },
    });
  }

  private async executeStep(
    step: AutomationStepConfig,
    context: AutomationContext,
    callCtx: {
      runId: string;
      stepName: string;
      isResuming: boolean;
      resumeBranchPath?: readonly PauseBranchSegment[];
    },
  ): Promise<void> {
    const stepImpl = this.stepRegistry.get(step.type);

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

      if (callCtx.isResuming && callCtx.resumeBranchPath && callCtx.resumeBranchPath.length > 0) {
        const [segment, ...deeper] = callCtx.resumeBranchPath as [
          PauseBranchSegment,
          ...PauseBranchSegment[],
        ];
        const branchKey = segment.branchKey;
        const branchLabel = branchKeyToString(branchKey);
        const branchSteps = resolveBranchSteps(safeResult.data as BranchOwnerConfig, branchKey);
        if (!branchSteps) {
          throw new Error(
            `Step "${step.id}" (${step.type}) cannot resume: branch "${branchLabel}" no longer exists in the automation.`,
          );
        }
        logger.info(
          `[automations] step RESUME id=${step.id} type=${step.type} branch=${branchLabel} at=${segment.index}`,
        );
        await this.walkNestedBranch(
          branchSteps,
          context,
          callCtx.runId,
          callCtx.stepName,
          branchKey,
          [segment, ...deeper],
        );
        context.steps[step.id] = {
          type: step.type,
          output:
            step.type === ControlFlowStepType.SWITCH
              ? { matchedIndex: branchKey.kind === 'case' ? branchKey.index : -1 }
              : { result: branchKey.kind === 'if_true' },
        };
        logger.info(
          `[automations] step OK    id=${step.id} type=${step.type} elapsedMs=${Date.now() - t0}`,
        );
        return;
      }

      logger.info(`[automations] step START id=${step.id} type=${step.type}`);
      const output = await controlImpl.execute(safeResult.data, context, {
        walkBranch: (steps, ctx, branchKey) =>
          this.walkNestedBranch(steps, ctx, callCtx.runId, callCtx.stepName, branchKey),
      });
      context.steps[step.id] = { type: step.type, output };
      logger.info(
        `[automations] step OK    id=${step.id} type=${step.type} elapsedMs=${Date.now() - t0}`,
      );
      return;
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
      const parentStore = automationContextStorage.getStore();
      const output = await automationContextStorage.run(
        { ...parentStore!, stepName: callCtx.stepName },
        async () =>
          callCtx.isResuming
            ? this.invokeResume(actionImpl, callCtx.runId, callCtx.stepName, resolvedInput, context)
            : actionImpl.execute(resolvedInput, context),
      );
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
  }

}
