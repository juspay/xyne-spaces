/**
 * Digital Twin — Context Assembler.
 *
 * Turns raw Spaces activity into THREAD-COMPLETE, TIME-AWARE, CHANNEL-TYPED,
 * responded/ignored "conversation units" for the curator — replacing the
 * thread-blind flat-message stream (`fetchUserMessages`) that starves the
 * (already-capable) curator prompt.
 *
 * Why this exists: the curator's SYSTEM_PROMPT already asks for trigger→response
 * patterns, per-person tone, and ignore behaviour — but ingestion only ever gave
 * it the user's own outgoing messages with no thread, no incoming message, and no
 * "did they answer?" signal. This module reconstructs that context.
 *
 * Everything is fetched through the SAME ACL-checked Spaces HTTP surface the
 * canvas path already uses (`interact()` → POST /api/query/claw). MessagesACL
 * permits reading every message in a channel the user can see, so full threads
 * (co-participants included, as CONTEXT) are reachable with no Spaces change.
 * The one optional Spaces change is allow-listing `conversationParticipant` for
 * EXACT responded/ignored truth; until then we DERIVE it (a later user message
 * in the thread ⇒ responded). Both paths are handled.
 *
 * Privacy: co-participant lines are context to GROUND facts about the user; the
 * rendered unit is prefixed to tell the curator to extract facts about the user
 * only. Nothing co-participant is stored verbatim as the user's memory.
 *
 * Enabled by default. Set TWIN_CONTEXT_ASSEMBLER=0/false/off/no to use the
 * legacy flat `fetchUserMessages` path for rollback or comparison.
 */

import type { UserMemoryChannelType, UserMemoryRecord, UserMemoryThreadContext } from "xyne-claw-shared";
import { errMsg } from "../lib/errors.js";
import { interact } from "../mcp/servers/xyne-spaces-client.js";
import { resolveAuthForUser } from "./userMemoryFetcher.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { buildYqlFromParams } from "../mcp/servers/vespa-search-areas.js";
import { queryDirect } from "../mcp/servers/vespa-direct.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("twin-context-assembler", createTraceId());

// ─── Tunables (env-overridable) ─────────────────────────────────────────
// Coverage caps — sized so a per-MONTH backfill window processes ALL of the
// user's conversations, not a truncated subset. The backfill is windowed and
// reads from the Vespa replica (thread-fetch) + batched psql metadata, so wide
// caps here don't hammer the source-of-truth DB. More conversations simply
// produce MORE curator batches per window (token-budgeted packer), not bigger prompts.
/** Max of the user's own messages pulled per window (defines which threads we
 *  consider "touched", drives ownCount interesting-detection, AND feeds Q3
 *  async-reply hydration). Fetched from claw-auth's OWN direct-Vespa read replica
 *  (fetchOwnMessagesVespa) — the SAME source as the thread-fetch — paginated past
 *  Vespa's per-query hit ceiling, so it is NOT subject to the Spaces
 *  /api/query/claw `take≤1000` cap that used to 400 this fetch → ownMsgs=[] (no
 *  own-only lightweight units, Q3 hydration starved). Off the source-of-truth DB. */
// Not a target — a RUNAWAY GUARD. The Vespa fetch paginates until the user's
// messages run out (page < PAGE), so a real user gets ALL their messages in the
// window (Pradeesh: 56). This ceiling only stops an infinite loop on a
// pathological/bot account with tens of thousands of messages; 10k is far above
// any human month, so it never truncates real data.
const OWN_MSG_LIMIT = 10_000;
/** Vespa returns at most this many hits per query — paginate to reach OWN_MSG_LIMIT. */
const OWN_MSG_VESPA_PAGE = 400;
/** Spaces /api/query/claw hard `take` cap — used only by the no-workspace fallback. */
const SPACES_TAKE_MAX = 1000;
/** Fixed Asia/Kolkata offset — the Vespa date DSL interprets literals in IST
 *  (convertDateLiteralsToMs), so window bounds are formatted as IST wall-clock. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Max inbound-mention rows pulled per window. */
const MENTION_LIMIT = Number(process.env["TWIN_ASM_MENTION_LIMIT"] ?? 1000);
/** Cap on distinct conversations turned into units per window. High so no
 *  conversation is silently dropped; the cap-hit log below is pure observability. */
const MAX_CONVERSATIONS = Number(process.env["TWIN_ASM_MAX_CONVERSATIONS"] ?? 1000);
/** Cap on how many of those get a FULL thread fetch. */
const MAX_THREAD_FETCHES = Number(process.env["TWIN_ASM_MAX_THREADS"] ?? 1000);
/** Max messages FETCHED per thread from Vespa (the whole thread, so behaviour
 *  derivation + smart-select see everything). 400 = Vespa's per-query hit ceiling,
 *  so a thread given a query to itself can never be starved by a neighbour. */
const THREAD_FETCH_CAP = 400;
/** Above this many messages a thread is SMART-SELECTED for rendering (first N +
 *  last N + a ±window around each of the user's own turns) instead of rendered in
 *  full — so a huge thread never blows the prompt yet always keeps the user's
 *  turns + their local context + the head/tail. Full thread is still FETCHED
 *  (behaviour/hydration read all of it); only the rendered transcript is trimmed. */
const THREAD_RENDER_CAP = 80;
const THREAD_SELECT_HEAD = 20;
const THREAD_SELECT_TAIL = 20;
const THREAD_SELECT_USER_WINDOW = 5;
/** Vespa's per-query hit ceiling — a thread-fetch chunk packs up to this. */
const VESPA_MAX_HITS = 400;
/** Headroom per conversation so small `replyCount` drift doesn't force a refetch. */
const THREAD_SIZE_SLACK = 4;
/** Parallelism for per-thread fetches (keep gentle on Spaces). */
const THREAD_FETCH_CONCURRENCY = Number(process.env["TWIN_ASM_THREAD_CONCURRENCY"] ?? 6);

// Per-message render cap. A single, author-agnostic ceiling (was 400/200/260
// split across user/other/parent, which clipped real content and lost data).
// 3000 chars ≈ 750 tokens — generous enough that only pathological walls-of-text
// get trimmed; every normal message renders in full. The OVERALL prompt size is
// no longer bounded here (no per-unit RENDER_BUDGET/TEXT_CAP truncation) — it's
// bounded downstream by the token-budgeted batch packer (userMemoryBatcher.ts),
// which packs units into curator batches and sub-chunks the rare fat thread.
const MSG_CHAR_CAP = 3000;

