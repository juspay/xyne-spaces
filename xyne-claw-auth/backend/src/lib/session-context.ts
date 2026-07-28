/**
 * Redis-backed session context store — the platform's per-run state kernel.
 *
 * Every surface (Spaces, Slack, CLI, external API) persists a SessionContext
 * at dispatch time; the result/progress handlers resolve it back by sessionId,
 * recovery row, or the (conversationId, agentSlug) index. Extracted from
 * routes/webhook.ts (2026-07-22 refactor session 1, commit 1) — this state is
 * surface-agnostic and must not live inside any one surface's route file.
 */
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { getRecoveryContextForSession } from "../queue/run-recovery-worker.js";
import type { ExternalResultCallbackConfig } from "../surfaces/external-api/delivery.js";
import type { SlackDeliveryTarget } from "../surfaces/slack/delivery.js";


export interface SessionContext {
  mentionedUserId: string;
  /**
   * The RUN OWNER — the userId the AgentRun + `user` ChatMessage are persisted
   * under (run.ts uses the dispatch `userId`). For a twin USER_MENTIONED run
   * this is the MENTIONED user, NOT the sender. The assistant ChatMessage
   * written in /result MUST be tagged with this, or the owner can't see their
   * own twin reply (filtered out by the per-user read ACL) and the SENDER sees
   * it in their history. Optional: older/other conversation flows omit it and
   * fall back to the responseMode-derived owner (= sender for "conversation").
   */
  targetUserId?: string;
  senderId: string;
  senderName: string;
  channelId: string;
  channelName: string;
  conversationId: string;
  /** The message that triggered this run (the mention). The Twin's twin_deliver
   *  "react" action targets THIS message. */
  sourceMessageId?: string;
  task: string;
  /**
   * The ORIGINAL user request that kicked off this run/chain. For a first-touch
   * run this equals `task`; across chain hops `task` becomes the interpolated
   * hand-off prompt while `rootTask` stays the human's actual ask. The chain
   * judge is fed this (not the stale interpolated task) so it can reason about
   * whether the user's request is satisfied.
   */
  rootTask?: string;
  agentId?: string;
  agentOrgId?: string | null;
  agentSlug?: string | undefined;
  responseMode: "conversation" | "approval";
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  traceId?: string;
  provider?: string;
  /** Current chain depth — incremented each time a chain fires. Used with maxDepth. */
  chainDepth?: number;
  /** Entry-point agent for this chain run. Used to resolve channel-level workflow binding. */
  rootAgentSlug?: string;
  /** Resolved workflow ID for this chain run (if any). */
  workflowId?: string;
  /**
   * MessageId of the "⏳ Working on it…" placeholder we posted at webhook-arrival
   * time. Used ONLY when USE_EPHEMERAL_PROGRESS=false — we edit this message
   * in-place as tools run, and replace its content with the final agent
   * response in the result handler. Undefined under the ephemeral path.
   */
  progressMessageId?: string;
  /**
   * MessageId of the live plan/todo card (todo-write → kind:"plan" progress
   * event). Posted once, then updated in place on every subsequent todo-write.
   * Undefined until the first todo-write of the run.
   */
  planMessageId?: string;
  /**
   * Auto-draft forward URL. Present only when this run was triggered by the
   * Spaces email auto-draft (a synthetic APP_MENTIONED, not a real mention).
   * /webhook/result persists as usual, then forwards the result here (the
   * Spaces autodraft-callback) and skips the bot DM; the start placeholder is
   * skipped too. Absent for normal mentions.
   */
  resultForwardUrl?: string;
  /** External API caller result target. The optional secret is AES-GCM encrypted. */
  externalResultCallback?: ExternalResultCallbackConfig;
  /** Terminal result target for a run dispatched from a per-agent Slack app. */
  slackDelivery?: SlackDeliveryTarget;
  /**
   * When true, the result-forward branch resolves the agent's plain `@Name`
   * mentions into clickable/notifying Spaces mentions (name→userId via
   * user-search, then HTML-span expansion) BEFORE forwarding. Set by the Spaces
   * automation path (handleAutomationWebhook), where there is no human session —
   * resolution uses the agent's bot token (`appToken`). Left unset for the email
   * auto-draft forward, which must NOT inject mention spans into a draft body.
   */
  resolveMentions?: boolean;
  /**
   * Workspace ID of the mentioned user for Digital Twin (USER_MENTIONED)
   * flows. Captured at webhook-receive time via getSpacesAuthForUser and
   * threaded all the way to the Flow UI data context so flow-action.ts can
   * forward it to Spaces' /api/internal/postAsUser — which REQUIRES
   * workspaceId to mint a JWT for the user. Without this, the Twin's
   * response generates fine but can never post.
   */
  workspaceId?: string;
  /**
   * Conversation-scoped "the user opted in to the agent's premium provider"
   * flag. Set by:
   *   1. `/upgrade` slash-command in the user's task (immediate auto-escalate)
   *   2. User clicking "Yes" on the FlowUI escalation prompt after a kimi
   *      failure or soft refusal (see flow-action.ts promote-provider branch)
   * When set, the resolution chain in handleWebhook uses this provider instead
   * of falling through to spaces/LiteLLM. Persists for the lifetime of the
   * conversation (Redis SESSION_TTL = 24h, keyed by convKey). Clearing it
   * requires the user to start a new conversation.
   */
  escalatedProvider?: string;
}

