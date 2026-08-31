/**
 * Fetch a user's Spaces records for the user-memory curator pipeline.
 *
 * Source: Spaces' Vespa-backed `/api/vespaSearch` endpoint. Replaced the
 * earlier `/api/query` Prisma-AST path because:
 *   - `/api/query`'s validator silently strips `include`, so nested relation
 *     filters (`conversation.channel.*`, `participants.some.*`) returned
 *     rows without the data needed to verify scope — every row was rejected
 *     by our post-fetch filter.
 *   - `/api/vespaSearch` indexes content + permissions per-document and
 *     filters results to docs the requesting user has access to natively.
 *
 * Schema reference (backend/src/vespa/src/types.ts + mapper.ts):
 *   - Permissions:
 *       * canvas:     CanvasParticipant.userId — owners/editors/viewers
 *       * call:       CallParticipant.userId, as `userIds` — everyone who was
 *                     invited or joined. This is the guard the call schema
 *                     actually queries, which is why discovery goes here.
 *   - Vespa enforces ACL via permissions on every search request; we never
 *     see docs the user doesn't have access to.
 *
 * CALLS do NOT go through the transcript subApp: a filter-only search never
 * returns chunk text (there is no `body` field, and `context` only holds the
 * chunk a query matched), so it can only ever yield the AI summary. Discover via
 * the `call` schema instead — participant-scoped, carries externalId +
 * hasTranscript — then download the real transcript per call.
 */

import type { UserMemoryRecord } from "xyne-claw-shared";
import { errMsg } from "../lib/errors.js";
import {
  interact,
  search,
  spacesFetchText,
  type SpacesAuthContext,
} from "../mcp/servers/xyne-spaces-client.js";
import { loadEffectiveCredentials } from "../lib/credentials-loader.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("user-memory-fetcher", createTraceId());

const MAX_RECORDS_PER_FETCH = 200;
const MAX_TEXT_CHARS = 1_500;
/** Calls get a much larger cap — a transcript IS the record, and 1_500 chars is
 *  ~90 seconds of talking. The batcher sub-chunks anything still too big. */
const MAX_CALL_TEXT_CHARS = 120_000;
/** One HTTP call per transcript — keep the fan-out bounded. */
const TRANSCRIPT_FETCH_CONCURRENCY = 4;

/** Machine-authored canvases. These grant participants OWNER/EDITOR, so a
 *  participant filter sweeps them in and the curator reads LLM prose as the
 *  user's own writing. */
const GENERATED_CANVAS_SOURCES = new Set([
  "call_detailed_summary",
  "call_prd",
  "commit_analysis",
  "workflow_knowledge",
  "release_report",
]);

/** Spaces/Vespa could not answer, as opposed to answering "nothing here". Keeps
 *  the backfill cursor from advancing past a window it never read. */
export class SpacesFetchError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SpacesFetchError";
  }
}

// ─── Vespa search response shape ────────────────────────────────────────

interface VespaSearchResult {
  id: string;
  type: "user" | "conversation" | "channel" | "ticket" | "attachment";
  title: string;
  subtitle: string;
  context?: string;
  body?: string;
  chunks?: string[];
  relevanceScore: number;
  avatar?: string;
  metadata?: {
    timestamp?: string;
    channelName?: string;
    [k: string]: unknown;
  };
  searchContext?: {
    channelId?: string;
    channelTitle?: string;
    conversationId?: string;
    messageId?: string;
    senderId?: string;
    senderName?: string;
    attachmentId?: string;
    fileName?: string;
    subApp?: string;
    [k: string]: unknown;
  };
}

