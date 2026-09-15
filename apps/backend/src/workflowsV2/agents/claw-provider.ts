import { z } from 'zod';
import { BaseAgentProvider } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDescriptor,
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import type { Attachment, ResumePayload, StepExecutionContext } from '@xyne/workflow-sdk';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { runS2SClawAgent } from '@/services/clawAgentService';
import { parseAgentAttachments } from '@/automations/services/agent-attachment.service';
import { listDispatchableClawAgents, resolveClawRunIdentity } from './identity';
import type { XyneCtx, XyneResourceAttrs } from '../types';

/**
 * Runs a workflow step on an xyne-claw agent.
 *
 * Claw owns everything about the agent — its prompt, tools, MCP connections,
 * model, approvals and conversation history. A workflow step names one and
 * hands it a task; it does not configure it.
 *
 * **Dispatch-and-callback only**, over claw's service-to-service path — the
 * same transport automations runs agents on. The step parks and its worker slot
 * is released for the duration of the run, which can be many minutes. Claw's
 * streaming endpoint exists but has only ever been driven from a browser.
 *
 * Correlation is by node path plus attempt number. See {@link buildCallbackUrl}.
 */

export const ClawAgentConfigSchema = z.object({
  agentSlug: z.string().min(1)
    .describe('Slug of the claw agent to run, e.g. "support-triage"'),
});

export type ClawAgentConfig = z.infer<typeof ClawAgentConfigSchema>;

/** The envelope claw POSTs to the callback URL when a run finishes. */
interface ClawCallbackEnvelope {
  status?: unknown;
  result?: unknown;
  error?: unknown;
  attachments?: unknown;
}

