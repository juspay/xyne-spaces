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
  /**
   * Suppress the thread reply for this run entirely.
   *
   * Set for the /experiment CHECKER, whose output belongs in the ledger (and
   * therefore in `/experiment findings`), not in chat. Observed live: a checker
   * dispatched alongside epoch 29 finished after the user had asked an unrelated
   * question and its "Checked 1 finding: confirms=1" landed as the apparent
   * answer. A run whose result is data for the control plane must not speak in
   * the thread.
   */
  suppressThreadReply?: boolean;
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
   * True when this run is an /experiment or /understanding epoch (or its
   * checker). Experiment epochs run dozens of times back-to-back and their
   * output is a proof artifact, not a user turn — so they must NOT trigger the
   * channel's agent-chain workflow. Without this, every epoch hands off to the
   * next agent in the chain, which for euler-doctor meant euler-reviewer
   * refusing "I only handle PR reviews" once per epoch (40+ noise replies in a
   * single run).
   */
  isExperiment?: boolean;
  /**
   * MessageId of the "⏳ Working on it…" placeholder we posted at webhook-arrival
   * time. Used ONLY when USE_EPHEMERAL_PROGRESS=false — we edit this message
   * in-place as tools run, and replace its content with the final agent
   * response in the result handler. Undefined under the ephemeral path.
   */
  progressMessageId?: string;
  /**
   * MessageId of the live plan/todo card (todo-write → ui-widget progress
   * event). Posted once, then updated in place on every subsequent todo-write.
   * Undefined until the first todo-write of the run.
   */
  planMessageId?: string;
  /**
   * MessageIds of the PR cards this run posted, keyed by the deterministic PR
   * screenId (prScreenId → `agent-pr-<identity>`). A `*__create_pull_request` /
   * `*__merge_pull_request` subagent tool fires a kind:"pr" progress event; the
   * card is posted once per PR and then updated in place as its status advances
   * (created → merged / reverted / deleted / declined). One entry per distinct PR
   * touched in the run; undefined until the first PR op.
   */
  prMessageIds?: Record<string, string>;
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
  /** Surface that dispatched this run. Used by MCP tool filtering to apply
   *  surface-scoped default tools without mutating the stored agent config. */
  triggerSource?: "spaces" | "scheduled" | "chat" | "api" | "automation" | "slack" | "heartbeat" | "reflex";
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
   * True when this session was dispatched by the Spaces automation webhook
   * (app-user run, no human in the thread). This is the EXPLICIT gate the
   * MCP layer uses to serve Spaces tools in app mode (routes/mcp.ts injects
   * `xyne-spaces-app-tools` instead of the user `xyne-spaces` server).
   * Older in-flight sessions predate this flag; mcp.ts falls back to the
   * resolveMentions/externalResultCallback proxy for those.
   */
  isAutomation?: boolean;
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
   * Plan/auto mode gate (distinct from responseMode). 'plan' = the agent
   * proposed a plan and is awaiting approval; 'auto' = normal execution
   * (today's behavior). Absent ⇒ 'auto'. Set to 'plan' at dispatch when
   * agent.config.planMode is on AND the event is a non-twin thread mention;
   * flipped to 'auto' by the plan-approval flow-action for Turn 2.
   */
  mode?: 'plan' | 'auto';
  /**
   * The approved plan carried into Turn 2 (auto) after the user approves —
   * the subset of todos they kept. Read by the plan-approval dispatch to build
   * Turn 2's task, and lets claw emit a mode_switch debug event.
   */
  pendingPlan?: { todos: { id: string; title: string }[] };
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

export function convKey(conversationId: string, agentSlug: string, twinUserScopeId?: string): string {
  const base = `${CONV_PREFIX}${conversationId}:${agentSlug}`;
  // Digital-twin runs are PER-USER: one claw session per mentioned user in a
  // thread (see buildSandboxStoreKey). So the conv index must be user-scoped
  // too — otherwise two twins mentioned in ONE thread clobber each other's row
  // and the /result conv-index fallback resolves the wrong user. Only the twin
  // passes twinUserScopeId; every conversation-mode caller keeps the legacy 2-part
  // key (backward compatible, unchanged).
  return agentSlug === "digital-twin" && twinUserScopeId ? `${base}:${twinUserScopeId}` : base;
}

export function automationRunDedupKey(conversationId: string, agentSlug: string): string {
  return `automation-run-dedup:${conversationId}:${agentSlug}`;
}

// ── Active proposed-plan card (conversation-scoped) ─────────────────────────
// Tracks the LIVE, still-awaiting-approval plan card for a (conversation, agent)
// so a follow-up "revise the plan" turn can grey-out + disable the previous card
// before posting the new one. Deliberately NOT stored on SessionContext: each
// plan-mode turn mints a fresh sessionId and the conv-index is overwritten at
// dispatch, so the prior card's id would be lost. This dedicated key survives
// sessionId churn across re-plans. Cleared once the plan is approved / trivially
// auto-run (no proposal is left dangling).
const PLAN_CARD_PREFIX = "plan-active-card:";

export interface ActivePlanCard {
  messageId: string;
  todos: { id: string; title: string }[];
  title?: string;
  desc?: string;
  /** Detailed markdown plan — preserved so a superseded card keeps its document. */
  document?: string;
}

function planCardKey(conversationId: string, agentSlug: string): string {
  return `${PLAN_CARD_PREFIX}${conversationId}:${agentSlug}`;
}

export async function setActivePlanCard(
  conversationId: string,
  agentSlug: string,
  card: ActivePlanCard,
): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(planCardKey(conversationId, agentSlug), JSON.stringify(card), "EX", SESSION_TTL);
}

