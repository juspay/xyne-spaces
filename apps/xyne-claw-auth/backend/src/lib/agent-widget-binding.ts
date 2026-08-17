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
 *   - 'plan' → (future) externalKey null; data = plan-specific
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
