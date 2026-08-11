/**
 * Ambient intent suggestions — the server half of on-device intent detection.
 *
 * The dashboard runs a local embedding classifier on every message sent in a
 * public channel. When a score clears the threshold it calls
 * POST /api/intent/suggest, which lands here. This module decides whether the
 * suggestion is worth an agent run, dispatches one, and — on the callback —
 * turns the agent's answer into a `call_start` FlowJSON card posted into the
 * thread.
 *
 * Design notes that matter:
 *
 *  - The client is NEVER trusted. It sends ids and a score; every gate
 *    (message exists, lives in that channel, channel is public) is re-checked
 *    here, and the message TEXT is read from our own DB rather than the wire.
 *  - The agent is the authority and may decline. A local false positive costs
 *    one agent run, not a wrong card — which is what lets the on-device model
 *    be cheap and approximate.
 *  - Dedupe is a COST control, not just correctness. Retries, multiple tabs and
 *    (later) multiple viewers of the same message must collapse to one run.
 *
 * See apps/dashboard/docs/ON_DEVICE_INTENT.md
 */
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { runAsServiceActor } from '@/database/tenant/context';
import { findOrCreateConversation } from '@/apps/core/conversationUtils';
import { listS2SClawAgents, runClawAgent } from '@/services/clawAgentService';
import { stripHtml } from '@/agents/xyne-ai/tools/helpers';
import { MessageType, validateFlowDefinition, formatValidationErrors } from '@xyne/shared';

/**
 * Reuses the existing, org-provisioned `ask-ai` agent rather than a bespoke one.
 * A dedicated `intent-start-call` agent would be a better fit (tighter tools,
 * cheaper) but Agent rows are per-org and nothing provisions them into new orgs
 * yet — see ON_DEVICE_INTENT.md §8. Swap this once that exists.
 */
const INTENT_AGENT_SLUG = 'ask-ai';

/** Dedupe window. Covers client retries and duplicate tabs for the same message. */
const DEDUPE_TTL_SECONDS = 10 * 60;

/** Supported ambient intents. The client's `intentId` is advisory; this is the allow-list. */
const SUPPORTED_INTENTS = new Set(['start-call']);

/**
 * The agent's contract. Anything that fails this is treated as a decline — a
 * malformed answer must never render a card.
 */
// Lengths here are a backstop only — sanitizeAgentStrings() truncates first, so these
// should never be what rejects a result. Structure is what this is for.
const agentResultSchema = z.union([
  z.object({ decline: z.literal(true), reason: z.string().optional() }),
  z.object({
    decline: z.literal(false),
    title: z.string().min(1).max(200),
    attendeeIds: z.array(z.string().min(1)).max(20),
    rationale: z.string().max(200).optional(),
  }),
]);

export type AgentIntentResult = z.infer<typeof agentResultSchema>;

export interface DispatchParams {
  messageId: string;
  intentId: string;
  score: number;
  user: { id: string; workspaceId: string; orgMemberId: string; name: string; email: string };
}

export type DispatchOutcome =
  | { dispatched: true; sessionId: string }
  | { dispatched: false; reason: string };

/**
 * Validate + dispatch. Returns a reason rather than throwing on the expected
 * rejections, so the route can answer 200 with an outcome — a client whose
 * suggestion is declined has done nothing wrong and must not see an error.
 */