export async function getActivePlanCard(
  conversationId: string,
  agentSlug: string,
): Promise<ActivePlanCard | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(planCardKey(conversationId, agentSlug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActivePlanCard;
  } catch {
    return null;
  }
}

export async function clearActivePlanCard(conversationId: string, agentSlug: string): Promise<void> {
  const redis = redisService.getConnection();
  await redis.del(planCardKey(conversationId, agentSlug)).catch(() => {});
}

// ── Plan execution meta (conversation-scoped, deterministic) ────────────────
// The facts Turn 2's live plan-card render needs, written by the approve/trivial
// path BEFORE Turn 2 is dispatched, so they are already present when Turn 2's
// FIRST todo-write arrives (the Turn-2 SessionContext is only seeded AFTER
// dispatch, so reading these off the session would race the first render):
//   - autoApproved: the plan skipped the user gate (trivial) → "Auto-approved" chip.
//   - approvedTitles: normalized titles of the todos the user KEPT → a whitelist
//     so a re-added rejected todo can never render (the model may re-emit dropped
//     steps in todo-write; the flow-JSON approval is correct, this makes the live
//     render correct too, deterministically, on every todo-write).
// Keyed per (conversation, agent); reset on each new proposal; TTL-cleaned.
const PLAN_EXEC_META_PREFIX = "plan-exec-meta:";

export interface PlanExecMeta {
  autoApproved: boolean;
  approvedTitles: string[];
  /** Display name of the human who approved (absent when autoApproved). */
  approvedByName?: string;
  /** ISO timestamp of the approve/trivial decision — stamped ONCE before Turn 2
   *  dispatch and preserved across every live todo-write render (never re-stamped),
   *  so the audit footer shows a stable "· <time>". */
  approvedAt?: string;
  /** The approved plan's title/desc, so Turn 2's card render preserves them
   *  instead of falling back to the generic "Plan". */
  title?: string;
  desc?: string;
  /** The detailed markdown plan, so Turn 2's live renders keep the expanded-view
   *  document (authored once at propose time). */
  document?: string;
}

function planExecMetaKey(conversationId: string, agentSlug: string): string {
  return `${PLAN_EXEC_META_PREFIX}${conversationId}:${agentSlug}`;
}

