import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { PauseStep } from '../engine/pause-step';
import { automationContextStorage } from '../engine/automation-context-storage';
import { OutputSchemaSchema, assertMatchesSchema } from '../engine/declared-schema';
import {
  clawClient,
  resolveAgentSpacesAppId,
  resolveHeadlessIdentityContext,
} from '../services/claw-client';
import { parseAgentAttachments } from '../services/agent-attachment.service';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const DEFAULT_MAX_RETRIES = 3;
const AGENT_RESULT_LOG_LIMIT = 2_000;

const RunAgentConfigSchema = z.object({
  agentSlug: variableRef(z.string().min(1).describe('Claw agent slug (display/logging only)')),
  spacesAppId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Spaces app id of the claw agent — the globally-unique webhook routing key. Saved by the builder; when absent (legacy configs) it is resolved from agentSlug at run time.',
    ),
  prompt: variableRef(z.string().min(1).describe('Prompt for the agent')),
  outputSchema: OutputSchemaSchema.default({}).describe(
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

    const stepName = store.stepName ?? `step_${Math.max(0, Object.keys(context.steps).length - 1)}`;

    const sessionId = `${store.runId}:${stepName}`;
    const callbackUrl = buildCallbackUrl(store.runId, stepName);

    const agentSlug = cfg.agentSlug as string;
    const prompt = cfg.prompt as string;
    const spacesAppId = await resolveAgentSpacesAppId(agentSlug, context.automation.workspaceId, cfg.spacesAppId);
    const runUserId = await resolveRunUserId(spacesAppId, context.automation.createdById, context.automation.workspaceId);
    const identityContext = await resolveHeadlessIdentityContext(runUserId, context.automation.workspaceId);
    const visibleContext = resolveVisibleConversationContext(context);

    logger.info(
      `[RUN_AGENT] firing — executionId=${store.runId} stepName=${stepName} agentSlug=${agentSlug} sessionId=${sessionId} userId=${runUserId}`,
    );

    try {
      await clawClient.runAgent({
        sessionId,
        spacesAppId,
        agentSlug,
        task: prompt,
        userId: runUserId,
        ...identityContext,
        callbackUrl,
        ...(visibleContext ? visibleContext : {}),
      });
    } catch (err) {
      logger.error(
        `[RUN_AGENT] claw rejected the run — executionId=${store.runId} stepName=${stepName}:`,
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
    const attachments = parseAgentAttachments(
      (agentRawResult as { attachments?: unknown }).attachments,
    );
    logger.info(
      `[RUN_AGENT] callback result — status=${String(envelopeStatus ?? '∅')} rawType=${typeof rawResult} attachments=${attachments.length} raw=${formatForLog(rawResult)}`,
    );

    try {
      const parsed = parseAgentJson(rawResult);
      assertMatchesSchema(parsed, declaredSchema);
      if (attachments.length === 0) return parsed as RunAgentOutput;
      if ('attachments' in parsed) {
        logger.warn(
          '[RUN_AGENT] agent JSON already declares "attachments"; keeping it and dropping the callback attachments',
        );
        return parsed as RunAgentOutput;
      }
      return { ...parsed, attachments } as RunAgentOutput;
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
        : (store.stepName ?? deriveStepNameFromCtx(context));
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
    const spacesAppId = await resolveAgentSpacesAppId(agentSlug, context.automation.workspaceId, cfg.spacesAppId);
    const runUserId = await resolveRunUserId(spacesAppId, context.automation.createdById, context.automation.workspaceId);
    const identityContext = await resolveHeadlessIdentityContext(runUserId, context.automation.workspaceId);
    const callbackUrl = buildCallbackUrl(store.runId, stepName);
    const visibleContext = resolveVisibleConversationContext(context);

    logger.info(
      `[RUN_AGENT] retry ${nextRetry}/${maxRetries} firing — executionId=${store.runId} step=${stepName} sessionId=${retrySessionId}`,
    );

    try {
      await clawClient.runAgent({
        sessionId: retrySessionId,
        spacesAppId,
        agentSlug,
        task: retryPrompt,
        userId: runUserId,
        ...identityContext,
        callbackUrl,
        ...(visibleContext ? visibleContext : {}),
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

function resolveVisibleConversationContext(
  context: AutomationContext,
): { conversationId: string; channelId: string } | null {
  const trigger = context.trigger as Record<string, unknown> | undefined;
  const message = trigger?.message as Record<string, unknown> | undefined;
  const ticket = trigger?.ticket as Record<string, unknown> | undefined;
  const conversationId =
    asNonEmptyString(trigger?.conversationId) ??
    asNonEmptyString(message?.conversationId) ??
    asNonEmptyString(ticket?.conversationId);
  const channelId =
    asNonEmptyString(trigger?.channelId) ??
    asNonEmptyString(message?.channelId) ??
    asNonEmptyString(ticket?.channelId);
  return conversationId && channelId ? { conversationId, channelId } : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function buildCallbackUrl(executionId: string, stepName: string): string {
  return `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}/api/internal/automations/claw-callback/${encodeURIComponent(executionId)}/${encodeURIComponent(stepName)}`;
}

async function resolveRunUserId(spacesAppId: string, creatorId: string, workspaceId: string): Promise<string> {
  if (creatorId) return creatorId;
  try {
    const install = await db.installedApps.findFirst({
      where: { appId: spacesAppId, workspaceId },
      select: { userId: true },
    });
    if (install?.userId) return install.userId;
    logger.info(
      `[RUN_AGENT] app ${spacesAppId} has no installation — attributing to automation creator ${creatorId}`,
    );
  } catch (err) {
    logger.warn(
      `[RUN_AGENT] failed to resolve app user for ${spacesAppId}; falling back to creator:`,
      err,
    );
  }
  return creatorId;
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

function formatForLog(value: unknown): string {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > AGENT_RESULT_LOG_LIMIT
    ? `${text.slice(0, AGENT_RESULT_LOG_LIMIT)}...[truncated ${text.length - AGENT_RESULT_LOG_LIMIT} chars]`
    : text;
}