export class ClawAgentProvider
  extends BaseAgentProvider<typeof ClawAgentConfigSchema, XyneCtx>
  implements AsyncAgentCapability<typeof ClawAgentConfigSchema>
{
  readonly name = 'Xyne Claw';
  readonly configSchema = ClawAgentConfigSchema;

  /**
   * Backs the agent picker. Not reachable from the builder yet — `agentSlug` is
   * a free-text field until the SDK grows an agents route and the UI honours
   * `format: 'agent-ref'`. Implemented now so that work is a route away.
   */
  override async listAgents(_ctx: XyneCtx): Promise<AgentDescriptor[]> {
    const agents = await listDispatchableClawAgents();
    return agents.map((agent) => ({
      id: agent.slug,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
    }));
  }

  async dispatch(
    stepConfig: ClawAgentConfig,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): Promise<{ externalRef: string }> {
    const { workspaceId } = ctx.runtime.attributes as XyneResourceAttrs;
    const identity = await resolveClawRunIdentity(stepConfig.agentSlug, workspaceId);

    // A distinct session per attempt keeps claw's own run history readable —
    // a repair re-run is visible as its own run rather than overwriting the
    // attempt it replaces. This is a label, not the correlation key.
    const attempt = input.repair?.attempt ?? 0;
    const sessionId = `wf:${ctx.runtime.executionId}:${ctx.runtime.stepName}`
      + (attempt > 0 ? `:retry-${String(attempt)}` : '');

    logger.info(
      `[workflows] dispatching claw agent — execution=${ctx.runtime.executionId} `
      + `node=${ctx.runtime.stepName} agent=${stepConfig.agentSlug} session=${sessionId}`,
    );

    const response = await runS2SClawAgent({
      sessionId,
      agentSlug: stepConfig.agentSlug,
      task: buildTask(input),
      workspaceId,
      userId: identity.userId,
      userName: identity.userName,
      userEmail: identity.userEmail,
      spacesWorkspaceId: identity.spacesWorkspaceId,
      spacesOrgId: identity.spacesOrgId,
      spacesOrgMemberId: identity.spacesOrgMemberId,
      callbackUrl: buildCallbackUrl(ctx.runtime.executionId, ctx.runtime.stepName, attempt),
    });

    if (!response.success) {
      throw new Error(
        `[workflows] claw rejected the run for agent "${stepConfig.agentSlug}": `
        + `${response.error ?? 'unknown error'}`,
      );
    }

    if (response.sessionId && response.sessionId !== sessionId) {
      logger.info(
        `[workflows] claw accepted session=${sessionId} as run ${response.sessionId}`,
      );
    }
    return { externalRef: sessionId };
  }

  async collect(
    payload: ResumePayload,
    record: AgentDispatchRecord,
    _stepConfig: ClawAgentConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentRunResult> {
    const envelope = isRecord(payload.data) ? (payload.data as ClawCallbackEnvelope) : null;
    if (!envelope) {
      throw new Error(
        `[workflows] claw callback for session ${record.externalRef} carried no envelope`,
      );
    }

    if (envelope.status && envelope.status !== 'completed') {
      const detail = envelope.error ?? `agent run ${String(envelope.status)}`;
      throw new Error(
        `[workflows] claw run ${record.externalRef} status=${String(envelope.status)}: ${String(detail)}`,
      );
    }

    // A non-string result is not a failure in itself — hand it over as JSON and
    // let the step's classifier and repair loop decide.
    const text = typeof envelope.result === 'string'
      ? envelope.result
      : JSON.stringify(envelope.result ?? '');

    return {
      text,
      // Claw runs its own tool loop and reports neither tool calls nor token
      // accounting in the callback envelope, so this reports none rather than
      // inventing numbers. Both are visible in claw's own run history.
      toolCalls: [],
      turnCount: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      attachments: await storeCallbackAttachments(envelope.attachments, ctx),
    };
  }
}

// ─── Correlation ───

/**
 * Read the dispatch record the step wrote when it parked.
 *
 * Exported for the callback route, which matches an arriving session against
 * `externalRef` to find the right gate. Keeping the shape here means the route
 * never has to know how a parked agent step lays out its step row.
 */
export function readAgentDispatch(data: string | null): AgentDispatchRecord | undefined {
  if (!data) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const agent = parsed['agent'];
  if (!isRecord(agent)) return undefined;
  const { provider, attempt, externalRef } = agent;
  if (typeof provider !== 'string' || typeof externalRef !== 'string') return undefined;
  return { provider, externalRef, attempt: typeof attempt === 'number' ? attempt : 0 };
}

/**
 * Where claw reports back.
 *
 * Two values, answering two different questions:
 *
 * - `nodePath` is *which gate*. It addresses the step record through its
 *   `(executionId, stepName)` unique key, so the route does one indexed read.
 * - `attempt` is *whether that gate is still on this run*. A repair re-dispatch
 *   re-parks the same step at the same node path, so the path alone cannot tell
 *   a current callback from a superseded one — the route compares this against
 *   the attempt stored when the step parked, and drops anything stale.
 *
 * Both ride in the query string. A node path is a structural address that can
 * contain `/`, `:` and `#`, which no router should have to disambiguate from
 * its own path segments. Claw passes the callback URL through verbatim
 * (`fetch(opts.callbackUrl, …)`), so the query string survives.
 */
function buildCallbackUrl(executionId: string, nodePath: string, attempt: number): string {
  const base = config.xyneClaw.callbackUrl.replace(/\/$/, '');
  return `${base}/api/internal/workflows-v2/claw-callback/${encodeURIComponent(executionId)}`
    + `?nodePath=${encodeURIComponent(nodePath)}&attempt=${String(attempt)}`;
}

// ─── Payload ───

/**
 * Claw agents are prompt-driven: this transport has no structured-output
 * parameter, so the output contract has to be stated in the task itself. Same
 * approach as automations' `buildRetryPrompt`.
 */
function buildTask(input: AgentRunInput): string {
  const parts = [input.task];

  if (input.expectJson) {
    parts.push(
      '',
      'Respond ONLY with a valid JSON object — no markdown, no commentary, no code fence.',
    );
    if (input.outputSchema) {
      parts.push('It must match this exact shape:', JSON.stringify(input.outputSchema, null, 2));
    }
  }

  if (input.repair) {
    parts.push(
      '',
      '---',
      '',
      'Your previous response could not be accepted. Reason: '
      + `${input.repair.reason}${input.repair.error ? ` — ${input.repair.error}` : ''}`,
    );
  }

  return parts.join('\n');
}

/**
 * Persist claw's artifacts and return storage references.
 *
 * Claw sends attachments as base64 in the callback body, but the SDK's
 * `Attachment.data` is an opaque *storage reference*. Storing the bytes here is
 * what lets `/attachments` serve them later — and keeps multi-megabyte blobs
 * out of the workflow context and the step row, which are read on every pass.
 */
async function storeCallbackAttachments(
  raw: unknown,
  ctx: StepExecutionContext,
): Promise<Attachment[]> {
  const files = parseAgentAttachments(raw);
  if (files.length === 0) return [];

  const storage = ctx.storage;
  if (!storage) {
    logger.warn(
      `[workflows] claw returned ${String(files.length)} attachment(s) but no storage adapter `
      + 'is configured; dropping them',
    );
    return [];
  }

  return Promise.all(
    files.map((file) =>
      storage.store(ctx.runtime.attributes, {
        name: file.fileName,
        mimeType: file.mimeType,
        // Strip any `data:<mime>;base64,` prefix and whitespace first, or
        // Buffer.from silently truncates at the first invalid character.
        bytes: new Uint8Array(
          Buffer.from(
            file.data.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, ''),
            'base64',
          ),
        ),
      }),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