export async function dispatchIntentSuggestion(params: DispatchParams): Promise<DispatchOutcome> {
  const { messageId, intentId, score, user } = params;

  if (!SUPPORTED_INTENTS.has(intentId)) {
    return { dispatched: false, reason: 'unsupported-intent' };
  }

  // Re-read the message and its channel from OUR db. The client sent only ids;
  // the text, the channel linkage and the visibility all come from here.
  const message = await db.message.findUnique({
    where: { messageId },
    select: {
      messageId: true,
      content: true,
      senderId: true,
      conversationId: true,
      conversation: {
        select: {
          conversationId: true,
          channelId: true,
          channel: { select: { id: true, visibility: true, workspaceId: true } },
        },
      },
    },
  });

  if (!message?.conversation?.channel) {
    return { dispatched: false, reason: 'message-not-found' };
  }

  const channel = message.conversation.channel;

  // Public channels only — the same gate the client applies, re-applied server
  // side because a client check is a UX affordance, not a security control.
  if (channel.visibility !== 'PUBLIC') {
    return { dispatched: false, reason: 'channel-not-public' };
  }

  // Only the author's own message can trigger a suggestion for them. Without
  // this, any user could spend agent budget on any message they can see.
  if (message.senderId !== user.id) {
    return { dispatched: false, reason: 'not-message-author' };
  }

  if (channel.workspaceId !== user.workspaceId) {
    return { dispatched: false, reason: 'workspace-mismatch' };
  }

  // Dedupe/rate gate. SETNX so concurrent callers collapse to exactly one run.
  const claimed = await claimDedupeKey(messageId);
  if (!claimed) {
    return { dispatched: false, reason: 'already-dispatched' };
  }

  const resultForwardUrl =
    `${config.backendUrl.replace(/\/$/, '')}/api/internal/intent/callback/` +
    `${encodeURIComponent(messageId)}/${encodeURIComponent(intentId)}`;

  // runClawAgent, NOT runS2SClawAgent. The latter POSTs to a bare
  // `/claw/api/v1/webhook`, but claw-auth only routes `/webhook/app/:spacesAppId`
  // and `/webhook/:agentSlug` — so it 404s. It has no callers; treat it as dead.
  // runClawAgent resolves the agent's installed app, signs with the app secret,
  // and derives the org identity itself via resolveHeadlessAppEventIdentity.
  let dispatched = false;
  try {
    const run = await runClawAgent({
      agentSlug: INTENT_AGENT_SLUG,
      // Messages are stored as HTML; the agent was being handed
      // `<p class="m-0 leading-6">…</p>` as the thing to reason about.
      task: buildTask({ intentId, text: stripHtml(message.content), channelId: channel.id }),
      userId: user.id,
      userName: user.name,
      conversationId: message.conversation.conversationId,
      channelId: channel.id,
      workspaceId: user.workspaceId,
      resultForwardUrl,
      spacesWorkspaceId: user.workspaceId,
    });
    dispatched = run.dispatched;
  } finally {
    // A dispatch that never happened must not hold the dedupe window — otherwise
    // one transient failure silently suppresses this message for 10 minutes and
    // the retry reports the misleading 'already-dispatched'.
    if (!dispatched) await releaseDedupeKey(messageId);
  }

  if (!dispatched) {
    // runClawAgent returns false (rather than throwing) when the agent has no
    // installed app in this workspace, or the app has no signing secret.
    return { dispatched: false, reason: 'agent-not-installed' };
  }

  logger.info('[intent] dispatched agent run', {
    messageId,
    intentId,
    score,
    agentSlug: INTENT_AGENT_SLUG,
  });

  return { dispatched: true, sessionId: '' };
}

/**
 * SETNX + TTL. Redis being down must not take the feature down, but it also must
 * not silently disable dedupe — failing OPEN here would let a retry storm each
 * spend an agent run, so this fails CLOSED.
 */