// ── Q3: async cross-channel reply hydration ──────────────────────────────────
// When the user was mentioned but never replied IN-THREAD (outcome "ignored"),
// they may have actually engaged elsewhere — replied in another channel, or
// DM'd the asker. We attach the user's NEXT messages (across ALL channels/DMs)
// after the mention as CONTEXT so the curator can judge real engagement vs a
// true ignore and capture it as a triage memory. Purely context: does NOT change
// the derived outcome or the persisted behaviour signal — the rich behaviour is
// captured as memory (the deterministic signal stays coarse by design).
/** How far after the mention to look for the user's follow-up activity. */
const HYDRATION_WINDOW_MS = 24 * 3600 * 1000;
/** Max follow-up messages attached per ignored unit (soonest-after first). */
const HYDRATION_MAX_MSGS = 20;

const MENTION_ACTIONS = ["mentioned_user", "group_mention"];

// ─── Flag ────────────────────────────────────────────────────────────────
export function isContextAssemblerEnabled(): boolean {
  const value = process.env["TWIN_CONTEXT_ASSEMBLER"]?.trim().toLowerCase();
  return !value || !["0", "false", "off", "no"].includes(value);
}

// ─── Loose Spaces row shapes (flat scalar rows from /api/query/claw) ───────
interface MsgRow {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  msgType?: string;
  createdAt: string;
  isDeleted?: boolean;
}
interface ActivityRow {
  id: string;
  conversationId?: string | null;
  messageId?: string | null;
  actorId?: string | null;
  actorAction?: string | null;
  isRead?: boolean;
  createdAt: string;
}
interface ConvRow {
  conversationId: string;
  channelId?: string | null;
  createdBy?: string | null;
  initialMessageId?: string | null;
  parentMessageId?: string | null;
  replyCount?: number | null;
}
interface ChannelRow {
  id: string;
  name?: string | null;
  scopeType?: string | null;
  visibility?: string | null;
}
interface UserRow {
  id: string;
  name?: string | null;
  email?: string | null;
}

// ─── Small helpers ─────────────────────────────────────────────────────────
function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function toIso(d: Date): string {
  return d.toISOString();
}

function uniq<T>(xs: Iterable<T>): T[] {
  return Array.from(new Set(xs));
}

