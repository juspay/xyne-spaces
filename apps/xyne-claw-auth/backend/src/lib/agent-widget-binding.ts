/**
 * Durable agent-widget → thread binding (backed by the AgentWidgetBinding table).
 *
 * The live card render path (doRenderPrCard / doRenderPlanCard) keeps its state
 * on the Redis SessionContext (fast, 24h TTL, deleted on run completion). This
 * table COMPLEMENTS that: it is the durable index an INBOUND event that fires
 * long after the run ended (e.g. a Bitbucket pr:merged webhook) uses to recover
 * the thread + agent identity and post a fresh status card.
 *
 * Generic across widget `kind`:
 *   - 'pr'   → externalKey = normalized PR URL; data = {provider,title,ticketId,url,desc,repo,number}
 *   - 'plan' → externalKey = `<conversationId>:<agentSlug>`; data = {todos,title,desc,document,ownerUserId}
 *
 * For 'plan' the table is more than an index: it is the durable REPLACEMENT for
 * the Redis plan state, so a proposed card stays approvable indefinitely (see
 * the Plan bindings section below).
 *
 * Everything here is BEST-EFFORT: a binding write/read must never break card
 * rendering, so callers wrap in try/catch.
 */
import { Prisma, type AgentWidgetBinding } from "@prisma/client";
import { prisma } from "../db.js";

export type WidgetKind = "pr" | "plan";

/**
 * Normalize a PR URL into a stable join key: lowercase, strip protocol, strip
 * query/fragment, strip trailing slashes. Both sides derive their URL from the
 * same Bitbucket Server self-link (the agent's create_pull_request response and
 * the webhook's links.self[0].href), so after this normalization they match —
 * this is the reliable join key (repo strings differ: the agent builds
 * "PROJECT/repo" while the webhook exposes project.key + repo.slug separately).
 */