/** Normalize a todo title for stable matching (approved-set whitelist). Turn 2's
 *  model regenerates todo ids, so titles — not ids — are the reliable key. */
export function normalizePlanTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Deterministic reject filter: keep ONLY the todos whose normalized title is in
 * the approved set, so a rejected/hallucinated todo the model re-adds can never
 * render. `approvedTitles` are already normalized. Returns the ORIGINAL list
 * unchanged when the approved set is empty (no plan approval) OR when nothing
 * matched (the model rephrased every title) — so the card never renders blank.
 */
export function filterToApprovedTitles<T extends { title: string }>(
  todos: T[],
  approvedTitles: string[],
): T[] {
  if (!approvedTitles.length) return todos;
  const allow = new Set(approvedTitles);
  const kept = todos.filter((t) => allow.has(normalizePlanTitle(t.title)));
  return kept.length > 0 ? kept : todos;
}

export async function setPlanExecMeta(
  conversationId: string,
  agentSlug: string,
  meta: PlanExecMeta,
): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(planExecMetaKey(conversationId, agentSlug), JSON.stringify(meta), "EX", SESSION_TTL);
}

export async function getPlanExecMeta(
  conversationId: string,
  agentSlug: string,
): Promise<PlanExecMeta | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(planExecMetaKey(conversationId, agentSlug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlanExecMeta;
  } catch {
    return null;
  }
}

export async function clearPlanExecMeta(conversationId: string, agentSlug: string): Promise<void> {
  const redis = redisService.getConnection();
  await redis.del(planExecMetaKey(conversationId, agentSlug)).catch(() => {});
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
 */
export async function getSessionByConv(
  conversationId: string,
  agentSlug: string,
  twinUserScopeId?: string,
): Promise<SessionContext | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(convKey(conversationId, agentSlug, twinUserScopeId));
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
  twinUserScopeId?: string | null,
): Promise<SessionContext | null> {
  let ctx = sessionId ? await getSession(sessionId) : null;
  if (!ctx && sessionId) ctx = await getRecoveryContextForSession(sessionId);
  if (!ctx && conversationId && agentSlug) {
    ctx = await getSessionByConv(conversationId, agentSlug, twinUserScopeId ?? undefined);
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


// ── Last rendered plan todos (conversation-scoped) ───────────────────────────
// The live plan card is fire-and-forget: every todo-write re-renders it and
// nothing keeps the list afterwards. A todo only leaves `in_progress` when the
// NEXT todo-write arrives, so a run that ends without one — the model forgot to
// close the step, or it crashed mid-step — leaves the card frozen mid-flight
// with a row spinning forever on a run that is definitively over.
//
// This snapshot is the only record of what the card currently shows, so it is
// what /webhook/result reconciles against at run end. Written on every render;
// cleared once reconciled.
const PLAN_LAST_TODOS_PREFIX = "plan-last-todos:";

/** Mirrors xyne-claw-shared's `Todo` structurally, without the dependency. */
export interface PlanTodoSnapshot {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

function planLastTodosKey(conversationId: string, agentSlug: string): string {
  return `${PLAN_LAST_TODOS_PREFIX}${conversationId}:${agentSlug}`;
}

export async function setPlanLastTodos(
  conversationId: string,
  agentSlug: string,
  todos: PlanTodoSnapshot[],
): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(planLastTodosKey(conversationId, agentSlug), JSON.stringify(todos), "EX", SESSION_TTL);
}

export async function getPlanLastTodos(
  conversationId: string,
  agentSlug: string,
): Promise<PlanTodoSnapshot[] | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(planLastTodosKey(conversationId, agentSlug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PlanTodoSnapshot[]) : null;
  } catch {
    return null;
  }
}

export async function clearPlanLastTodos(conversationId: string, agentSlug: string): Promise<void> {
  const redis = redisService.getConnection();
  await redis.del(planLastTodosKey(conversationId, agentSlug)).catch(() => {});
}
