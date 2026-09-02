import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { PauseStep } from '../engine/pause-step';
import { automationContextStorage } from '../engine/automation-context-storage';
import { OutputSchemaSchema, assertMatchesSchema } from '../engine/declared-schema';
import { clawClient } from '../services/claw-client';
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

    const stepName = deriveStepNameFromCtx(context);
    if (!stepName) {
      throw new Error('[RUN_AGENT] cannot derive stepName for this step');
    }

    const sessionId = `${store.runId}:${stepName}`;
    const callbackUrl = buildCallbackUrl(store.runId, stepName);

    const agentSlug = cfg.agentSlug as string;
    const prompt = cfg.prompt as string;
    const spacesAppId = await resolveSpacesAppId(cfg, agentSlug, context.automation.workspaceId);
    const runUserId = await resolveRunUserId(spacesAppId, context.automation.createdById);
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
    const spacesAppId = await resolveSpacesAppId(cfg, agentSlug, context.automation.workspaceId);
    const runUserId = await resolveRunUserId(spacesAppId, context.automation.createdById);
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
  const conversationId =
    asNonEmptyString(trigger?.conversationId) ??
    asNonEmptyString((trigger?.message as Record<string, unknown> | undefined)?.conversationId);
  const channelId =
    asNonEmptyString(trigger?.channelId) ??
    asNonEmptyString((trigger?.message as Record<string, unknown> | undefined)?.channelId);
  return conversationId && channelId ? { conversationId, channelId } : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function buildCallbackUrl(executionId: string, stepName: string): string {
  return `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}/api/internal/automations/claw-callback/${encodeURIComponent(executionId)}/${encodeURIComponent(stepName)}`;
}

const AGENT_LIST_CACHE_TTL_MS = 60_000;
let agentListCache: { agents: Awaited<ReturnType<typeof clawClient.listAgents>>; fetchedAt: number } | null = null;

async function listAgentsCached(): Promise<Awaited<ReturnType<typeof clawClient.listAgents>>> {
  if (agentListCache && Date.now() - agentListCache.fetchedAt < AGENT_LIST_CACHE_TTL_MS) {
    return agentListCache.agents;
  }
  const agents = await clawClient.listAgents();
  agentListCache = { agents, fetchedAt: Date.now() };
  return agents;
}

async function resolveSpacesAppId(
  cfg: z.infer<typeof RunAgentConfigSchema>,
  agentSlug: string,
  workspaceId: string,
): Promise<string> {
  const configured = (cfg.spacesAppId ?? '').trim();
  if (configured) {
    if (await appBelongsToWorkspace(configured, workspaceId)) return configured;
    throw new Error(
      `[RUN_AGENT] configured spacesAppId ${configured} for agent "${agentSlug}" does not belong to workspace ${workspaceId} — re-select the agent in the automation builder`,
    );
  }

  const agents = await listAgentsCached();
  const candidates = agents.filter(a => a.slug === agentSlug && a.spacesAppId);
  if (candidates.length === 0) {
    throw new Error(
      `[RUN_AGENT] agent "${agentSlug}" not found in the claw catalog (disabled, deleted, or never published as a Spaces app)`,
    );
  }
  if (candidates.length === 1) return candidates[0].spacesAppId as string;

  const candidateIds = candidates.map(a => a.spacesAppId as string);
  const apps = await db.apps.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, workspaceId: true, orgId: true },
  });
  const inWorkspace = apps.filter(a => a.workspaceId === workspaceId);
  if (inWorkspace.length === 1) return inWorkspace[0].id;

  const wsOrgs = await db.workspaceOrganization.findMany({
    where: { workspaceId, leftAt: null },
    select: { orgId: true },
  });
  const orgIds = new Set(wsOrgs.map(w => w.orgId));
  const inOrg = apps.filter(a => orgIds.has(a.orgId));
  if (inOrg.length === 1) return inOrg[0].id;

  throw new Error(
    `[RUN_AGENT] agent slug "${agentSlug}" matches ${candidates.length} agents across orgs and workspace ${workspaceId} does not disambiguate — re-select the agent in the builder so the config pins its spacesAppId`,
  );
}

async function appBelongsToWorkspace(appId: string, workspaceId: string): Promise<boolean> {
  const app = await db.apps.findUnique({
    where: { id: appId },
    select: { workspaceId: true, orgId: true },
  });
  if (!app) return false;
  if (app.workspaceId === workspaceId) return true;
  const member = await db.workspaceOrganization.findFirst({
    where: { workspaceId, orgId: app.orgId, leftAt: null },
    select: { id: true },
  });
  return Boolean(member);
}

async function resolveRunUserId(spacesAppId: string, fallbackUserId: string): Promise<string> {
  try {
    const install = await db.installedApps.findFirst({
      where: { appId: spacesAppId },
      select: { userId: true },
    });
    if (install?.userId) return install.userId;
    logger.info(
      `[RUN_AGENT] app ${spacesAppId} has no installation — attributing to automation creator ${fallbackUserId}`,
    );
  } catch (err) {
    logger.warn(
      `[RUN_AGENT] failed to resolve app user for ${spacesAppId}; falling back to creator:`,
      err,
    );
  }
  return fallbackUserId;
}

/**
 * Queue workers do not have a browser cookie. Resolve the workspace context
 * from Spaces itself and send it as optional metadata, preserving the legacy
 * raw userId field for older Claw deployments.
 */
async function resolveHeadlessIdentityContext(
  userId: string,
  workspaceId: string,
): Promise<{ spacesWorkspaceId: string; spacesOrgId: string; spacesOrgMemberId: string }> {
  const [workspace, user] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } }),
    db.user.findUnique({ where: { id: userId }, select: { orgMemberId: true } }),
  ]);
  if (!workspace?.orgId) {
    throw new Error(`[RUN_AGENT] workspace ${workspaceId} has no organization`);
  }
  if (!user?.orgMemberId) {
    throw new Error(`[RUN_AGENT] user ${userId} has no orgMemberId`);
  }
  return {
    spacesWorkspaceId: workspaceId,
    spacesOrgId: workspace.orgId,
    spacesOrgMemberId: user.orgMemberId,
  };
}


function deriveStepNameFromCtx(context: AutomationContext): string | null {
  const published = automationContextStorage.getStore()?.currentStepName;
  if (published) return published;
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
