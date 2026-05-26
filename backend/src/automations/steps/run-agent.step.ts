import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { PauseStep } from '../engine/pause-step';
import { automationContextStorage } from '../engine/automation-context-storage';
import { clawClient } from '../services/claw-client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

const OutputFieldTypeSchema = z.enum(['string', 'number', 'boolean', 'object', 'array']);
export type OutputFieldType = z.infer<typeof OutputFieldTypeSchema>;

const OutputSchemaNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([OutputFieldTypeSchema, z.record(z.string().min(1), OutputSchemaNodeSchema)]),
);
const OutputSchemaSchema = z.record(z.string().min(1), OutputSchemaNodeSchema);
export type RunAgentOutputSchema = z.infer<typeof OutputSchemaSchema>;

const DEFAULT_MAX_RETRIES = 3;

const RunAgentConfigSchema = z.object({
  agentSlug: variableRef(z.string().min(1).describe('Claw agent slug')),
  prompt: variableRef(z.string().min(1).describe('Prompt for the agent')),
  outputSchema: OutputSchemaSchema.describe(
    'Expected output shape: keys must be present in the agent response; extra fields are kept but not validated.',
  ),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('How many times to retry the agent if its response fails schema validation. Default 3.'),
});

export type RunAgentConfig = z.infer<typeof RunAgentConfigSchema>;

const RunAgentOutputSchemaPermissive = z.record(z.string(), z.unknown());
type RunAgentOutput = z.infer<typeof RunAgentOutputSchemaPermissive> & Record<string, unknown>;

export class RunAgentStep extends BaseActionStep<typeof RunAgentConfigSchema, RunAgentOutput> {
  readonly type = 'RUN_AGENT';
  readonly configSchema = RunAgentConfigSchema;
  readonly outputSchema = RunAgentOutputSchemaPermissive;
  readonly name = 'Run an agent';
  readonly description =
    'Send a prompt to an xyne-claw agent and wait for its JSON response. Downstream steps can use the fields you declare in the output schema.';
  readonly category = StepCategory.AI;
  readonly icon = 'Sparkles';

  async execute(
    cfg: z.infer<typeof RunAgentConfigSchema>,
    context: AutomationContext,
  ): Promise<RunAgentOutput> {
    const store = automationContextStorage.getStore();
    if (!store) {
      throw new Error(
        '[RUN_AGENT] step executed outside an automation context — automationContextStorage was empty',
      );
    }

    const stepCount = Object.keys(context.steps).length;
    const currentIndex = Math.max(0, stepCount - 1);

    const sessionId = `${store.runId}:step_${currentIndex}`;
    const callbackUrl = buildCallbackUrl(store.runId, `step_${currentIndex}`);

    const agentSlug = cfg.agentSlug as string;
    const prompt = cfg.prompt as string;
    const runUserId = await resolveRunUserId(agentSlug, context.automation.createdById);

    logger.info(
      `[RUN_AGENT] firing — executionId=${store.runId} stepIndex=${currentIndex} agentSlug=${agentSlug} sessionId=${sessionId} userId=${runUserId}`,
    );

    try {
      await clawClient.runAgent({
        sessionId,
        agentSlug,
        task: prompt,
        userId: runUserId,
        callbackUrl,
      });
    } catch (err) {
      logger.error(
        `[RUN_AGENT] claw rejected the run — executionId=${store.runId} stepIndex=${currentIndex}:`,
        err,
      );
      throw err;
    }
    throw new PauseStep(`waiting on claw agent ${agentSlug}`, { externalRef: sessionId });
  }