interface VespaSearchResponse {
  success: boolean;
  data?: {
    grouped: boolean;
    groups?: Array<{ groupValue: string; count: number; results: VespaSearchResult[] }>;
    results?: VespaSearchResult[];
    totalCount?: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

export async function resolveAuthForUser(userId: string): Promise<SpacesAuthContext | null> {
  const eff = await loadEffectiveCredentials(userId, "xyne-spaces");
  if (!eff) {
    logger.warn("[user-memory-fetcher] no spaces creds for user", { userId });
    return null;
  }
  const c = eff.credentials as Record<string, unknown>;
  const token = typeof c["token"] === "string" ? (c["token"] as string) : "";
  const sessionId = typeof c["sessionId"] === "string" ? (c["sessionId"] as string) : "";
  const workspaceId = typeof c["workspaceId"] === "string" ? (c["workspaceId"] as string) : "";
  const baseUrl = typeof c["url"] === "string" ? (c["url"] as string) : "";
  if (!token) return null;
  return {
    token,
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

/** Flatten a vespaSearch response into a list of hits, handling both the
 *  flat `results[]` and the grouped `groups[].results[]` shapes. */
function flattenResults(resp: VespaSearchResponse): VespaSearchResult[] {
  if (!resp.data) return [];
  if (resp.data.grouped && resp.data.groups) {
    return resp.data.groups.flatMap((g) => g.results ?? []);
  }
  return resp.data.results ?? [];
}

/** vespaSearch's `after` / `before` accept ISO date strings or relative
 *  keywords. We always send ISO so the curator's window aligns precisely. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function vespaQuery(
  userId: string,
  params: Record<string, string>,
  /** Reuse an already-resolved context — credentials are decrypted per load. */
  knownAuth?: SpacesAuthContext,
): Promise<VespaSearchResult[]> {
  const auth = knownAuth ?? (await resolveAuthForUser(userId));
  if (!auth) return [];

  // filterOnly=true means "no semantic query, just filters" — exactly the
  // backfill / daily walk mode. Without this, vespaSearch's validator
  // demands a `q` param.
  const fullParams: Record<string, string> = {
    q: "",
    filterOnly: "true",
    ...params,
  };

  // A failed search is NOT an empty window. Swallowing errors here meant a query
  // that 400'd on every request read as "nothing to ingest", and the backfill
  // walked its cursor to the end having stored nothing. Throw instead: the daily
  // walk logs and moves on, the backfill holds its cursor and retries.
  try {
    const resp = (await search(fullParams, auth)) as VespaSearchResponse;
    if (!resp.success || !resp.data) {
      throw new SpacesFetchError(
        `vespaSearch returned unsuccessful for type=${params["type"] ?? "?"}`,
      );
    }
    return flattenResults(resp);
  } catch (err) {
    logger.error("[user-memory-fetcher] vespaSearch failed", {
      userId,
      params: fullParams,
      err: errMsg(err),
      name: err instanceof Error ? err.name : "unknown",
    });
    if (err instanceof SpacesFetchError) throw err;
    throw new SpacesFetchError(
      `vespaSearch failed for type=${params["type"] ?? "?"}: ${errMsg(err)}`,
      err,
    );
  }
}

// ─── Messages ───────────────────────────────────────────────────────────

export async function fetchUserMessages(
  userId: string,
  window: { from: Date; to: Date },
  limit = MAX_RECORDS_PER_FETCH,
): Promise<UserMemoryRecord[]> {
  // `after`/`before` name a whole DAY and exclude it: after → that day's
  // 23:59:59.999, before → its 00:00:00.000. A single-day window therefore asks
  // for `> 23:59 AND < 00:00`, which nothing satisfies. Widen by a day each side
  // and clamp to the exact instants below.
  const DAY = 24 * 3600 * 1000;
  const hits = await vespaQuery(userId, {
    type: "messages",
    from: userId,                      // senderId filter (vespaSearch maps this for messages)
    after: toIsoDate(new Date(window.from.getTime() - DAY)),
    before: toIsoDate(new Date(window.to.getTime() + DAY)),
    limit: String(limit),
  });

  return hits
    // Defense-in-depth: even though `from=userId` filters server-side and
    // Vespa's permissions[] gate-keeps access, double-check the senderId
    // matches in JS. Catches any future drift in the senderId mapping.
    .filter((h) => {
      const sender = h.searchContext?.senderId;
      return typeof sender !== "string" || sender === userId;
    })
    // Exact window. `metadata.timestamp` is a display string, so use the epoch.
    // A hit without one is kept — the day filter already bounded it.
    .filter((h) => {
      const ts = epochOrUndefined(h.searchContext?.["createdAtTimestamp"]);
      if (ts === undefined) return true;
      return ts >= window.from.getTime() && ts <= window.to.getTime();
    })
    .filter((h) => typeof h.context === "string" && h.context.trim().length > 0)
    .map((h): UserMemoryRecord => {
      const channelId = (h.searchContext?.channelId as string | undefined) ?? undefined;
      const channelName = (h.searchContext?.channelTitle as string | undefined)
        ?? (h.metadata?.channelName as string | undefined);
      return {
        id: h.id,
        type: "message",
        ts: (h.metadata?.timestamp as string | undefined) ?? "",
        ...(channelId ? { channelId } : {}),
        ...(channelName ? { channelName } : {}),
        text: (h.context ?? "").slice(0, MAX_TEXT_CHARS),
      };
    });
}

// ─── Files: split path ─────────────────────────────────────────────────
//
// Two Vespa-side bugs force a split:
//
//   1. /api/vespaSearch ignores the `subApp` filter — type=transcript and
//      type=canvas return the same mixed-subApp result set (confirmed
//      2026-05-22 with identical totalCount + sample IDs).
//   2. The Vespa permissions[] check for canvas docs is too broad — it
//      returns every PUBLIC canvas in the workspace regardless of whether
//      the user is in CanvasParticipant. For Anurag's workspace this
//      surfaced 14,968 canvases when he had only authored 10.
//
// Resolution:
//   - TRANSCRIPTS: continue via vespaSearch. The transcript permissions[]
//     check IS correctly populated from CallParticipant (mapper.ts:719-722),
//     so the result set narrows correctly. We share the same combined
//     query with canvas just to dedupe API calls, then partition.
//   - CANVASES: switch to /api/query directly. Canvas ACL on /api/query is
//     `null` (canvases-acl.ts) so we can apply our own where-clause with
//     `OR: [{ createdBy: userId }, { participants: { some: { userId, role
//     IN [OWNER, EDITOR] } } }]`. This guarantees we only ingest canvases
//     the user authored OR has edit access to — which is the user's
//     explicit V1 scope ("if i have edit access of canvas them also").
//
// When the Vespa-side bugs are fixed, both can revert to a single
// vespaSearch call.

interface SpacesCanvasRow {
  id: string;
  title?: string;
  createdBy: string;
  channelId?: string | null;
  content?: unknown;  // BlockNote JSON
  visibility?: string;
  updatedAt: string;
  /** `{ source, callId, … }` on machine-authored canvases, absent on human ones.
   *  Arrives with the row (no `select`), so classifying costs no extra query. */
  metadata?: unknown;
}

/** True for canvases a machine wrote (see GENERATED_CANVAS_SOURCES). */
function isGeneratedCanvas(row: SpacesCanvasRow): boolean {
  const meta = row.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const source = (meta as Record<string, unknown>)["source"];
  return typeof source === "string" && GENERATED_CANVAS_SOURCES.has(source);
}

/** Pull canvases the user authored OR has edit access to.
 *
 *  Two queries + JS dedupe because /api/query's AST validator (Spaces' Zod
 *  schema in validators.ts) doesn't accept arrays-of-objects under `OR` —
 *  Prisma's `OR: [{...}, {...}]` syntax gets rejected. Issuing the two
 *  branches separately and merging by id is the cheap workaround. Same
 *  result set, dedupe is O(N).
 *
 *  VIEWER role excluded — passive read access doesn't tell the curator
 *  anything about the user's work.
 */
async function queryUserCanvases(
  userId: string,
  window: { from: Date; to: Date },
  limit: number,
  auth: SpacesAuthContext,
): Promise<SpacesCanvasRow[]> {
  const winFilter = {
    updatedAt: { gte: window.from.toISOString(), lte: window.to.toISOString() },
  };

  let authored: SpacesCanvasRow[] = [];
  let edited: SpacesCanvasRow[] = [];

  try {
    authored = (await interact(
      {
        model: "canvas",
        operation: "findMany",
        where: { ...winFilter, createdBy: { equals: userId } },
        orderBy: [{ updatedAt: "desc" }],
        take: limit,
      },
      auth,
    )) as SpacesCanvasRow[];
  } catch (err) {
    logger.warn("[user-memory-fetcher] canvas authored fetch failed", { userId, err: errMsg(err) });
  }

  try {
    edited = (await interact(
      {
        model: "canvas",
        operation: "findMany",
        where: {
          ...winFilter,
          participants: { some: { userId: { equals: userId }, role: { in: ["OWNER", "EDITOR"] } } },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: limit,
      },
      auth,
    )) as SpacesCanvasRow[];
  } catch (err) {
    logger.warn("[user-memory-fetcher] canvas editor/owner fetch failed", { userId, err: errMsg(err) });
  }

  // Dedupe by id (creators are auto-OWNER so overlap is the norm).
  const seen = new Set<string>();
  const merged: SpacesCanvasRow[] = [];
  for (const r of [...authored, ...edited]) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
    if (merged.length >= limit) break;
  }
  return merged;
}

/** Walk BlockNote JSON content and collect text-node values. Falls back to
 *  a stringified slice if the structure doesn't match BlockNote. */
function extractCanvasText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj["text"] === "string") out.push(obj["text"] as string);
      if (Array.isArray(obj["content"])) visit(obj["content"]);
      if (Array.isArray(obj["children"])) visit(obj["children"]);
    }
  };
  visit(content);
  const text = out.join(" ").replace(/\s+/g, " ").trim();
  return text || JSON.stringify(content).slice(0, MAX_TEXT_CHARS);
}

