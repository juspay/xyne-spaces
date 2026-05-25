import type Bull from 'bull';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { automationResumeQueue, type AutomationResumeJobData } from './automation-resume.queue';
import { stepRegistry } from '../steps/step-registry';
import { AutomationExecutor } from '../engine/automation-executor';
import {
  parseAutomationConfig,
  AUTOMATION_WORKFLOW_TYPE,
} from '../types/workflow-adapter';
import { getAutomationPauseState } from '@/database/repositories/workflowExecutionStateUtils';
import { clawClient } from '../services/claw-client';

const MAX_AGENT_RETRIES = 3;

class AutomationResumeWorker {
  private isInitialized = false;
  private executor: AutomationExecutor | null = null;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await automationResumeQueue.initialize();
    if (!automationResumeQueue.isReady) {
      logger.error('[AUTOMATION-RESUME-WORKER] Queue not ready — aborting start');
      return;
    }

    this.executor = new AutomationExecutor(db, stepRegistry);

    automationResumeQueue.getQueue().process(async (job: Bull.Job<AutomationResumeJobData>) => {
      return this.processJob(job);
    });

    this.isInitialized = true;
    logger.info('[AUTOMATION-RESUME-WORKER] Started');
  }

  private async processJob(job: Bull.Job<AutomationResumeJobData>): Promise<void> {
    if (!this.executor) {
      throw new Error('[AUTOMATION-RESUME-WORKER] Executor not initialized');
    }
    const { executionId, externalRef } = job.data;

    const ok = await this.consumePendingAgentResult(executionId);
    if (ok === 'rejected') {
      logger.warn(
        `[AUTOMATION-RESUME-WORKER] Job ${job.id} execution=${executionId} — agent result rejected; not resuming`,
      );
      return;
    }
    if (ok === 'retrying') {
      logger.info(
        `[AUTOMATION-RESUME-WORKER] Job ${job.id} execution=${executionId} — agent retry triggered; waiting for new callback`,
      );
      return;
    }

    logger.info(
      `[AUTOMATION-RESUME-WORKER] Job ${job.id} resuming execution=${executionId} externalRef=${externalRef ?? '∅'}`,
    );
    await this.executor.runExecution(executionId);
  }

  private async consumePendingAgentResult(
    executionId: string,
  ): Promise<'accepted' | 'rejected' | 'no-op' | 'retrying'> {
    const execution = await db.workflowExecution.findUnique({ where: { id: executionId } });
    if (!execution) {
      logger.warn(`[AUTOMATION-RESUME-WORKER] execution=${executionId} not found`);
      return 'no-op';
    }

    const workflow = await db.workflow.findUnique({ where: { id: execution.workflowId } });
    if (!workflow || workflow.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
      logger.warn(
        `[AUTOMATION-RESUME-WORKER] workflow ${execution.workflowId} missing or wrong type`,
      );
      return 'no-op';
    }

    const pauseState = await getAutomationPauseState(executionId);
    if (!pauseState) {
      logger.warn(`[AUTOMATION-RESUME-WORKER] no pause state for execution=${executionId}`);
      return 'no-op';
    }

    const stepIndex = pauseState.currentStepIndex;
    const stepName = `step_${stepIndex}`;
    const automationConfig = parseAutomationConfig(workflow.context);
    const stepConfig = automationConfig.steps[stepIndex];
    if (!stepConfig) {
      logger.warn(
        `[AUTOMATION-RESUME-WORKER] step index ${stepIndex} out of bounds for execution=${executionId}`,
      );
      return 'no-op';
    }

    const row = await db.workflowStep.findUnique({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      select: { data: true },
    });
    const rowData = parseRowData(row?.data ?? null);
    const agentRawResult = rowData['agentRawResult'];
    if (agentRawResult === undefined) {
      return 'no-op';
    }

    const declaredSchema = ((stepConfig as { config?: { outputSchema?: unknown } }).config
      ?.outputSchema ?? {}) as Record<string, string>;
    const envelopeStatus = (agentRawResult as { status?: unknown }).status;
    if (envelopeStatus && envelopeStatus !== 'completed') {
      const envErr =
        (agentRawResult as { error?: unknown }).error ?? `agent run ${String(envelopeStatus)}`;
      await this.failStep(
        executionId,
        stepName,
        rowData,
        `claw run status=${String(envelopeStatus)}: ${String(envErr)}`,
      );
      return 'rejected';
    }

    const rawResult = (agentRawResult as { result?: unknown }).result;
    const agentOutput = unwrapAgentResult(rawResult);
    if (!agentOutput.ok) {
      return this.retryOrFail(executionId, stepName, rowData, declaredSchema, agentOutput.error);
    }

    const validation = validateAgainstSchema(agentOutput.value, declaredSchema);
    if (!validation.ok) {
      logger.warn(
        `[AUTOMATION-RESUME-WORKER] schema validation failed execution=${executionId} step=${stepName}: ${validation.error} — parsed=${JSON.stringify(agentOutput.value)}`,
      );
      return this.retryOrFail(executionId, stepName, rowData, declaredSchema, validation.error);
    }

    const finalEntry: Record<string, unknown> = {
      output: validation.value,
    };
    if ('input' in rowData) finalEntry['input'] = rowData['input'];

    await db.workflowStep.update({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      data: {
        status: 'COMPLETED',
        data: JSON.stringify(finalEntry),
      },
    });
    return 'accepted';
  }

  private async retryOrFail(
    executionId: string,
    stepName: string,
    rowData: Record<string, unknown>,
    declaredSchema: Record<string, unknown>,
    validationError: string,
  ): Promise<'retrying' | 'rejected'> {
    const previousRetries = Number(rowData['agentRetryCount'] ?? 0);
    if (previousRetries >= MAX_AGENT_RETRIES) {
      logger.warn(
        `[AUTOMATION-RESUME-WORKER] execution=${executionId} step=${stepName} exhausted retries (${previousRetries}/${MAX_AGENT_RETRIES}) — failing`,
      );
      await this.failStep(executionId, stepName, rowData, validationError);
      return 'rejected';
    }

    const input = (rowData['input'] as Record<string, unknown> | undefined) ?? {};
    const agentSlug = input['agentSlug'] as string | undefined;
    const originalPrompt = input['prompt'] as string | undefined;
    if (!agentSlug || !originalPrompt) {
      logger.error(
        `[AUTOMATION-RESUME-WORKER] execution=${executionId} step=${stepName} missing agentSlug/prompt on row.input — cannot retry, failing`,
      );
      await this.failStep(executionId, stepName, rowData, validationError);
      return 'rejected';
    }

    const nextRetry = previousRetries + 1;
    const retrySessionId = `${executionId}:${stepName}:retry-${nextRetry}`;
    const retryPrompt = buildRetryPrompt(originalPrompt, validationError, declaredSchema);
    const callbackUrl = `${config.backendUrl.replace(/\/$/, '')}/api/internal/automations/claw-callback/${encodeURIComponent(executionId)}/${encodeURIComponent(stepName)}`;

    let runUserId = '';
    try {
      const agent = await clawClient.getAgentBySlug(agentSlug);
      runUserId =
        agent?.spacesAppUserId ?? (input['userId'] as string | undefined) ?? '';
    } catch (err) {
      logger.warn(
        `[AUTOMATION-RESUME-WORKER] retry agent lookup failed for ${agentSlug}; using stored userId:`,
        err,
      );
      runUserId = (input['userId'] as string | undefined) ?? '';
    }
    if (!runUserId) {
      logger.error(
        `[AUTOMATION-RESUME-WORKER] execution=${executionId} step=${stepName} cannot resolve userId for retry — failing`,
      );
      await this.failStep(executionId, stepName, rowData, validationError);
      return 'rejected';
    }

    try {
      await clawClient.runAgent({
        sessionId: retrySessionId,
        agentSlug,
        task: retryPrompt,
        userId: runUserId,
        callbackUrl,
      });
    } catch (err) {
      logger.error(
        `[AUTOMATION-RESUME-WORKER] retry runAgent failed execution=${executionId} step=${stepName}:`,
        err,
      );
      await this.failStep(executionId, stepName, rowData, validationError);
      return 'rejected';
    }

    const nextRowData: Record<string, unknown> = { ...rowData };
    delete nextRowData['agentRawResult'];
    nextRowData['agentRetryCount'] = nextRetry;
    nextRowData['lastValidationError'] = validationError;

    await db.workflowStep.update({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      data: { data: JSON.stringify(nextRowData) },
    });

    logger.info(
      `[AUTOMATION-RESUME-WORKER] retry ${nextRetry}/${MAX_AGENT_RETRIES} fired execution=${executionId} step=${stepName} sessionId=${retrySessionId}`,
    );
    return 'retrying';
  }

  private async failStep(
    executionId: string,
    stepName: string,
    existingRowData: Record<string, unknown>,
    errorMsg: string,
  ): Promise<void> {
    const raw = existingRowData['agentRawResult'];
    await db.workflowStep.update({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      data: {
        status: 'FAILED',
        data: JSON.stringify({
          ...(existingRowData['input'] !== undefined ? { input: existingRowData['input'] } : {}),
          error: errorMsg,
          raw,
        }),
      },
    });
    await db.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'FAILED' },
    });
  }
}