function epochOf(iso: string | undefined | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function humanDur(ms: number): string {
  const v = ms < 0 ? 0 : ms;
  const m = Math.round(v / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Bounded-concurrency map so a window with 60 threads doesn't fire 60 parallel
 *  HTTP calls at Spaces at once. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function channelTypeOf(scopeType?: string | null, visibility?: string | null): UserMemoryChannelType {
  const s = (scopeType ?? "").toUpperCase();
  if (s === "DM") return "dm";
  if (s === "GROUP_DM") return "group_dm";
  return (visibility ?? "").toUpperCase() === "PRIVATE" ? "private" : "public";
}

/**
 * A DM / group-DM has no human-authored channel name, so Spaces stores the
 * participant id list as the name — e.g. "cmsr…,cmsr…". Detect that shape so
 * the curator prompt can show people instead of opaque ids.
 *
 * Gated on channel TYPE as well as the pattern: a public channel legitimately
 * named like an id must keep its real name.
 */
const ID_LIST_RE = /^[A-Za-z0-9_-]{16,40}(?:,[A-Za-z0-9_-]{16,40})*$/;

function dmParticipantIds(
  channelName: string | undefined,
  channelType: UserMemoryChannelType,
): string[] {
  if (!channelName) return [];
  if (channelType !== "dm" && channelType !== "group_dm") return [];
  if (!ID_LIST_RE.test(channelName)) return [];
  return channelName.split(",");
}

/** Names listed in a DM label before it collapses to "+N more". */
const DM_NAME_CAP = 4;

/**
 * The channel label the curator sees. For DMs this turns the stored id list
 * into the other participants' display names ("#Mei Tanaka"); every other
 * channel keeps its real name untouched.
 *
 * Ids that didn't resolve are COUNTED but not named — rendering them via
 * `nameOf` would print "someone, someone", which reads as real people to the
 * LLM. If nothing resolves we return the raw name rather than inventing one.
 * Resolution is pure map lookup against the names already fetched for message
 * authors, so this costs no additional query.
 */
function channelLabel(
  rawName: string | undefined,
  channelType: UserMemoryChannelType,
  userId: string,
  nameById: Map<string, string>,
): string | undefined {
  const ids = dmParticipantIds(rawName, channelType);
  if (ids.length === 0) return rawName;
  const others = ids.filter((id) => id !== userId);
  const names = others.map((id) => nameById.get(id)).filter((n): n is string => !!n);
  if (names.length === 0) return rawName;
  const shown = names.slice(0, DM_NAME_CAP);
  const hidden = others.length - shown.length;
  return shown.join(", ") + (hidden > 0 ? ` +${hidden} more` : "");
}

/** Strip mention tokens / HTML to a plain readable line. */
function cleanContent(raw: string | undefined | null, nameOf: (id: string) => string): string {
  if (!raw) return "";
  let s = raw;
  s = s.replace(/<userid:([a-zA-Z0-9_-]+)>/g, (_m, id: string) => `@${nameOf(id)}`);
  s = s.replace(/<@([a-zA-Z0-9_-]+)>/g, (_m, id: string) => `@${nameOf(id)}`);
  s = s.replace(/<[^>]+>/g, " "); // strip HTML (incl. mention spans; inner @Name text is kept)
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// ─── Spaces fetch primitives (all ACL-checked via /api/query/claw) ─────────

/** Format a UTC instant as an IST wall-clock literal (`dd/mm/yy HH:MM:SS`) for
 *  the Vespa date DSL. convertDateLiteralsToMs re-anchors it to IST, so the
 *  round-trip reproduces the exact epoch ms. */
function istDateLiteral(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${String(t.getUTCFullYear()).slice(-2)} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** The user's own messages in a window, from claw-auth's direct-Vespa read
 *  replica (senderId → Vespa `userId`, createdDate range on `createdAtTimestamp`).
 *  Same replica + ACL/workspace injection as the thread-fetch (queryDirect adds
 *  `permissions contains <userId>` — always true for the user's own docs).
 *  Paginated in OWN_MSG_VESPA_PAGE-sized pages up to OWN_MSG_LIMIT, so it is not
 *  bound by the Spaces API's take≤1000 cap and never hits the source-of-truth DB.
 *  Best-effort: a failed page stops pagination and returns what we have. */
async function fetchOwnMessagesVespa(userId: string, workspaceId: string, window: { from: Date; to: Date }): Promise<MsgRow[]> {
  const built = buildYqlFromParams(
    {
      searchArea: "message",
      filters: {
        senderId: { contains: userId },
        createdDate: { gte: istDateLiteral(window.from), lte: istDateLiteral(window.to) },
      },
      sort: { by: "createdDate", dir: "asc" },
      hits: OWN_MSG_VESPA_PAGE,
    },
    userId,
    workspaceId,
  );
  const out: MsgRow[] = [];
  for (let offset = 0; offset < OWN_MSG_LIMIT; offset += OWN_MSG_VESPA_PAGE) {
    let rows: Array<Record<string, unknown>>;
    try {
      const resp = (await queryDirect(
        built.yql, built.query, userId, OWN_MSG_VESPA_PAGE, offset, CONFIG.vespaQueryEndpoint,
        built.rankProfile, undefined, workspaceId, true, // includeRawFields
      )) as unknown as { data?: { results?: Array<Record<string, unknown>> } };
      rows = resp?.data?.results ?? [];
    } catch (e) {
      logger.warn("[assembler] own-messages Vespa page failed", { userId, offset, err: String(e) });
      break;
    }
    for (const r of rows) {
      const row = vespaHitToMsgRow(r);
      if (row && !row.isDeleted) out.push(row);
    }
    if (rows.length < OWN_MSG_VESPA_PAGE) break;
  }
  return out;
}

/** No-workspace fallback: the original Spaces /api/query/claw path (capped at the
 *  API's take≤1000). Only used when workspaceId can't be resolved, so the Vespa
 *  replica isn't reachable. */
async function fetchOwnMessagesSpaces(auth: SpacesAuthContext, userId: string, window: { from: Date; to: Date }): Promise<MsgRow[]> {
  const data = await interact(
    {
      model: "message",
      operation: "findMany",
      where: {
        senderId: { equals: userId },
        createdAt: { gte: toIso(window.from), lte: toIso(window.to) },
      },
      orderBy: [{ createdAt: "asc" }],
      take: Math.min(SPACES_TAKE_MAX, OWN_MSG_LIMIT),
    },
    auth,
  );
  return asRows<MsgRow>(data).filter((m) => !m.isDeleted);
}

/**
 * Inbound mentions for a user in a window — the source of responded/ignored
 * behaviour. UNION of two rails, deduped by trigger messageId:
 *   1. `activities` (the Spaces notification feed) — pre-resolves every mention
 *      TYPE per recipient (user, group, @channel, @here) and carries isRead.
 *      Authoritative in prod; often sparse/empty for imported/historical data.
 *   2. `messages.content` — the ground truth. Mentions are HTML spans
 *      (`data-user-id="..."`, `data-group-id="..."`) inside the message body,
 *      so they exist for ALL historical data regardless of whether the
 *      notification feed was populated. This is what makes backfill actually
 *      capture "tagged but never replied".
 * Both rails run on every path (backfill + daily) since both call
 * assembleConversationUnits.
 */
async function fetchInboundMentions(
  auth: SpacesAuthContext,
  userId: string,
  window: { from: Date; to: Date },
): Promise<ActivityRow[]> {
  const [fromActivities, fromContent] = await Promise.all([
    fetchActivityMentions(auth, window).catch((e) => {
      logger.info("[assembler] activity-mentions fetch failed", { err: String(e) });
      return [] as ActivityRow[];
    }),
    fetchContentMentions(auth, userId, window).catch((e) => {
      logger.info("[assembler] content-mentions fetch failed", { err: String(e) });
      return [] as ActivityRow[];
    }),
  ]);
  // Dedupe by trigger messageId (fallback id). Iterate content first so an
  // activities row (richer: isRead) overwrites the content-derived one on a
  // collision.
  const byKey = new Map<string, ActivityRow>();
  for (const r of [...fromContent, ...fromActivities]) {
    const key = r.messageId ?? r.id;
    if (key) byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

/** Rail 1: the `activities` notification feed. ActivitiesACL auto-scopes to the
 *  requesting user, so this is exactly the mentions THIS user received. */
async function fetchActivityMentions(auth: SpacesAuthContext, window: { from: Date; to: Date }): Promise<ActivityRow[]> {
  const data = await interact(
    {
      model: "activity",
      operation: "findMany",
      where: {
        actorAction: { in: MENTION_ACTIONS },
        createdAt: { gte: toIso(window.from), lte: toIso(window.to) },
      },
      orderBy: [{ createdAt: "asc" }],
      take: MENTION_LIMIT,
    },
    auth,
  );
  return asRows<ActivityRow>(data).filter((a) => !!a.conversationId);
}

/** Rail 2: mentions parsed out of `messages.content`. Covers direct user
 *  mentions and named-group mentions the user belongs to. @channel/@here
 *  broadcasts are intentionally NOT included here (they target a whole channel,
 *  need membership resolution, and are the noisiest — a follow-up). */
async function fetchContentMentions(
  auth: SpacesAuthContext,
  userId: string,
  window: { from: Date; to: Date },
): Promise<ActivityRow[]> {
  const groupIds = await fetchUserGroupIds(auth, userId);
  const targets: Array<{ token: string; action: string }> = [
    { token: `data-user-id="${userId}"`, action: "mentioned_user" },
    ...groupIds.map((g) => ({ token: `data-group-id="${g}"`, action: "group_mention" })),
  ];
  const perTarget = await mapPool(targets, 4, (t) =>
    queryMentionMessages(auth, t.token, userId, window)
      .then((rows) => rows.map((m) => contentMentionRow(m, t.action)))
      .catch((e) => {
        logger.info("[assembler] content-mention query failed", { token: t.token, err: String(e) });
        return [] as ActivityRow[];
      }),
  );
  return perTarget.flat();
}

/** Messages in the window whose content tags `token`, authored by someone else.
 *  ALL message types are kept (USER/BOT/SYSTEM) — "don't ignore anything": a
 *  bot/automation ping the user was tagged in is still a real inbound mention
 *  and part of their responded/ignored behaviour. Only deleted (retracted) and
 *  empty-content messages are skipped downstream. */
async function queryMentionMessages(
  auth: SpacesAuthContext,
  token: string,
  userId: string,
  window: { from: Date; to: Date },
): Promise<MsgRow[]> {
  const data = await interact(
    {
      model: "message",
      operation: "findMany",
      where: {
        content: { contains: token },
        senderId: { not: userId },
        createdAt: { gte: toIso(window.from), lte: toIso(window.to) },
      },
      orderBy: [{ createdAt: "asc" }],
      take: MENTION_LIMIT,
    },
    auth,
  );
  return asRows<MsgRow>(data).filter((m) => !!m.conversationId && !m.isDeleted);
}

function contentMentionRow(m: MsgRow, action: string): ActivityRow {
  return {
    id: m.messageId,
    conversationId: m.conversationId,
    messageId: m.messageId,
    actorId: m.senderId,
    actorAction: action,
    createdAt: m.createdAt,
  };
}

/** The user's named-group memberships (for `data-group-id` mentions). */
async function fetchUserGroupIds(auth: SpacesAuthContext, userId: string): Promise<string[]> {
  try {
    const data = await interact(
      { model: "userGroupMapping", operation: "findMany", where: { userId: { equals: userId } }, take: 100 },
      auth,
    );
    return uniq(asRows<{ userGroupId?: string }>(data).map((r) => r.userGroupId ?? "").filter(Boolean));
  } catch (e) {
    logger.info("[assembler] user-group fetch failed — skipping group mentions", { err: String(e) });
    return [];
  }
}

async function fetchConversations(auth: SpacesAuthContext, convIds: string[]): Promise<ConvRow[]> {
  if (convIds.length === 0) return [];
  const data = await interact(
    { model: "conversation", operation: "findMany", where: { conversationId: { in: convIds } }, take: convIds.length },
    auth,
  );
  return asRows<ConvRow>(data);
}

async function fetchChannels(auth: SpacesAuthContext, channelIds: string[]): Promise<ChannelRow[]> {
  if (channelIds.length === 0) return [];
  const data = await interact(
    { model: "channel", operation: "findMany", where: { id: { in: channelIds } }, take: channelIds.length },
    auth,
  );
  return asRows<ChannelRow>(data);
}

async function fetchUsers(auth: SpacesAuthContext, userIds: string[]): Promise<UserRow[]> {
  if (userIds.length === 0) return [];
  const data = await interact(
    { model: "user", operation: "findMany", where: { id: { in: userIds } }, take: userIds.length },
    auth,
  );
  return asRows<UserRow>(data);
}

async function fetchMessagesByIds(auth: SpacesAuthContext, ids: string[]): Promise<MsgRow[]> {
  if (ids.length === 0) return [];
  const data = await interact(
    { model: "message", operation: "findMany", where: { messageId: { in: ids } }, take: ids.length },
    auth,
  );
  return asRows<MsgRow>(data);
}

/** Batched thread-fetch against claw-auth's OWN direct-Vespa read replica —
 *  replaces the per-conversation psql N+1 that used to hit the app's
 *  source-of-truth Postgres ~60×/window. One query per chunk of conversations
 *  (`conversationId in [...]` → Vespa `threadId`), grouped in JS. queryDirect
 *  auto-injects `permissions contains <userId>` + workspace guard, so per-doc
 *  ACL + tenant scoping match the old MessagesACL path exactly. Best-effort per
 *  chunk: a failed/empty chunk just yields no messages for those conversations
 *  (they render lightweight), never throws. Returns cid → messages (asc, capped).
 *  Vespa is eventually-consistent — fine here since backfill/daily read past
 *  windows, not the live edge. */
/**
 * Pack conversations into chunks that each fit one Vespa query.
 *
 * The limit is a HIT budget and the query sorts by recency across the whole
 * chunk, so an overflowing chunk starves its oldest conversation. `replyCount`
 * (already fetched) tells us each thread's size, so small threads can share a
 * query while a big one gets its own. Unknown size → charged the full cap, which
 * is the old one-per-query behaviour.
 */
export function packThreadChunks(convIds: string[], sizeOf: (cid: string) => number): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curHits = 0;
  for (const cid of convIds) {
    const size = Math.min(THREAD_FETCH_CAP, Math.max(1, sizeOf(cid)));
    if (cur.length > 0 && curHits + size > VESPA_MAX_HITS) {
      chunks.push(cur);
      cur = [];
      curHits = 0;
    }
    cur.push(cid);
    curHits += size;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

async function fetchThreadsBatch(
  userId: string,
  workspaceId: string,
  convIds: string[],
  /** Expected message count per conversation. */
  sizeOf: (cid: string) => number,
): Promise<Map<string, MsgRow[]>> {
  const byConv = new Map<string, MsgRow[]>();

  /** One Vespa read. False = the result filled the budget, so it may be trimmed. */
  const fetchChunk = async (chunk: string[], hits: number): Promise<boolean> => {
    const built = buildYqlFromParams(
      {
        searchArea: "message",
        filters: { conversationId: { in: chunk } },
        sort: { by: "createdDate", dir: "desc" },
        hits,
      },
      userId,
      workspaceId,
    );
    const resp = (await queryDirect(
      built.yql,
      built.query,
      userId,
      hits,
      0,
      CONFIG.vespaQueryEndpoint,
      built.rankProfile,
      undefined,
      workspaceId,
      true, // includeRawFields — we read the raw chat_message doc
    )) as unknown as { data?: { results?: Array<Record<string, unknown>> } };
    const results = resp?.data?.results ?? [];
    for (const r of results) {
      const row = vespaHitToMsgRow(r);
      if (!row || row.isDeleted) continue;
      const list = byConv.get(row.conversationId);
      if (list) list.push(row);
      else byConv.set(row.conversationId, [row]);
    }
    return results.length < hits;
  };

  const chunks = packThreadChunks(convIds, sizeOf);
  logger.info("[assembler] thread-fetch packed", {
    userId,
    conversations: convIds.length,
    queries: chunks.length,
  });

  await mapPool(chunks, THREAD_FETCH_CONCURRENCY, async (chunk) => {
    const hits = Math.min(
      VESPA_MAX_HITS,
      chunk.reduce((n, cid) => n + Math.min(THREAD_FETCH_CAP, Math.max(1, sizeOf(cid))), 0),
    );
    try {
      const complete = await fetchChunk(chunk, hits);
      // `replyCount` can lag reality. If the read came back full we can't tell
      // what was trimmed, so redo those conversations one at a time — where a
      // full cap each makes trimming impossible.
      if (!complete && chunk.length > 1) {
        logger.info("[assembler] thread-fetch chunk hit the hit budget — refetching singly", {
          userId,
          size: chunk.length,
        });
        for (const cid of chunk) byConv.delete(cid);
        await mapPool(chunk, THREAD_FETCH_CONCURRENCY, async (cid) => {
          try {
            await fetchChunk([cid], THREAD_FETCH_CAP);
          } catch (e) {
            logger.info("[assembler] vespa thread-refetch failed", { cid, err: String(e) });
          }
        });
      }
    } catch (e) {
      logger.info("[assembler] vespa thread-fetch chunk failed", { size: chunk.length, err: String(e) });
    }
  });

  // Ascending order + per-thread cap. Query returned newest-first, so on the rare
  // overflow keep the NEWEST THREAD_FETCH_CAP (slice from the end after asc sort) —
  // the mention + reply are almost always recent. With chunk=1 this never trims.
  for (const [cid, list] of byConv) {
    list.sort((a, b) => epochOf(a.createdAt) - epochOf(b.createdAt));
    if (list.length > THREAD_FETCH_CAP) byConv.set(cid, list.slice(-THREAD_FETCH_CAP));
  }
  return byConv;
}

/** Map a raw direct-Vespa chat_message hit (`rawFields`) to the flat MsgRow the
 *  assembler expects. Field aliases: docId→messageId, threadId→conversationId,
 *  userId→senderId, text→content, createdAtTimestamp(ms)→createdAt ISO. */
function vespaHitToMsgRow(r: Record<string, unknown>): MsgRow | null {
  const f = (r["rawFields"] ?? {}) as Record<string, unknown>;
  const messageId = f["docId"] != null ? String(f["docId"]) : "";
  const conversationId = f["threadId"] != null ? String(f["threadId"]) : "";
  if (!messageId || !conversationId) return null;
  const tsMs = Number(f["createdAtTimestamp"]);
  const createdAt =
    Number.isFinite(tsMs) && tsMs > 0
      ? new Date(tsMs).toISOString()
      : f["createdAt"] != null
        ? String(f["createdAt"])
        : "";
  const row: MsgRow = {
    messageId,
    conversationId,
    senderId: String(f["userId"] ?? f["senderId"] ?? ""),
    content: typeof f["text"] === "string" ? (f["text"] as string) : "",
    createdAt,
    // Vespa stores deletedAt=0 (not null) for live messages; only a positive
    // timestamp means actually deleted.
    isDeleted: Number(f["deletedAt"] ?? 0) > 0,
  };
  if (f["messageType"] != null) row.msgType = String(f["messageType"]);
  return row;
}

/**
 * EXACT responded/ignored truth via ConversationParticipant.lastReplyAt.
 * The model may not be allow-listed yet (Spaces Phase 6) — on any error we
 * return null and the caller DERIVES the signal instead. Never throws.
 */
// ─── Assembly ──────────────────────────────────────────────────────────────

/**
 * Assemble the user's window of Spaces activity into thread-complete
 * conversation units. Drop-in replacement for `fetchUserMessages` when the
 * TWIN_CONTEXT_ASSEMBLER flag is on. Returns `UserMemoryRecord[]` with
 * type="conversation"; each unit's `text` is a rendered transcript so the
 * existing curator prompt consumes it with no change, and `thread` carries the
 * structured version for Phase 2.
 */
export async function assembleConversationUnits(
  userId: string,
  window: { from: Date; to: Date },
): Promise<UserMemoryRecord[]> {
  const auth = await resolveAuthForUser(userId);
  if (!auth) {
    logger.warn("[assembler] no Spaces creds — returning []", { userId });
    return [];
  }

  // Workspace scope for the direct-Vespa reads (own-messages + thread-fetch).
  // Resolved up front so own-messages can go through Vespa; falls back to the
  // Spaces API only when it can't be resolved.
  const workspaceId = auth.workspaceId || (await getWorkspaceIdForUser(userId, "scheduled-job")) || "";

  // 1. What the user said + what came at them. Own-messages come from Vespa (the
  //    read replica) — mentions stay on the Spaces API (content-substring match).
  const [ownMsgs, mentions] = await Promise.all([
    (workspaceId
      ? fetchOwnMessagesVespa(userId, workspaceId, window)
      : fetchOwnMessagesSpaces(auth, userId, window)
    ).catch((e) => {
      logger.warn("[assembler] own-messages fetch failed", { userId, err: String(e) });
      return [] as MsgRow[];
    }),
    fetchInboundMentions(auth, userId, window).catch((e) => {
      logger.warn("[assembler] inbound-mentions fetch failed", { userId, err: String(e) });
      return [] as ActivityRow[];
    }),
  ]);

  // 2. Which conversations were touched (user spoke in, or was mentioned in).
  const mentionedConvs = new Set(mentions.map((m) => m.conversationId!).filter(Boolean));
  const ownCountByConv = new Map<string, number>();
  for (const m of ownMsgs) ownCountByConv.set(m.conversationId, (ownCountByConv.get(m.conversationId) ?? 0) + 1);

  // Mentioned convs FIRST: they carry the scarce, previously-missing behaviour
  // signal (responded/ignored) AND the ignore/respond memories. Ignored convs
  // are — by definition — ones the user never posted in, so they're absent from
  // ownCountByConv and would otherwise sit in the tail and be cut by the
  // MAX_CONVERSATIONS cap. Own-only convs (abundant general memories) fill the
  // remainder. Caps stay env-tunable for dense windows.
  const allConvIds = uniq<string>([...mentionedConvs, ...ownCountByConv.keys()]);
  const convIds = allConvIds.slice(0, MAX_CONVERSATIONS);
  if (allConvIds.length > convIds.length) {
    logger.info("[assembler] conversation cap hit — some dropped", {
      userId,
      total: allConvIds.length,
      kept: convIds.length,
    });
  }
  if (convIds.length === 0) return [];

  // 3. Conversation + channel metadata. (Responded/ignored is derived from
  //    message authorship below — NOT from ConversationParticipant, whose
  //    lastReplyAt is conversation-level and misreports "responded".)
  const convRows = await fetchConversations(auth, convIds).catch(() => [] as ConvRow[]);
  const convById = new Map(convRows.map((c) => [c.conversationId, c]));
  const channelIds = uniq(convRows.map((c) => c.channelId ?? "").filter(Boolean));
  const chanRows = await fetchChannels(auth, channelIds).catch(() => [] as ChannelRow[]);
  const chanById = new Map(chanRows.map((c) => [c.id, c]));

  // 4. Decide which conversations deserve a full thread fetch (the expensive
  //    part). "Interesting" = the user was mentioned, held a back-and-forth
  //    (≥2 own messages), or the thread has replies. Drive-by single posts get
  //    a lightweight unit from the user's own messages — no thread fetch.
  const isInteresting = (cid: string): boolean =>
    mentionedConvs.has(cid) || (ownCountByConv.get(cid) ?? 0) >= 2 || (convById.get(cid)?.replyCount ?? 0) > 1;

  const interestingIds = convIds.filter(isInteresting).slice(0, MAX_THREAD_FETCHES);
  const interestingSet = new Set(interestingIds);
  if (convIds.filter(isInteresting).length > interestingIds.length) {
    logger.info("[assembler] thread-fetch cap hit — some rendered lightweight", { userId });
  }

  // Thread bodies come from the direct-Vespa read replica (batched), NOT the
  // source-of-truth psql — see fetchThreadsBatch. workspaceId (resolved above)
  // gates the tenant scope; without it we skip thread-fetch (convs render
  // lightweight) rather than run unscoped.
  //    Expected size per conversation so the fetch can batch small threads.
  //    replyCount counts replies, so +1 for the root; unknown → full cap.
  const expectedThreadSize = (cid: string): number => {
    const replies = convById.get(cid)?.replyCount;
    return typeof replies === "number" && replies >= 0
      ? replies + 1 + THREAD_SIZE_SLACK
      : THREAD_FETCH_CAP;
  };

  const threadByConv = workspaceId
    ? await fetchThreadsBatch(userId, workspaceId, interestingIds, expectedThreadSize)
    : new Map<string, MsgRow[]>();
  if (!workspaceId) {
    logger.warn("[assembler] no workspaceId — skipping Vespa thread-fetch (lightweight units)", { userId });
  }

  // 5. Resolve display names for every author + actor + parent sender.
  const parentIds = uniq(
    convIds.map((cid) => convById.get(cid)?.parentMessageId ?? "").filter(Boolean),
  );
  const parentMsgs = await fetchMessagesByIds(auth, parentIds).catch(() => [] as MsgRow[]);
  const parentById = new Map(parentMsgs.map((m) => [m.messageId, m]));

  const senderIds = new Set<string>([userId]);
  for (const m of ownMsgs) senderIds.add(m.senderId);
  for (const list of threadByConv.values()) for (const m of list) senderIds.add(m.senderId);
  for (const a of mentions) if (a.actorId) senderIds.add(a.actorId);
  for (const m of parentMsgs) senderIds.add(m.senderId);
  // DM participants who never spoke in the window aren't message authors, so
  // fold them in here — this WIDENS the single fetchUsers call below rather
  // than adding a second one, and it's what lets channelLabel() name everyone
  // in the conversation instead of only the people with a line in it.
  for (const cid of convIds) {
    const c = convById.get(cid);
    const ch = c?.channelId ? chanById.get(c.channelId) : undefined;
    const ids = dmParticipantIds(ch?.name ?? undefined, channelTypeOf(ch?.scopeType, ch?.visibility));
    for (const id of ids) senderIds.add(id);
  }
  const userRows = await fetchUsers(auth, Array.from(senderIds)).catch(() => [] as UserRow[]);
  const nameById = new Map(userRows.map((u) => [u.id, u.name || u.email || u.id]));
  const nameOf = (id: string): string => (id === userId ? "you" : nameById.get(id) ?? "someone");

  // 6. Build a unit per conversation.
  const units: UserMemoryRecord[] = [];
  // Durable behavioural signals — persisted independently of the curator so a
  // failed distill never loses the responded/ignored signal (gap-1 fix).
  const signalRows: BehaviorSignalRow[] = [];
  for (const cid of convIds) {
    const conv = convById.get(cid);
    const chan = conv?.channelId ? chanById.get(conv.channelId) : undefined;
    const channelType = channelTypeOf(chan?.scopeType, chan?.visibility);
    const channelName = channelLabel(chan?.name ?? undefined, channelType, userId, nameById);

    // Thread messages: fetched for interesting convs; else the user's own
    // messages in this conv (lightweight).
    const rawThread = interestingSet.has(cid)
      ? threadByConv.get(cid) ?? []
      : ownMsgs.filter((m) => m.conversationId === cid);
    if (rawThread.length === 0) continue;

    const messages = rawThread
      .map((m) => ({
        author: nameOf(m.senderId),
        authorIsUser: m.senderId === userId,
        text: cleanContent(m.content, nameOf),
        tsEpoch: epochOf(m.createdAt),
      }))
      .filter((m) => m.text.length > 0);
    if (messages.length === 0) continue;

    // Parent (what the thread replies to).
    let parent: UserMemoryThreadContext["parent"] | undefined;
    const parentMsg = conv?.parentMessageId ? parentById.get(conv.parentMessageId) : undefined;
    if (parentMsg) {
      const ptext = cleanContent(parentMsg.content, nameOf);
      if (ptext) parent = { author: nameOf(parentMsg.senderId), text: ptext };
    }

    // Role.
    const wasMentioned = mentionedConvs.has(cid);
    const authored = conv?.createdBy === userId;
    const userRole: UserMemoryThreadContext["userRole"] = wasMentioned
      ? "mentioned"
      : authored
        ? "author"
        : "participant";

    // Behaviour (mentioned only): responded vs ignored.
    let behavior: UserMemoryThreadContext["behavior"] | undefined;
    // Q3 hydration lines (ignored mentions only) — see buildHydrationLines.
    let hydrationLines: string[] | undefined;
    if (wasMentioned) {
      const mention = mentions
        .filter((a) => a.conversationId === cid)
        .sort((a, b) => epochOf(a.createdAt) - epochOf(b.createdAt))[0];
      const mentionEpoch = mention ? epochOf(mention.createdAt) : 0;
      const triggerMsg = mention?.messageId
        ? rawThread.find((m) => m.messageId === mention.messageId)
        : undefined;
      const trigger = triggerMsg
        ? cleanContent(triggerMsg.content, nameOf)
        : messages.find((m) => !m.authorIsUser)?.text ?? "";

      // Responded vs ignored, from MESSAGE AUTHORSHIP — the ground truth.
      // Deliberately NOT ConversationParticipant.lastReplyAt: that field is
      // conversation-level (populated for every participant once the thread has
      // any activity — including just from being @-mentioned), so it reads
      // "responded" even when the user never posted a single message. "Responded"
      // = the user authored ANY message in this conversation (product decision:
      // engagement, not strictly a reply after the tag). Latency is measured to
      // the first user message at/after the tag, when one exists.
      const ownInThread = rawThread
        .filter((m) => m.senderId === userId)
        .sort((a, b) => epochOf(a.createdAt) - epochOf(b.createdAt));
      const replied = ownInThread.length > 0;
      const firstReplyAfter = ownInThread.find((m) => epochOf(m.createdAt) >= mentionEpoch);
      behavior = {
        trigger,
        outcome: replied ? "responded" : "ignored",
        source: "derived",
        ...(firstReplyAfter && mentionEpoch
          ? { latencyMs: Math.max(0, epochOf(firstReplyAfter.createdAt) - mentionEpoch) }
          : {}),
        ...(!replied && mentionEpoch ? { ignoredForMs: Math.max(0, window.to.getTime() - mentionEpoch) } : {}),
      };

      // Persist the durable signal (keyed on the trigger message → idempotent).
      if (mention?.messageId && behavior) {
        signalRows.push({
          userId,
          eventType: channelType === "dm" || channelType === "group_dm" ? "dm" : "mention",
          outcome: behavior.outcome,
          channelId: conv?.channelId ?? null,
          channelName: channelName ?? null,
          channelType,
          actorId: mention.actorId ?? null,
          // Response latency only (null for ignored — there's no response).
          // NOT ignoredForMs: that's a mention→window-end duration (up to
          // months in ms) that overflows the INT4 `latencyMs` column and would
          // silently drop every ignored signal. Clamp to INT4 max to also
          // survive the rare >24-day genuine reply.
          latencyMs: behavior.latencyMs != null ? Math.min(behavior.latencyMs, 2_147_483_647) : null,
          sourceMessageId: mention.messageId,
          triggerPreview: (behavior.trigger || "").slice(0, 240),
          occurredAt: new Date(mention.createdAt),
        });
      }

      // Q3: for an IGNORED mention, hydrate with the user's cross-channel
      // follow-up so the curator can see whether they actually engaged elsewhere.
      if (behavior.outcome === "ignored" && mentionEpoch) {
        hydrationLines = buildHydrationLines({
          ownMsgs,
          excludeConvId: cid,
          mentionEpoch,
          askerName: mention?.actorId ? nameOf(mention.actorId) : "someone",
          convById,
          chanById,
          nameOf,
        });
      }
    }

    const thread: UserMemoryThreadContext = {
      ...(parent ? { parent } : {}),
      messages,
      userRole,
      ...(behavior ? { behavior } : {}),
    };

    const latestEpoch = messages.reduce((mx, m) => Math.max(mx, m.tsEpoch), 0);
    const text = renderUnit({ channelName, channelType, thread, ...(hydrationLines ? { hydration: hydrationLines } : {}) });
    if (!text) continue;

    units.push({
      id: cid,
      type: "conversation",
      ts: latestEpoch ? new Date(latestEpoch).toISOString() : toIso(window.to),
      tsEpoch: latestEpoch || window.to.getTime(),
      ...(conv?.channelId ? { channelId: conv.channelId } : {}),
      ...(channelName ? { channelName } : {}),
      channelType,
      conversationId: cid,
      text,
      thread,
    });
  }

  // Persist behavioural signals (best-effort, independent of the curator).
  await persistBehaviorSignals(signalRows);

  logger.info("[assembler] assembled conversation units", {
    userId,
    window: `${toIso(window.from)}..${toIso(window.to)}`,
    ownMsgs: ownMsgs.length,
    mentions: mentions.length,
    conversations: convIds.length,
    threadsFetched: interestingIds.length,
    units: units.length,
    behaviorSignals: signalRows.length,
  });

  return units;
}

// ── Behavioural signals ────────────────────────────────────────────────────

interface BehaviorSignalRow {
  userId: string;
  eventType: string;
  outcome: "responded" | "ignored";
  channelId: string | null;
  channelName: string | null;
  channelType: UserMemoryChannelType;
  actorId: string | null;
  latencyMs: number | null;
  sourceMessageId: string;
  triggerPreview: string;
  occurredAt: Date;
}

/** Upsert behavioural signals keyed on (userId, sourceMessageId) so a re-backfill
 *  refreshes the outcome instead of duplicating. Best-effort — never throws. */
async function persistBehaviorSignals(rows: BehaviorSignalRow[]): Promise<void> {
  for (const r of rows) {
    try {
      // Feedback reconciliation: if the respond/ignore gate silenced the twin
      // for this mention (gateDecision="ignore") but the user actually responded,
      // that was a WRONG silence — flag it so future gate decisions learn from it.
      const existing = await prisma.twinBehaviorSignal.findUnique({
        where: { userId_sourceMessageId: { userId: r.userId, sourceMessageId: r.sourceMessageId } },
        select: { gateDecision: true },
      });
      const shouldHaveResponded = existing?.gateDecision === "ignore" && r.outcome === "responded";

      await prisma.twinBehaviorSignal.upsert({
        where: { userId_sourceMessageId: { userId: r.userId, sourceMessageId: r.sourceMessageId } },
        create: {
          userId: r.userId,
          eventType: r.eventType,
          outcome: r.outcome,
          channelId: r.channelId,
          channelName: r.channelName,
          channelType: r.channelType,
          actorId: r.actorId,
          latencyMs: r.latencyMs,
          sourceMessageId: r.sourceMessageId,
          triggerPreview: r.triggerPreview,
          occurredAt: r.occurredAt,
        },
        update: {
          outcome: r.outcome,
          latencyMs: r.latencyMs,
          channelType: r.channelType,
          triggerPreview: r.triggerPreview,
          shouldHaveResponded,
        },
      });
    } catch (err) {
      logger.warn("[assembler] persist behavior signal failed", {
        userId: r.userId,
        sourceMessageId: r.sourceMessageId,
        err: errMsg(err),
      });
    }
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────

/**
 * Q3: build the "what the user did NEXT" hydration block for an IGNORED mention.
 * Pulls the user's own messages (already fetched, ALL channels/DMs) posted after
 * the mention within HYDRATION_WINDOW_MS, soonest-after first (a real reply is
 * almost always soon after the ping), capped at HYDRATION_MAX_MSGS. Each line is
 * labelled with its channel TYPE + name and the delay from the mention, so the
 * curator can tell an actual cross-channel/DM reply from unrelated activity.
 * Messages in the mentioned conversation itself are excluded (an ignored unit —
 * by definition — has none from the user, but guard anyway). CONTEXT ONLY: these
 * do not change the derived outcome or the behaviour signal. Returns undefined
 * when there's nothing to attach.
 *
 * Boundary note: `ownMsgs` is fetched only within [window.from, window.to], so a
 * mention near window.to sees little forward activity. Accepted — those messages
 * are curated as their own units in the next window regardless.
 */
function buildHydrationLines(args: {
  ownMsgs: MsgRow[];
  excludeConvId: string;
  mentionEpoch: number;
  askerName: string;
  convById: Map<string, ConvRow>;
  chanById: Map<string, ChannelRow>;
  nameOf: (id: string) => string;
}): string[] | undefined {
  const { ownMsgs, excludeConvId, mentionEpoch, askerName, convById, chanById, nameOf } = args;
  const upper = mentionEpoch + HYDRATION_WINDOW_MS;
  const next = ownMsgs
    .filter((m) => {
      if (m.conversationId === excludeConvId || m.isDeleted) return false;
      const e = epochOf(m.createdAt);
      return e > mentionEpoch && e <= upper;
    })
    .sort((a, b) => epochOf(a.createdAt) - epochOf(b.createdAt))
    .slice(0, HYDRATION_MAX_MSGS);
  if (next.length === 0) return undefined;

  const lines: string[] = [
    `— What @you did NEXT, elsewhere (CONTEXT — the ping above was from @${askerName} and went unanswered IN-THREAD; ` +
      `these are the user's own later messages in OTHER channels/DMs, NOT part of the thread above. Use them only to judge ` +
      `whether the user actually engaged with @${askerName}'s ping elsewhere vs truly ignored it):`,
  ];
  for (const m of next) {
    const conv = convById.get(m.conversationId);
    const chan = conv?.channelId ? chanById.get(conv.channelId) : undefined;
    const type = channelTypeOf(chan?.scopeType, chan?.visibility);
    const name = chan?.name ? `#${chan.name}` : "(dm/unknown)";
    const txt = clip(cleanContent(m.content, nameOf), MSG_CHAR_CAP);
    if (!txt) continue;
    lines.push(`  [+${humanDur(epochOf(m.createdAt) - mentionEpoch)}] (${type} ${name}) "${txt}"`);
  }
  return lines.length > 1 ? lines : undefined;
}

/**
 * Turn a thread's turns into rendered lines. A thread with ≤ THREAD_RENDER_CAP
 * turns renders in full; a longer one is SMART-SELECTED — the first HEAD + last
 * TAIL turns plus a ±WINDOW around every one of the user's own turns, merged and
 * deduped (overlaps collapse), with gaps shown as "(… N turns omitted …)". The
 * full thread is still fetched + used for behaviour/hydration; only the rendered
 * transcript is trimmed, and only for genuinely huge threads.
 */
function renderThreadLines(messages: UserMemoryThreadContext["messages"]): string[] {
  const line = (m: UserMemoryThreadContext["messages"][number]): string => `  ─ @${m.author}: "${clip(m.text, MSG_CHAR_CAP)}"`;
  const n = messages.length;
  if (n <= THREAD_RENDER_CAP) return messages.map(line);

  const keep = new Set<number>();
  for (let i = 0; i < Math.min(THREAD_SELECT_HEAD, n); i++) keep.add(i);
  for (let i = Math.max(0, n - THREAD_SELECT_TAIL); i < n; i++) keep.add(i);
  for (let i = 0; i < n; i++) {
    if (messages[i]!.authorIsUser) {
      const lo = Math.max(0, i - THREAD_SELECT_USER_WINDOW);
      const hi = Math.min(n - 1, i + THREAD_SELECT_USER_WINDOW);
      for (let j = lo; j <= hi; j++) keep.add(j);
    }
  }
  const out: string[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev >= 0 && i > prev + 1) {
      const gap = i - prev - 1;
      out.push(`  (… ${gap} turn${gap === 1 ? "" : "s"} omitted …)`);
    }
    out.push(line(messages[i]!));
    prev = i;
  }
  return out;
}

/**
 * Render a conversation unit into a transcript block. No per-message size cap:
 * every rendered message shows in full up to MSG_CHAR_CAP (author-agnostic). Turn
 * COUNT is bounded by renderThreadLines (full thread ≤ THREAD_RENDER_CAP, else
 * head+tail+user-windows); the OVERALL prompt is bounded downstream by the
 * token-budgeted batch packer (userMemoryBatcher.ts), which sub-chunks the rare
 * oversized unit. An optional Q3 hydration block is appended for ignored units.
 */
function renderUnit(u: {
  channelName: string | undefined;
  channelType: UserMemoryChannelType;
  thread: UserMemoryThreadContext;
  hydration?: string[];
}): string {
  const { thread } = u;
  const chan = u.channelName ? `#${u.channelName}` : "(no channel)";
  const roleLabel = thread.userRole.toUpperCase();

  let behaviorLabel = "";
  if (thread.behavior) {
    if (thread.behavior.outcome === "responded") {
      behaviorLabel = thread.behavior.latencyMs != null ? `RESPONDED in ${humanDur(thread.behavior.latencyMs)}` : "RESPONDED";
    } else {
      behaviorLabel =
        thread.behavior.ignoredForMs != null ? `IGNORED (no reply in ${humanDur(thread.behavior.ignoredForMs)})` : "IGNORED";
    }
  }

  const header =
    `${chan} (${u.channelType}) · ${thread.messages.length} msgs · user ${roleLabel}` +
    (behaviorLabel ? ` · ${behaviorLabel}` : "");

  const lines: string[] = [
    "Conversation the user took part in — other people's lines are CONTEXT; extract facts about the user only.",
    header,
  ];
  if (thread.parent) {
    lines.push(`  parent  @${thread.parent.author}: "${clip(thread.parent.text, MSG_CHAR_CAP)}"`);
  }
  lines.push(...renderThreadLines(thread.messages));
  if (u.hydration && u.hydration.length > 0) {
    lines.push(...u.hydration);
  }

  return lines.join("\n");
}
