import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BaseAgentProvider } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDescriptor,
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import { withOptions } from '@xyne/workflow-sdk';
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
  // A picker in every editor: the step answers it from `listAgents` below.
  agentSlug: withOptions(z.string().min(1))
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

  /** Backs the agent picker on `agentSlug` (served through the step's `getOptions`). */
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

    // One session per turn and attempt. Claw-auth only accepts ids of
    // [A-Za-z0-9_-] (anything else is silently swapped for a random one), and it
    // de-duplicates dispatches by session id — so each turn and each repair must
    // have its own, while a genuinely repeated dispatch of the same one still
    // collapses. The node path is hashed: it holds `:`, `/` and `#`.
    const attempt = input.repair?.attempt ?? 0;
    const turn = input.conversation?.turn ?? 0;
    const sessionId = safeClawId(
      `wf-${ctx.runtime.executionId}-${shortHash(ctx.runtime.stepName)}-t${String(turn)}-r${String(attempt)}`,
    );
    // A step that waits for replies keeps one conversation across its turns;
    // claw resumes the agent's session by this id, so nothing is kept here.
    const conversationId = input.conversation
      ? safeClawId(`wf-${shortHash(`${workspaceId}|${stepConfig.agentSlug}|${input.conversation.id}`)}`)
      : undefined;

    logger.info(
      `[workflows] dispatching claw agent — execution=${ctx.runtime.executionId} `
      + `node=${ctx.runtime.stepName} agent=${stepConfig.agentSlug} session=${sessionId}`,
    );

    const response = await dispatchWithBusyRetry(Boolean(conversationId), () => runS2SClawAgent({
      sessionId,
      ...(conversationId ? { conversationId } : {}),
      agentSlug: stepConfig.agentSlug,
      task: buildTask(input),
      workspaceId,
      userId: identity.userId,
      userName: identity.userName,
      userEmail: identity.userEmail,
      spacesWorkspaceId: identity.spacesWorkspaceId,
      spacesOrgId: identity.spacesOrgId,
      spacesOrgMemberId: identity.spacesOrgMemberId,
      callbackUrl: buildCallbackUrl(ctx.runtime.executionId, ctx.runtime.stepName, attempt, input.conversation?.turn),
    }));

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
    stepConfig: ClawAgentConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentRunResult> {
    return collectClawResult(payload, record, stepConfig, ctx);
  }
}

/** Claw joins the agent's last text messages, so a mid-run note can precede the JSON. */
function jsonAtEnd(text: string): string | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    try {
      JSON.parse(text.slice(start));
      return text.slice(start);
    } catch {
      continue;
    }
  }
  return null;
}

export async function collectClawResult(
  payload: ResumePayload,
  record: AgentDispatchRecord,
  stepConfig: object,
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

  const raw = typeof envelope.result === 'string'
    ? envelope.result
    : JSON.stringify(envelope.result ?? '');
  // The SDK passes the whole step config, outputType included.
  const expectJson = 'outputType' in stepConfig && stepConfig.outputType === 'json';
  const text = expectJson ? (jsonAtEnd(raw) ?? raw) : raw;

  return {
    text,
    toolCalls: [],
    turnCount: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    attachments: await storeCallbackAttachments(envelope.attachments, ctx),
  };
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
  const { provider, attempt, externalRef, conversation } = agent;
  if (typeof provider !== 'string' || typeof externalRef !== 'string') return undefined;
  const turn = isRecord(conversation) && typeof conversation['turn'] === 'number' ? conversation['turn'] : undefined;
  const id = isRecord(conversation) && typeof conversation['id'] === 'string' ? conversation['id'] : undefined;
  return {
    provider,
    externalRef,
    attempt: typeof attempt === 'number' ? attempt : 0,
    ...(id !== undefined && turn !== undefined ? { conversation: { id, turn } } : {}),
  };
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
export function buildCallbackUrl(executionId: string, nodePath: string, attempt: number, turn?: number): string {
  const base = config.xyneClaw.callbackUrl.replace(/\/$/, '');
  return `${base}/api/internal/workflows-v2/claw-callback/${encodeURIComponent(executionId)}`
    + `?nodePath=${encodeURIComponent(nodePath)}&attempt=${String(attempt)}`
    + (turn !== undefined ? `&turn=${String(turn)}` : '');
}

function safeClawId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** How long to keep retrying while claw-auth still holds the conversation's previous turn. */
const BUSY_RETRY_MS = 35_000;
const BUSY_RETRY_EVERY_MS = 3_000;

/**
 * Claw-auth keeps a short per-conversation guard after each dispatch (up to
 * 30 s) and answers 409 while it holds. A person replying quickly can land in
 * it; waiting it out is the whole fix, so only a conversation's dispatch
 * retries, and only on that answer.
 */
async function dispatchWithBusyRetry<T>(inConversation: boolean, send: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + BUSY_RETRY_MS;
  for (;;) {
    try {
      return await send();
    } catch (err) {
      const busy = inConversation && err instanceof Error && /HTTP 409/.test(err.message);
      if (!busy || Date.now() + BUSY_RETRY_EVERY_MS > deadline) throw err;
      logger.info(`[workflows] claw conversation still busy with its previous turn — retrying in ${String(BUSY_RETRY_EVERY_MS)}ms`);
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_EVERY_MS));
    }
  }
}

// ─── Payload ───

/**
 * Claw agents are prompt-driven: this transport has no structured-output
 * parameter, so the output contract has to be stated in the task itself. Same
 * approach as automations' `buildRetryPrompt`.
 */
export function buildTask(input: AgentRunInput): string {
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