function buildRetryPrompt(
  originalPrompt: string,
  validationError: string,
  declaredSchema: Record<string, unknown>,
): string {
  const schemaPreview = JSON.stringify(declaredSchema, null, 2);
  return [
    originalPrompt,
    '',
    '---',
    '',
    'Your previous response could not be accepted. Validation error:',
    validationError,
    '',
    'Respond ONLY with a valid JSON object matching this exact shape (no markdown, no commentary, no code fence):',
    schemaPreview,
  ].join('\n');
}

function parseRowData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function unwrapAgentResult(
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: false, error: 'agent callback missing `result` field' };
  }
  if (typeof raw === 'object') {
    return { ok: true, value: raw as Record<string, unknown> };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: `agent callback \`result\` has unexpected type ${typeof raw}` };
  }

  const trimmed = raw.trim();
  const attempts: string[] = [trimmed];
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenceMatch && fenceMatch[1]) attempts.push(fenceMatch[1].trim());
  const braceMatch = /\{[\s\S]*\}/.exec(trimmed);
  if (braceMatch) attempts.push(braceMatch[0]);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
    } catch {
      continue;
    }
  }
  return {
    ok: false,
    error: `agent \`result\` is not valid JSON object (preview: ${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''})`,
  };
}

function validateAgainstSchema(
  actual: Record<string, unknown>,
  declared: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  return validateInner(actual, declared, '');
}

function validateInner(
  actual: Record<string, unknown>,
  declared: Record<string, unknown>,
  pathPrefix: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof actual !== 'object' || actual === null) {
    return { ok: false, error: `${pathPrefix || 'response'} is not an object` };
  }
  for (const [key, expected] of Object.entries(declared)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (!(key in actual)) {
      return { ok: false, error: `required key "${path}" missing from agent response` };
    }
    const v = (actual as Record<string, unknown>)[key];

    if (typeof expected === 'string') {
      const actualType = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      if (actualType !== expected) {
        return {
          ok: false,
          error: `key "${path}" expected ${expected}, got ${actualType}`,
        };
      }
    } else if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return {
          ok: false,
          error: `key "${path}" expected object, got ${Array.isArray(v) ? 'array' : typeof v}`,
        };
      }
      const sub = validateInner(
        v as Record<string, unknown>,
        expected as Record<string, unknown>,
        path,
      );
      if (!sub.ok) return sub;
    }
  }
  return { ok: true, value: actual };
}

export const automationResumeWorker = new AutomationResumeWorker();