const SESSION_TTL = 86400;
const SESSION_PREFIX = "session:";
// Conversation-keyed index — see setSession comment.
const CONV_PREFIX = "session-by-conv:";
// Duplicate-DELIVERY suppression window (seconds), NOT a run-lifetime lock:
// absorbs webhook retries / double-fires of the same automation. Kept short
// deliberately — the key leaks on non-interposed and dispatch-failure paths
// (only the interposed /result path deletes it), so a long TTL would 409
// legitimate runs for its whole duration. One-active-run enforcement is the
// busy slot (tryAcquireSlot) + runtime session lock, not this key.
export const AUTOMATION_RUN_DEDUP_TTL = Number(process.env["AUTOMATION_RUN_DEDUP_TTL_SEC"] ?? 30);

export function convKey(conversationId: string, agentSlug: string, userScopeId?: string): string {
  const base = `${CONV_PREFIX}${conversationId}:${agentSlug}`;
  // Digital-twin runs are PER-USER: one claw session per mentioned user in a
  // thread (see buildSandboxStoreKey). So the conv index must be user-scoped
  // too — otherwise two twins mentioned in ONE thread clobber each other's row
  // and the /result conv-index fallback resolves the wrong user. Only the twin
  // passes userScopeId; every conversation-mode caller keeps the legacy 2-part
  // key (backward compatible, unchanged).
  return agentSlug === "digital-twin" && userScopeId ? `${base}:${userScopeId}` : base;
}

export function automationRunDedupKey(conversationId: string, agentSlug: string): string {
  return `automation-run-dedup:${conversationId}:${agentSlug}`;
}

/**
 * Persist the session context under TWO Redis keys:
 *   1. `session:<sessionId>` — the original per-run key. Hot path; expires
 *      naturally with the run.
 *   2. `session-by-conv:<conversationId>:<agentSlug>` — durable index that
 *      survives sessionId churn across /goal turns, chain hops, run-recovery
 *      refires, and scheduled-job re-triggers. Catches the case where a
 *      refire path (e.g. goalRelooper's `void fetch(...)`) doesn't register
 *      the freshly-minted sessionId back to claw-auth, leaving Turn 2's
 *      result orphaned. With this index the /result handler can fall back
 *      to (conv, slug) lookup using the conversationId + agentSlug that
 *      claw already sends in its callback payload.
 *
 * If the context lacks conversationId or agentSlug we only write the per-
 * session key — those identifiers are required to make the conv index
 * usable, and the original behaviour is the safe default.
 */
export async function setSession(
  sessionId: string,
  ctx: SessionContext,
  options: { skipConversationIndex?: boolean } = {},
): Promise<void> {
  const redis = redisService.getConnection();
  const json = JSON.stringify(ctx);
  await redis.set(`${SESSION_PREFIX}${sessionId}`, json, "EX", SESSION_TTL);
  if (!options.skipConversationIndex && ctx.conversationId && ctx.agentSlug) {
    await redis.set(convKey(ctx.conversationId, ctx.agentSlug, ctx.mentionedUserId), json, "EX", SESSION_TTL);
  }
}

export async function getSession(sessionId: string): Promise<SessionContext | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionContext;
}

/**
 * Conversation-keyed context lookup. Returns the most recently saved context
 * for `(conversationId, agentSlug)` — exactly what /result needs when claw
 * minted a new sessionId via a refire path and claw-auth never registered it.
 * Exported so flow-action.ts can read+merge before flipping
 * `escalatedProvider` (promote-provider branch).
 */
export async function getSessionByConv(
  conversationId: string,
  agentSlug: string,
  userScopeId?: string,
): Promise<SessionContext | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(convKey(conversationId, agentSlug, userScopeId));
  if (!raw) return null;
  return JSON.parse(raw) as SessionContext;
}

/**
 * Single source of truth for "given a callback, find the context that started
 * the run." Tries, in order:
 *   1. the sessionId index            — the normal hot path
 *   2. the durable run-recovery row   — survives a claw-auth restart
 *   3. the (conversationId, agentSlug) index — survives a claw refire that
 *      minted a brand-new sessionId claw-auth never registered (goal turns,
 *      chain hops, run-recovery, scheduled re-triggers)
 * On a conv-index hit we backfill the sessionId index so subsequent callbacks
 * for the same run resolve via the fast path.
 */
export async function resolveSessionContext(
  sessionId: string,
  conversationId?: string | null,
  agentSlug?: string | null,
  userScopeId?: string | null,
): Promise<SessionContext | null> {
  let ctx = sessionId ? await getSession(sessionId) : null;
  if (!ctx && sessionId) ctx = await getRecoveryContextForSession(sessionId);
  if (!ctx && conversationId && agentSlug) {
    ctx = await getSessionByConv(conversationId, agentSlug, userScopeId ?? undefined);
    if (ctx && sessionId) await setSession(sessionId, ctx);
  }
  return ctx;
}

export async function ensureSessionContextOrg(ctx: SessionContext | null, sessionId?: string): Promise<SessionContext | null> {
  if (!ctx || ctx.agentOrgId) return ctx;
  const orgId = ctx.agentId
    ? (await prisma.agent.findUnique({ where: { id: ctx.agentId }, select: { orgId: true } }))?.orgId
    : (await prisma.user.findUnique({ where: { id: ctx.senderId }, select: { orgId: true } }))?.orgId;
  if (!orgId) return ctx;
  const next = { ...ctx, agentOrgId: orgId };
  if (sessionId) await setSession(sessionId, next);
  return next;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = redisService.getConnection();
  // Read the row before deleting so we can also drop the conv index.
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
  if (raw) {
    try {
      const ctx = JSON.parse(raw) as SessionContext;
      if (ctx.conversationId && ctx.agentSlug) {
        // Use the SAME per-user key setSession wrote, so completing user A's
        // twin run doesn't drop user B's conv index for the same thread.
        await redis.del(convKey(ctx.conversationId, ctx.agentSlug, ctx.mentionedUserId));
      }
    } catch { /* malformed — nothing to clean up */ }
  }
}