async function claimDedupeKey(messageId: string): Promise<boolean> {
  try {
    return await redisService.set(
      `intent:dispatched:${messageId}`,
      '1',
      DEDUPE_TTL_SECONDS,
      true,
    );
  } catch (err) {
    logger.warn('[intent] dedupe claim failed — refusing dispatch', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Undo a claim when the dispatch it was guarding did not happen. */
async function releaseDedupeKey(messageId: string): Promise<void> {
  try {
    await redisService.del(`intent:dispatched:${messageId}`);
  } catch {
    // Best effort — the key expires on its own; the cost is one suppressed retry.
  }
}

/**
 * The agent prompt. Deliberately narrow: it decides, it does not chat. The JSON
 * contract is restated in `agentResultSchema`, which is what actually enforces it.
 *
 * The "no replies yet" paragraph is load-bearing. This fires the instant a message
 * is posted, so the thread is ALWAYS empty at that moment. An earlier version said
 * "prefer participants active in this thread and channel" and the agent — correctly,
 * given what it was told — declined every time with "the thread contains only this
 * single message, 0 replies, no other participants to invite". Pointing it at the
 * channel instead of the thread is the difference between a feature that fires and
 * one that never does.
 */
function buildTask(input: { intentId: string; text: string; channelId: string }): string {
  return [
    `A user just posted this message in a public channel (id ${input.channelId}):`,
    '',
    `"""${input.text}"""`,
    '',
    'An on-device classifier thinks they may be trying to get on a call with people here.',
    'Decide whether an unprompted "start a call" suggestion would genuinely help.',
    '',
    'IMPORTANT — this runs the moment the message is posted, so it has no replies and',
    'no thread history yet. That is the NORMAL case and is NOT a reason to decline.',
    'Do not look for thread activity or wait for context to accumulate.',
    '',
    'Decline only on the CONTENT of the message: it is not actually asking to talk to',
    'people now. In particular DECLINE for on-call rotation talk, API/function "call"',
    'usage, the "good call" idiom, call-to-action phrasing, and references to past or',
    'already-scheduled calls.',
    '',
    'If it does warrant a suggestion, pick attendees from the CHANNEL, not the thread:',
    'use the Spaces tools to find members who have posted in this channel recently, and',
    'anyone named or @-mentioned in the message. Prefer 2-5 people. If you can only find',
    'the author, still propose with an empty attendee list rather than declining — the',
    'human picks who joins.',
    '',
    'Title the call from what the message is about, not from generic filler.',
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '  {"decline": true, "reason": "..."}',
    'or',
    '  {"decline": false, "title": "<short call title>", "attendeeIds": ["<spaces user id>"],',
    '   "rationale": "<max 8 words on why these people>"}',
  ].join('\n');
}

/**
 * Callback path: validate the agent's answer and, if it proposed something, post
 * the card as a reply in the same thread.
 */
export async function handleIntentAgentResult(input: {
  messageId: string;
  intentId: string;
  rawResult: string;
}): Promise<{ posted: boolean; reason?: string }> {
  const parsed = parseAgentResult(input.rawResult);
  if (!parsed) {
    logger.warn('[intent] agent result failed schema — treating as decline', {
      messageId: input.messageId,
      preview: input.rawResult.slice(0, 200),
    });
    return { posted: false, reason: 'invalid-result' };
  }

  if (parsed.decline) {
    logger.info('[intent] agent declined', { messageId: input.messageId, reason: parsed.reason });
    return { posted: false, reason: 'agent-declined' };
  }

  const message = await db.message.findUnique({
    where: { messageId: input.messageId },
    select: {
      conversationId: true,
      conversation: {
        select: {
          conversationId: true,
          channelId: true,
          channel: { select: { workspaceId: true } },
        },
      },
    },
  });
  if (!message?.conversation?.channel?.workspaceId) {
    return { posted: false, reason: 'message-not-found' };
  }

  const { conversation } = message;
  const workspaceId = conversation.channel.workspaceId;

  const botUserId = await resolveAgentUserId();
  if (!botUserId) {
    logger.error('[intent] no spacesAppUserId for the intent agent — cannot post card', {
      agentSlug: INTENT_AGENT_SLUG,
    });
    return { posted: false, reason: 'agent-user-unresolved' };
  }

  const content = buildCardContent({
    title: parsed.title,
    attendees: parsed.attendeeIds,
    rationale: parsed.rationale,
  });
  if (!content) return { posted: false, reason: 'flow-validation-failed' };

  // Callbacks arrive with no HTTP tenant scope, so the message write has to be
  // wrapped or workspaceId never gets stamped (mirrors autodraftCallback.handler).
  await runAsServiceActor('intent-suggestion', workspaceId, () =>
    findOrCreateConversation(
      conversation.channelId,
      botUserId,
      content,
      false,
      // Reply INTO the existing thread rather than starting a new one — the
      // suggestion belongs next to the message that prompted it.
      conversation.conversationId,
      undefined,
      MessageType.BOT,
    ),
  );

  logger.info('[intent] posted call_start card', {
    messageId: input.messageId,
    conversationId: conversation.conversationId,
    attendees: parsed.attendeeIds.length,
  });

  return { posted: true };
}

/** Citation tokens the `spaces-citations` skill injects, e.g. `[clf-…spaces-users:1#1]`. */
const CITATION_TOKEN = /\s*\[clf-[^\]]*\]/g;

/**
 * Repair cosmetic damage BEFORE validation.
 *
 * Be strict about structure, lenient about prose. A real run returned two correctly
 * identified attendees and a good title, and the whole thing was discarded because
 * `rationale` came back 147 chars against a 120 cap — the overflow being 72 chars of
 * injected citation tokens. A decorative field must never be able to kill a card,
 * least of all one we do not render.
 */
function sanitizeAgentStrings(candidate: unknown): unknown {
  if (typeof candidate !== 'object' || candidate === null) return candidate;
  const obj = { ...(candidate as Record<string, unknown>) };

  for (const key of ['title', 'rationale', 'reason'] as const) {
    const value = obj[key];
    if (typeof value !== 'string') continue;
    // Citation tokens are meaningless on a card and are pure length.
    obj[key] = value.replace(CITATION_TOKEN, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  return obj;
}

/**
 * Agents wrap JSON in prose and code fences no matter how firmly you ask them not
 * to, so pull the first balanced object out before validating.
 */
function parseAgentResult(raw: string): AgentIntentResult | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const candidate: unknown = JSON.parse(trimmed.slice(start, end + 1));
    const result = agentResultSchema.safeParse(sanitizeAgentStrings(candidate));
    if (!result.success) {
      logger.warn('[intent] agent result failed schema after sanitising', {
        issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.code}`).join(', '),
      });
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/** The Spaces user the agent posts as. */
async function resolveAgentUserId(): Promise<string | null> {
  try {
    const agents = await listS2SClawAgents();
    const agent = agents.find(a => a.slug === INTENT_AGENT_SLUG);
    return agent?.spacesAppUserId ?? null;
  } catch (err) {
    logger.warn('[intent] could not list claw agents', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build the stored message content: a preamble line plus the `call_start` card,
 * validated against the shared FlowJSON schema before it is ever persisted.
 */
function buildCardContent(input: {
  title: string;
  attendees: string[];
  rationale?: string | undefined;
}): string | null {
  const flowJSON = {
    version: '2.0' as const,
    screenId: `agent-call-start-${crypto.randomUUID()}`,
    title: 'Start a call',
    components: [
      {
        id: 'preamble',
        type: 'text',
        props: {
          content: 'Looks like you were trying to get on a call. Here is a suggestion:',
        },
      },
      {
        id: 'call-start',
        type: 'call_start',
        props: {
          phase: 'proposed',
          title: input.title,
          attendees: input.attendees,
          ...(input.rationale ? { rationale: input.rationale } : {}),
        },
      },
    ],
    state: {
      values: {},
      touched: {},
      errors: {},
      submitting: false,
      submitted: false,
      history: [],
      loadingComponentIds: [],
    },
  };

  const result = validateFlowDefinition(flowJSON);
  if (!result.success) {
    logger.error('[intent] built an invalid FlowJSON card', {
      errors: formatValidationErrors(result),
    });
    return null;
  }

  const escaped = JSON.stringify(result.data).replace(/"/g, '&quot;');
  return `<div data-flow-json="${escaped}">Flow JSON</div>`;
}