/** The `call`-schema fields transformCall exposes that we actually use. */
interface CallHitContext {
  callId?: string;
  externalId?: string;
  channelId?: string;
  channelTitle?: string;
  hasTranscript?: boolean;
  startedAt?: number;
  startsAt?: number;
  callType?: string;
  participantNames?: string[];
}

/** Positive epoch-ms or undefined. The call schema stores 0 for "unset", and
 *  `new Date(0)` would date the record to 1970. */
function epochOrUndefined(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** One call's full transcript, via the same permission-checked route the web app
 *  uses. Returns "" rather than throwing — one unreadable call must not fail the
 *  whole window. */
async function fetchTranscriptText(
  externalId: string,
  auth: SpacesAuthContext,
  userId: string,
): Promise<string> {
  try {
    const text = await spacesFetchText(
      `/api/calls/claw/${encodeURIComponent(externalId)}/download-transcript`,
      auth,
    );
    return text.trim();
  } catch (err) {
    const msg = errMsg(err);
    // 403/404 are ordinary — not shared with this user, or not transcribed yet.
    const expected = msg.includes("403") || msg.includes("404");
    logger[expected ? "info" : "warn"]("[user-memory-fetcher] transcript unavailable", {
      userId,
      externalId,
      err: msg,
    });
    return "";
  }
}

/** Run `work` over `items` with a bounded number in flight. */
async function mapPool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Calls the user attended, with their transcripts. `type=calls` is guarded by
 *  `userIds contains <user>`, so this covers calls they merely joined — not just
 *  ones they hosted. */
export async function fetchUserCalls(
  userId: string,
  window: { from: Date; to: Date },
  limit = 100,
): Promise<UserMemoryRecord[]> {
  const auth = await resolveAuthForUser(userId);
  if (!auth) return [];

  const hits = await vespaQuery(userId, {
    type: "calls",
    withUser: userId,
    callStartsAt: String(window.from.getTime()),
    callEndsAt: String(window.to.getTime()),
    // Must be explicit: with no callType the query appends
    // `!(callType contains "HEADLESS")` and silently drops every recording.
    callType: "VIDEO,AUDIO,HEADLESS",
    limit: String(limit),
  }, auth);

  const seen = new Set<string>();
  const candidates: Array<{ id: string; externalId: string; ctx: CallHitContext; startedAt: number; title: string }> = [];

  for (const h of hits) {
    const ctx = (h.searchContext ?? {}) as CallHitContext;
    const id = ctx.callId || h.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // The server window is an overlap test, so a long call can land in two
    // adjacent windows and be curated twice. Bind it to the window its start
    // falls in, half-open so a boundary start belongs to exactly one.
    const startedAt = epochOrUndefined(ctx.startedAt) ?? epochOrUndefined(ctx.startsAt);
    if (startedAt === undefined) continue;
    if (startedAt < window.from.getTime() || startedAt >= window.to.getTime()) continue;

    // No transcript = nothing readable; title + attendees alone is not a memory.
    if (ctx.hasTranscript !== true || !ctx.externalId) continue;

    candidates.push({ id, externalId: ctx.externalId, ctx, startedAt, title: h.title || "Untitled Call" });
  }

  const texts = await mapPool(candidates, TRANSCRIPT_FETCH_CONCURRENCY, (c) =>
    fetchTranscriptText(c.externalId, auth, userId),
  );

  const records: UserMemoryRecord[] = [];
  candidates.forEach((c, i) => {
    const transcript = texts[i] ?? "";
    if (!transcript) return;

    // Header so the curator knows who was in the room — speaker labels alone
    // don't say that THIS user was there.
    const attendees = (c.ctx.participantNames ?? []).filter(Boolean);
    const header = [
      `Call: ${c.title}`,
      c.ctx.channelTitle ? `Channel: ${c.ctx.channelTitle}` : null,
      c.ctx.callType === "HEADLESS" ? "Type: recording (xyne-automation)" : null,
      attendees.length > 0 ? `Participants: ${attendees.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    records.push({
      id: c.id,
      type: "call",
      ts: new Date(c.startedAt).toISOString(),
      tsEpoch: c.startedAt,
      ...(c.ctx.channelId ? { channelId: c.ctx.channelId } : {}),
      ...(c.ctx.channelTitle ? { channelName: c.ctx.channelTitle } : {}),
      title: c.title,
      text: `${header}\n\nTranscript:\n${transcript}`.slice(0, MAX_CALL_TEXT_CHARS),
    });
  });

  return records;
}

export async function fetchUserCanvases(
  userId: string,
  window: { from: Date; to: Date },
  limit = 100,
): Promise<UserMemoryRecord[]> {
  const auth = await resolveAuthForUser(userId);
  if (!auth) return [];

  const rows = await queryUserCanvases(userId, window, limit, auth);

  // Drop machine-authored canvases. A call summary grants its attendees
  // OWNER/EDITOR, so the participant filter above matches it for everyone on the
  // call. Call content belongs to the `call` source, from the transcript.
  const generated = rows.filter(isGeneratedCanvas);
  if (generated.length > 0) {
    logger.info("[user-memory-fetcher] skipped machine-authored canvases", {
      userId,
      skipped: generated.length,
      kept: rows.length - generated.length,
    });
  }

  return rows
    .filter((cv) => !isGeneratedCanvas(cv))
    .filter((cv) => cv.createdBy === userId || cv.content)  // safety
    .map((cv): UserMemoryRecord => ({
      id: cv.id,
      type: "canvas",
      ts: cv.updatedAt,
      ...(cv.channelId ? { channelId: cv.channelId } : {}),
      ...(cv.title ? { title: cv.title } : {}),
      text: extractCanvasText(cv.content).slice(0, MAX_TEXT_CHARS),
    }))
    .filter((r) => r.text.trim().length > 0);
}

// ─── Estimate (counts only) ─────────────────────────────────────────────

/**
 * Cheap counts for the consent-screen estimate. Uses `limit: 1` so Vespa
 * returns a tiny payload but `totalCount` reflects the true hit count.
 * Falls back to 0 on error so the estimate page degrades gracefully
 * instead of 500ing the user.
 */
export async function countUserRecords(
  userId: string,
  window: { from: Date; to: Date },
): Promise<{ messages: number; calls: number; canvases: number }> {
  const auth = await resolveAuthForUser(userId);
  if (!auth) return { messages: 0, calls: 0, canvases: 0 };

  async function safeMessagesCount(): Promise<number> {
    try {
      const resp = (await search(
        {
          q: "",
          filterOnly: "true",
          type: "messages",
          from: userId,
          after: toIsoDate(window.from),
          before: toIsoDate(window.to),
          limit: "1",
        },
        auth!,
      )) as VespaSearchResponse;
      return resp.data?.totalCount ?? 0;
    } catch (err) {
      logger.warn("[user-memory-fetcher] messages count failed", { userId, err: errMsg(err) });
      return 0;
    }
  }

  // `type=calls` is participant-scoped, matching what fetchUserCalls ingests.
  // Only transcribed calls become records and `hasTranscript` isn't a query
  // filter, so count it off the page — exact when the window fits one page.
  const SAMPLE_SIZE = 200;
  let calls = 0;
  try {
    const resp = (await search(
      {
        q: "",
        filterOnly: "true",
        type: "calls",
        withUser: userId,
        callStartsAt: String(window.from.getTime()),
        callEndsAt: String(window.to.getTime()),
        callType: "VIDEO,AUDIO,HEADLESS",   // see fetchUserCalls — HEADLESS is excluded by default
        limit: String(SAMPLE_SIZE),
      },
      auth!,
    )) as VespaSearchResponse;
    const total = resp.data?.totalCount ?? 0;
    const sample = flattenResults(resp);
    const withTranscript = sample.filter((r) => r.searchContext?.["hasTranscript"] === true).length;
    calls =
      sample.length === 0
        ? 0
        : total <= sample.length
          ? withTranscript
          : Math.round(total * (withTranscript / sample.length));
  } catch (err) {
    logger.warn("[user-memory-fetcher] call count failed", { userId, err: errMsg(err) });
  }

  // Canvas count: two queries because /api/query AST validator rejects
  // OR-as-array. We over-count by the createdBy∩participants overlap,
  // which is fine for an estimate (always erring on the side of slightly
  // higher cost displayed). Real fetch dedupes correctly.
  let canvases = 0;
  try {
    const winFilter = {
      updatedAt: { gte: window.from.toISOString(), lte: window.to.toISOString() },
    };
    const [authoredRes, editedRes] = await Promise.all([
      interact(
        {
          model: "canvas",
          operation: "count",
          where: { ...winFilter, createdBy: { equals: userId } },
        },
        auth!,
      ).catch(() => ({ count: 0 })),
      interact(
        {
          model: "canvas",
          operation: "count",
          where: {
            ...winFilter,
            participants: { some: { userId: { equals: userId }, role: { in: ["OWNER", "EDITOR"] } } },
          },
        },
        auth!,
      ).catch(() => ({ count: 0 })),
    ]);
    const authoredCount = typeof authoredRes === "number" ? authoredRes : ((authoredRes as { count?: number })?.count ?? 0);
    const editedCount = typeof editedRes === "number" ? editedRes : ((editedRes as { count?: number })?.count ?? 0);
    // Cap at max(authored, edited) — creators are auto-OWNER so editedCount
    // already includes most of authoredCount. Min is a better estimate than
    // the sum (which would double-count the overlap).
    canvases = Math.max(authoredCount, editedCount);
  } catch (err) {
    logger.warn("[user-memory-fetcher] canvas count failed", { userId, err: errMsg(err) });
  }

  const [messages] = await Promise.all([safeMessagesCount()]);
  return { messages, calls, canvases };
}