  async onResume(
    rowData: Record<string, unknown>,
    cfg: z.infer<typeof RunAgentConfigSchema>,
    context: AutomationContext,
  ): Promise<RunAgentOutput> {
    const agentRawResult = rowData['agentRawResult'] as Record<string, unknown> | undefined;
    if (!agentRawResult) {
      throw new Error('[RUN_AGENT] onResume called with no agentRawResult on the step row');
    }

    const envelopeStatus = (agentRawResult as { status?: unknown }).status;
    if (envelopeStatus && envelopeStatus !== 'completed') {
      const envErr =
        (agentRawResult as { error?: unknown }).error ?? `agent run ${String(envelopeStatus)}`;
      throw new Error(`[RUN_AGENT] claw run status=${String(envelopeStatus)}: ${String(envErr)}`);
    }

    const declaredSchema = (cfg.outputSchema ?? {}) as Record<string, unknown>;
    const rawResult = (agentRawResult as { result?: unknown }).result;

    try {
      const parsed = parseAgentJson(rawResult);
      assertMatchesSchema(parsed, declaredSchema);
      return parsed as RunAgentOutput;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[RUN_AGENT] validation failed: ${message}`);
      return this.handleValidationFailure(message, rowData, cfg, context);
    }
  }

  private async handleValidationFailure(
    validationError: string,
    rowData: Record<string, unknown>,
    cfg: z.infer<typeof RunAgentConfigSchema>,
    context: AutomationContext,
  ): Promise<RunAgentOutput> {
    const previousRetries = Number(rowData['agentRetryCount'] ?? 0);
    const maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (previousRetries >= maxRetries) {
      throw new Error(
        `[RUN_AGENT] retries exhausted (${previousRetries}/${maxRetries}): ${validationError}`,
      );
    }

    const store = automationContextStorage.getStore();
    if (!store) {
      throw new Error('[RUN_AGENT] retry attempted outside an automation context');
    }
    const stepName =
      typeof rowData['stepName'] === 'string'
        ? (rowData['stepName'] as string)
        : deriveStepNameFromCtx(context);
    if (!stepName) {
      throw new Error('[RUN_AGENT] cannot derive stepName for retry');
    }

    const nextRetry = previousRetries + 1;
    const retrySessionId = `${store.runId}:${stepName}:retry-${nextRetry}`;
    const agentSlug = cfg.agentSlug as string;
    const originalPrompt = cfg.prompt as string;
    const retryPrompt = buildRetryPrompt(
      originalPrompt,
      validationError,
      cfg.outputSchema ?? {},
    );
    const runUserId = await resolveRunUserId(agentSlug, context.automation.createdById);
    const callbackUrl = buildCallbackUrl(store.runId, stepName);

    logger.info(
      `[RUN_AGENT] retry ${nextRetry}/${maxRetries} firing — executionId=${store.runId} step=${stepName} sessionId=${retrySessionId}`,
    );

    try {
      await clawClient.runAgent({
        sessionId: retrySessionId,
        agentSlug,
        task: retryPrompt,
        userId: runUserId,
        callbackUrl,
      });
    } catch (err) {
      throw new Error(
        `[RUN_AGENT] retry runAgent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    throw new PauseStep(`retrying claw agent ${agentSlug} (${nextRetry}/${maxRetries})`, {
      externalRef: retrySessionId,
      statePatch: {
        agentRetryCount: nextRetry,
        lastValidationError: validationError,
      },
    });
  }
}

export const runAgentStep = new RunAgentStep();

function buildCallbackUrl(executionId: string, stepName: string): string {
  return `${config.backendUrl.replace(/\/$/, '')}/api/internal/automations/claw-callback/${encodeURIComponent(executionId)}/${encodeURIComponent(stepName)}`;
}

async function resolveRunUserId(agentSlug: string, fallbackUserId: string): Promise<string> {
  try {
    const agent = await clawClient.getAgentBySlug(agentSlug);
    if (agent?.spacesAppUserId) return agent.spacesAppUserId;
    logger.info(
      `[RUN_AGENT] agent "${agentSlug}" has no spacesAppUserId — attributing to automation creator ${fallbackUserId}`,
    );
  } catch (err) {
    logger.warn(
      `[RUN_AGENT] failed to fetch agent "${agentSlug}" for userId resolution; falling back to creator:`,
      err,
    );
  }
  return fallbackUserId;
}

function deriveStepNameFromCtx(context: AutomationContext): string | null {
  const stepCount = Object.keys(context.steps).length;
  if (stepCount === 0) return null;
  return `step_${stepCount - 1}`;
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

function parseAgentJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') throw new Error(`result is not a string (got ${typeof raw})`);
  const text = stripJsonFence(raw.trim());
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('result is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function stripJsonFence(text: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fence?.[1]?.trim() ?? text;
}

function assertMatchesSchema(
  actual: Record<string, unknown>,
  declared: Record<string, unknown>,
  path = '',
): void {
  for (const [key, expected] of Object.entries(declared)) {
    const here = path ? `${path}.${key}` : key;
    if (!(key in actual)) throw new Error(`required key "${here}" missing`);
    const v = actual[key];
    const actualType = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (typeof expected === 'string') {
      if (actualType !== expected) {
        throw new Error(`key "${here}" expected ${expected}, got ${actualType}`);
      }
    } else if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (actualType !== 'object') {
        throw new Error(`key "${here}" expected object, got ${actualType}`);
      }
      assertMatchesSchema(v as Record<string, unknown>, expected as Record<string, unknown>, here);
    }
  }
}
