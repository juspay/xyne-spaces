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
 *     For transcripts that means "calls you participated in"; for canvases
 *     "canvases where you're a participant" — exactly what the Twin needs.
 *
 * Schema reference (backend/src/vespa/src/types.ts + mapper.ts):
 *   - File documents (canvas + transcript subApps) index `chunks: string[]`
 *     containing the full markdown text. Backend's vespaSearch transformer
 *     returns this as `body` (joined) on each result.
 *   - Permissions:
 *       * canvas:     CanvasParticipant.userId — owners/editors/viewers
 *       * transcript: CallParticipant.userId   — anyone who joined the call
 *   - Vespa enforces ACL via permissions on every search request; we never
 *     see docs the user doesn't have access to.
 */

import type { UserMemoryRecord } from "xyne-claw-shared";
import { interact, search, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { loadEffectiveCredentials } from "../lib/credentials-loader.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("user-memory-fetcher", createTraceId());

const MAX_RECORDS_PER_FETCH = 200;
const MAX_TEXT_CHARS = 1_500;

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
): Promise<VespaSearchResult[]> {
  const auth = await resolveAuthForUser(userId);
  if (!auth) return [];

  // filterOnly=true means "no semantic query, just filters" — exactly the
  // backfill / daily walk mode. Without this, vespaSearch's validator
  // demands a `q` param.
  const fullParams: Record<string, string> = {
    q: "",
    filterOnly: "true",
    ...params,
  };

  try {
    const resp = (await search(fullParams, auth)) as VespaSearchResponse;
    if (!resp.success || !resp.data) {
      logger.warn("[user-memory-fetcher] vespaSearch returned unsuccessful", { userId, params: fullParams });
      return [];
    }
    return flattenResults(resp);
  } catch (err) {
    // Treat Vespa / Spaces-backend errors as "no data for this window" so the
    // backfill cursor still advances rather than stalling. The error is logged
    // so ops can detect a systematic Vespa outage, but a single bad window
    // won't exhaust BullMQ retries and freeze the cursor at `to` forever.
    // This mirrors the canvas-path's behaviour where individual fetch errors
    // are caught and logged without re-throwing.
    logger.error("[user-memory-fetcher] vespaSearch failed — treating window as empty", {
      userId,
      params: fullParams,
      err: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : "unknown",
    });
    return [];
  }
}

// ─── Messages ───────────────────────────────────────────────────────────

export async function fetchUserMessages(
  userId: string,
  window: { from: Date; to: Date },
  limit = MAX_RECORDS_PER_FETCH,
): Promise<UserMemoryRecord[]> {
  const hits = await vespaQuery(userId, {
    type: "messages",
    from: userId,                      // senderId filter (vespaSearch maps this for messages)
    after: toIsoDate(window.from),
    before: toIsoDate(window.to),
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
    logger.warn("[user-memory-fetcher] canvas authored fetch failed", { userId, err: err instanceof Error ? err.message : String(err) });
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
    logger.warn("[user-memory-fetcher] canvas editor/owner fetch failed", { userId, err: err instanceof Error ? err.message : String(err) });
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

export async function fetchUserHostedCalls(
  userId: string,
  window: { from: Date; to: Date },
  limit = 100,
): Promise<UserMemoryRecord[]> {
  // Transcripts via vespaSearch: type=transcript correctly narrows by
  // CallParticipant permissions[] (the indexer side works for transcripts;
  // it's only canvas that's broken). We DON'T need the combined query for
  // transcripts alone — vespaSearch returns the right docs when type is
  // exactly "transcript". The subApp-mixing bug only matters when you want
  // to distinguish transcripts from canvases in a single response, which
  // we no longer do because canvas uses /api/query.
  const hits = await vespaQuery(userId, {
    type: "transcript",
    after: toIsoDate(window.from),
    before: toIsoDate(window.to),
    limit: String(limit),
  });

  const seen = new Set<string>();
  return hits
    .filter((h) => {
      // Drop CHAT_ATTACHMENT / TICKET_ATTACHMENT noise — vespaSearch leaks
      // those through the broken subApp filter even for type=transcript.
      // After the Spaces fix this filter becomes a no-op.
      const sub = String(h.searchContext?.subApp ?? "").toUpperCase();
      return sub === "TRANSCRIPT";
    })
    .filter((h) => {
      if (!h.id || seen.has(h.id)) return false;
      seen.add(h.id);
      const body = (h.body ?? "").trim();
      const summary = (h.subtitle ?? "").trim();
      return body.length > 0 || summary.length > 0;
    })
    .map((h): UserMemoryRecord => {
      const channelId = h.searchContext?.channelId as string | undefined;
      const channelName = h.searchContext?.channelTitle as string | undefined;
      const summary = (h.subtitle ?? "").trim();
      const body = (h.body ?? "").trim();
      const text = (summary + (summary && body ? "\n\nTranscript:\n" : "") + body).slice(0, MAX_TEXT_CHARS);
      return {
        id: h.id,
        type: "call",
        ts: (h.metadata?.timestamp as string | undefined) ?? "",
        ...(channelId ? { channelId } : {}),
        ...(channelName ? { channelName } : {}),
        ...(h.title ? { title: h.title } : {}),
        text,
      };
    });
}

export async function fetchUserCanvases(
  userId: string,
  window: { from: Date; to: Date },
  limit = 100,
): Promise<UserMemoryRecord[]> {
  const auth = await resolveAuthForUser(userId);
  if (!auth) return [];

  const rows = await queryUserCanvases(userId, window, limit, auth);
  return rows
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
      logger.warn("[user-memory-fetcher] messages count failed", { userId, err: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  }

  // Transcript count: still via vespaSearch sample (subApp filter broken
  // but transcript-side permissions[] are correct, so the result set
  // narrows to calls the user joined). Sample 200 to extrapolate the
  // transcript fraction × the combined-files totalCount.
  const SAMPLE_SIZE = 200;
  let calls = 0;
  try {
    const resp = (await search(
      {
        q: "",
        filterOnly: "true",
        type: "transcript",
        after: toIsoDate(window.from),
        before: toIsoDate(window.to),
        limit: String(SAMPLE_SIZE),
      },
      auth!,
    )) as VespaSearchResponse;
    const filesTotal = resp.data?.totalCount ?? 0;
    const sample = flattenResults(resp);
    let transcriptInSample = 0;
    for (const r of sample) {
      if (String(r.searchContext?.subApp ?? "").toUpperCase() === "TRANSCRIPT") transcriptInSample += 1;
    }
    const sampleSize = sample.length || 1;
    calls = Math.round(filesTotal * (transcriptInSample / sampleSize));
  } catch (err) {
    logger.warn("[user-memory-fetcher] transcript count failed", { userId, err: err instanceof Error ? err.message : String(err) });
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
    logger.warn("[user-memory-fetcher] canvas count failed", { userId, err: err instanceof Error ? err.message : String(err) });
  }

  const [messages] = await Promise.all([safeMessagesCount()]);
  return { messages, calls, canvases };
}