export function normalizePrUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export interface WidgetBindingInput {
  orgId: string;
  kind: WidgetKind;
  screenId: string;
  externalKey?: string | null;
  conversationId: string;
  channelId: string;
  messageId?: string | null;
  spacesAppId: string;
  spacesAppUserId: string;
  agentSlug?: string | null;
  status?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Upsert a widget binding keyed on (kind, screenId) — same widget instance ⇒
 * one row, re-written idempotently on every render. Last-writer-wins, which is
 * correct: if the same PR's card is ever re-posted in a different thread, the
 * most recent thread is where a webhook update should land.
 */
export async function upsertWidgetBinding(input: WidgetBindingInput): Promise<void> {
  const jsonData: Prisma.InputJsonValue | typeof Prisma.JsonNull = input.data
    ? (input.data as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  const common = {
    orgId: input.orgId,
    externalKey: input.externalKey ?? null,
    conversationId: input.conversationId,
    channelId: input.channelId,
    messageId: input.messageId ?? null,
    spacesAppId: input.spacesAppId,
    spacesAppUserId: input.spacesAppUserId,
    agentSlug: input.agentSlug ?? null,
    status: input.status ?? null,
    data: jsonData,
  };
  await prisma.agentWidgetBinding.upsert({
    where: { kind_screenId: { kind: input.kind, screenId: input.screenId } },
    create: { kind: input.kind, screenId: input.screenId, ...common },
    update: common,
  });
}

/** Look up the most-recent binding for an inbound event correlate. An empty
 *  key is never a valid correlate (and bindings never store ""), so short-
 *  circuit to avoid a spurious match. */
export async function findWidgetBindingByExternalKey(
  kind: WidgetKind,
  externalKey: string,
): Promise<AgentWidgetBinding | null> {
  if (!externalKey) return null;
  return prisma.agentWidgetBinding.findFirst({
    where: { kind, externalKey },
    orderBy: { updatedAt: "desc" },
  });
}

/** PR convenience: find the binding for a PR URL (normalizes internally). */
export async function findPrBindingByUrl(prUrl: string): Promise<AgentWidgetBinding | null> {
  const key = normalizePrUrl(prUrl);
  if (!key) return null;
  return findWidgetBindingByExternalKey("pr", key);
}

/** Record the last rendered status (dedup for provider re-delivery) and,
 *  optionally, the latest posted messageId. */
export async function setWidgetBindingStatus(
  id: string,
  status: string,
  messageId?: string,
): Promise<void> {
  await prisma.agentWidgetBinding.update({
    where: { id },
    data: { status, ...(messageId ? { messageId } : {}) },
  });
}

/** The `data` blob a 'pr' binding stores so a webhook can rebuild the card. */
export interface PrBindingData {
  provider: string;
  title: string;
  url?: string;
  ticketId?: string;
  desc?: string;
  repo?: string;
  number?: string | number;
}

export function readPrBindingData(row: AgentWidgetBinding): PrBindingData | null {
  const d = row.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const provider = typeof d["provider"] === "string" ? (d["provider"] as string) : undefined;
  const title = typeof d["title"] === "string" ? (d["title"] as string) : undefined;
  if (!provider || !title) return null;
  const out: PrBindingData = { provider, title };
  if (typeof d["url"] === "string") out.url = d["url"] as string;
  if (typeof d["ticketId"] === "string") out.ticketId = d["ticketId"] as string;
  if (typeof d["desc"] === "string") out.desc = d["desc"] as string;
  if (typeof d["repo"] === "string") out.repo = d["repo"] as string;
  if (typeof d["number"] === "string" || typeof d["number"] === "number") {
    out.number = d["number"] as string | number;
  }
  return out;
}

// ── Plan bindings ────────────────────────────────────────────────────────────
// A proposed plan card is actionable indefinitely, but every piece of state the
// approve/reject handler needs used to live in Redis (SessionContext + the
// `plan-active-card:` pointer, both 24h TTL). Past that window — or after any
// Redis restart — the card was still on screen but every tap 409'd with "This
// plan is no longer active". These bindings are the durable mirror: they carry
// the executable todos, the card's routing, and the proposer, so approval works
// days later with no Redis state at all. Redis stays the fast path; this is the
// fallback and, for liveness (`status`), the authority.

/** Lifecycle of a proposed plan card. Only 'proposed' is actionable. */
export type PlanBindingStatus = "proposed" | "approved" | "rejected" | "superseded";

/** The `data` blob a 'plan' binding stores so an approval long after the run
 *  ended can rebuild the card and dispatch Turn 2 from the row alone. */
export interface PlanBindingData {
  todos: { id: string; title: string }[];
  title?: string;
  desc?: string;
  document?: string;
  /** The user the plan was proposed to — the ONLY one who may approve/reject. */
  ownerUserId: string;
}

/** One row per posted plan card. Keyed on the card's own messageId (unique per
 *  card), which is also what a flow-action arrives carrying. */
export function planScreenId(messageId: string): string {
  return `agent-plan-${messageId}`;
}

/** Conversation correlate for 'plan' rows — lets a re-plan find the outstanding
 *  proposal to supersede without the Redis pointer. Rides the existing
 *  (kind, externalKey) index. */
export function planExternalKey(conversationId: string, agentSlug: string): string {
  return `${conversationId}:${agentSlug}`;
}

export function readPlanBindingData(row: AgentWidgetBinding): PlanBindingData | null {
  const d = row.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const ownerUserId = typeof d["ownerUserId"] === "string" ? (d["ownerUserId"] as string) : "";
  const rawTodos = Array.isArray(d["todos"]) ? (d["todos"] as unknown[]) : [];
  const todos = rawTodos
    .filter(
      (t): t is { id: string; title: string } =>
        !!t &&
        typeof t === "object" &&
        typeof (t as { id?: unknown }).id === "string" &&
        typeof (t as { title?: unknown }).title === "string",
    )
    .map((t) => ({ id: t.id, title: t.title }));
  // A plan with no owner or no executable steps can't be approved — treat the
  // row as unusable rather than half-resolving it.
  if (!ownerUserId || todos.length === 0) return null;
  const out: PlanBindingData = { todos, ownerUserId };
  if (typeof d["title"] === "string") out.title = d["title"] as string;
  if (typeof d["desc"] === "string") out.desc = d["desc"] as string;
  if (typeof d["document"] === "string") out.document = d["document"] as string;
  return out;
}

/** Record a freshly posted proposed plan card. Best-effort like every binding
 *  write — a failure here costs durability, never the card itself. */
export async function upsertPlanBinding(input: {
  orgId: string;
  conversationId: string;
  channelId: string;
  messageId: string;
  spacesAppId: string;
  spacesAppUserId: string;
  agentSlug: string;
  data: PlanBindingData;
}): Promise<void> {
  await upsertWidgetBinding({
    orgId: input.orgId,
    kind: "plan",
    screenId: planScreenId(input.messageId),
    externalKey: planExternalKey(input.conversationId, input.agentSlug),
    conversationId: input.conversationId,
    channelId: input.channelId,
    messageId: input.messageId,
    spacesAppId: input.spacesAppId,
    spacesAppUserId: input.spacesAppUserId,
    agentSlug: input.agentSlug,
    status: "proposed" satisfies PlanBindingStatus,
    data: input.data as unknown as Record<string, unknown>,
  });
}

/** The binding for the exact card a flow-action targets. */
export async function findPlanBindingByMessageId(
  messageId: string,
): Promise<AgentWidgetBinding | null> {
  if (!messageId) return null;
  return prisma.agentWidgetBinding.findUnique({
    where: { kind_screenId: { kind: "plan", screenId: planScreenId(messageId) } },
  });
}

/** The still-actionable proposal in a thread, if any — used by the re-plan path
 *  to grey out the card it supersedes. */
export async function findProposedPlanBinding(
  conversationId: string,
  agentSlug: string,
): Promise<AgentWidgetBinding | null> {
  if (!conversationId || !agentSlug) return null;
  return prisma.agentWidgetBinding.findFirst({
    where: {
      kind: "plan",
      externalKey: planExternalKey(conversationId, agentSlug),
      status: "proposed" satisfies PlanBindingStatus,
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Durable single-use gate: flip 'proposed' → terminal, atomically. The WHERE
 * clause is the lock — Postgres serializes the two UPDATEs of a double-tap and
 * the loser matches 0 rows. This replaces the Redis `flow-action:plan:` NX key
 * for any card that has a binding, because that key expires while the card does
 * not: past its TTL a plan could otherwise be approved twice.
 */
export async function consumePlanBinding(
  screenId: string,
  next: PlanBindingStatus,
): Promise<boolean> {
  const { count } = await prisma.agentWidgetBinding.updateMany({
    where: { kind: "plan", screenId, status: "proposed" satisfies PlanBindingStatus },
    data: { status: next },
  });
  return count === 1;
}

/** Mark a proposal terminal without the single-use semantics (supersede). */
export async function markPlanBindingStatus(
  id: string,
  status: PlanBindingStatus,
): Promise<void> {
  await prisma.agentWidgetBinding.update({ where: { id }, data: { status } });
}
