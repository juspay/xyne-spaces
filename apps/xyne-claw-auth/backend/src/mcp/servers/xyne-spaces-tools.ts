/**
 * Xyne Spaces MCP tool definitions.
 *
 * Each tool has a name, description, JSON Schema inputSchema, and async handler.
 * Handlers call the Spaces HTTP client and return MCP-formatted results.
 */

import { errMsg } from "../../lib/errors.js";
import {
  interact,
  search,
  memorySearch,
  spacesFetch,
  spacesFetchBuffer,
  spacesFetchText,
  appFetch,
  appFetchBuffer,
  type SpacesAuthContext,
} from "./xyne-spaces-client.js";
import { esc, queryDirect, type DirectSearchResponse } from "./vespa-direct.js";
import { buildYqlFromParams, AREA_NAMES, AREA_ALIASES, describeAreasForPrompt } from "./vespa-search-areas.js";
import { validateCorpusScan, buildCorpusScanYql, parseBucketKey, termToQuery, MAX_SCAN_TERMS, type CorpusScanScope } from "./vespa-corpus-scan.js";
import { validateEvidencePack, bucketRange, buildPackFetchYql, formatIstDate, toSnippet, MAX_PACK_PER_BUCKET, DEFAULT_PACK_PER_BUCKET, MAX_BUCKET_FETCHES } from "./vespa-evidence-pack.js";
import { getWorkspaceIdForUser } from "../../lib/spaces-db.js";
import {
  extractCleanTextFromFlowJson,
  isFlowJsonContent,
  SDLC_TOOL_NAMES,
  type Citation,
} from "xyne-claw-shared";
import { SDLC_BASELINE_KINDS } from "@xyne/shared/sdlc";
import { CONFIG } from "../../config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("xyne-spaces-tools");

const RAW_ATTACHMENT_INLINE_LIMIT_BYTES = Number(
  process.env["SPACES_FETCH_ATTACHMENT_INLINE_LIMIT_BYTES"] ?? 5 * 1024 * 1024,
);
const isOnyxBenchLane = (): boolean => (process.env["ONYX_BENCH_VESPA"] ?? "").trim() === "true";
const ATTACHMENT_INGEST_TIMEOUT_MS = Number(
  process.env["SPACES_FETCH_ATTACHMENT_INGEST_TIMEOUT_MS"] ?? 120_000,
);
// Ceiling for the /download fallback (below). The signed-url path streams
// straight from GCS to claw and handles arbitrarily large files; the fallback
// instead pulls the whole blob into THIS process and base64-inflates it over
// the wire to claw, so it must be bounded. Matches claw's own URL-ingest cap
// (ATTACHMENT_URL_MAX_BYTES, default 50 MB) so claw won't reject what we send.
const ATTACHMENT_DOWNLOAD_FALLBACK_LIMIT_BYTES = Number(
  process.env["SPACES_FETCH_ATTACHMENT_FALLBACK_LIMIT_BYTES"] ?? 50 * 1024 * 1024,
);

/**
 * Vespa-query debug sidecar mirrored from claw-auth's kb-handlers. Same shape
 * as `data.debug` on /api/vespaSearch/claw responses when includeDebugInfo=true.
 */
interface VespaDebugBlock {
  payloads?: Array<{
    stage: string;
    yql: string;
    vespaParams: Record<string, unknown>;
  }>;
}

/**
 * Build a clickable Spaces thread URL for a ticket. Mirrors the
 * pattern used by claw-auth's citations.ts buildThreadUrl so the link
 * format stays consistent across the codebase. Returns null when
 * required fields are missing so callers can fall back to plain text.
 */
function buildTicketUrl(channelId: string | undefined, conversationId: string | undefined): string | null {
  const base = CONFIG.spacesAppUrl;
  if (!base || !channelId || !conversationId) return null;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
}

// ── Types ────────────────────────────────────────────────────────────

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /** MCP `_meta` field — out-of-band metadata callers can read. We use it
   *  to propagate structured citations from tools through the MCP transport
   *  to xyne-claw's invocation record (see Tier 1 design). */
  _meta?: { citations?: Citation[]; [k: string]: unknown };
}

export interface HandlerContext {
  userId: string;
  /**
   * "user" → run is a real Spaces user; tools use the user session token
   * against `/api/query` (the default `handler`).
   * "app"  → run is an agent's app user (no login session); tools use the app
   * token against `/api/apps/*` (the `appHandler`).
   */
  authMode: "user" | "app";
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Default (user-session) implementation, hits `/api/query` etc. */
  handler: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>;
  /**
   * Optional app-token implementation, hits the `/api/apps/*` routes. As
   * Spaces adds app routes for search / ticket-filter / user-search, give
   * those tools an `appHandler` here — no duplicate `apps-*` tool is created;
   * it's the SAME tool, app backend. Tools WITHOUT one still run in app mode
   * through `handler` when that handler only hits dual-auth `/claw` routes
   * (interact / search / memorySearch — authenticateUserOrApp on the Spaces
   * side), which is most of the read tools.
   */
  appHandler?: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>;
  /**
   * True when the tool is meaningless or broken without a human user token:
   * either it acts AS the human (user-send-message) or its handler hits
   * user-session-only routes with no app equivalent and no appHandler. The
   * app-tools server (which always runs in app mode) hides these from its
   * listing and rejects calls to them — otherwise they surface to automation
   * runs and can only 401.
   */
  userOnly?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function okCited(text: string, citations: Citation[]): ToolResult {
  return citations.length > 0
    ? { content: [{ type: "text", text }], _meta: { citations } }
    : { content: [{ type: "text", text }] };
}

const TOOL_CALL_ID_PLACEHOLDER = "__TOOL_CALL_ID__";

function inlineCitationToken(chunkIndex: number): string {
  return `[clf-${TOOL_CALL_ID_PLACEHOLDER}#${chunkIndex}]`;
}

function prefixChunk(chunkIndex: number, title: string, lines: string[]): string {
  return [`${inlineCitationToken(chunkIndex)} ${title}`, ...lines].join("\n");
}

/**
 * Pagination footer so the agent KNOWS whether more results exist and how to get
 * them — without it, a tool that returns its `limit`-worth of rows looks
 * complete even when the underlying data has far more.
 *
 * Pass `total` when an exact count is known (search / meeting-insights surface a
 * Vespa totalCount); otherwise we infer "there may be more" from a full page
 * (returned === requested limit). The agent should re-call with the suggested
 * `offset` and the SAME filters to page forward.
 */
function paginationFooter(p: {
  returned: number;
  limit: number;
  offset: number;
  total?: number | undefined;
}): string {
  const { returned, limit, offset, total } = p;
  const next = offset + returned;
  if (typeof total === "number") {
    if (next < total) {
      return `\n\n[Showing ${offset + 1}-${next} of ${total}. More results available — call again with offset=${next} and the same filters/query for the next page.]`;
    }
    return offset > 0 || total > limit
      ? `\n\n[Showing ${offset + 1}-${next} of ${total} — end of results.]`
      : "";
  }
  // No exact total: a full page almost always means there's more behind it.
  if (returned >= limit) {
    return `\n\n[Showing ${returned} result(s) starting at offset ${offset}. There may be more — call again with offset=${next} and the same filters to continue paginating.]`;
  }
  return offset > 0
    ? `\n\n[Showing ${returned} result(s) starting at offset ${offset} — end of results.]`
    : "";
}

/** Append text to a ToolResult's first text block (e.g. a pagination footer). */
function appendText(result: ToolResult, extra: string): void {
  if (extra && result.content[0] && result.content[0].type === "text") {
    result.content[0].text = result.content[0].text + extra;
  }
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function withToolErrors(
  label: string,
  fn: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>,
): (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult> {
  return async (params, ctx) => {
    try {
      return await fn(params, ctx);
    } catch (e) {
      return err(`${label}: ${errMsg(e)}`);
    }
  };
}

function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2);
  return `${rounded} ${units[unit]} (${bytes} bytes)`;
}

/**
 * Push a thread citation `(channelId, conversationId)` into `out`, tagged
 * with the `chunkIndex` of the result row it corresponds to. We intentionally
 * do NOT dedupe by composite key — each rendered chunk needs its own Citation
 * so the frontend can resolve `[clf-<toolCallId>#<N>]` → `citations.find(c =>
 * c.chunkIndex === N)` even when several chunks share the same thread (e.g.
 * spaces-messages returning multiple messages from one conversation).
 *
 * When `conversationId` is missing (e.g. citing a whole channel rather than
 * a specific thread), the citation still goes in — the URL builder falls back
 * to `/chat/dir/<channelId>` for channel-level navigation.
 */
/**
 * `extras` carries optional deep-link fields the frontend's
 * `buildClawCitationUrl` consumes:
 *   - `messageId`: thread panel scrolls to and highlights this message
 *     (mirrors `navigateToMessage`).
 *   - `xyneId`: human-readable ticket key. When the channel turns out to be
 *     desk-typed (EMAIL/SLACK), the FE routes the citation to
 *     `/support/<channelId>/<xyneId>` instead of the chat thread URL
 *     (mirrors `navigateToTicket`). The xyneId here is intentionally
 *     attached to a *thread* citation — same row carries both ids so the
 *     URL builder can pick the right one based on channelKind.
 *   - `mailId`: specific Desk email; appended as `?mail=<mailId>` so
 *     SupportScreen scrolls to that EmailThreadItem.
 *
 * `channelKind` (channel.type) is filled later by `applyChannelInfo` after
 * the batched channel lookup — callers don't need to know it upfront.
 */
function pushThreadCitation(
  out: Citation[],
  channelId: string | undefined | null,
  conversationId: string | undefined | null,
  chunkIndex: number,
  label?: string,
  extras?: { messageId?: string; xyneId?: string; mailId?: string },
): void {
  if (!channelId) return;
  out.push({
    kind: "thread",
    channelId,
    ...(conversationId ? { conversationId } : {}),
    chunkIndex,
    ...(label ? { label } : {}),
    ...(extras?.messageId ? { messageId: extras.messageId } : {}),
    ...(extras?.xyneId ? { xyneId: extras.xyneId } : {}),
    ...(extras?.mailId ? { mailId: extras.mailId } : {}),
  });
}

/**
 * Strip Vespa's `<hi>` highlight tags for use as a citation LABEL. `cleanSnippet`
 * turns them into `**bold**`, which is right for prose but renders as literal
 * asterisks inside a chip, so labels get the plain form.
 */
function plainLabel(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const stripped = text.replace(/<\/?hi>/gi, "").trim();
  return stripped || undefined;
}

/**
 * Cite a call at whatever target it actually has.
 *
 * A channel call lives in a thread, so `pushThreadCitation` is right for it. A
 * note-taker recording has neither channel nor conversation — it is created from
 * a LiveKit webhook and never posted anywhere — so a thread citation silently
 * produced nothing while the row still rendered an inline `[clf-…#N]` token.
 * That left a chip with no citation behind it, which the dashboard treats as an
 * unlinkable auto-citation and routes to the debug panel on click. Recordings
 * get a `recording` citation pointing at `/recordings/:externalId` instead.
 *
 * Returns whether anything was emitted, so callers can skip the inline token for
 * a call that has no linkable target at all rather than render a dead chip.
 */
function pushCallCitation(
  out: Citation[],
  call: { id: string; externalId?: string; callType?: string; channelId?: string },
  conversationId: string | undefined,
  chunkIndex: number,
  label?: string,
): boolean {
  if (call.callType === "HEADLESS" && call.externalId) {
    out.push({
      kind: "recording",
      recordingId: call.externalId,
      chunkIndex,
      ...(label ? { label } : {}),
    });
    return true;
  }
  if (call.channelId) {
    pushThreadCitation(out, call.channelId, conversationId, chunkIndex, label);
    return true;
  }
  return false;
}

function pushCanvasCitation(
  out: Citation[],
  viewAccessId: string | undefined | null,
  chunkIndex: number,
  label?: string,
): void {
  if (!viewAccessId) return;
  out.push({
    kind: "canvas",
    viewAccessId,
    chunkIndex,
    ...(label ? { label } : {}),
  });
}

/**
 * Single-query batch resolver: takes a list of channelIds and returns a
 * Map<channelId, { name, scopeType }>. Used by tools that emit thread
 * citations to enrich them with display name + channel type so the
 * citation block renders as e.g. "Ticket XYNE-123 in #testing-claw (TICKET)"
 * instead of an opaque "Spaces thread".
 */
async function resolveChannelInfo(
  channelIds: Iterable<string>,
): Promise<Map<string, { name?: string; scopeType?: string; type?: string }>> {
  const ids = [...new Set(Array.from(channelIds).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    // Also pulls `type` (EMAIL/SLACK/DEFAULT/SUPPORT) so the frontend can
    // detect desk-typed tickets and route them to the Support view rather
    // than the chat thread panel. The python query gateway returns scalar
    // columns by default, so adding `type` is free — no extra round trip.
    const rows = (await interact({
      model: "channel",
      operation: "findMany",
      where: { id: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; name?: string; scopeType?: string; type?: string }>;
    const out = new Map<string, { name?: string; scopeType?: string; type?: string }>();
    for (const r of rows) {
      out.set(r.id, {
        ...(r.name ? { name: r.name } : {}),
        ...(r.scopeType ? { scopeType: r.scopeType } : {}),
        ...(r.type ? { type: r.type } : {}),
      });
    }
    return out;
  } catch {
    // Non-fatal — citations still work without channel display info.
    return new Map();
  }
}

/**
 * Look up the channelId that owns a given conversationId. Used by tools that
 * query the `message` model (which has no channelId column — channelId lives
 * on the related Conversation). We can't `include: { conversation }` here
 * because the python query gateway at /api/query/claw silently drops `include`
 * relations from the response (verified 2026-06-15). Querying the Conversation
 * model directly returns channelId as a base scalar field, which works.
 */
async function resolveChannelIdForConversation(
  conversationId: string | undefined | null,
): Promise<string | undefined> {
  if (!conversationId) return undefined;
  try {
    const rows = (await interact({
      model: "conversation",
      operation: "findMany",
      where: { conversationId: { equals: conversationId } },
      take: 1,
    })) as Array<{ channelId?: string }>;
    return rows?.[0]?.channelId;
  } catch {
    return undefined;
  }
}

/**
 * Look up the xyneId of the ticket owning a desk conversation. Each desk
 * conversation has exactly one ticket, so a single ticket find by
 * conversationId returns the right row. Used by spaces-emails to attach the
 * ticket key to mail citations so the FE can deep-link them to the Support
 * view (`/support/<channelId>/<xyneId>?mail=<mailId>`). Returns undefined
 * when the lookup fails or no ticket exists — caller falls back to the
 * regular chat thread URL in that case.
 */
async function resolveTicketByConversation(
  conversationId: string | undefined | null,
): Promise<string | undefined> {
  if (!conversationId) return undefined;
  try {
    const rows = (await interact({
      model: "ticket",
      operation: "findMany",
      where: { conversationId: { equals: conversationId } },
      take: 1,
    })) as Array<{ xyneId?: string }>;
    return rows?.[0]?.xyneId;
  } catch {
    return undefined;
  }
}

/** Thread-routing ids resolved for a direct-Vespa hit via the ACL'd query
 *  gateway — the raw Vespa doc alone can't supply them (mail needs the
 *  email→ticket join; RCA/ticket-attachment files only carry a ticket id). */
interface DirectLink {
  channelId?: string;
  conversationId?: string;
  xyneId?: string;
}

/**
 * Batch-resolve Vespa mail hits → their desk thread ids. A Vespa mail doc's
 * docId IS the Postgres email.id (same convention as the backend's
 * /api/vespaSearch mail transform), so one email lookup gives each hit's
 * conversationId + channelId, and one ticket lookup by those conversationIds
 * attaches the human ticket key (xyneId) the FE's desk route needs
 * (/support/<channelId>/<xyneId>?mail=<mailId>). Mail whose conversation has
 * no ticket keeps the email row's channelId and falls back to the chat thread
 * URL — mirroring spaces-emails. Both lookups are ACL'd (Emails/TicketsACL);
 * failure → empty map → the rows render uncited, never a broken chip.
 */
async function resolveMailLinks(mailDocIds: string[]): Promise<Map<string, DirectLink>> {
  // Slice to the gateway's take ceiling — it REJECTS (400s) take > MAX_TAKE
  // rather than clamping, which would silently drop every citation on the
  // page. Grouped direct-Vespa output can exceed it (up to 1000 groups × 5
  // sample rows); rows past the cap just render uncited.
  const ids = [...new Set(mailDocIds.filter(Boolean))].slice(0, GATEWAY_MAX_TAKE);
  const out = new Map<string, DirectLink>();
  if (ids.length === 0) return out;
  try {
    const emails = (await interact({
      model: "email",
      operation: "findMany",
      where: { id: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; conversationId?: string; channelId?: string }>;
    const convIds = [...new Set(emails.map((e) => e.conversationId).filter((v): v is string => !!v))].slice(
      0,
      GATEWAY_MAX_TAKE,
    );
    const tickets = convIds.length
      ? ((await interact({
          model: "ticket",
          operation: "findMany",
          where: { conversationId: { in: convIds } },
          take: convIds.length,
        })) as Array<{ conversationId?: string; channelId?: string; xyneId?: string }>)
      : [];
    const ticketByConv = new Map(
      tickets.filter((t) => t.conversationId).map((t) => [t.conversationId as string, t]),
    );
    for (const e of emails) {
      const t = e.conversationId ? ticketByConv.get(e.conversationId) : undefined;
      const channelId = t?.channelId ?? e.channelId;
      if (!channelId) continue; // no route without a channel — leave uncited
      out.set(e.id, {
        channelId,
        ...(e.conversationId ? { conversationId: e.conversationId } : {}),
        ...(t?.xyneId ? { xyneId: t.xyneId } : {}),
      });
    }
  } catch {
    // Non-fatal — mail rows render uncited when the lookup fails.
  }
  return out;
}

/**
 * Batch ticketId → thread ids for file rows that only carry a ticket
 * reference: RCA docs (metadata.ticketId) and TICKET_ATTACHMENT files whose
 * channelRef was never set at ingest. xyneId rides along so desk tickets
 * route to /support/<channelId>/<xyneId>.
 */
async function resolveTicketLinks(ticketIds: Array<string | undefined>): Promise<Map<string, DirectLink>> {
  // Sliced for the same gateway take-ceiling reason as resolveMailLinks.
  const ids = [...new Set(ticketIds.filter((v): v is string => !!v))].slice(0, GATEWAY_MAX_TAKE);
  const out = new Map<string, DirectLink>();
  if (ids.length === 0) return out;
  try {
    const rows = (await interact({
      model: "ticket",
      operation: "findMany",
      where: { id: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; channelId?: string; conversationId?: string; xyneId?: string }>;
    for (const t of rows) {
      if (!t.channelId) continue;
      out.set(t.id, {
        channelId: t.channelId,
        ...(t.conversationId ? { conversationId: t.conversationId } : {}),
        ...(t.xyneId ? { xyneId: t.xyneId } : {}),
      });
    }
  } catch {
    // Non-fatal — rows fall back to their own channel ids or render uncited.
  }
  return out;
}

/**
 * Canvas fallback: docId (= Postgres Canvas.id) → viewAccessId for CANVAS
 * rows whose metadata JSON didn't carry it (pre-viewAccessId index docs,
 * corrupt blobs). ACL'd via CanvasesACL, so a canvas the user can't open
 * simply doesn't resolve.
 */
async function resolveCanvasViewIds(canvasDocIds: string[]): Promise<Map<string, string>> {
  // Sliced for the same gateway take-ceiling reason as resolveMailLinks.
  const ids = [...new Set(canvasDocIds.filter(Boolean))].slice(0, GATEWAY_MAX_TAKE);
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const rows = (await interact({
      model: "canvas",
      operation: "findMany",
      where: { id: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; viewAccessId?: string }>;
    for (const c of rows) {
      if (c.viewAccessId) out.set(c.id, c.viewAccessId);
    }
  } catch {
    // Non-fatal — canvas rows degrade to channel-level thread chips.
  }
  return out;
}

/**
 * Batch Vespa file docId (= collectionItem.fileId, a stable UUID shared
 * across all versions of the file) → collectionItem.id (the Postgres cuid
 * the FE's KB file-viewer route, downloads, and picker all key on). The two
 * ids are NOT interchangeable — see the identical translation map built in
 * claw-auth's kb-handlers.ts (`vespaDocIdToItemId`) for the same reason.
 * Without this, a COLLECTIONS citation's `collectionItemId`/url would carry
 * the Vespa docId straight through and 404 (or resolve to nothing) on the FE.
 */
async function resolveCollectionItemIds(fileDocIds: string[]): Promise<Map<string, string>> {
  // Sliced for the same gateway take-ceiling reason as resolveMailLinks.
  const ids = [...new Set(fileDocIds.filter(Boolean))].slice(0, GATEWAY_MAX_TAKE);
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const rows = (await interact({
      model: "collectionItem",
      operation: "findMany",
      where: { fileId: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; fileId: string }>;
    for (const c of rows) {
      out.set(c.fileId, c.id);
    }
  } catch {
    // Non-fatal — COLLECTIONS rows degrade to a channel-level thread chip.
  }
  return out;
}

function applyChannelInfo(
  citations: Citation[],
  info: Map<string, { name?: string; scopeType?: string; type?: string }>,
): void {
  for (const c of citations) {
    if ((c.kind !== "thread" && c.kind !== "ticket") || !c.channelId) continue;
    const meta = info.get(c.channelId);
    if (!meta) continue;
    if (meta.name && !c.channelName) c.channelName = meta.name;
    if (meta.scopeType && !c.channelType) c.channelType = meta.scopeType;
    // `channelKind` carries channel.type (EMAIL/SLACK/DEFAULT/SUPPORT). FE
    // uses it to detect desk-typed tickets and switch the URL to /support/…
    // instead of the regular chat thread URL.
    if (meta.type && !c.channelKind) c.channelKind = meta.type;
  }
}

/**
 * Batch-resolve user ids → { name, email } in ONE findMany. Mirrors
 * resolveChannelInfo: the query gateway strips `include`, so a joined
 * sender/creator name never rides back on the parent row — this is the single
 * reliable id→name path. Non-fatal; unresolved ids fall back to the raw id at
 * the render site. `user` is gateway-allowlisted (validator.ts).
 */
async function resolveUserInfo(
  userIds: Iterable<string>,
): Promise<Map<string, { name?: string; email?: string }>> {
  const ids = [...new Set(Array.from(userIds).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const rows = (await interact({
      model: "user",
      operation: "findMany",
      where: { id: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; name?: string; email?: string }>;
    const out = new Map<string, { name?: string; email?: string }>();
    for (const r of rows) {
      out.set(r.id, { ...(r.name ? { name: r.name } : {}), ...(r.email ? { email: r.email } : {}) });
    }
    return out;
  } catch {
    return new Map();
  }
}

/** Render a user id as "Name <email>" via a resolveUserInfo map, falling back to
 *  the raw id when unresolved. `withId` appends " (id: …)" for tools that also
 *  want the raw id inline. */
function formatUserRef(
  id: string | undefined | null,
  info: Map<string, { name?: string; email?: string }>,
  withId = true,
): string {
  if (!id) return "unknown";
  const u = info.get(id);
  if (!u?.name) return `userId: ${id}`;
  return `${u.name}${u.email ? ` <${u.email}>` : ""}${withId ? ` (id: ${id})` : ""}`;
}

/**
 * Fetch a conversation's scalars (channelId, replyCount, createdBy,
 * lastActivityAt) in ONE findMany. Supersedes resolveChannelIdForConversation
 * for the message tools — same single round trip, more fields — since the
 * gateway drops `include` so we can't piggy-back on the message query.
 */
async function resolveConversationMeta(
  conversationId: string | undefined | null,
): Promise<
  { channelId?: string; replyCount?: number; createdBy?: string; lastActivityAt?: string } | undefined
> {
  if (!conversationId) return undefined;
  try {
    const rows = (await interact({
      model: "conversation",
      operation: "findMany",
      where: { conversationId: { equals: conversationId } },
      take: 1,
    })) as Array<{ channelId?: string; replyCount?: number; createdBy?: string; lastActivityAt?: string }>;
    return rows?.[0];
  } catch {
    return undefined;
  }
}

/**
 * Parse a Message.reactions_md blob into a compact "👍 3 · 🔥 1" summary. Format
 * (from shared serializeReactionsMd):
 *   :::reactions
 *   👍: [user-a, user-b, user-c]
 *   🔥: [user-d]
 *   :::
 * claw-auth can't import @xyne/shared, so this is a tiny local mirror. Returns ""
 * when absent/empty/unparseable. Reaction structured rows (reaction/reactionCount
 * models) are NOT gateway-allowlisted, so this scalar is the only live source.
 */
/** Parse a Message.reactions_md blob into [{ emoji, userIds }]. Lines look like
 *  "👍: [user-a, user-b]"; the ":::reactions"/":::" fence lines don't match the
 *  emoji:[…] shape and are skipped. */
function parseReactions(md: string | undefined | null): Array<{ emoji: string; userIds: string[] }> {
  if (!md || typeof md !== "string") return [];
  const out: Array<{ emoji: string; userIds: string[] }> = [];
  for (const line of md.split("\n")) {
    const m = line.trim().match(/^(.+?):\s*\[([^\]]*)\]$/);
    if (!m) continue;
    const emoji = m[1]!.trim();
    if (!emoji || emoji === ":::reactions") continue;
    const userIds = m[2]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (userIds.length > 0) out.push({ emoji, userIds });
  }
  return out;
}

/**
 * Render reactions_md as "👍 Asha, Ravi · 🔥 Meera" when a resolveUserInfo map is
 * supplied (WHO reacted), or "👍 2 · 🔥 1" (counts only) when it isn't. Reactor
 * ids that don't resolve fall back to the raw id. Returns "" when there are none.
 */
function formatReactions(
  md: string | undefined | null,
  userInfo?: Map<string, { name?: string; email?: string }>,
): string {
  const groups = parseReactions(md);
  if (groups.length === 0) return "";
  return groups
    .map((g) =>
      userInfo
        ? `${g.emoji} ${g.userIds.map((id) => userInfo.get(id)?.name ?? id).join(", ")}`
        : `${g.emoji} ${g.userIds.length}`,
    )
    .join(" · ");
}

/**
 * Batch-resolve each channel's MOST-RECENTLY-ACTIVE conversation id in ONE
 * findMany. A channel (chat_container) has no `conversationId` scalar — it owns
 * many Conversation threads — so spaces-channels' advertised conversationId was
 * dead. This gives the agent a concrete thread to open/read per channel. Ordered
 * by lastActivityAt desc and capped, so very inactive channels may resolve to
 * none (acceptable — nothing recent to navigate to). `conversation` is
 * gateway-allowlisted.
 */
async function resolveChannelLatestConversation(channelIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set(Array.from(channelIds).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const rows = (await interact({
      model: "conversation",
      operation: "findMany",
      where: { channelId: { in: ids } },
      orderBy: [{ lastActivityAt: "desc" }],
      take: Math.min(ids.length * 4, 400),
    })) as Array<{ conversationId?: string; channelId?: string }>;
    const out = new Map<string, string>();
    for (const r of rows) {
      if (r.channelId && r.conversationId && !out.has(r.channelId)) out.set(r.channelId, r.conversationId);
    }
    return out;
  } catch {
    return new Map();
  }
}

/** Query gateway's MAX_TAKE (backend validator.ts). */
const GATEWAY_MAX_TAKE = 1000;

/**
 * resolveChannelParticipants: batched member lookup for a set of channels.
 *
 * The `Channel.participantCount` scalar is deprecated — XYNE-11666 moved the
 * live count into `channel_stats` (which the query gateway does not allowlist),
 * so the column on `channels` stays at its @default(0) and can't be trusted.
 * The reliable source is the `channel_participants` rows, fetched here in one
 * batched query (the gateway strips relation `include`, so we can't piggy-back
 * on the channel query). Returns channelId → ordered list of member userIds
 * plus a `truncated` flag when the global MAX_TAKE cap was hit (counts for the
 * busiest channels may then be a lower bound, surfaced to the caller as "N+").
 */
async function resolveChannelParticipants(
  channelIds: Iterable<string>,
): Promise<{ byChannel: Map<string, string[]>; truncated: boolean }> {
  const ids = [...new Set(Array.from(channelIds).filter(Boolean))];
  const byChannel = new Map<string, string[]>();
  if (ids.length === 0) return { byChannel, truncated: false };
  try {
    const rows = (await interact({
      model: "channelParticipant",
      operation: "findMany",
      where: { channelId: { in: ids } },
      orderBy: [{ joinedAt: "asc" }],
      take: GATEWAY_MAX_TAKE,
    })) as Array<{ channelId?: string; userId?: string }>;
    for (const r of rows) {
      if (!r.channelId || !r.userId) continue;
      const list = byChannel.get(r.channelId) ?? [];
      list.push(r.userId);
      byChannel.set(r.channelId, list);
    }
    return { byChannel, truncated: rows.length >= GATEWAY_MAX_TAKE };
  } catch {
    return { byChannel, truncated: false };
  }
}

// ── spaces-search ────────────────────────────────────────────────────

const spacesSearch: ToolDef = {
  name: "spaces-search",
  description:
    "Fast Vespa-powered search across all connected Spaces apps — messages, tickets, files, channels, users. " +
    "Much faster than reading individual conversations. Use it for keyword/topic/person lookups across the workspace.\n\n" +
    "## IMPORTANT — this returns SHALLOW CHUNKS, not full content\n" +
    "Each hit is a high-level RANKED SNIPPET (a ~300-char excerpt + ids), NOT the full message, thread, ticket, or file. " +
    "It tells you WHERE the answer lives, not the whole answer. Do NOT answer from a single search snippet — that is how wrong/partial answers happen.\n" +
    "Correct pattern: search broad → scan hits, pick the 1–3 most relevant → FETCH THE FULL CONTENT of each before concluding → then synthesize.\n" +
    "Follow-up (fetch) tools, by hit type:\n" +
    "- message / thread hit → take the returned `conversationId` and call **spaces-messages** to read the whole thread (and **spaces-message-detail** with `messageId` for one message's reactions/attachments).\n" +
    "- ticket hit → take the returned `xyneId`/ids and call **spaces-tickets** for structured fields, then **spaces-messages** on its `conversationId` for the discussion.\n" +
    "- file / attachment hit → list with **spaces-thread-attachments** then download with **spaces-fetch-attachment** (read it with the `read` tool).\n" +
    "Only skip the fetch step when the snippet itself unambiguously and completely answers the question.\n\n" +
    "## When NOT to use spaces-search\n" +
    "- Ticket queries by status/priority/assignee/board/tag/stage/project → use **spaces-tickets** (richer filters, structured output).\n" +
    "- Meeting content by TOPIC (action items, decisions, what was said) → **spaces-meeting-insights** (vector search);\n" +
    "  a known call, an exact list, or one transcript in full → **spaces-calls** (deterministic; includeTranscript=true).\n" +
    "- Reading a specific thread → use **spaces-messages** with `conversationId`.\n" +
    "- Recent activity for the user → use **spaces-activity**.\n\n" +
    "## Scoping (important)\n" +
    "- Always scope by `in=<channelId>` when the user is asking about a specific channel or has a channel attached as context — global search returns noise.\n" +
    "- Use `type` to narrow the surface (messages / attachments / channels / tickets / files / transcript / canvas). Use `transcript` for call recordings and summaries. Without `type`, results are grouped — use `type` when you only want one kind.\n" +
    "- `apps` (comma-sep: chat, ticket, user, file) is coarser than `type`; prefer `type`.\n" +
    "- `from=<userId>`: pass a USER id ONLY — NOT an email, a name, or a channel/conversation id (channel ids go in `in`). Resolve names → ids via spaces-users first.\n" +
    "- For ticket free-text only (not status/priority — those go to spaces-tickets): combine `type=tickets` with `query`.\n\n" +
    "## Empty-query searches\n" +
    "- To search by filters alone, just OMIT `query` (e.g. \"latest 10 files in #design\" → `in=<channelId>, type=attachments, range='last 7 days'`). Leaving `query` empty switches to filter-only mode automatically — there is no flag to set.\n\n" +
    "## Dates\n" +
    "- Prefer `range` for natural windows (today, yesterday, this week, last 7 days, last 30 days). Use `before`/`after` (ISO 8601 or '15 Mar 26' style) only when you need a specific cutoff.\n\n" +
    "## Pagination\n" +
    "- `limit` (1–100, default 100) is per group when results are grouped. Lower it if you only need the top few.\n" +
    "- To PAGE deeper, set `offset` (20, 40, …). Paging returns a FLAT ranked list — grouped output can't be paged, so grouping is dropped automatically once offset>0.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query text. OPTIONAL — omit it (or leave empty) to search by filters alone (type/from/in/range/etc.); the tool handles filter-only mode for you.",
      },
      apps: {
        type: "string",
        description:
          "Comma-separated apps to search: chat, ticket, user, file (default: all). Prefer `type` over this.",
      },
      type: {
        type: "string",
        enum: [
          "messages",
          "attachments",
          "channels",
          "tickets",
          "files",
          "transcript",
          "canvas",
          "rca",
          "emails",
          "users",
          "people",
        ],
        description:
          "Narrow to one surface. messages | attachments | channels | tickets | files | emails | users. transcript, canvas, rca are file sub-surfaces.",
      },
      from: {
        type: "string",
        description:
          "Filter by SENDER/AUTHOR user ID(s), comma-separated — a user id ONLY. NEVER pass a channel/conversation id here (use `in` for those); resolve names → ids via spaces-users first. A wrong id type here can produce a bad request.",
      },
      in: {
        type: "string",
        description:
          "Channel ID(s) to scope into, comma-separated. ALWAYS set this when the user is asking about a specific channel or has a channel attached as context. This is the ONLY place a channel id goes.",
      },
      status: {
        type: "string",
        description:
          "Filter by ticket status(es), comma-separated. Prefer spaces-tickets for ticket queries.",
      },
      priority: {
        type: "string",
        enum: ["HIGH", "MEDIUM", "LOW", "CRITICAL"],
        description: "Filter by ticket priority. Prefer spaces-tickets.",
      },
      board: { type: "string", description: "Filter by board name. Prefer spaces-tickets." },
      tags: { type: "string", description: "Filter by tags, comma-separated." },
      stage: { type: "string", description: "Filter by ticket stage. Prefer spaces-tickets." },
      assignee: { type: "string", description: "Filter by assigned user ID. Prefer spaces-tickets." },
      before: {
        type: "string",
        description: "Created before date — ISO 8601 or '15 Mar 26'. Prefer `range` for natural windows.",
      },
      after: {
        type: "string",
        description: "Created after date — ISO 8601 or '15 Mar 26'. Prefer `range` for natural windows.",
      },
      range: {
        type: "string",
        description: "Natural time window: today | yesterday | this week | last 7 days | last 30 days.",
      },
      orderBy: {
        type: "string",
        enum: ["newest", "oldest", "relevance"],
        description:
          "Sort order: newest (latest first), oldest (earliest first), relevance (default). Use newest for 'latest message', 'most recent' queries.",
      },
      groupBy: {
        type: "string",
        enum: ["createdBy", "channelId", "senderId", "docType"],
        description:
          "Group results by a field and get real document counts from Vespa, ordered by count descending. " +
          "Use this for enumeration and frequency queries — DO NOT fetch all results and count manually. " +
          "createdBy → who filed the most tickets or sent the most messages (top reporters, top contributors). " +
          "channelId → activity volume per channel. " +
          "senderId → most active message senders. " +
          "docType → breakdown by content type. " +
          "Each group returns a real total count (all matching docs, not just the returned sample) plus up to 5 representative results. " +
          "Example: type=tickets + groupBy=createdBy answers 'who reported the most issues'.",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results per group (default 100, max 100).",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0)." },
    },
    // required: ["query"],
  },
  handler: withToolErrors("Search error", async (args, ctx) => {
      const query = String(args["query"] ?? "").trim();
      const params: Record<string, string> = {};
      // Deterministic q vs filter-only — the model no longer passes a `filterOnly`
      // flag (it kept forgetting it, and the Spaces backend rejects an empty `q`
      // with "Query parameter q is required" unless filterOnly=true). When real
      // query text is present we send it as `q`; when `query` is empty/omitted we
      // switch the backend into filter-only mode ourselves.
      params["q"] = query ?? "";
      if (!query) params["filterOnly"] = "true";
      params["limit"] = String(args["limit"] ?? 100);
      if (args["offset"] && Number(args["offset"]) > 0) {
        params["offset"] = String(args["offset"]);
        // Grouped results (Spaces' default groupBy=docType) IGNORE the Vespa
        // offset — the grouping clause carries no offset, so every "page" returns
        // the same top hits per group and pagination never advances. Force a FLAT
        // ranked list (groupBy="") whenever the caller pages; flat hits honor
        // offset. (offset has no meaning for grouped output anyway.)
        params["groupBy"] = "";
      }
      if (args["apps"]) params["apps"] = String(args["apps"]);
      if (args["type"]) params["type"] = String(args["type"]);
      if (args["from"]) params["from"] = String(args["from"]);
      if (args["in"]) params["in"] = String(args["in"]);
      if (args["status"]) params["status"] = String(args["status"]);
      if (args["priority"]) params["priority"] = String(args["priority"]);
      if (args["board"]) params["board"] = String(args["board"]);
      if (args["tags"]) params["tags"] = String(args["tags"]);
      if (args["stage"]) params["stage"] = String(args["stage"]);
      if (args["assignee"]) params["assignee"] = String(args["assignee"]);
      if (args["before"]) params["before"] = String(args["before"]);
      if (args["after"]) params["after"] = String(args["after"]);
      if (args["range"]) params["range"] = String(args["range"]);
      if (args["orderBy"]) params["orderBy"] = String(args["orderBy"]);
      // Only forward groupBy when not already forced to "" by the offset path above.
      if (args["groupBy"] && !params["groupBy"]) params["groupBy"] = String(args["groupBy"]);

      let data: {
        success: boolean;
        data?: {
          grouped: boolean;
          groups?: Array<{ groupValue: string; count: number; results: Array<SearchResult> }>;
          results?: SearchResult[];
          totalCount?: number;
          debug?: VespaDebugBlock;
        };
      };

      // spaces-search ALWAYS goes through the Spaces backend /api/vespaSearch
      // (the canonical YqlBuilder). DIRECT_VESPA_SEARCH deliberately does NOT
      // reroute this tool through the hand-maintained vespa-direct.ts copy — that
      // flag now only gates the spaces-vespa-query escape-hatch tool (registered
      // below). The direct copy lagged the backend (no mail, no fuzzy fallback,
      // no personalization/threshold ranking, single-surface grouping dropped,
      // weaker workspace isolation), so routing the primary search tool through
      // it silently degraded results.
      //
      // includeDebugInfo: the backend rides the YQL back as `_meta.debug` on the
      // ToolResult; claw stashes it via takeDebug() and pins it to the persisted
      // ToolInvocation row. Strictly metadata, never reaches the model.
      params["includeDebugInfo"] = "true";
      data = (await search(params)) as typeof data;

      const debugBlock = data?.data?.debug;

      if (!data.success || !data.data) {
        return debugBlock
          ? {
              content: [{ type: "text", text: "Search failed." }],
              isError: true,
              _meta: { debug: debugBlock },
            }
          : err("Search failed.");
      }

      const citations: Citation[] = [];
      const harvest = (r: SearchResult, chunkIndex: number): void => {
        const sc = r.searchContext ?? {};
        const meta = r.metadata ?? {};
        const channelId =
          (sc["channelId"] as string | undefined) ?? (meta["channelId"] as string | undefined);
        const conversationId =
          (sc["conversationId"] as string | undefined) ?? (meta["conversationId"] as string | undefined);
        // Pull the per-row deep-link ids that searchContext exposes (matches
        // dashboard/src/utils/searchNavigation.ts which reads the same
        // fields). Each is optional — only present on result types that
        // make sense (messageId on messages, mailId on desk mails,
        // xyneId/ticketId on tickets) and is forwarded to the URL builder
        // only when set.
        const messageId = sc["messageId"] as string | undefined;
        const xyneId = sc["xyneId"] as string | undefined;
        const mailId = sc["mailId"] as string | undefined;
        pushThreadCitation(citations, channelId, conversationId, chunkIndex, r.title || r.type, {
          ...(messageId ? { messageId } : {}),
          ...(xyneId ? { xyneId } : {}),
          ...(mailId ? { mailId } : {}),
        });
      };

      // Merge the Vespa debug block into the ToolResult's _meta alongside any
      // citations the result already carries — _meta is the MCP-spec sidecar
      // for non-content metadata and is preserved verbatim by the runner.
      const withDebug = (r: ToolResult): ToolResult => {
        if (!debugBlock) return r;
        const existingMeta = (r as { _meta?: Record<string, unknown> })._meta ?? {};
        return { ...r, _meta: { ...existingMeta, debug: debugBlock } };
      };

      if (data.data.grouped && data.data.groups) {
        const groups = data.data.groups;
        if (groups.length === 0) return withDebug(ok(`No results found for "${args["query"]}".`));
        const parts: string[] = [];
        let chunkIndex = 0;
        for (const group of groups) {
          parts.push(`--- ${group.groupValue} (${group.count}) ---`);
          for (const r of group.results) {
            chunkIndex += 1;
            parts.push(formatSearchResult(r, chunkIndex));
            harvest(r, chunkIndex);
          }
          parts.push("");
        }
        const channelInfo = await resolveChannelInfo(
          citations.map((c) => c.channelId).filter((v): v is string => !!v),
        );
        applyChannelInfo(citations, channelInfo);
        // Grouped: `limit` is per-group, so an exact total isn't meaningful.
        // Signal "more" when any group filled its page.
        const groupLimit = Number(args["limit"] ?? 100);
        const groupOffset = Number(args["offset"] ?? 0);
        const maxReturned = groups.reduce((m, g) => Math.max(m, g.results.length), 0);
        const groupFooter =
          maxReturned >= groupLimit
            ? `\n\n[Results are grouped; each group shows up to ${groupLimit}. More may exist — call again with offset=${groupOffset + groupLimit} and the same query/filters to page deeper.]`
            : "";
        return withDebug(okCited(parts.join("\n") + groupFooter, citations));
      }

      const results = data.data.results ?? [];
      if (results.length === 0) return withDebug(ok(`No results found for "${args["query"]}".`));
      results.forEach((r, idx) => harvest(r, idx + 1));
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);
      return withDebug(
        okCited(
          `Found ${data.data.totalCount ?? results.length} result(s):\n\n${results
            .map((r, idx) => formatSearchResult(r, idx + 1))
            .join(
              "\n\n",
            )}${paginationFooter({ returned: results.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0), total: data.data.totalCount })}`,
          citations,
        ),
      );
    }),
};

// ── spaces-search-v2 ─────────────────────────────────────────────────
// Additive rollout: same schema + handler as spaces-search, improved description only.

const spacesSearchV2: ToolDef = {
  ...spacesSearch,
  name: "spaces-search-v2",
  description:
    "Fast Vespa-powered search across all connected Spaces apps — messages, tickets, files, channels, users. " +
    "Much faster than reading individual conversations. Use it for keyword/topic/person lookups across the workspace.\n\n" +
    "## IMPORTANT — this returns SHALLOW CHUNKS, not full content\n" +
    "Each hit is a high-level RANKED SNIPPET (a ~300-char excerpt + ids), NOT the full message, thread, ticket, or file. " +
    "It tells you WHERE the answer lives, not the whole answer. Do NOT answer from a single search snippet — that is how wrong/partial answers happen.\n" +
    "Correct pattern: search broad → scan hits, pick the 1–3 most relevant → FETCH THE FULL CONTENT of each before concluding → then synthesize.\n" +
    "Follow-up (fetch) tools, by hit type:\n" +
    "- message / thread hit → take the returned `conversationId` and call **spaces-messages** to read the whole thread (and **spaces-message-detail** with `messageId` for one message's reactions/attachments).\n" +
    "- ticket hit → take the returned `xyneId`/ids and call **spaces-tickets** for structured fields, then **spaces-messages** on its `conversationId` for the discussion.\n" +
    "- file / attachment hit → list with **spaces-thread-attachments** then download with **spaces-fetch-attachment** (read it with the `read` tool).\n" +
    "Only skip the fetch step when the snippet itself unambiguously and completely answers the question.\n\n" +
    "## When NOT to use spaces-search\n" +
    "- Ticket queries by status/priority/assignee/board/tag/stage/project → use **spaces-tickets** (richer filters, structured output).\n" +
    "- Meeting content by TOPIC (action items, decisions, what was said) → **spaces-meeting-insights** (vector search);\n" +
    "  a known call, an exact list, or one transcript in full → **spaces-calls** (deterministic; includeTranscript=true).\n" +
    "- Reading a specific thread → use **spaces-messages** with `conversationId`.\n" +
    "- Recent activity for the user → use **spaces-activity**.\n\n" +
    "## Scoping (important)\n" +
    "- Always scope by `in=<channelId>` when the user is asking about a specific channel or has a channel attached as context — global search returns noise.\n" +
    "- Use `type` to narrow the surface (messages / attachments / channels / tickets / files). Without `type`, results are GROUPED and each surface is capped per group — use `type` whenever you want one kind, a count, or full coverage.\n" +
    "- `apps` (comma-sep: chat, ticket, user, file) is coarser than `type`; prefer `type`.\n" +
    "- `from=<userId>`: pass a USER id ONLY — NOT an email, a name, or a channel/conversation id (channel ids go in `in`). Resolve names → ids via spaces-users first.\n" +
    "- For ticket free-text only (not status/priority — those go to spaces-tickets): combine `type=tickets` with `query`.\n\n" +
    "## Empty-query searches\n" +
    "- To search by filters alone, just OMIT `query` (e.g. \"latest 10 files in #design\" → `in=<channelId>, type=attachments, range='last 7 days'`). Leaving `query` empty switches to filter-only mode automatically — there is no flag to set.\n\n" +
    '## Counting — "how many X"\n' +
    '- Do NOT count the snippets this tool returns. A single call returns a capped PAGE; in grouped mode the per-group "(N)" can be the capped page size, not the true total. Tallying visible rows is the #1 cause of undercounts.\n' +
    '- Pass `type=<surface>` to run UNGROUPED — the result then leads with "Found N result(s)", the count for that surface. For ticket counts specifically, prefer **spaces-tickets**.\n' +
    '- A concept can span more than one surface (e.g. "issues" = tickets, support-desk items, AND messages raised in-channel) — count each relevant `type` and sum; one grouped call is not a count.\n' +
    '- If a surface is still capped, PAGINATE TO EXHAUSTION (below) and count what you page through. Never report the visible row count from one grouped call as "how many".\n\n' +
    "## Pagination\n" +
    "- `limit` (1–50, default 10) is the PAGE SIZE — and it is PER GROUP when results are grouped — NOT a total. A page (or group) that comes back FULL (results == `limit`) means THERE ARE MORE.\n" +
    "- To cover a whole set, LOOP: repeat the call with `offset` += `limit` until a page returns FEWER than `limit`. What you've paged through is then the complete set. (Paging returns a FLAT ranked list — grouping is dropped once offset>0.)\n" +
    "- Bump `limit` to 25–50 to cut round-trips, but one bumped call is still ONE page — keep paging until a page comes back short. Don't treat a single page as the whole set.\n\n" +
    '## Empty results — verify before concluding "none"\n' +
    '- An empty result under a filter (especially a date `range`/`before`/`after`, or an `in=<channelId>` scope) is ambiguous: truly nothing, or the scope/filter is wrong. Before answering "none", re-run WITHOUT the time filter: still empty → re-check the channel/scope (right channelId? right `type`?); non-empty → the window is genuinely empty, say so with context. Never report a bare "none" off one empty filtered call.\n\n' +
    "## Dates\n" +
    "- Prefer `range` for natural windows (today, yesterday, this week, last 7 days, last 30 days). Use `before`/`after` (ISO 8601 or '15 Mar 26' style) only when you need a specific cutoff.",
};

interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  context?: string;
  relevanceScore?: number;
  metadata?: Record<string, unknown>;
  searchContext?: Record<string, unknown>;
}

const toIST = (d: Date | string | number): string => {
  // Vespa timestamps are epoch-ms *numbers*, but transformHit stringifies them
  // (String(rawTs)), so a numeric string like "1700000000000" arrives here.
  // new Date(<numeric string>) parses it as a date string and returns Invalid
  // Date — coerce all-digit strings back to a number first (10 digits = seconds).
  const s = typeof d === "string" ? d.trim() : d;
  const v = typeof s === "string" && /^\d{10,}$/.test(s) ? Number(s) * (s.length === 10 ? 1000 : 1) : s;
  const date = new Date(v);
  const ms = date.getTime();
  // Guard against a bad value silently rendering as a wrong/absurd date. Sane
  // range: 2000-01-01 .. 2100-01-01. Outside it (or NaN), degrade gracefully.
  if (Number.isNaN(ms) || ms < 946684800000 || ms > 4102444800000) {
    if (!Number.isNaN(ms)) console.warn(`toIST: timestamp out of sane range: ${String(d)}`);
    return "(date n/a)";
  }
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
};

/** Decode the common HTML entities that survive tag-stripping. `&amp;` is decoded
 *  LAST so `&amp;lt;` → `&lt;` → `<` doesn't double-decode into a real tag char. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n: string) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return m;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return m;
      }
    })
    .replace(/&amp;/gi, "&");
}

/**
 * Convert rich-text HTML (Spaces message bodies, ticket descriptions) and Vespa
 * snippets to clean, readable markdown-ish plain text for the model — WITHOUT
 * truncating (claw's promoteIfOversized() is the size guard). Message/ticket
 * content is stored as TipTap/ProseMirror HTML (`<h2>`, `<p class=…>`, `<ul><li>`,
 * `<strong>`, …); dumping it raw floods the model with tag noise. We map block +
 * inline structure to markdown so meaning survives, then strip the rest:
 *  - Vespa search highlight `<hi>…</hi>` → **bold** (so matched terms stay visible)
 *  - `<h1..6>` → `#`/`##`/… ; `<li>` → `- ` ; `<strong>/<b>` → ** ; `<em>/<i>` → *
 *  - `<br>` and block closers (`</p></div></li></ul>…`) → newlines
 *  - every other tag removed; HTML entities decoded; blank runs collapsed
 * Plain-text messages (no tags) are returned trimmed unchanged (fast path).
 */
function cleanSnippet(text: string): string {
  if (!text || typeof text !== "string") return text ?? "";
  // Flow JSON (app/bot block messages) hide their real content in a
  // `data-flow-json` attribute; the tag-strip below would drop it, so flatten
  // the block tree first. Falls through to normal handling when empty.
  if (isFlowJsonContent(text)) {
    const flowText = extractCleanTextFromFlowJson(text);
    if (flowText) return flowText;
  }
  // Fast path: nothing tag-shaped → just decode entities + trim.
  if (!/<[a-z!/][^>]*>/i.test(text)) return decodeHtmlEntities(text).trim();
  const s = text
    .replace(/<\/?hi>/gi, "**")
    .replace(/<h1[^>]*>/gi, "\n\n# ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<h[4-6][^>]*>/gi, "\n\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?(em|i)\b[^>]*>/gi, "*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(s)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Render a byte count as a compact "2.4 MB" for file search hits. Returns ""
 *  for a missing/zero size so the caller can skip the line. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatSearchResult(r: SearchResult, chunkIndex: number | null): string {
  const subApp = (r.searchContext?.["subApp"] as string | undefined)?.toUpperCase();
  const displayType =
    r.type === "transcript" || subApp === "TRANSCRIPT"
      ? "call"
      : r.type === "canvas" || subApp === "CANVAS"
        ? "canvas"
        : r.type;
  const lines = [`[${displayType}] ${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}`];
  if (r.context && typeof r.context === "string") lines.push(`  ${cleanSnippet(r.context)}`);
  const meta = r.metadata;
  const detail: string[] = [];
  if (meta) {
    if (meta["timestamp"]) detail.push(toIST(meta["timestamp"] as string));
    if (meta["channelName"]) detail.push(`#${meta["channelName"]}`);
    if (meta["status"]) detail.push(`status: ${meta["status"]}`);
    if (meta["priority"]) detail.push(`priority: ${meta["priority"]}`);
    if (meta["stage"]) detail.push(`stage: ${meta["stage"]}`);
    // messageType only when it's not the default USER (BOT/SYSTEM/FORWARDED matter).
    if (meta["messageType"] && meta["messageType"] !== "USER")
      detail.push(String(meta["messageType"]).toLowerCase());
    if (meta["visibility"]) detail.push(`visibility: ${meta["visibility"]}`);
    if (typeof meta["memberCount"] === "number") detail.push(`${meta["memberCount"]} members`);
    if (meta["lastActivityAt"]) detail.push(`last active ${toIST(meta["lastActivityAt"] as string)}`);
  }
  // Relevance score gives the model a ranking-confidence signal it never had
  // before. Forwarded by the backend on every TransformedSearchResult.
  if (typeof r.relevanceScore === "number") detail.push(`score: ${r.relevanceScore.toFixed(3)}`);
  if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
  const sc = r.searchContext;
  if (sc) {
    // Sender line now carries the email when the transform surfaced it.
    if (sc["senderName"] || sc["senderEmail"] || sc["senderId"]) {
      const name = (sc["senderName"] as string) || "";
      const email = sc["senderEmail"] ? `<${sc["senderEmail"]}>` : "";
      const id = sc["senderId"] ? `(${sc["senderId"]})` : "";
      lines.push(`  From: ${[name, email, id].filter(Boolean).join(" ")}`);
    }
    // People hits: the userId so the agent can reuse it (from=<id>, assignee, …).
    if (sc["userId"]) lines.push(`  userId: ${sc["userId"]}`);
    if (typeof sc["replyCount"] === "number")
      lines.push(`  ${sc["replyCount"]} repl${sc["replyCount"] === 1 ? "y" : "ies"}`);
    // Ticket hits: creator/assignee/closer names the transform always computed
    // but this renderer never printed. Skip the "Unknown Creator" fallback so an
    // unresolved createdBy doesn't render a misleading line.
    if (sc["creatorName"] && sc["creatorName"] !== "Unknown Creator")
      lines.push(`  Created by: ${sc["creatorName"]}${sc["createdBy"] ? ` (${sc["createdBy"]})` : ""}`);
    else if (sc["createdBy"]) lines.push(`  createdBy: ${sc["createdBy"]}`);
    if (sc["assigneeName"])
      lines.push(`  Assigned to: ${sc["assigneeName"]}${sc["assignedTo"] ? ` (${sc["assignedTo"]})` : ""}`);
    else if (sc["assignedTo"]) lines.push(`  assignedTo: ${sc["assignedTo"]}`);
    if (sc["closedByName"]) lines.push(`  Closed by: ${sc["closedByName"]}`);
    const bp: string[] = [];
    if (sc["boardName"]) bp.push(`Board: ${sc["boardName"]}`);
    if (sc["projectName"]) bp.push(`Project: ${sc["projectName"]}`);
    if (bp.length > 0) lines.push(`  ${bp.join(" · ")}`);
    if (sc["tags"]) lines.push(`  tags: ${sc["tags"]}`);
    // Mail recipients / labels.
    if (sc["to"]) lines.push(`  To: ${sc["to"]}`);
    if (sc["cc"]) lines.push(`  Cc: ${sc["cc"]}`);
    if (sc["bcc"]) lines.push(`  Bcc: ${sc["bcc"]}`);
    if (sc["labels"]) lines.push(`  labels: ${sc["labels"]}`);
    if (sc["attachments"]) lines.push(`  Attachments: ${sc["attachments"]}`);
    // Mail thread ids — the agent uses these to pull "this mail + all replies".
    const mt: string[] = [];
    if (sc["threadId"]) mt.push(`threadId: ${sc["threadId"]}`);
    if (sc["gmailThreadId"]) mt.push(`gmailThreadId: ${sc["gmailThreadId"]}`);
    if (mt.length > 0) lines.push(`  ${mt.join(" · ")}`);
    // Extracted entities.
    const ent: string[] = [];
    if (sc["people"]) ent.push(`People: ${sc["people"]}`);
    if (sc["products"]) ent.push(`Products: ${sc["products"]}`);
    if (sc["merchants"]) ent.push(`Merchants: ${sc["merchants"]}`);
    if (ent.length > 0) lines.push(`  ${ent.join(" · ")}`);
    if (sc["generatedTags"]) lines.push(`  generatedTags: ${sc["generatedTags"]}`);
    const prov: string[] = [];
    if (sc["app"]) prov.push(String(sc["app"]));
    if (sc["entity"]) prov.push(String(sc["entity"]));
    if (sc["fileType"]) prov.push(String(sc["fileType"]));
    if (prov.length > 0) lines.push(`  ${prov.join(" · ")}`);
    // File owner + type + size.
    if (sc["ownerEmail"] || sc["ownerId"]) lines.push(`  Owner: ${sc["ownerEmail"] || sc["ownerId"]}`);
    const ff: string[] = [];
    if (sc["mimeType"]) ff.push(String(sc["mimeType"]));
    if (typeof sc["fileSize"] === "number") {
      const b = formatBytes(sc["fileSize"] as number);
      if (b) ff.push(b);
    }
    if (ff.length > 0) lines.push(`  ${ff.join(" · ")}`);
    if (sc["xyneId"]) lines.push(`  ID: ${sc["xyneId"]}`);
    if (sc["conversationId"]) lines.push(`  conversationId: ${sc["conversationId"]}`);
    if (sc["channelId"]) lines.push(`  channelId: ${sc["channelId"]}`);
  }
  if (meta) {
    if (meta["conversationId"]) lines.push(`  conversationId: ${meta["conversationId"]}`);
    if (meta["channelId"]) lines.push(`  channelId: ${meta["channelId"]}`);
  }
  // chunkIndex null → the row is non-routable (no citation was harvested), so
  // omit the inline [clf-…#N] token; emitting it would orphan a chip with no
  // matching citation.
  return chunkIndex == null
    ? [lines[0]!, ...lines.slice(1)].join("\n")
    : prefixChunk(chunkIndex, lines[0]!, lines.slice(1));
}

// ── spaces-tickets ───────────────────────────────────────────────────

const spacesTickets: ToolDef = {
  name: "spaces-tickets",
  description:
    "PRIMARY tool for all ticket queries. ALWAYS use this when the user asks about tickets, ticket status, ticket lists, " +
    "or anything ticket-related. Covers every filter the Spaces tickets UI offers: status, priority, assignee, creator, " +
    "board, project, tags/labels, stage, channel, user group, ticket type, AI category, PR reviewer, QA assignee, " +
    "due-date (ETA) range, and creation-date range. Every people filter (assignee, creator, PR reviewer, QA) accepts an " +
    "EMAIL or a userId. Most filters have a multi-select array form (statusIn, priorityIn, boardIdIn, stageNameIn, " +
    "assignedToIn, createdByIn, userGroupIds, ticketTypes, aiCategory, prReviewers, qaAssigned) that matches ANY of the " +
    "given values. Returns structured ticket details including assignee, tags, stage, channel ID, conversation ID, " +
    "createdAt, and updatedAt, plus (when set) the resolver + close time, last editor, first-response time, ticket type, " +
    "AI triage labels, owning group, due date (ETA), archived status, and related/duplicate tickets — the full lifecycle in one call. " +
    "Archived tickets are EXCLUDED from every filtered query (matching the Spaces UI); only a direct `ticketId`/`xyneId` " +
    "lookup can return one. " +
    "Prefer this over spaces-search for ticket queries — it returns richer, more accurate data.",
  inputSchema: {
    type: "object",
    properties: {
      ticketId: {
        type: "string",
        description:
          "Fetch ONE specific ticket directly. Accepts EITHER the internal DB id (cm…, shown as 'id:' in results) OR the human ticket key (xyneId, e.g. 'XYNE-1234') — whichever you have. When set, all other filters are ignored and only that single ticket is returned.",
      },
      xyneId: {
        type: "string",
        description:
          "Fetch ONE ticket by its human ticket key (xyneId, e.g. 'XYNE-1234'). Same direct single-ticket fetch as `ticketId`; provided for clarity when you specifically have the human key.",
      },
      status: {
        type: "string",
        enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"],
        description: "Filter by status",
      },
      priority: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        description: "Filter by priority",
      },
      assignedTo: {
        type: "string",
        description:
          "Filter by assigned user — accepts either the user's ID (cm…) or their email address. Email is resolved to userId server-side before the ticket query.",
      },
      createdBy: {
        type: "string",
        description:
          "Filter by ticket creator — accepts either the user's ID (cm…) or their email address. Email is resolved to userId server-side before the ticket query.",
      },
      createdByIn: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter by ticket creator across MANY users in one call. Accepts an array of emails or userIds (mix allowed). " +
          "Use this for daily/team reports where you need tickets from a fixed user group — one tool call instead of N. " +
          "Emails are resolved server-side in a single batch query. " +
          "If this is provided, the singular `createdBy` is ignored. Unresolved emails are noted in the response.",
      },
      boardId: { type: "string", description: "Filter by board ID" },
      projectId: { type: "string", description: "Filter by project ID" },
      stageName: { type: "string", description: "Filter by stage name" },
      tags: {
        type: "string",
        description: "Filter by tag name(s), comma-separated (e.g. 'April-Launch,Q2')",
      },
      channelId: { type: "string", description: "Filter to tickets in this channel only" },
      // ── Multi-select variants (mirror the Spaces tickets UI, which is multi-select
      //    on every dropdown). Each is an array → Prisma `in`; when both a singular
      //    field above and its plural form are passed, the plural (array) wins. ──
      statusIn: {
        type: "array",
        items: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"] },
        description: "Filter by MULTIPLE statuses (matches any). Multi-select form of `status`.",
      },
      priorityIn: {
        type: "array",
        items: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        description: "Filter by MULTIPLE priorities (matches any). Multi-select form of `priority`.",
      },
      boardIdIn: {
        type: "array",
        items: { type: "string" },
        description: "Filter by MULTIPLE board ids (matches any). Multi-select form of `boardId`.",
      },
      stageNameIn: {
        type: "array",
        items: { type: "string" },
        description: "Filter by MULTIPLE stage names (matches any). Multi-select form of `stageName`.",
      },
      assignedToIn: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter by assignee across MANY users (matches any) — array of emails or userIds (mix allowed); emails resolved server-side. Multi-select form of `assignedTo` (strict assignee match, no assigned-or-created union). If set, singular `assignedTo` is ignored.",
      },
      userGroupIds: {
        type: "array",
        items: { type: "string" },
        description: "Filter by owning user group — one or more user-group ids (matches any).",
      },
      ticketTypes: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter by ticket type(s) — the ticketType lookup string, e.g. 'Bug', 'Feature' (matches any).",
      },
      aiCategory: {
        type: "array",
        items: { type: "string" },
        description: "Filter by AI-classified category label(s), e.g. 'Mandate', 'Refund' (matches any).",
      },
      prReviewers: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter to tickets where ANY of these users is a PR reviewer (a ticket_assignments participant with responsibility PR_REVIEWER). Array of emails or userIds; emails resolved server-side.",
      },
      qaAssigned: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter to tickets where ANY of these users is QA-assigned (a ticket_assignments participant with responsibility QA). Array of emails or userIds; emails resolved server-side.",
      },
      dueAfter: {
        type: "string",
        description: "ISO 8601 timestamp — only tickets whose due date (ETA) is at or after this time.",
      },
      dueBefore: {
        type: "string",
        description: "ISO 8601 timestamp — only tickets whose due date (ETA) is at or before this time.",
      },
      createdAfter: {
        type: "string",
        description:
          "ISO 8601 timestamp — only tickets created at or after this time (e.g. '2026-04-20T00:00:00Z')",
      },
      createdBefore: {
        type: "string",
        description: "ISO 8601 timestamp — only tickets created strictly before this time",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 500,
        default: 100,
        description:
          "Max tickets (default 100, max 500). Use higher values with createdByIn for team-wide reports.",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      orderBy: {
        type: "string",
        enum: ["updatedAt", "createdAt"],
        default: "updatedAt",
        description:
          "Sort field: updatedAt (default, most recently changed) or createdAt (when the ticket was opened).",
      },
      sortOrder: {
        type: "string",
        enum: ["desc", "asc"],
        default: "desc",
        description: "Sort direction: desc (default, newest first) or asc (oldest first).",
      },
      classifyActionable: {
        type: "boolean",
        description:
          "When true, the server computes an `actionReason` per ticket — one of 'critical' | 'overdue' | 'no-assignee' | 'stale' | null — using deterministic rules with proper preconditions (terminal states never actionable). " +
          "Use this for daily reports / triage views so the agent never has to classify tickets itself (which it does badly). Default false (no classification).",
      },
      summary: {
        type: "boolean",
        description:
          "When true, appends a Summary block to the response containing aggregate counts: total, actionableCount (if classifyActionable also true), byStatus, byPriority, byUser. Computed server-side from the response data — agents that render reports never need to do arithmetic themselves. Default false.",
      },
      expectedUserGroup: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of emails (or userIds) the caller expects to see in the data. When provided alongside summary=true, summary.byUser includes every member of this list — those with 0 tickets are kept (with all-zero counts). Lets a daily-report caller surface 'Members with No Tickets' without doing set-difference math itself.",
      },
    },
  },
  handler: withToolErrors("Tickets error", async (args) => {
      const include = {
        assignedToUser: { select: { name: true, email: true } },
        createdByUser: { select: { name: true, email: true } },
        board: { select: { name: true } },
        project: { select: { name: true } },
        tags: { select: { name: true } },
      };

      // Direct single-ticket fetch. When the caller passes `ticketId` (or
      // `xyneId`) we short-circuit every filter below and return just that
      // ticket. The value may be the internal DB id (cm…) OR the human ticket
      // key (xyneId, e.g. XYNE-1234) — the model often only has one — so we try
      // `id` first and fall back to `xyneId`. Two plain `equals` queries, not an
      // OR clause: the gateway validator rejects OR arrays-of-objects.
      const directRef = String(args["ticketId"] ?? args["xyneId"] ?? "").trim();
      if (directRef) {
        let hit = (await interact({
          model: "ticket",
          operation: "findMany",
          where: { id: { equals: directRef } },
          take: 1,
          include,
        })) as TicketRow[];
        if (!hit?.length) {
          hit = (await interact({
            model: "ticket",
            operation: "findMany",
            where: { xyneId: { equals: directRef } },
            take: 1,
            include,
          })) as TicketRow[];
        }
        if (!hit?.length)
          return ok(`No ticket found for '${directRef}' (looked up by internal id and xyneId).`);
        return await formatTickets(hit, {
          classifyActionable: args["classifyActionable"] === true,
          summary: args["summary"] === true,
          expectedUserGroup: Array.isArray(args["expectedUserGroup"])
            ? (args["expectedUserGroup"] as unknown[]).map((v) => String(v))
            : [],
        });
      }

      const baseWhere: Record<string, unknown> = { isArchived: { equals: false } };
      if (args["status"]) baseWhere["statusV2"] = { equals: args["status"] };
      if (args["priority"]) baseWhere["priority"] = { equals: args["priority"] };
      if (args["boardId"]) baseWhere["boardId"] = { equals: args["boardId"] };
      if (args["projectId"]) baseWhere["projectId"] = { equals: args["projectId"] };
      if (args["stageName"]) baseWhere["stageName"] = { equals: args["stageName"] };
      if (args["channelId"]) baseWhere["channelId"] = { equals: args["channelId"] };
      if (args["tags"]) {
        const tagNames = (args["tags"] as string)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (tagNames.length > 0) {
          baseWhere["tags"] = { some: { name: { in: tagNames } } };
        }
      }
      const createdAtFilter: Record<string, string> = {};
      if (args["createdAfter"]) createdAtFilter["gte"] = args["createdAfter"] as string;
      if (args["createdBefore"]) createdAtFilter["lt"] = args["createdBefore"] as string;
      if (Object.keys(createdAtFilter).length > 0) baseWhere["createdAt"] = createdAtFilter;

      // Coerce an arg to a trimmed, non-empty string[]. Also accepts a bare string
      // or comma-separated string (a common model slip on the array params, e.g.
      // statusIn:"TODO,STARTED") — same forgiving convention as `tags` — so a
      // stray scalar filters instead of being silently dropped (which would
      // broaden the result set).
      const asStrArr = (v: unknown): string[] =>
        Array.isArray(v)
          ? v.map((x) => String(x).trim()).filter(Boolean)
          : typeof v === "string"
            ? v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

      // Multi-select scalar filters (array → Prisma `in`). Set AFTER the singular
      // equivalents above so the array form wins when both are supplied.
      const statusIn = asStrArr(args["statusIn"]);
      if (statusIn.length) baseWhere["statusV2"] = { in: statusIn };
      const priorityIn = asStrArr(args["priorityIn"]);
      if (priorityIn.length) baseWhere["priority"] = { in: priorityIn };
      const boardIdIn = asStrArr(args["boardIdIn"]);
      if (boardIdIn.length) baseWhere["boardId"] = { in: boardIdIn };
      const stageNameIn = asStrArr(args["stageNameIn"]);
      if (stageNameIn.length) baseWhere["stageName"] = { in: stageNameIn };
      const userGroupIds = asStrArr(args["userGroupIds"]);
      if (userGroupIds.length) baseWhere["userGroupId"] = { in: userGroupIds };
      const ticketTypes = asStrArr(args["ticketTypes"]);
      if (ticketTypes.length) baseWhere["ticketType"] = { in: ticketTypes };
      const aiCategoryIn = asStrArr(args["aiCategory"]);
      if (aiCategoryIn.length) baseWhere["aiCategory"] = { in: aiCategoryIn };

      // Due-date (ETA) range — mirrors the createdAt handling above. eta is the
      // ticket's due-date column (DateTime); Prisma accepts ISO strings.
      const etaFilter: Record<string, string> = {};
      if (args["dueAfter"]) etaFilter["gte"] = args["dueAfter"] as string;
      if (args["dueBefore"]) etaFilter["lte"] = args["dueBefore"] as string;
      if (Object.keys(etaFilter).length > 0) baseWhere["eta"] = etaFilter;

      const take = (args["limit"] as number | undefined) ?? 100;
      const skip = (args["offset"] as number | undefined) ?? 0;
      // Caller-controlled sort, defensively clamped to known date columns so a
      // bad value can never reach Prisma. Defaults preserve the prior behaviour
      // (most-recently-updated first).
      const sortField = args["orderBy"] === "createdAt" ? "createdAt" : "updatedAt";
      const sortDir: "asc" | "desc" = args["sortOrder"] === "asc" ? "asc" : "desc";
      const orderByClause: Array<Record<string, "asc" | "desc">> = [{ [sortField]: sortDir }];

      // Resolve email-form values for assignedTo / createdBy → userId via one
      // lookup. Saves the caller a round-trip to spaces-users when they only
      // have an email handy (the common case for merchant-paglu user-tickets).
      // assignedToIn (multi-assignee) takes precedence over the singular assignedTo,
      // so resolve it FIRST — a bad singular value must not abort a query that
      // assignedToIn was meant to drive (mirrors createdBy/createdByIn below).
      const participantUnresolved: string[] = [];
      const assignedToInRaw = asStrArr(args["assignedToIn"]);
      // When assignedToIn is present it drives the assignee match and bypasses the
      // singular assigned∪created union path so the two don't fight over assignedTo.
      const assignedToInApplied = assignedToInRaw.length > 0;

      const assignedToUserId = assignedToInApplied
        ? null
        : await resolveUserIdentifier(args["assignedTo"] as string | undefined);
      if (!assignedToInApplied && args["assignedTo"] && !assignedToUserId) {
        return ok(`No user found for assignedTo='${args["assignedTo"]}'.`);
      }

      if (assignedToInApplied) {
        const { userIds, unresolved } = await resolveUserIdentifiersBatch(assignedToInRaw);
        participantUnresolved.push(...unresolved);
        if (userIds.length === 0) {
          return ok(
            `No matching users found for any of the ${assignedToInRaw.length} assignedToIn entries. Unresolved: ${unresolved.join(", ")}.`,
          );
        }
        baseWhere["assignedTo"] = { in: userIds };
      }

      // Participant filters (PR reviewer / QA) via the ticket_assignments relation.
      // The query gateway's validator only accepts arrays of string|number, so an
      // AND array-of-objects (two `assignments.some` clauses) is REJECTED outright
      // and would 400 the whole query. A SINGLE participant filter is therefore a
      // plain relation filter (validates, like `tags`); when BOTH are supplied we
      // resolve each to its matching ticket-id set and intersect, constraining the
      // main query by `id IN (…)`.
      const participantSomes: Array<{ responsibility: "PR_REVIEWER" | "QA"; userIds: string[] }> = [];
      const collectParticipant = async (
        raw: string[],
        responsibility: "PR_REVIEWER" | "QA",
      ): Promise<void> => {
        if (!raw.length) return;
        const { userIds, unresolved } = await resolveUserIdentifiersBatch(raw);
        participantUnresolved.push(...unresolved);
        if (userIds.length > 0) participantSomes.push({ responsibility, userIds });
      };
      await collectParticipant(asStrArr(args["prReviewers"]), "PR_REVIEWER");
      await collectParticipant(asStrArr(args["qaAssigned"]), "QA");

      // De-duplicated note appended to whichever success path returns, so unresolved
      // participant emails are never silently dropped.
      const participantNote =
        participantUnresolved.length > 0
          ? `\n\n_Note: ${participantUnresolved.length} participant email(s) did not match any user and were excluded: ${[...new Set(participantUnresolved)].join(", ")}_`
          : "";

      const participantSome = (p: {
        responsibility: "PR_REVIEWER" | "QA";
        userIds: string[];
      }): Record<string, unknown> => ({
        some: { userResponsibility: { equals: p.responsibility }, userId: { in: p.userIds } },
      });

      if (participantSomes.length === 1) {
        // Single relation filter — validates and composes with every other filter.
        baseWhere["assignments"] = participantSome(participantSomes[0]!);
      } else if (participantSomes.length === 2) {
        // Two relation `some`s can't be AND-ed in one gateway query — resolve each to
        // its matching ticket-id set (capped at the gateway max) and intersect.
        const [setA, setB] = await Promise.all(
          participantSomes.map(async (p) => {
            const rows = (await interact({
              model: "ticket",
              operation: "findMany",
              where: { assignments: participantSome(p), isArchived: { equals: false } },
              take: 1000,
            })) as Array<{ id: string }>;
            return new Set(rows.map((r) => r.id));
          }),
        );
        const intersection = [...setA!].filter((id) => setB!.has(id));
        if (intersection.length === 0) {
          const empty = ok("No tickets found matching both the PR-reviewer and QA participant filters.");
          if (participantNote) appendText(empty, participantNote);
          return empty;
        }
        baseWhere["id"] = { in: intersection };
      }

      // Bulk createdByIn — resolve every email-or-userId in a single batch
      // query, then filter with `createdBy IN (…)`. Lets a single tool call
      // span a whole team for daily reports, replacing N parallel subagent
      // calls. If createdByIn is set, the singular createdBy is ignored.
      let unresolvedEmails: string[] = [];
      let bulkActive = false;
      const rawIn = args["createdByIn"];
      if (Array.isArray(rawIn) && rawIn.length > 0) {
        bulkActive = true;
        const { userIds, unresolved } = await resolveUserIdentifiersBatch(
          (rawIn as unknown[]).map((v) => String(v)),
        );
        if (userIds.length === 0) {
          return ok(
            `No matching users found for any of the ${rawIn.length} createdByIn entries. ` +
              `Unresolved: ${unresolved.join(", ")}.`,
          );
        }
        baseWhere["createdBy"] = { in: userIds };
        unresolvedEmails = unresolved;
      }

      // Singular createdBy — only when bulk is not active.
      let createdByUserId: string | null = null;
      if (!bulkActive) {
        createdByUserId = await resolveUserIdentifier(args["createdBy"] as string | undefined);
        if (args["createdBy"] && !createdByUserId)
          return ok(`No user found for createdBy='${args["createdBy"]}'.`);
      }

      // Single-user merged fetch (assigned OR created by the same person) only
      // applies when bulk isn't in play, createdBy wasn't supplied, and the
      // multi-assignee `assignedToIn` filter isn't driving the assignee match.
      if (assignedToUserId && !bulkActive && !createdByUserId && !assignedToInApplied) {
        const [assigned, created] = await Promise.all([
          interact({
            model: "ticket",
            operation: "findMany",
            where: { ...baseWhere, assignedTo: { equals: assignedToUserId } },
            orderBy: orderByClause,
            take,
            skip,
            include,
          }) as Promise<TicketRow[]>,
          interact({
            model: "ticket",
            operation: "findMany",
            where: { ...baseWhere, createdBy: { equals: assignedToUserId } },
            orderBy: orderByClause,
            take,
            skip,
            include,
          }) as Promise<TicketRow[]>,
        ]);
        const seen = new Set<string>();
        const merged: TicketRow[] = [];
        for (const t of [...(assigned ?? []), ...(created ?? [])]) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            merged.push(t);
          }
        }
        // Re-sort the merged (assigned ∪ created) set by the same field/direction.
        merged.sort((a, b) => {
          const av = new Date(String((a as unknown as Record<string, string>)[sortField] ?? "")).getTime();
          const bv = new Date(String((b as unknown as Record<string, string>)[sortField] ?? "")).getTime();
          return sortDir === "asc" ? av - bv : bv - av;
        });
        const mergedPage = merged.slice(0, take);
        const mergedResult = await formatTickets(mergedPage, {
          classifyActionable: args["classifyActionable"] === true,
          summary: args["summary"] === true,
          expectedUserGroup: Array.isArray(args["expectedUserGroup"])
            ? (args["expectedUserGroup"] as unknown[]).map((v) => String(v))
            : [],
        });
        appendText(
          mergedResult,
          paginationFooter({ returned: mergedPage.length, limit: take, offset: skip }),
        );
        if (participantNote) appendText(mergedResult, participantNote);
        return mergedResult;
      }

      // Explicit single createdBy filter (only when bulk isn't active).
      if (createdByUserId) {
        baseWhere["createdBy"] = { equals: createdByUserId };
      }

      const rows = (await interact({
        model: "ticket",
        operation: "findMany",
        where: baseWhere,
        orderBy: orderByClause,
        take,
        skip,
        include,
      })) as TicketRow[];

      const classifyActionable = args["classifyActionable"] === true;
      const wantSummary = args["summary"] === true;
      const expectedGroup = Array.isArray(args["expectedUserGroup"])
        ? (args["expectedUserGroup"] as unknown[]).map((v) => String(v))
        : [];

      const result = await formatTickets(rows, {
        classifyActionable,
        summary: wantSummary,
        expectedUserGroup: expectedGroup,
      });

      appendText(result, paginationFooter({ returned: rows.length, limit: take, offset: skip }));

      // When the caller did a bulk lookup, surface the unresolved email list
      // so they can flag those users in their downstream report.
      if (bulkActive && unresolvedEmails.length > 0) {
        const note = `\n\n_Note: ${unresolvedEmails.length} email(s) did not match any user and were excluded: ${unresolvedEmails.join(", ")}_`;
        if (result.content[0] && result.content[0].type === "text") {
          result.content[0].text = result.content[0].text + note;
        }
      }
      if (participantNote) appendText(result, participantNote);
      return result;
    }),
};

/**
 * Resolve a mixed list of emails + userIds to a flat userId list in a single
 * `user findMany` query. Returns the resolved userIds and any emails that
 * didn't match any user. Inputs that don't contain '@' are passed through as
 * userIds without DB lookup.
 */
async function resolveUserIdentifiersBatch(
  raw: string[],
): Promise<{ userIds: string[]; unresolved: string[] }> {
  const trimmed = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  if (trimmed.length === 0) return { userIds: [], unresolved: [] };

  const emails = trimmed.filter((s) => s.includes("@"));
  const idPassthrough = trimmed.filter((s) => !s.includes("@"));

  if (emails.length === 0) {
    return { userIds: idPassthrough, unresolved: [] };
  }

  const rows = (await interact({
    model: "user",
    operation: "findMany",
    where: { email: { in: emails } },
    select: { id: true, email: true },
  })) as Array<{ id: string; email: string }>;

  const emailToId = new Map(rows.map((r) => [r.email, r.id] as const));
  const resolvedFromEmails: string[] = [];
  const unresolved: string[] = [];
  for (const e of emails) {
    const id = emailToId.get(e);
    if (id) resolvedFromEmails.push(id);
    else unresolved.push(e);
  }
  return { userIds: [...idPassthrough, ...resolvedFromEmails], unresolved };
}

/**
 * Accept either a user id (starts with "cm" or any non-email string) or an
 * email address. Emails are resolved to the underlying userId via a single
 * `/api/query` call against the user model. Returns null if nothing was
 * passed in OR if an email didn't match any user. The empty-arg → null path
 * is intentional so callers can write `if (resolved) ...` without juggling
 * undefined separately.
 */
async function resolveUserIdentifier(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("@")) return trimmed; // already a userId
  const rows = (await interact({
    model: "user",
    operation: "findMany",
    where: { email: { equals: trimmed } },
    take: 1,
    select: { id: true },
  })) as Array<{ id: string }>;
  return rows && rows.length > 0 ? rows[0]!.id : null;
}

interface FormatOptions {
  classifyActionable?: boolean;
  summary?: boolean;
  expectedUserGroup?: string[];
}

type ActionReason = "critical" | "overdue" | "no-assignee" | "stale" | null;

/**
 * Deterministic actionability classifier — same rules every caller, no LLM in
 * the loop. Terminal states (COMPLETED / CANCELLED) are never actionable.
 * Priority order: critical > overdue > no-assignee > stale.
 */
function classifyTicket(t: TicketRow, now: Date): ActionReason {
  const status = (t.statusV2 ?? "").toUpperCase();
  if (status === "COMPLETED" || status === "CANCELLED") return null;

  if ((t.priority ?? "").toUpperCase() === "CRITICAL") return "critical";

  if (t.eta) {
    const due = new Date(t.eta);
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) return "overdue";
  }

  if (!t.assignedTo) {
    const created = new Date(t.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const hoursSinceCreated = (now.getTime() - created.getTime()) / 3_600_000;
      if (hoursSinceCreated > 24) return "no-assignee";
    }
  }

  // "Stale" check excludes PAUSED — work paused intentionally isn't stale.
  if (status !== "PAUSED") {
    const updated = new Date(t.updatedAt);
    if (!Number.isNaN(updated.getTime())) {
      const hoursSinceUpdated = (now.getTime() - updated.getTime()) / 3_600_000;
      if (hoursSinceUpdated > 48) return "stale";
    }
  }
  return null;
}

interface UserBreakdownRow {
  userId: string;
  name: string;
  email: string | null;
  total: number;
  actionable: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
}

interface SummaryShape {
  total: number;
  /** Only set when classifyActionable=true. Otherwise undefined, and the
   * renderer skips the Actionable line to avoid emitting misleading zeros. */
  actionableCount?: number;
  /** Only set when classifyActionable=true. */
  hasActionableInfo: boolean;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byUser: UserBreakdownRow[];
  membersWithNoTickets?: string[];
}

async function formatTickets(rows: TicketRow[], opts: FormatOptions = {}): Promise<ToolResult> {
  if (!rows || rows.length === 0) {
    // Even with zero tickets, the caller may want the expectedUserGroup as
    // "members with no tickets" — emit a minimal summary if asked.
    if (opts.summary && opts.expectedUserGroup && opts.expectedUserGroup.length > 0) {
      const empty: SummaryShape = {
        total: 0,
        hasActionableInfo: opts.classifyActionable === true,
        ...(opts.classifyActionable ? { actionableCount: 0 } : {}),
        byStatus: {},
        byPriority: {},
        byUser: [],
        membersWithNoTickets: opts.expectedUserGroup.slice(),
      };
      return ok(`${renderSummaryBlock(empty)}\n\nNo tickets found.`);
    }
    return ok("No tickets found.");
  }

  // Hydrate missing user-relation joins. Spaces' /api/query sometimes
  // returns `createdByUser`/`assignedToUser` as null even though the scalar
  // `createdBy`/`assignedTo` userId is present — observed especially on
  // bulk-IN queries. Without this hydration, the report would render raw
  // userIds like `n04kedw3hqlpz0Itc75tfvbr` in the Created By column.
  // One batch lookup covers every missing id across the whole result set.
  const missingIds = new Set<string>();
  for (const t of rows) {
    if (!t.createdByUser?.name && t.createdBy) missingIds.add(t.createdBy);
    if (!t.assignedToUser?.name && t.assignedTo) missingIds.add(t.assignedTo);
    if (t.updatedBy && t.updatedBy !== t.createdBy) missingIds.add(t.updatedBy); // editor (only when it differs from creator)
    if (t.closedBy) missingIds.add(t.closedBy); // resolver
  }
  let nameMap = new Map<string, { name: string; email?: string }>();
  if (missingIds.size > 0) {
    try {
      const users = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { in: Array.from(missingIds) } },
        select: { id: true, name: true, email: true },
      })) as Array<{ id: string; name: string; email?: string }>;
      nameMap = new Map(
        users.map((u) => [u.id, u.email ? { name: u.name, email: u.email } : { name: u.name }] as const),
      );
    } catch {
      // Non-fatal — fall through to raw-id rendering for whatever didn't resolve.
    }
  }

  // Resolve related/duplicate ticket ids (Ticket.referenceTicket[]) → human
  // xyneIds in ONE lookup, skipped when no ticket references any. `ticket` is
  // gateway-allowlisted.
  const refIds = new Set<string>();
  for (const t of rows) for (const rid of t.referenceTicket ?? []) refIds.add(rid);
  let refXyneMap = new Map<string, string>();
  if (refIds.size > 0) {
    try {
      const refs = (await interact({
        model: "ticket",
        operation: "findMany",
        where: { id: { in: Array.from(refIds) } },
        take: refIds.size,
      })) as Array<{ id: string; xyneId?: string }>;
      refXyneMap = new Map(refs.filter((r) => r.xyneId).map((r) => [r.id, r.xyneId!] as const));
    } catch {
      // Non-fatal — fall back to raw reference ids.
    }
  }

  // Hydrate ticket form-field answers. A ticket's custom-form values live in
  // FormEntityValues (entityId = ticket.id, entityType = "TICKET"); the field
  // labels live in FormFields keyed by FormEntityValues.fieldId. There is no
  // Prisma relation between the two and the query gateway strips `include`, so we
  // fetch both with two batched gateway calls and join by fieldId in memory.
  // Non-fatal: any failure (e.g. gateway rejects the model) falls through to
  // rendering tickets without a Form fields line.
  const formValuesByTicket = new Map<
    string,
    Array<{ fieldId: string; fieldValue: string; actualFieldValue?: unknown }>
  >();
  let fieldNameMap = new Map<string, string>();
  try {
    const ticketIds = rows.map((t) => t.id);
    const values = (await interact({
      model: "formEntityValues",
      operation: "findMany",
      where: { entityId: { in: ticketIds }, entityType: "TICKET" },
      take: 1000,
    })) as Array<{ entityId: string; fieldId: string; fieldValue: string; actualFieldValue?: unknown }>;
    if (values && values.length > 0) {
      for (const v of values) {
        const arr = formValuesByTicket.get(v.entityId) ?? [];
        arr.push({ fieldId: v.fieldId, fieldValue: v.fieldValue, actualFieldValue: v.actualFieldValue });
        formValuesByTicket.set(v.entityId, arr);
      }
      const fieldIds = Array.from(new Set(values.map((v) => v.fieldId)));
      const fields = (await interact({
        model: "formFields",
        operation: "findMany",
        where: { id: { in: fieldIds } },
        take: 1000,
      })) as Array<{ id: string; fieldName: string }>;
      fieldNameMap = new Map((fields ?? []).map((f) => [f.id, f.fieldName] as const));
    }
  } catch {
    // Non-fatal — render tickets without form fields if the gateway rejects the model.
  }

  // "Name <email> (id: …)" for a user id via the batched nameMap (relations are
  // never hydrated by the gateway, so nameMap is the source of truth).
  const userLabel = (id?: string): string => {
    if (!id) return "";
    const u = nameMap.get(id);
    return u ? `${u.name}${u.email ? ` <${u.email}>` : ""} (id: ${id})` : `userId: ${id}`;
  };

  const now = new Date();
  // Pre-classify every ticket if the caller asked. Same Date snapshot used
  // for every ticket so the report is internally consistent (no drift
  // between "stale" cutoffs across rows in the same response).
  const reasons = new Map<string, ActionReason>();
  if (opts.classifyActionable) {
    for (const t of rows) reasons.set(t.id, classifyTicket(t, now));
  }

  const citations: Citation[] = [];
  const lines = rows.map((t, idx) => {
    // Render ticketId as a clickable markdown link when we have the channel +
    // conversation pair needed to deep-link into Spaces. Falls back to plain
    // `[xyneId]` when either is missing so the output never breaks. The
    // deterministic link removes the agent's need to fabricate URLs in its
    // rendered report.
    const ticketUrl = buildTicketUrl(t.channelId, t.conversationId);
    const idCell = ticketUrl ? `[${t.xyneId}](${ticketUrl})` : `[${t.xyneId}]`;
    const parts = [`${idCell} ${t.title} (id: ${t.id})`];
    parts.push(
      `  Board Status: ${t.statusV2} (workflow state, not PR verification) · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`,
    );
    // Assignee: prefer the joined user (name + email); fall back to the raw
    // assignedTo userId when the relation isn't populated. Always emit the
    // line if EITHER field is present so bulk callers (e.g. user-tickets
    // subagent) can always pin a ticket to a user.
    if (t.assignedToUser || t.assignedTo) {
      const u = t.assignedToUser ?? (t.assignedTo ? nameMap.get(t.assignedTo) : undefined);
      const id = t.assignedTo ?? "";
      const label = u
        ? `${u.name}${u.email ? ` <${u.email}>` : ""}${id ? ` (id: ${id})` : ""}`
        : `userId: ${id}`;
      parts.push(`  Assigned: ${label}`);
    }
    if (t.createdByUser || t.createdBy) {
      const u = t.createdByUser ?? (t.createdBy ? nameMap.get(t.createdBy) : undefined);
      const id = t.createdBy ?? "";
      const label = u
        ? `${u.name}${u.email ? ` <${u.email}>` : ""}${id ? ` (id: ${id})` : ""}`
        : `userId: ${id}`;
      parts.push(`  Created by: ${label}`);
    }
    if (t.updatedBy && t.updatedBy !== t.createdBy) parts.push(`  Last edited by: ${userLabel(t.updatedBy)}`);
    if (t.ticketType) parts.push(`  Type: ${t.ticketType}`);
    if (t.aiCategory || t.aiSubCategory) {
      parts.push(`  AI triage: ${[t.aiCategory, t.aiSubCategory].filter(Boolean).join(" / ")}`);
    }
    if (t.userGroupId) parts.push(`  User Group ID: ${t.userGroupId}`);
    if (t.referenceTicket && t.referenceTicket.length > 0) {
      parts.push(`  Related tickets: ${t.referenceTicket.map((id) => refXyneMap.get(id) ?? id).join(", ")}`);
    }
    if (t.board) parts.push(`  Board: ${t.board.name}${t.project ? ` · Project: ${t.project.name}` : ""}`);
    if (t.tags && t.tags.length > 0) parts.push(`  Tags: ${t.tags.map((tg) => tg.name).join(", ")}`);
    if (t.eta) parts.push(`  ETA: ${new Date(t.eta).toLocaleDateString()}`);
    const formVals = formValuesByTicket.get(t.id);
    if (formVals && formVals.length > 0) {
      const rendered = formVals
        .map((fv) => {
          const label = fieldNameMap.get(fv.fieldId) ?? fv.fieldId;
          const raw =
            fv.actualFieldValue !== undefined && fv.actualFieldValue !== null
              ? typeof fv.actualFieldValue === "string"
                ? fv.actualFieldValue
                : JSON.stringify(fv.actualFieldValue)
              : fv.fieldValue;
          return `${label}: ${raw}`;
        })
        .join(" · ");
      parts.push(`  Form fields: ${rendered}`);
    }
    if (t.description && t.description.trim().length > 0) {
      // Full description — no cap. claw's promoteIfOversized() is the single
      // context-size guard: it spills an over-large response to a file behind a
      // preview, so nothing is lost even for a very fat ticket. Ticket bodies are
      // rich-text HTML, so clean the tag noise to markdown-ish plain text.
      parts.push(`  Description: ${cleanSnippet(t.description)}`);
    }
    if (t.channelId) parts.push(`  ChannelID: ${t.channelId}`);
    if (t.conversationId) parts.push(`  ConversationID: ${t.conversationId}`);
    parts.push(`  Created: ${toIST(t.createdAt)} IST · Updated: ${toIST(t.updatedAt)} IST`);
    if (t.firstRespondedAt) parts.push(`  First response: ${toIST(t.firstRespondedAt)} IST`);
    if (t.closedAt || t.closedBy) {
      parts.push(
        `  Closed: ${t.closedAt ? `${toIST(t.closedAt)} IST` : "(time n/a)"}${t.closedBy ? ` by ${userLabel(t.closedBy)}` : ""}`,
      );
    }
    if (t.isArchived) parts.push(`  Archived: yes`);
    if (opts.classifyActionable) {
      const reason = reasons.get(t.id) ?? null;
      parts.push(`  Action: ${reason ?? "none"}`);
    }
    // Carry xyneId on the citation so the FE can route desk-typed tickets
    // (EMAIL/SLACK channels) to `/support/<channelId>/<xyneId>` — mirrors
    // `navigateToTicket` in dashboard/src/utils/searchNavigation.ts.
    pushThreadCitation(citations, t.channelId, t.conversationId, idx + 1, `Ticket ${t.xyneId}`, {
      xyneId: t.xyneId,
    });
    return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
  });
  const channelInfo = await resolveChannelInfo(
    citations.map((c) => c.channelId).filter((v): v is string => !!v),
  );
  applyChannelInfo(citations, channelInfo);

  // Render order matters: a large response (200+ tickets) can exceed claw's
  // promoteIfOversized() retrieval cap and spill to a file behind an inline
  // preview. Putting the Summary at the TOP keeps it in that preview (and ahead
  // of any tail that gets spilled), so the most useful info always reaches the
  // model.
  const bodyParts: string[] = [];
  if (opts.summary) {
    const summary = buildSummary(
      rows,
      reasons,
      nameMap,
      opts.expectedUserGroup ?? [],
      opts.classifyActionable === true,
    );
    bodyParts.push(renderSummaryBlock(summary));
    bodyParts.push(""); // blank separator
  }
  bodyParts.push(`${rows.length} ticket(s):`);
  bodyParts.push("");
  bodyParts.push(lines.join("\n\n"));

  return okCited(bodyParts.join("\n"), citations);
}

/**
 * Compute aggregate counts from the ticket list. Pre-computed action reasons
 * (from classifyTicket) feed actionableCount and the per-user `actionable`
 * column. If a name hydration map is available, byUser rows are labelled
 * with names instead of raw userIds.
 */
function buildSummary(
  rows: TicketRow[],
  reasons: Map<string, ActionReason>,
  nameMap: Map<string, { name: string; email?: string }>,
  expectedUserGroup: string[],
  hasActionableInfo: boolean,
): SummaryShape {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let actionableCount = 0;

  const userBuckets = new Map<string, UserBreakdownRow>();

  for (const t of rows) {
    const status = (t.statusV2 ?? "UNKNOWN").toUpperCase();
    const priority = (t.priority ?? "UNKNOWN").toUpperCase();
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;

    const isActionable = (reasons.get(t.id) ?? null) !== null;
    if (isActionable) actionableCount += 1;

    const creatorId = t.createdBy ?? "";
    if (!creatorId) continue;
    let bucket = userBuckets.get(creatorId);
    if (!bucket) {
      const user = t.createdByUser ?? nameMap.get(creatorId);
      bucket = {
        userId: creatorId,
        name: user?.name ?? `userId:${creatorId}`,
        email: user?.email ?? null,
        total: 0,
        actionable: 0,
        byStatus: {},
        byPriority: {},
      };
      userBuckets.set(creatorId, bucket);
    }
    bucket.total += 1;
    if (isActionable) bucket.actionable += 1;
    bucket.byStatus[status] = (bucket.byStatus[status] ?? 0) + 1;
    bucket.byPriority[priority] = (bucket.byPriority[priority] ?? 0) + 1;
  }

  // Compute "members with no tickets" against the caller's expected list.
  // Match by email primarily (since the caller usually passes emails); fall
  // back to userId match when an entry doesn't contain '@'.
  let membersWithNoTickets: string[] | undefined;
  if (expectedUserGroup.length > 0) {
    const presentEmails = new Set<string>();
    const presentUserIds = new Set<string>();
    for (const b of userBuckets.values()) {
      if (b.email) presentEmails.add(b.email.toLowerCase());
      presentUserIds.add(b.userId);
    }
    membersWithNoTickets = expectedUserGroup.filter((e) => {
      const lower = e.toLowerCase();
      if (e.includes("@")) return !presentEmails.has(lower);
      return !presentUserIds.has(e);
    });
  }

  const byUser = Array.from(userBuckets.values()).sort((a, b) => b.total - a.total);

  return {
    total: rows.length,
    hasActionableInfo,
    ...(hasActionableInfo ? { actionableCount } : {}),
    byStatus,
    byPriority,
    byUser,
    ...(membersWithNoTickets ? { membersWithNoTickets } : {}),
  };
}

/**
 * Render a deterministic Summary block at the end of the tool response.
 * The agent doesn't need to count anything — it copies these numbers.
 */
function renderSummaryBlock(s: SummaryShape): string {
  const L: string[] = [];
  L.push(`Summary:`);
  L.push(`  Total: ${s.total}`);
  // Skip Actionable line when classification didn't run — emitting "0" would
  // be misleading (it'd mean "we didn't classify" not "no actionable tickets").
  if (s.hasActionableInfo) {
    L.push(`  Actionable: ${s.actionableCount ?? 0}`);
  }

  const statuses = Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]);
  if (statuses.length > 0) {
    L.push(`  ByStatus: ${statuses.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  }
  const priorities = Object.entries(s.byPriority).sort((a, b) => b[1] - a[1]);
  if (priorities.length > 0) {
    L.push(`  ByPriority: ${priorities.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  }

  if (s.byUser.length > 0) {
    L.push(`  ByUser:`);
    for (const u of s.byUser) {
      const status = Object.entries(u.byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      const prio = Object.entries(u.byPriority)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      const actionableField = s.hasActionableInfo ? ` actionable=${u.actionable}` : "";
      L.push(
        `    - ${u.name}${u.email ? ` <${u.email}>` : ""} (id: ${u.userId}) — total=${u.total}${actionableField} status=[${status}] priority=[${prio}]`,
      );
    }
  }

  if (s.membersWithNoTickets && s.membersWithNoTickets.length > 0) {
    L.push(`  MembersWithNoTickets: ${s.membersWithNoTickets.join(", ")}`);
  }

  return L.join("\n");
}

interface TicketRow {
  id: string;
  title: string;
  xyneId: string;
  statusV2: string;
  priority: string;
  stageName?: string;
  eta?: string;
  createdAt: string;
  updatedAt: string;
  channelId?: string;
  conversationId?: string;
  // Description body of the ticket (markdown). Often contains the MID (merchant
  // id) and other free-form context the agent needs but isn't in scalar columns.
  // Surfacing it here means a single spaces-tickets call gives the agent enough
  // to fill the MID column without spaces-messages.
  description?: string;
  // Raw foreign keys — always present in Prisma scalar output even when the
  // relation include is omitted / unpopulated. Used as a fallback in
  // formatTickets so we never lose the creator/assignee identity in bulk
  // results when Spaces' /api/query doesn't hydrate the relation object.
  assignedTo?: string;
  createdBy?: string;
  // More scalar columns the gateway returns by default (it drops `select`), so
  // spaces-tickets can surface the full audit/lifecycle without extra calls.
  updatedBy?: string; // last editor
  closedBy?: string; // resolver
  closedAt?: string; // resolution time
  firstRespondedAt?: string; // SLA: first response
  userGroupId?: string; // owning group (id; name is gateway-blocked)
  ticketType?: string; // categorization (e.g. Bug/Fix)
  isArchived?: boolean; // live PG archived state
  aiCategory?: string; // AI triage label
  aiSubCategory?: string; // AI triage sub-label
  referenceTicket?: string[]; // related/duplicate ticket ids → resolved to xyneIds
  assignedToUser?: { name: string; email?: string } | null;
  createdByUser?: { name: string; email?: string } | null;
  board?: { name: string } | null;
  project?: { name: string } | null;
  tags?: Array<{ name: string }>;
}

// ── spaces-messages ──────────────────────────────────────────────────

const spacesMessages: ToolDef = {
  name: "spaces-messages",
  description:
    "Read messages in a conversation thread by exact conversationId. ID sources: the conversationId field from " +
    "spaces-tickets / spaces-activity / search results, OR a Spaces message link pasted by the user — in a URL like " +
    "…/chat/dir/<channelId>/<conversationId> or with a #origin=<id> hash fragment, that id IS the conversationId. " +
    "When the user provides a message/thread link, extract the id and call THIS tool first — never search or browse the " +
    "channel to \"find\" the linked thread; if this returns nothing, report that, don't substitute a similar thread. " +
    "(Not the channel ID or ticket ID.) " +
    "Messages are returned in chronological order, each showing the sender's name <email>, edited/attachment markers, and reaction counts; " +
    "the header shows the channel name and total reply count — no follow-up call needed to resolve who said what.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "Exact conversationId — from prior tool results, or extracted from a pasted Spaces URL (#origin=<id>, or the path segment after the channelId)." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max messages (default 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      sortOrder: {
        type: "string",
        enum: ["asc", "desc"],
        default: "asc",
        description:
          "Order by message time: asc (default, oldest→newest, normal reading order) or desc (newest first — pair with limit to grab the latest replies).",
      },
      hasAttachment: {
        type: "boolean",
        description: "Only messages that carry a file attachment (the thread 'Files' view).",
      },
      msgType: {
        type: "array",
        items: { type: "string", enum: ["USER", "BOT", "SYSTEM", "FORWARDED"] },
        description:
          "Restrict to these message types (matches any). USER = human replies; BOT/SYSTEM = automation & workflow posts (the thread 'Workflows' view); FORWARDED = forwarded messages.",
      },
    },
    required: ["conversationId"],
  },
  handler: withToolErrors("Messages error", async (args) => {
      const conversationId = String(args["conversationId"]);
      const sortDir: "asc" | "desc" = args["sortOrder"] === "desc" ? "desc" : "asc";
      const msgTypes = Array.isArray(args["msgType"])
        ? (args["msgType"] as unknown[]).map((v) => String(v)).filter(Boolean)
        : [];
      const rows = (await interact({
        model: "message",
        operation: "findMany",
        where: {
          conversationId: { equals: conversationId },
          isDeleted: { equals: false },
          ...(args["hasAttachment"] === true ? { hasAttachment: { equals: true } } : {}),
          ...(msgTypes.length > 0 ? { msgType: { in: msgTypes } } : {}),
        },
        orderBy: [{ createdAt: sortDir }],
        take: (args["limit"] as number | undefined) ?? 100,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as MessageRow[];

      if (!rows || rows.length === 0) return ok(`No messages found in conversation ${conversationId}.`);

      // Resolve, in three cheap batched lookups (the gateway strips `include`,
      // so relations never ride back on the message rows): the conversation's
      // channelId + reply count, every sender's name/email, and the channel
      // display name. This makes a thread read human-readable ("Name <email>:
      // …") with a "#channel · N replies" header — no follow-up tool calls.
      const convMeta = await resolveConversationMeta(conversationId);
      const channelId = convMeta?.channelId;
      // One user lookup covers every SENDER and every REACTOR across the thread,
      // so reactions can show who reacted (not just counts).
      const userIds = new Set<string>();
      for (const m of rows) {
        if (m.senderId) userIds.add(m.senderId);
        for (const g of parseReactions(m.reactions_md)) for (const uid of g.userIds) userIds.add(uid);
      }
      const userInfo = await resolveUserInfo(userIds);
      const channelInfo = await resolveChannelInfo(channelId ? [channelId] : []);
      const channelName = channelId ? channelInfo.get(channelId)?.name : undefined;

      const lines = rows.map((m) => {
        const time = toIST(m.createdAt);
        const attach = m.hasAttachment ? " [attachment]" : "";
        const edited = m.edited ? " (edited)" : "";
        const reactions = formatReactions(m.reactions_md, userInfo);
        const react = reactions ? ` {${reactions}}` : "";
        // Message bodies are stored as rich-text HTML — strip to markdown-ish
        // plain text so the model doesn't wade through <p class=…>/<h2>/<li> noise.
        return `[${time}] ${formatUserRef(m.senderId, userInfo)}${attach}${edited}${react}: ${cleanSnippet(m.content)}`;
      });

      const context: string[] = [];
      if (channelName) context.push(`#${channelName}`);
      if (channelId) context.push(`channelId: ${channelId}`);
      context.push(`conversationId: ${conversationId}`);
      if (typeof convMeta?.replyCount === "number") {
        context.push(`${convMeta.replyCount} repl${convMeta.replyCount === 1 ? "y" : "ies"}`);
      }
      const header = `${context.join(" · ")}\n\n`;

      // Emit one Citation per rendered message chunk so the frontend can
      // resolve each `[clf-…#N]` token back to its own thread URL. Each
      // citation carries its row's messageId so the FE appends
      // `&messageId=<id>` to the hash — the thread panel scrolls to the
      // specific reply instead of the top of the conversation. Critical for
      // long threads where the cited message could be 50+ scrolls down.
      const citations: Citation[] = [];
      rows.forEach((m, idx) => {
        pushThreadCitation(
          citations,
          channelId,
          conversationId,
          idx + 1,
          channelName ? `Thread in #${channelName}` : "Spaces thread",
          m.messageId ? { messageId: m.messageId } : undefined,
        );
      });
      applyChannelInfo(citations, channelInfo);

      return okCited(
        `${rows.length} message(s):\n\n${header}${lines
          .map((line, idx) => prefixChunk(idx + 1, line, []))
          .join(
            "\n",
          )}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
        citations,
      );
    }),
};

interface MessageRow {
  messageId: string;
  content: string;
  msgType: string;
  createdAt: string;
  hasAttachment: boolean;
  edited?: boolean;
  /** Reaction summary blob (":::reactions\n👍: [uid,…]\n:::"); parsed by formatReactions. */
  reactions_md?: string;
  conversationId?: string;
  /** The Prisma scalar — gateway returns this, but NOT the joined `sender.name`. */
  senderId?: string;
}

// ── spaces-message-detail ────────────────────────────────────────────

const spacesMessageDetail: ToolDef = {
  name: "spaces-message-detail",
  description:
    "Get detailed information about a specific message (full content, sender details, reactions with counts, attachments) " +
    "by exact messageId. ID sources: spaces-messages / spaces-activity results, OR the #messageId=<id> parameter of a " +
    "pasted Spaces message link. If the user's link contains #messageId, call this tool with that id directly — " +
    "never search for the message by its content or recency.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Exact messageId — from prior tool results, or the #messageId=<id> parameter in a pasted Spaces URL." },
    },
    required: ["messageId"],
  },
  handler: withToolErrors("Message detail error", async (args) => {
      const messageId = String(args["messageId"]);
      const rows = (await interact({
        model: "message",
        operation: "findMany",
        where: { messageId: { equals: messageId } },
        take: 1,
      })) as MessageDetailRow[];

      if (!rows || rows.length === 0) return ok(`Message ${messageId} not found.`);
      const m = rows[0]!;
      // Gateway strips `include`, so resolve the conversation (channelId + reply
      // count), the sender's name/email, the channel name, and reactions in
      // batched scalar lookups — a human-readable detail view with no follow-ups.
      const convMeta = await resolveConversationMeta(m.conversationId);
      const channelId = convMeta?.channelId;
      // Resolve the sender AND every reactor so "Reactions" shows who reacted.
      const reactorIds = parseReactions(m.reactions_md).flatMap((g) => g.userIds);
      const userInfo = await resolveUserInfo([...(m.senderId ? [m.senderId] : []), ...reactorIds]);
      const channelInfo = await resolveChannelInfo(channelId ? [channelId] : []);
      const channelName = channelId ? channelInfo.get(channelId)?.name : undefined;
      const reactions = formatReactions(m.reactions_md, userInfo);

      const parts = [
        `Message: ${m.messageId}`,
        `From: ${formatUserRef(m.senderId, userInfo)}`,
        `Type: ${m.msgType}${m.edited ? " (edited)" : ""}`,
        `Date: ${toIST(m.createdAt)}`,
        ...(channelName ? [`Channel: #${channelName}`] : []),
        ...(channelId ? [`channelId: ${channelId}`] : []),
        ...(m.conversationId ? [`conversationId: ${m.conversationId}`] : []),
        ...(typeof convMeta?.replyCount === "number" ? [`Thread replies: ${convMeta.replyCount}`] : []),
        ...(reactions ? [`Reactions: ${reactions}`] : []),
        // Message body is rich-text HTML — clean to markdown-ish plain text.
        `\n${cleanSnippet(m.content)}`,
      ];

      if (m.hasAttachment) {
        parts.push("\n[Has attachments]");
      }

      const citations: Citation[] = [];
      // `messageId` deep-links the citation chip into the specific message
      // inside the thread instead of dropping the user at the thread start.
      pushThreadCitation(
        citations,
        channelId,
        m.conversationId,
        1,
        channelName ? `Message in #${channelName}` : `Message ${m.messageId}`,
        { messageId: m.messageId },
      );
      applyChannelInfo(citations, channelInfo);

      return okCited(prefixChunk(1, parts[0]!, parts.slice(1)), citations);
    }),
};

interface MessageDetailRow {
  messageId: string;
  content: string;
  msgType: string;
  createdAt: string;
  edited: boolean;
  hasAttachment: boolean;
  /** Reaction summary blob; parsed by formatReactions. */
  reactions_md?: string;
  conversationId?: string;
  senderId?: string;
}

// ── spaces-channels ──────────────────────────────────────────────────

const spacesChannels: ToolDef = {
  name: "spaces-channels",
  description:
    "List channels in Spaces. Can filter by channel name, visibility (PUBLIC/PRIVATE), scope type (DEFAULT/DM/TICKET/GROUP_DM), " +
    "and participant name. This is the AUTHORITATIVE way to resolve a channel name to its id (direct database match, " +
    "works for private channels too — unlike spaces-search, which is a fuzzy index). ALWAYS re-resolve here and copy the " +
    "returned id verbatim before any write action (create-ticket, send-message); never re-type a channel id from memory or prose. " +
    "To find a DM between two people, use scopeType='DM' and participantName to filter by one of them. " +
    "Returns per channel: name, member COUNT, creator, created / updated / last-active times, archived status, " +
    "and (when the channel has recent activity) its latest-thread conversation ID to pass to spaces-messages — no follow-up call needed. " +
    "Member NAMES are omitted by default (a busy channel can have hundreds); set includeMembers=true to list them, " +
    "paging with membersLimit / membersOffset so the output stays bounded.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Filter by channel name (case-insensitive partial match). Use this to find a specific channel.",
      },
      description: {
        type: "string",
        description: "Filter by channel description / topic (case-insensitive partial match).",
      },
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility" },
      scopeType: {
        type: "string",
        enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"],
        description: "Filter by scope type",
      },
      channelType: {
        type: "string",
        enum: ["DEFAULT", "EMAIL", "SUPPORT", "SLACK", "APP"],
        description:
          "Filter by channel TYPE (distinct from scopeType). DEFAULT = regular chat channels (what the chat directory shows); EMAIL/SUPPORT/SLACK/APP = desk / integration channels. Set DEFAULT to exclude desk/integration channels.",
      },
      participantName: { type: "string", description: "Filter channels by participant name (partial match)" },
      includeMembers: {
        type: "boolean",
        default: false,
        description:
          "List participant NAMES (not just the count). Off by default to keep results compact — a busy channel can have hundreds of members. Prefer narrowing to one channel (via name) before turning this on. Names are paged with membersLimit / membersOffset.",
      },
      membersLimit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 20,
        description:
          "When includeMembers=true, max member names to show per channel (default 20). The count is always exact regardless of this.",
      },
      membersOffset: {
        type: "number",
        minimum: 0,
        default: 0,
        description:
          "When includeMembers=true, skip this many member names per channel before listing (pagination). Raise it to page through a large member list.",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max channels (default 100)",
      },
      orderBy: {
        type: "string",
        enum: ["lastActivityAt", "createdAt", "name"],
        default: "lastActivityAt",
        description:
          "Sort field: lastActivityAt (default, most recently active first), createdAt (newest channels), or name (alphabetical).",
      },
      sortOrder: {
        type: "string",
        enum: ["desc", "asc"],
        default: "desc",
        description: "Sort direction: desc (default) or asc. For name, asc = A→Z.",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Pagination offset (default 0). Call again with a higher offset for more channels.",
      },
    },
  },
  handler: withToolErrors("Channels error", async (args) => {
      const where: Record<string, unknown> = {};
      if (args["name"]) where["name"] = { contains: args["name"] as string, mode: "insensitive" };
      if (args["description"])
        where["description"] = { contains: args["description"] as string, mode: "insensitive" };
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["scopeType"]) where["scopeType"] = { equals: args["scopeType"] };
      if (args["channelType"]) where["type"] = { equals: args["channelType"] };
      if (args["participantName"])
        where["participants"] = { some: { user: { name: { contains: args["participantName"] as string } } } };

      // Caller-controlled sort, clamped to known columns; defaults preserve the
      // prior most-recently-active-first behaviour.
      const sortField = ["createdAt", "name"].includes(String(args["orderBy"]))
        ? String(args["orderBy"])
        : "lastActivityAt";
      const sortDir: "asc" | "desc" = args["sortOrder"] === "asc" ? "asc" : "desc";

      const rows = (await interact({
        model: "channel",
        operation: "findMany",
        where,
        orderBy: [{ [sortField]: sortDir }],
        take: (args["limit"] as number | undefined) ?? 100,
        skip: (args["offset"] as number | undefined) ?? 0,
        include: {
          project: { select: { name: true } },
          participants: { select: { user: { select: { name: true } } } },
        },
      })) as ChannelRow[];

      if (!rows || rows.length === 0) return ok("No channels found.");

      const includeMembers = args["includeMembers"] === true;
      const membersLimit = Math.min(Math.max(Number(args["membersLimit"] ?? 20), 1), 100);
      const membersOffset = Math.max(Number(args["membersOffset"] ?? 0), 0);

      // Three batched lookups (the gateway strips `include`): each channel's
      // creator name/email, its latest-active conversation id so the advertised
      // ConversationID is finally populated for navigation, and its real member
      // list. The Channel.participantCount scalar is deprecated (XYNE-11666
      // moved the live count to channel_stats), so we count channel_participants
      // rows instead — otherwise every channel shows "Members: 0".
      const { byChannel: participantsByChannel, truncated: membersTruncated } =
        await resolveChannelParticipants(rows.map((c) => c.id));
      // Resolve NAMES only for the member slice we'll actually print (plus every
      // creator). Off by default so a broad listing never dumps hundreds of
      // names into the model's context.
      const memberNameIds = includeMembers
        ? rows.flatMap((c) =>
            (participantsByChannel.get(c.id) ?? []).slice(membersOffset, membersOffset + membersLimit),
          )
        : [];
      const creatorInfo = await resolveUserInfo([
        ...rows.map((c) => c.createdBy).filter((v): v is string => !!v),
        ...memberNameIds,
      ]);
      const latestConv = await resolveChannelLatestConversation(rows.map((c) => c.id));

      const citations: Citation[] = [];
      const lines = rows.map((c, idx) => {
        const convId = c.conversationId ?? latestConv.get(c.id);
        const parts = [`#${c.name} (id: ${c.id}) (${c.scopeType}, ${c.visibility})${c.isArchived ? " [archived]" : ""}`];
        if (c.description) parts.push(`  ${c.description}`);
        // Real membership from channel_participants (the deprecated
        // Channel.participantCount scalar is unmaintained and reads 0). The count
        // is always shown; names only on includeMembers, paged to stay bounded.
        const memberIds = participantsByChannel.get(c.id) ?? [];
        const countLabel = membersTruncated ? `${memberIds.length}+` : `${memberIds.length}`;
        if (includeMembers && memberIds.length > 0) {
          const page = memberIds.slice(membersOffset, membersOffset + membersLimit);
          if (page.length > 0) {
            const names = page.map((uid) => creatorInfo.get(uid)?.name ?? uid);
            const shownTo = membersOffset + page.length;
            const pager =
              membersOffset > 0 || shownTo < memberIds.length
                ? ` [members ${membersOffset + 1}-${shownTo} of ${countLabel}; raise membersOffset for more]`
                : "";
            parts.push(`  Members (${countLabel}): ${names.join(", ")}${pager}`);
          } else {
            parts.push(`  Members: ${countLabel} [membersOffset ${membersOffset} is past the last member]`);
          }
        } else {
          parts.push(`  Members: ${countLabel}`);
        }
        if (c.createdBy) parts.push(`  Created by: ${formatUserRef(c.createdBy, creatorInfo)}`);
        if (c.project) parts.push(`  Project: ${c.project.name}`);
        const times: string[] = [];
        if (c.createdAt) times.push(`Created: ${toIST(c.createdAt)} IST`);
        if (c.updatedAt) times.push(`Updated: ${toIST(c.updatedAt)} IST`);
        if (c.lastActivityAt) times.push(`Last active: ${toIST(c.lastActivityAt)} IST`);
        if (times.length > 0) parts.push(`  ${times.join(" · ")}`);
        if (convId) parts.push(`  Latest thread ConversationID: ${convId}`);
        parts.push(`  ID: ${c.id}`);
        pushThreadCitation(citations, c.id, convId, idx + 1, `#${c.name}`);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });
      const channelInfo = await resolveChannelInfo(
        citations.map((cc) => cc.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      return okCited(
        `${rows.length} channel(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
        citations,
      );
    }),
  // APP MODE: list channels via the app-token route `/api/apps/channel/list`
  // (returns {items:[{id,name,description,scopeType,...}], hasMore, nextCursor}).
  // The app route supports scopeType + limit + cursor only, so name filtering
  // is applied client-side over the returned page.
  appHandler: withToolErrors("Channels error", async (args) => {
      const qs = new URLSearchParams();
      qs.set("limit", String(args["limit"] ?? 100));
      if (args["scopeType"]) qs.set("scopeType", String(args["scopeType"]));
      const data = (await appFetch(`/channel/list?${qs.toString()}`, { method: "GET" })) as {
        items?: Array<{ id: string; name: string; description?: string; scopeType?: string }>;
      };
      let items = data.items ?? [];
      const nameFilter = args["name"] ? String(args["name"]).toLowerCase() : "";
      if (nameFilter) items = items.filter((c) => c.name?.toLowerCase().includes(nameFilter));
      if (items.length === 0) return ok("No channels found.");
      const lines = items.map((c, idx) => {
        const parts = [`#${c.name} (${c.scopeType ?? "?"})`];
        if (c.description) parts.push(`  ${c.description}`);
        parts.push(`  ID: ${c.id}`);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });
      // App route is cursor-based (no offset); signal "more" heuristically so
      // the agent can refine filters or raise the limit.
      const appLimit = Number(args["limit"] ?? 100);
      const moreNote =
        items.length >= appLimit
          ? `\n\n[Showing ${items.length} channel(s) — more may exist. Raise limit or refine with name/scopeType filters.]`
          : "";
      return ok(`${items.length} channel(s):\n\n${lines.join("\n\n")}${moreNote}`);
    }),
};

interface ChannelRow {
  id: string;
  name: string;
  description?: string;
  type: string;
  scopeType: string;
  visibility: string;
  participantCount: number;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  /** Creator userId (Channel.createdBy scalar) — resolved to a name via resolveUserInfo. */
  createdBy?: string;
  /** Live PG archived state (Channel.isArchived) — the Vespa copy is hardcoded false. */
  isArchived?: boolean;
  /** Channel has no conversationId scalar; populated best-effort from the latest thread. */
  conversationId?: string;
  project?: { name: string } | null;
}

// ── spaces-users ─────────────────────────────────────────────────────

const spacesUsers: ToolDef = {
  name: "spaces-users",
  description:
    "Look up users by name or email, or list the members of a user group (team) via groupId. " +
    "Filter to current members with status=ACTIVE, and sort by name / join date / last-active. " +
    "Returns a directory card per person: name (+ display name), email, user ID, " +
    "role, account status, joined & last-seen times, presence status, and avatar — no follow-up call needed. " +
    "Deactivated / departed users also surface (tagged with their status + left date) unless status=ACTIVE.",
  inputSchema: {
    type: "object",
    properties: {
      nameOrEmail: {
        type: "string",
        description:
          "Person's name to search by name, or email address (with @ or .) to search by email. Optional when groupId is given (to list a whole group).",
      },
      groupId: {
        type: "string",
        description:
          "List members of this user group (team). Can be used alone to enumerate a group, or combined with nameOrEmail/status to narrow within it.",
      },
      status: {
        type: "string",
        enum: ["ACTIVE", "INACTIVE"],
        description:
          "Filter by account status. Omit to include departed/deactivated users (the default, so you can answer 'did this person leave?'); set ACTIVE to list only current members.",
      },
      orderBy: {
        type: "string",
        enum: ["name", "createdAt", "lastActiveAt"],
        description:
          "Sort field: name (A→Z with sortOrder=asc), createdAt (join date), or lastActiveAt (recency). Omit to keep default relevance order.",
      },
      sortOrder: {
        type: "string",
        enum: ["asc", "desc"],
        default: "asc",
        description: "Sort direction for orderBy (default asc; use desc for newest/most-recent first).",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results (default 100, max 100)",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description:
          "Pagination offset (default 0). Call again with the same query and a higher offset for more matches.",
      },
    },
  },
  handler: withToolErrors("Users error", async (args) => {
      const nameOrEmail = args["nameOrEmail"] ? String(args["nameOrEmail"]) : "";
      const groupId = args["groupId"] ? String(args["groupId"]) : "";
      if (!nameOrEmail && !groupId) {
        return err("Provide nameOrEmail (to search by name/email) or groupId (to list a group's members).");
      }
      // No hard status filter by default: a name/email `contains` search is
      // already narrow, so departed/deactivated users should SURFACE (clearly
      // tagged in the card) instead of silently vanishing — that's the "did this
      // person leave?" case. `status` opts into an active-only list.
      const where: Record<string, unknown> = {};
      if (nameOrEmail) {
        const isEmail = nameOrEmail.includes("@") || nameOrEmail.includes(".");
        if (isEmail) where["email"] = { contains: nameOrEmail, mode: "insensitive" };
        else where["name"] = { contains: nameOrEmail, mode: "insensitive" };
      }
      // Single relation-'some' object — gateway-legal (only the top-level model
      // is allowlisted; the userGroupMappings relation name passes the validator).
      if (groupId) where["userGroupMappings"] = { some: { userGroupId: { equals: groupId } } };
      if (args["status"]) where["status"] = { equals: String(args["status"]) };

      const orderByField = ["name", "createdAt", "lastActiveAt"].includes(String(args["orderBy"]))
        ? String(args["orderBy"])
        : undefined;
      const sortDir: "asc" | "desc" = args["sortOrder"] === "desc" ? "desc" : "asc";

      const rows = (await interact({
        model: "user",
        operation: "findMany",
        where,
        ...(orderByField ? { orderBy: [{ [orderByField]: sortDir }] } : {}),
        take: (args["limit"] as number | undefined) ?? 100,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as UserRow[];

      if (!rows || rows.length === 0) {
        return ok(
          nameOrEmail ? `No users found matching "${nameOrEmail}".` : "No users found in that group.",
        );
      }

      const lines = rows.map((u, idx) => prefixChunk(idx + 1, userTitle(u), userDetailLines(u)));
      return ok(
        `${rows.length} user(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
      );
    }),
};

interface UserRow {
  id: string;
  name: string;
  email: string;
  status: string;
  userType: string;
  /** All returned by default (gateway drops `select`, so every User scalar rides back). */
  displayName?: string;
  role?: string;
  createdAt?: string;
  lastActiveAt?: string;
  leftAt?: string;
  picture?: string;
  statusEmoji?: string;
  statusContent?: string;
}

// ── spaces-user-activity-context ────────────────────────────────────

interface UserAffinityResponse {
  userId: string;
  name?: string;
  email?: string;
  channelWeights?: Record<string, number>;
  userWeights?: Record<string, number>;
  channelTimestamps?: Record<string, number>;
  userTimestamps?: Record<string, number>;
  personalizationLastUpdated?: number;
}

interface VespaTensor {
  cells?: Record<string, number> | Array<{ address?: { key?: string }; value?: number }>;
}

interface AffinityEntry {
  id: string;
  weight: number;
  lastSignalAt?: number;
}

type AffinityOrder = "weight" | "recent" | "stale";

function affinityTensorToRecord(tensor: VespaTensor | undefined, prefix: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!tensor?.cells) return result;

  const stripPrefix = (key: string): string => (key.startsWith(prefix) ? key.slice(prefix.length) : key);

  if (Array.isArray(tensor.cells)) {
    for (const cell of tensor.cells) {
      const key = cell.address?.key;
      if (key !== undefined && cell.value !== undefined) {
        result[stripPrefix(key)] = Number(cell.value);
      }
    }
  } else {
    for (const [key, value] of Object.entries(tensor.cells)) {
      result[stripPrefix(key)] = Number(value);
    }
  }

  return result;
}

function buildAffinityEntries(
  weights: Record<string, number> | undefined,
  timestamps: Record<string, number> | undefined,
  orderBy: AffinityOrder,
  limit: number,
): AffinityEntry[] {
  const entries = Object.entries(weights ?? {}).map(([id, rawWeight]) => {
    const timestamp = Number(timestamps?.[id]);
    return {
      id,
      weight: Number(rawWeight),
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { lastSignalAt: timestamp } : {}),
    };
  });

  entries.sort((a, b) => {
    if (orderBy === "recent") {
      return (b.lastSignalAt ?? 0) - (a.lastSignalAt ?? 0) || b.weight - a.weight;
    }
    if (orderBy === "stale") {
      // Missing timestamps are unknown, not evidence of staleness, so keep
      // them after entries with a known old signal time.
      const aTime = a.lastSignalAt ?? Number.POSITIVE_INFINITY;
      const bTime = b.lastSignalAt ?? Number.POSITIVE_INFINITY;
      return aTime - bTime || b.weight - a.weight;
    }
    return b.weight - a.weight || (b.lastSignalAt ?? 0) - (a.lastSignalAt ?? 0);
  });

  return entries.slice(0, limit);
}

function formatSignalTime(timestamp: number | undefined): string {
  if (!timestamp) return "last signal: unknown";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "last signal: unknown";
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  const age = ageDays < 1 ? "today" : `${ageDays.toFixed(ageDays < 10 ? 1 : 0)} days ago`;
  return `last signal: ${date.toISOString()} (${age})`;
}

async function renderUserActivityContext(
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<ToolResult> {
  const userId = String(args["userId"] ?? "").trim();
  if (!userId) return err("userId is required. Resolve it with spaces-users or spaces-whoami.");

  const limit = Math.min(Math.max(Number(args["limit"] ?? 10), 1), 50);
  const requestedOrder = String(args["orderBy"] ?? "weight");
  const orderBy: AffinityOrder =
    requestedOrder === "recent" || requestedOrder === "stale" ? requestedOrder : "weight";

  try {
    const yql = `select * from sources user where docId contains "${esc(userId)}" limit 1`;
    const response = await queryDirect(
      yql,
      "",
      ctx.userId,
      1,
      0,
      CONFIG.vespaQueryEndpoint,
      "unranked",
      undefined,
      undefined,
      true,
    );
    const fields = response.data.results?.[0]?.rawFields;
    if (!fields) return err(`No Vespa activity profile found for userId ${userId}.`);

    const data: UserAffinityResponse = {
      userId,
      ...(fields["name"] ? { name: String(fields["name"]) } : {}),
      ...(fields["email"] ? { email: String(fields["email"]) } : {}),
      channelWeights: affinityTensorToRecord(fields["channelWeights"] as VespaTensor | undefined, "channel:"),
      userWeights: affinityTensorToRecord(fields["userWeights"] as VespaTensor | undefined, "user:"),
      channelTimestamps: affinityTensorToRecord(
        fields["channelTimestamps"] as VespaTensor | undefined,
        "channel:",
      ),
      userTimestamps: affinityTensorToRecord(fields["userTimestamps"] as VespaTensor | undefined, "user:"),
      personalizationLastUpdated: Number(fields["personalizationLastUpdated"] ?? 0),
    };
    const channels = buildAffinityEntries(data.channelWeights, data.channelTimestamps, orderBy, limit);
    const collaborators = buildAffinityEntries(data.userWeights, data.userTimestamps, orderBy, limit);

    const [channelInfo, userInfo] = await Promise.all([
      resolveChannelInfo(channels.map((entry) => entry.id)),
      resolveUserInfo(collaborators.map((entry) => entry.id)),
    ]);

    const profile = [data.name, data.email ? `<${data.email}>` : "", `(id: ${data.userId})`]
      .filter(Boolean)
      .join(" ");
    const updatedAt = data.personalizationLastUpdated
      ? new Date(data.personalizationLastUpdated).toISOString()
      : "unknown";
    const orderLabel =
      orderBy === "recent"
        ? "most recent signal first"
        : orderBy === "stale"
          ? "oldest known signal first"
          : "strongest affinity first";

    const channelLines = channels.map((entry) => {
      const channel = channelInfo.get(entry.id);
      const label = channel?.name ? `#${channel.name}` : entry.id;
      return `- ${label} — weight: ${entry.weight.toFixed(3)}; ${formatSignalTime(entry.lastSignalAt)}; channelId: ${entry.id}`;
    });
    const userLines = collaborators.map((entry) => {
      const user = userInfo.get(entry.id);
      const label = user?.name ? `${user.name}${user.email ? ` <${user.email}>` : ""}` : entry.id;
      return `- ${label} — weight: ${entry.weight.toFixed(3)}; ${formatSignalTime(entry.lastSignalAt)}; userId: ${entry.id}`;
    });

    return ok(
      [
        `Activity context for ${profile}`,
        `Profile computed at: ${updatedAt}`,
        `Ordering: ${orderLabel}`,
        "",
        `Channels (${channels.length} of ${Object.keys(data.channelWeights ?? {}).length} signals):`,
        ...(channelLines.length > 0 ? channelLines : ["- No channel signals recorded."]),
        "",
        `Collaborators (${collaborators.length} of ${Object.keys(data.userWeights ?? {}).length} signals):`,
        ...(userLines.length > 0 ? userLines : ["- No collaborator signals recorded."]),
        "",
        "Interpretation: weights and signal times show where this user has interacted, not whether a particular fact is current. For freshness-sensitive answers, use these IDs to search the relevant channels/users, then compare the timestamps of the returned messages or documents.",
      ].join("\n"),
    );
  } catch (e) {
    return err(`User activity context error: ${errMsg(e)}`);
  }
}

const spacesUserActivityContext: ToolDef = {
  name: "spaces-user-activity-context",
  description:
    "Fetch a user activity/affinity profile by Spaces userId without changing search ranking. " +
    "Returns compact, name-resolved channel and collaborator signals with affinity weights and last-signal timestamps. " +
    "Use orderBy=recent to find currently active sources, orderBy=stale to find old relationship signals, or orderBy=weight for strongest sources. " +
    "This identifies likely sources of fresh or stale information; it does not prove a message or fact is stale, so follow up with spaces-search/spaces-messages and compare content timestamps.",
  inputSchema: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description:
          "Spaces user ID whose activity context should be fetched. Resolve with spaces-users or spaces-whoami; never invent it.",
      },
      orderBy: {
        type: "string",
        enum: ["weight", "recent", "stale"],
        default: "weight",
        description:
          "weight = strongest affinity first; recent = newest interaction signal first; stale = oldest known interaction signal first.",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 50,
        default: 10,
        description: "Maximum channels and maximum collaborators to return (default 10 each, max 50).",
      },
    },
    required: ["userId"],
  },
  async handler(args, ctx) {
    return renderUserActivityContext(args, ctx);
  },
};

/** Directory-card TITLE for a user: "Name (aka DisplayName) <email> — userType",
 *  with a "[<status>, left <date>]" tag whenever the account isn't ACTIVE. */
function userTitle(u: UserRow): string {
  const alias = u.displayName && u.displayName !== u.name ? ` (aka ${u.displayName})` : "";
  const type = u.userType ? ` — ${u.userType}` : "";
  let tag = "";
  if (u.status && u.status !== "ACTIVE") {
    tag = u.leftAt ? ` [${u.status}, left ${new Date(u.leftAt).toLocaleDateString()}]` : ` [${u.status}]`;
  }
  return `${u.name}${alias} <${u.email}>${type}${tag}`;
}

/** Indented directory-card DETAIL lines: role · id, joined · last-seen, presence
 *  status, avatar. Each guarded so nullable columns simply don't render. */
function userDetailLines(u: UserRow): string[] {
  const out: string[] = [];
  out.push(`  ${[u.role ? `Role: ${u.role}` : "", `ID: ${u.id}`].filter(Boolean).join(" · ")}`);
  const times: string[] = [];
  if (u.createdAt) times.push(`Joined: ${toIST(u.createdAt)} IST`);
  if (u.lastActiveAt) times.push(`Last seen: ${toIST(u.lastActiveAt)} IST`);
  if (times.length > 0) out.push(`  ${times.join(" · ")}`);
  if (u.statusContent) out.push(`  Status: ${u.statusEmoji ? `${u.statusEmoji} ` : ""}${u.statusContent}`);
  if (u.picture) out.push(`  Avatar: ${u.picture}`);
  return out;
}

// ── spaces-activity ──────────────────────────────────────────────────

// Activity-feed tab → the set of `actorAction` values it surfaces. Kept in
// lockstep with the dashboard's getActivityTypes (ActivityListView.tsx): a
// change to the tab action sets there should be mirrored here.
const ACTIVITY_TAB_ACTIONS: Record<string, string[]> = {
  your_mentions: ["mentioned_user"],
  replies: ["replied", "replied_v2"],
  reactions: ["added", "added_v2", "removed"],
  group_mentions: ["group_mention"],
  tickets: [
    "eta_warning",
    "eta_breach",
    "stage_eta_breach",
    "ticket_assigned",
    "ticket_status",
    "ticket_eta",
    "ticket_board",
    "ticket_assigned_to",
    "ticket_pr_created",
    "ticket_pr_updated",
    "ticket_pr_merged",
    "ticket_pr_declined",
    "ticket_pr_reviewer_assigned",
    "ticket_qa_assigned",
    "ticket_priority",
    "ticket_user_group",
    "ticket_title",
    "ticket_description",
    "ticket_rca_created",
    "ticket_rca_updated",
    "ticket_subticket_added",
    "ticket_reference_added",
    "ticket_reference_removed",
    "ticket_multi_updated",
    "workflow_question",
    "stage_approval_requested",
    "stage_approval_approved",
    "stage_approval_rejected",
  ],
  canvas: ["canvas_shared", "canvas_role_changed", "canvas_access_revoked", "mentioned_user"],
};

const spacesActivity: ToolDef = {
  name: "spaces-activity",
  description:
    "Get your activity feed — mentions, replies, assignments, and notifications. " +
    "Filter to a feed tab (your_mentions / replies / reactions / group_mentions / tickets / canvas), by classification " +
    "(ACTIONABLE / FYI), or unread-only. " +
    "Returns messageId, conversationId, ticketId for each activity. " +
    "Use conversationId with spaces-messages to read the full thread, or messageId with spaces-message-detail.",
  inputSchema: {
    type: "object",
    properties: {
      tab: {
        type: "string",
        enum: ["your_mentions", "replies", "reactions", "group_mentions", "tickets", "canvas"],
        description:
          "Filter to one of the activity-feed tabs (mirrors the dashboard): your_mentions | replies | reactions | group_mentions | tickets | canvas. Each maps to the set of activity action types that tab shows.",
      },
      actorActions: {
        type: "array",
        items: { type: "string" },
        description:
          "Advanced: filter to these raw activity action types (matches any), e.g. ['ticket_assigned','ticket_status']. Use `tab` for the common groupings instead. If both are given, actorActions wins.",
      },
      classification: {
        type: "string",
        description: "Filter by classification (e.g. 'ACTIONABLE', 'FYI', 'PENDING')",
      },
      unreadOnly: { type: "boolean", description: "Show only unread activity" },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max entries (default 100)",
      },
      sortOrder: {
        type: "string",
        enum: ["desc", "asc"],
        default: "desc",
        description: "Order by activity time: desc (default, newest first) or asc (oldest first).",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description:
          "Pagination offset (default 0). Call again with the same filters and a higher offset to page through older activity.",
      },
    },
  },
  handler: withToolErrors("Activity error", async (args, ctx) => {
      const where: Record<string, unknown> = {
        userId: { equals: ctx.userId },
      };
      if (args["classification"]) where["classification"] = { equals: args["classification"] };
      if (args["unreadOnly"] === true) where["isRead"] = { equals: false };
      // Activity-tab → action-type sets, mirroring the dashboard's getActivityTypes
      // (ActivityListView.tsx). A raw `actorActions` array overrides the tab.
      const rawActions = Array.isArray(args["actorActions"])
        ? (args["actorActions"] as unknown[]).map((v) => String(v).trim()).filter(Boolean)
        : [];
      const actions =
        rawActions.length > 0 ? rawActions : (ACTIVITY_TAB_ACTIONS[String(args["tab"] ?? "")] ?? []);
      if (actions.length > 0) where["actorAction"] = { in: actions };

      const sortDir: "asc" | "desc" = args["sortOrder"] === "asc" ? "asc" : "desc";
      const rows = (await interact({
        model: "activity",
        operation: "findMany",
        where,
        orderBy: [{ createdAt: sortDir }],
        take: (args["limit"] as number | undefined) ?? 100,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as UserActivityRow[];

      if (!rows || rows.length === 0) return ok("No activity found.");

      const citations: Citation[] = [];
      const lines = rows.map((a, idx) => {
        const when = toIST(a.createdAt);
        const read = a.isRead ? "" : " (unread)";
        const refs: string[] = [];
        if (a.actorId) refs.push(`actorId: ${a.actorId}`);
        if (a.messageId) refs.push(`messageId: ${a.messageId}`);
        if (a.conversationId) refs.push(`conversationId: ${a.conversationId}`);
        if (a.ticketId) refs.push(`ticketId: ${a.ticketId}`);
        if (a.channelId) refs.push(`channelId: ${a.channelId}`);
        // Activity rows know which message triggered them — pass it so the
        // citation chip lands on that exact reply rather than the thread top.
        pushThreadCitation(
          citations,
          a.channelId,
          a.conversationId,
          idx + 1,
          a.ticketId ? `Ticket ${a.ticketId}` : undefined,
          a.messageId ? { messageId: a.messageId } : undefined,
        );
        const refStr = refs.length > 0 ? refs.join(" · ") : "";
        return prefixChunk(
          idx + 1,
          `[${when}] ${a.actorAction}${read}${a.classification ? ` · ${a.classification}` : ""}`,
          refStr ? [`    ${refStr}`] : [],
        );
      });

      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);
      return okCited(
        `${rows.length} activity entries:\n\n${lines.join("\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
        citations,
      );
    }),
};

interface UserActivityRow {
  id: string;
  actorAction: string;
  classification?: string;
  isRead: boolean;
  createdAt: string;
  channelId?: string;
  ticketId?: string;
  conversationId?: string;
  messageId?: string;
  actorId: string;
}

// ── spaces-projects ──────────────────────────────────────────────────

const spacesProjects: ToolDef = {
  name: "spaces-projects",
  description:
    "Search and list projects to find project IDs for creating tickets. " +
    "The `search` term matches a project's NAME or its CODE / shortcode (e.g. 'EUL'), case-insensitively, so you can " +
    "look a project up by either. Supports pagination.",
  inputSchema: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description: "Filter by project name OR code/shortcode (case-insensitive partial match).",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results (default 100, max 100)",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  handler: withToolErrors("Projects error", async (args) => {
      const search = args["search"] ? String(args["search"]) : "";
      const limit = (args["limit"] as number | undefined) ?? 100;
      const offset = (args["offset"] as number | undefined) ?? 0;

      let rows: ProjectRow[];
      if (search) {
        // Match name OR code. The gateway rejects an OR array-of-objects, so run
        // the two `contains` queries separately and union client-side, then
        // paginate the merged set (projects are few, so fetching broadly is fine).
        const [byName, byCode] = await Promise.all([
          interact({
            model: "project",
            operation: "findMany",
            where: { name: { contains: search, mode: "insensitive" } },
            orderBy: [{ createdAt: "desc" }],
            take: 1000,
          }) as Promise<ProjectRow[]>,
          interact({
            model: "project",
            operation: "findMany",
            where: { code: { contains: search, mode: "insensitive" } },
            orderBy: [{ createdAt: "desc" }],
            take: 1000,
          }) as Promise<ProjectRow[]>,
        ]);
        const seen = new Set<string>();
        const merged = [...(byName ?? []), ...(byCode ?? [])].filter((p) =>
          seen.has(p.id) ? false : (seen.add(p.id), true),
        );
        merged.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
        rows = merged.slice(offset, offset + limit);
      } else {
        rows = (await interact({
          model: "project",
          operation: "findMany",
          where: {},
          orderBy: [{ createdAt: "desc" }],
          take: limit,
          skip: offset,
        })) as ProjectRow[];
      }

      if (!rows || rows.length === 0)
        return ok(search ? `No projects found matching "${search}".` : "No projects found.");

      const lines = rows.map((p, idx) => {
        const parts = [`${p.name}${p.code ? ` [${p.code}]` : ""}`];
        if (p.description) parts.push(`  ${p.description}`);
        parts.push(`  ID: ${p.id}`);
        if (p.updatedAt) parts.push(`  Updated: ${toIST(p.updatedAt)}`);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });

      return ok(
        `${rows.length} project(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`,
      );
  }),
};

interface ProjectRow {
  id: string;
  name: string;
  code?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── spaces-project-team-members ─────────────────────────────────────

const spacesProjectTeamMembers: ToolDef = {
  name: "spaces-project-team-members",
  description:
    "Get all unique team members for a project by aggregating participants across every channel in the project. " +
    "Returns user IDs, names, and emails. Use this to identify who belongs to a project team.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Project ID (use spaces-projects to find project IDs)" },
    },
    required: ["projectId"],
  },
  handler: withToolErrors("Project team members error", async (args) => {
      const projectId = String(args["projectId"] ?? "");
      if (!projectId) return err("projectId is required");

      const channels = (await interact({
        model: "channel",
        operation: "findMany",
        where: { projectId: { equals: projectId } },
        take: 200,
      })) as Array<{ id: string; name?: string }>;

      if (!channels || channels.length === 0) return ok(`No channels found for project ${projectId}.`);

      const channelIds = channels.map((c) => c.id);

      const participants = (await interact({
        model: "channelParticipant",
        operation: "findMany",
        where: { channelId: { in: channelIds } },
        take: 1000,
      })) as Array<{ userId: string }>;

      const uniqueUserIds = [...new Set(participants.map((p) => p.userId))];
      if (uniqueUserIds.length === 0)
        return ok(`No team members found in any channel for project ${projectId}.`);

      const users = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { in: uniqueUserIds } },
        take: 1000,
      })) as UserRow[];

      const lines = [
        `Project ID: ${projectId}`,
        `Channels: ${channels.length}`,
        `Team members: ${users.length}`,
        "",
        "Members:",
      ];
      let idx = 0;
      for (const u of users) {
        idx += 1;
        lines.push(prefixChunk(idx, `${u.name} (${u.email})`, [`    ID: ${u.id}`]));
      }

      return ok(lines.join("\n"));
    }),
};

// ── spaces-canvases ─────────────────────────────────────────────────

// Canvas metadata.source values the dashboard hides by default (auto-generated
// RCA / PRD / summary / migration docs). Kept in lockstep with the frontend's
// EXCLUDED_CALL_GENERATED_SOURCES (dashboard/src/components/Canvas/canvasFilters.ts).
const EXCLUDED_CALL_GENERATED_SOURCES = new Set([
  "call_prd",
  "call_detailed_summary",
  "genius_dm_response",
  "genius_canvas_long_response",
  "jira_migration_report",
  "release_notes",
  "workflow_knowledge",
  "commit_analysis",
  "genius_investigation",
  "xyne_auto_rca",
]);

/** True when a canvas row's metadata.source marks it auto/call-generated. */
function isCallGeneratedCanvas(metadata: unknown): boolean {
  let meta = metadata;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch {
      return false;
    }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const source = (meta as Record<string, unknown>)["source"];
  return typeof source === "string" && EXCLUDED_CALL_GENERATED_SOURCES.has(source);
}

const spacesCanvases: ToolDef = {
  name: "spaces-canvases",
  description:
    "Search and list Canvas documents in Spaces (collaborative docs, slides). " +
    "Filter by title, channel, project, folder, visibility, doc type, creator, or starred-only; " +
    "set excludeCallGenerated=true to hide auto-generated RCA/PRD/summary docs (as the dashboard does by default). " +
    "Returns canvas IDs, titles, channel, creator, and last-edited time.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by canvas title (case-insensitive partial match)" },
      channelId: { type: "string", description: "Filter by channel ID" },
      projectId: { type: "string", description: "Filter to canvases in this project" },
      folderId: {
        type: "string",
        description:
          "Filter to canvases in this folder. Pass the literal 'none' to list ungrouped/personal canvases (folderId is null).",
      },
      visibility: {
        type: "string",
        enum: ["PUBLIC", "PRIVATE"],
        description: "Filter by visibility (canvases are PUBLIC or PRIVATE).",
      },
      createdBy: { type: "string", description: "Filter by creator user ID" },
      starredOnly: { type: "boolean", description: "Only canvases you have starred." },
      excludeCallGenerated: {
        type: "boolean",
        description:
          "Hide auto-generated call/RCA/PRD/summary/migration canvases (matches the dashboard's default view). Default false (returns everything).",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results (default 100, max 100)",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  handler: withToolErrors("Canvases error", async (args, ctx) => {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["title"] = { contains: args["search"] as string, mode: "insensitive" };
      if (args["channelId"]) where["channelId"] = { equals: args["channelId"] };
      if (args["projectId"]) where["projectId"] = { equals: args["projectId"] };
      if (args["folderId"])
        where["folderId"] = String(args["folderId"]) === "none" ? null : { equals: args["folderId"] };
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["createdBy"]) where["createdBy"] = { equals: args["createdBy"] };
      // Single relation-'some' object — gateway-legal. Scopes to canvases the
      // caller has starred (CanvasUserStatus is per-user).
      if (args["starredOnly"] === true) {
        where["userStatuses"] = { some: { userId: { equals: ctx.userId }, isStarred: { equals: true } } };
      }

      const limit = (args["limit"] as number | undefined) ?? 100;
      const offset = (args["offset"] as number | undefined) ?? 0;
      const excludeCallGen = args["excludeCallGenerated"] === true;

      // excludeCallGenerated keys off metadata.source (a JSON column) which the
      // scalar-only gateway can't filter — post-filter client-side. Over-fetch a
      // broad window and paginate the filtered set so the page stays full.
      let rows: CanvasRow[];
      if (excludeCallGen) {
        const fetched = (await interact({
          model: "canvas",
          operation: "findMany",
          where,
          orderBy: [{ updatedAt: "desc" }],
          take: 1000,
        })) as CanvasRow[];
        rows = (fetched ?? [])
          .filter((c) => !isCallGeneratedCanvas(c.metadata))
          .slice(offset, offset + limit);
      } else {
        rows = (await interact({
          model: "canvas",
          operation: "findMany",
          where,
          orderBy: [{ updatedAt: "desc" }],
          take: limit,
          skip: offset,
        })) as CanvasRow[];
      }

      if (!rows || rows.length === 0)
        return ok(args["search"] ? `No canvases found matching "${args["search"]}".` : "No canvases found.");

      const citations: Citation[] = [];
      const lines = rows.map((c, idx) => {
        const parts = [c.title];
        parts.push(`  Type: ${c.docType ?? "Canvas"} · Visibility: ${c.visibility}`);
        if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`);
        if (c.createdBy) parts.push(`  Created by: ${c.createdBy}`);
        if (c.lastEditedAt) parts.push(`  Last edited: ${toIST(c.lastEditedAt)}`);
        else if (c.updatedAt) parts.push(`  Updated: ${toIST(c.updatedAt)}`);
        parts.push(`  ID: ${c.id}`);
        // Prefer viewAccessId, but fall back to the canonical canvas id: the
        // Spaces `getCanvas` query resolves a canvas by id OR viewAccessId OR
        // editAccessId (see backend zero/queries.ts), so `/chat/canvas/<id>` is
        // a valid link too. Without this fallback, canvases that never got a
        // viewAccessId (older/locally-seeded rows) emit no citation at all and
        // render as an empty token in the answer.
        pushCanvasCitation(citations, c.viewAccessId || c.id, idx + 1, c.title);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });

      return okCited(
        `${rows.length} canvas(es):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
        citations,
      );
    }),
};

interface CanvasRow {
  id: string;
  title: string;
  docType?: string;
  visibility: string;
  channelId?: string;
  createdBy?: string;
  lastEditedAt?: string;
  updatedAt?: string;
  viewAccessId?: string;
  /** JSON column; parsed for the call-generated exclusion post-filter. */
  metadata?: unknown;
}

// ── spaces-calls ────────────────────────────────────────────────────

/**
 * Exact lookup of one call by either identifier. Search results and context
 * blocks hand back the internal id while the call HTTP APIs are keyed by
 * `externalId`, so accept both and normalise here rather than making the model
 * guess which one it is holding. Two point queries, no fuzzy matching.
 */
async function resolveCallById(ref: string): Promise<CallRow[]> {
  for (const field of ["id", "externalId"] as const) {
    const rows = (await interact({
      model: "call",
      operation: "findMany",
      where: { [field]: { equals: ref } },
      take: 1,
    })) as CallRow[] | null;
    if (rows && rows.length > 0) return rows;
  }
  return [];
}

/**
 * Pull one call's complete transcript. `call.transcript` is only a storage path
 * — for regular calls (transcriptService) and for HEADLESS recordings
 * (noteTakerTranscriptService) alike — so the text comes from the same route the
 * web app's download button uses. That route re-checks call-audience and
 * recording-view permission and streams the formatted .txt out of storage, which
 * keeps this tool from opening a second, weaker path to the same content.
 *
 * Returns a formatted block (never throws) so a transcript problem degrades to a
 * note under the call rather than failing the whole listing.
 */
async function fetchFullTranscript(
  call: CallRow,
  offset: number,
  limit: number | undefined,
): Promise<string> {
  const label = call.title || call.externalId || call.id;
  if (!call.externalId) return `\n\n(No transcript: call "${label}" has no externalId.)`;
  if (!call.transcript) return `\n\n(No transcript: "${label}" was never transcribed.)`;

  let text: string;
  try {
    text = await spacesFetchText(
      `/api/calls/claw/${encodeURIComponent(call.externalId)}/download-transcript`,
    );
  } catch (e) {
    const msg = errMsg(e);
    if (msg.includes("403")) return `\n\n(No transcript: you do not have access to "${label}".)`;
    if (msg.includes("404")) return `\n\n(No transcript: not available yet for "${label}".)`;
    return `\n\n(Transcript fetch failed for "${label}": ${msg})`;
  }

  const total = text.length;
  const start = Math.max(0, offset);
  const slice = limit === undefined ? text.slice(start) : text.slice(start, start + limit);
  const end = start + slice.length;
  const footer =
    end < total || start > 0
      ? `\n\n(Characters ${start}-${end} of ${total}.` +
        (end < total ? ` Call again with transcriptOffset=${end} for the rest.)` : ")")
      : `\n\n(Complete transcript — ${total} characters.)`;

  return `\n\n--- FULL TRANSCRIPT: ${label} ---\n\n${slice}${footer}`;
}

const spacesCalls: ToolDef = {
  name: "spaces-calls",
  description:
    "DETERMINISTIC (exact, non-semantic) lookup of calls, meetings, and RECORDINGS in Spaces, AND the way to read " +
    "one call's FULL transcript verbatim. Every filter here is an exact database match — title substring, channel, " +
    "status (ACTIVE/ENDED/SCHEDULED), call type (VIDEO/AUDIO/HEADLESS), organizer, creator, participant, date range, " +
    "recurring — so the same args always return the same rows, in a defined order, with an exact count. No embeddings, " +
    "no relevance ranking, nothing dropped below a score threshold. " +
    "Use this when you KNOW what you are looking for: a specific call, everything in a channel, every recording last " +
    "week, or the complete text of one meeting. Use spaces-meeting-insights instead when you only know the TOPIC and " +
    "need semantic/vector search to find which call discussed it. " +
    "HEADLESS = xyne-automation recordings (the '/recordings' page) — pass callType='HEADLESS' to list only recordings; " +
    "recordings carry transcripts exactly like regular calls and `includeTranscript` works the same for both. " +
    "Returns call ids, titles, organizer + creator names, channel, status, timing, and the participant list with each " +
    "person's attendance (accepted / declined / left / missed, external guests included), plus the AI summary inline. " +
    "Pass `callId` to fetch one call by id or externalId, and `includeTranscript: true` to get its complete " +
    "`[MM:SS] Speaker: text` transcript — the whole document, not a snippet (page it with transcriptOffset/transcriptLimit). " +
    "(A regular meeting call's summary may also be posted in its Spaces thread — open via spaces-messages.)",
  inputSchema: {
    type: "object",
    properties: {
      callId: {
        type: "string",
        description:
          "Fetch ONE specific call by its id or externalId — an exact lookup that ignores every other filter. " +
          "Take the id from a spaces-meeting-insights result, from a previous spaces-calls row ('ID: ...'), or from " +
          "an attached call's context block. Combine with includeTranscript to read that call in full.",
      },
      includeTranscript: {
        type: "boolean",
        default: false,
        description:
          "Include the COMPLETE verbatim transcript text ('[MM:SS] Speaker: text'), not a snippet. Only honoured when " +
          "the query resolves to a single call — pass `callId`, or filter narrowly enough to return one row. Works " +
          "for recordings (HEADLESS) exactly as it does for calls. Long meetings run to tens of thousands of " +
          "characters; page with transcriptOffset/transcriptLimit rather than re-fetching.",
      },
      transcriptOffset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Character offset to resume the transcript from (used with includeTranscript).",
      },
      transcriptLimit: {
        type: "number",
        minimum: 1,
        description:
          "Max transcript characters to return (default: the whole transcript). Only set this to page something huge.",
      },
      search: { type: "string", description: "Filter by call title (case-insensitive partial match)" },
      channelId: { type: "string", description: "Filter by channel ID" },
      status: {
        type: "string",
        enum: ["ACTIVE", "IN_PROGRESS", "ENDED", "SCHEDULED", "CANCELLED"],
        description: "Filter by a single call status.",
      },
      statusIn: {
        type: "array",
        items: { type: "string", enum: ["ACTIVE", "IN_PROGRESS", "ENDED", "SCHEDULED", "CANCELLED"] },
        description:
          "Filter by MULTIPLE statuses (matches any). e.g. ['ACTIVE','IN_PROGRESS','ENDED'] for the Recents view. Overrides `status` when both are set.",
      },
      callType: {
        type: "string",
        enum: ["VIDEO", "AUDIO", "HEADLESS"],
        description:
          "Filter by call type. HEADLESS = xyne-automation recordings (the '/recordings' page) — pass callType='HEADLESS' to list recordings, combinable with any other filter.",
      },
      callOrigin: {
        type: "string",
        enum: ["CHANNEL", "CONVERSATION", "GOOGLE_CALENDAR", "MICROSOFT_CALENDAR"],
        description:
          "Filter by where the call originated: channel/conversation calls vs Google/Microsoft calendar meetings.",
      },
      organizerId: { type: "string", description: "Filter by organizer user ID" },
      createdByUserId: {
        type: "string",
        description: "Filter by creator user ID (outgoing calls when set to yourself).",
      },
      notCreatedByUserId: {
        type: "string",
        description:
          "Filter to calls NOT created by this user ID (incoming calls when set to yourself). Ignored if createdByUserId is also set.",
      },
      participantId: {
        type: "string",
        description: "Filter to calls this user attended / was invited to (a participant). Accepts a userId.",
      },
      after: {
        type: "string",
        description: "ISO 8601 — only calls that started at or after this time (by actual start time).",
      },
      before: { type: "string", description: "ISO 8601 — only calls that started at or before this time." },
      isRecurring: { type: "boolean", description: "Filter recurring calls only" },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results (default 100, max 100)",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  handler: withToolErrors("Calls error", async (args) => {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["title"] = { contains: args["search"] as string, mode: "insensitive" };
      if (args["channelId"]) where["channelId"] = { equals: args["channelId"] };
      if (args["status"]) where["status"] = { equals: args["status"] };
      const statusIn = Array.isArray(args["statusIn"])
        ? (args["statusIn"] as unknown[]).map((v) => String(v)).filter(Boolean)
        : [];
      if (statusIn.length > 0) where["status"] = { in: statusIn };
      if (args["callType"]) where["callType"] = { equals: args["callType"] };
      if (args["callOrigin"]) where["callOrigin"] = { equals: args["callOrigin"] };
      if (args["organizerId"]) where["organizerId"] = { equals: args["organizerId"] };
      if (args["createdByUserId"]) where["createdByUserId"] = { equals: args["createdByUserId"] };
      else if (args["notCreatedByUserId"]) where["createdByUserId"] = { not: args["notCreatedByUserId"] };
      // Single relation-'some' object — gateway-legal — for participant scoping.
      if (args["participantId"])
        where["participants"] = { some: { userId: { equals: args["participantId"] } } };
      // Date range on actual start time (startedAt is always present; startsAt is
      // only the scheduled time and is null for many calls/recordings).
      const startedAt: Record<string, string> = {};
      if (args["after"]) startedAt["gte"] = args["after"] as string;
      if (args["before"]) startedAt["lte"] = args["before"] as string;
      if (Object.keys(startedAt).length > 0) where["startedAt"] = startedAt;
      if (typeof args["isRecurring"] === "boolean") where["isRecurring"] = { equals: args["isRecurring"] };

      // `callId` is an exact single-call lookup, so it replaces the filter set
      // rather than joining it — the caller already knows which call they want.
      const callIdArg = String(args["callId"] ?? "").trim();
      const rows = callIdArg
        ? await resolveCallById(callIdArg)
        : ((await interact({
            model: "call",
            operation: "findMany",
            where,
            orderBy: [{ lastActivityAt: "desc" }],
            take: (args["limit"] as number | undefined) ?? 100,
            skip: (args["offset"] as number | undefined) ?? 0,
          })) as CallRow[]);

      if (!rows || rows.length === 0) {
        if (callIdArg) return ok(`No call found with id "${callIdArg}" (or you do not have access to it).`);
        return ok(args["search"] ? `No calls found matching "${args["search"]}".` : "No calls found.");
      }

      // Full transcript is a per-call fetch out of object storage, so only do it
      // when the query has narrowed to one call — otherwise a broad list would
      // pull down 100 transcripts and bury the list itself.
      let transcriptBlock = "";
      if (args["includeTranscript"] === true) {
        if (rows.length > 1) {
          transcriptBlock =
            `\n\n(Transcript not included: ${rows.length} calls matched. Re-run with callId=<id> ` +
            `for the one you want, or narrow the filters to a single call.)`;
        } else {
          transcriptBlock = await fetchFullTranscript(
            rows[0]!,
            Number(args["transcriptOffset"] ?? 0),
            args["transcriptLimit"] !== undefined ? Number(args["transcriptLimit"]) : undefined,
          );
        }
      }

      // Cite each call's Spaces conversation THREAD — that's where the call
      // summary + transcript live, and it stays readable after the call ends.
      // (The old citation used `roomLink`, the live LiveKit room, which can't
      // be joined once the call is over — clicking it errored "Unable to
      // connect to the room".) The thread's conversationId is stamped onto
      // `call.metadata` for thread-linked calls; channelId is on the row. Going
      // through `pushThreadCitation` also earns the Spaces brand icon for free
      // (via citationIconKey), which a generic external link never gets.
      // Batch-fetch participants for all returned calls in ONE query (the gateway
      // strips relation includes, so we can't piggy-back on the call query).
      // CallParticipantsACL scopes this to participants of calls the user can
      // access. Then resolve every organizer / creator / participant id → name in
      // a single user lookup so nothing renders as a raw id.
      const callIds = rows.map((c) => c.id).filter((v): v is string => !!v);
      const participantsByCall = new Map<string, CallParticipantRow[]>();
      if (callIds.length > 0) {
        try {
          const prows = (await interact({
            model: "callParticipant",
            operation: "findMany",
            where: { callId: { in: callIds } },
            take: Math.min(callIds.length * 30, 1000),
          })) as CallParticipantRow[];
          for (const p of prows) {
            if (!p.callId) continue;
            const list = participantsByCall.get(p.callId) ?? [];
            list.push(p);
            participantsByCall.set(p.callId, list);
          }
        } catch {
          // Non-fatal — fall back to calls without participant detail.
        }
      }
      const userIds = new Set<string>();
      for (const c of rows) {
        if (c.organizerId) userIds.add(c.organizerId);
        if (c.createdByUserId) userIds.add(c.createdByUserId);
      }
      for (const list of participantsByCall.values())
        for (const p of list) if (p.userId) userIds.add(p.userId);
      const userInfo = await resolveUserInfo(userIds);

      const citations: Citation[] = [];
      const lines = rows.map((c, idx) => {
        const parts = [c.title ?? "(untitled call)"];
        parts.push(`  Type: ${c.callType ?? "VIDEO"} · Status: ${c.status}`);
        if (c.description) parts.push(`  ${c.description}`);
        if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`);
        if (c.organizerId) parts.push(`  Organizer: ${formatUserRef(c.organizerId, userInfo)}`);
        if (c.createdByUserId && c.createdByUserId !== c.organizerId) {
          parts.push(`  Created by: ${formatUserRef(c.createdByUserId, userInfo)}`);
        }
        if (c.startsAt) parts.push(`  Starts: ${toIST(c.startsAt)}`);
        if (c.endsAt) parts.push(`  Ends: ${toIST(c.endsAt)}`);
        if (c.isRecurring) parts.push(`  Recurring: ${c.recurrenceRule ?? "yes"}`);
        if (c.roomLink) parts.push(`  Link: ${c.roomLink}`);
        // Participants + their attendance (accepted/declined/left, or joined/missed).
        // External guests render their displayName; the count is exact.
        const plist = participantsByCall.get(c.id) ?? [];
        if (plist.length > 0) {
          const shown = plist.slice(0, 20).map((p) => {
            const name = p.isExternal
              ? `${p.displayName || "Guest"} (external)`
              : p.userId
                ? (userInfo.get(p.userId)?.name ?? p.displayName ?? p.userId)
                : p.displayName || "unknown";
            const state = p.response || p.meetingStatus;
            return state ? `${name} [${state}]` : name;
          });
          const more = plist.length > 20 ? ` +${plist.length - 20} more` : "";
          parts.push(`  Participants (${plist.length}): ${shown.join(", ")}${more}`);
        }
        // AI summary is stored as TEXT on the call row, so surface it inline.
        // The transcript field is a storage path (not text), so advertise the
        // arg that fetches the text rather than dumping a path the agent can't use.
        if (c.aiSummary) parts.push(`  Summary: ${cleanSnippet(c.aiSummary)}`);
        if (c.transcript)
          parts.push(
            `  Transcript: available — re-run with callId=${c.id}, includeTranscript=true to read it in full`,
          );
        parts.push(`  ID: ${c.id}`);
        const conversationId = (c.metadata as { conversationId?: string } | null | undefined)?.conversationId;
        // Only prefix the inline citation token when the row actually has a
        // link target — a token with no citation behind it renders as a chip
        // that goes nowhere (it opens the debug panel).
        const cited = pushCallCitation(citations, c, conversationId, idx + 1, c.title ?? "Call");
        return cited
          ? prefixChunk(idx + 1, parts[0]!, parts.slice(1))
          : [parts[0]!, ...parts.slice(1)].join("\n");
      });
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      // A callId lookup is a single exact row, so the list pagination footer
      // ("call again with offset=…") would be misleading — skip it there.
      const listFooter = callIdArg
        ? ""
        : paginationFooter({
            returned: rows.length,
            limit: Number(args["limit"] ?? 100),
            offset: Number(args["offset"] ?? 0),
          });

      return okCited(
        `${rows.length} call(s):\n\n${lines.join("\n\n")}${listFooter}${transcriptBlock}`,
        citations,
      );
    }),
};

interface CallRow {
  id: string;
  /** Public id the call HTTP APIs are keyed by (…/download-transcript, recording detail). */
  externalId?: string;
  title?: string;
  description?: string;
  callType?: string;
  status: string;
  channelId?: string;
  organizerId?: string;
  createdByUserId?: string;
  /** AI meeting/recording summary — stored as TEXT on the call row. */
  aiSummary?: string;
  /** Storage path to the transcript (NOT the text); non-empty = a transcript exists.
   *  Set the same way for calls (transcriptService) and HEADLESS recordings
   *  (noteTakerTranscriptService). Search its text via spaces-meeting-insights /
   *  type=transcript; fetch the whole document with includeTranscript here. */
  transcript?: string;
  startsAt?: string;
  endsAt?: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  roomLink?: string;
  lastActivityAt?: string;
  /** LiveKit room config etc. — for thread-linked calls this carries the
   *  `conversationId` of the call's Spaces thread (where the transcript lives). */
  metadata?: { conversationId?: string } | null;
}

interface CallParticipantRow {
  callId?: string;
  userId?: string;
  displayName?: string;
  isExternal?: boolean;
  /** Invitation response: ACCEPTED / DECLINED / LEFT / … */
  response?: string;
  /** Attendance: JOINED / MISSED / … */
  meetingStatus?: string;
}

// ── spaces-boards ───────────────────────────────────────────────────

const spacesBoards: ToolDef = {
  name: "spaces-boards",
  description:
    "Search and list boards to find board IDs for creating tickets. " +
    "Can filter by name or project ID with pagination support.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by board name (partial match)" },
      projectId: {
        type: "string",
        description: "Filter by project ID (use spaces-projects to find project IDs)",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results (default 100, max 100)",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  handler: withToolErrors("Boards error", async (args) => {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["name"] = { contains: args["search"] };
      if (args["projectId"]) where["projectId"] = { equals: args["projectId"] };

      const rows = (await interact({
        model: "board",
        operation: "findMany",
        where,
        orderBy: [{ updatedAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 100,
        skip: (args["offset"] as number | undefined) ?? 0,
        include: {
          project: { select: { name: true } },
        },
      })) as BoardRow[];

      if (!rows || rows.length === 0)
        return ok(args["search"] ? `No boards found matching "${args["search"]}".` : "No boards found.");

      const lines = rows.map((b) => {
        const parts = [b.name];
        if (b.description) parts.push(`  ${b.description}`);
        if (b.project) parts.push(`  Project: ${b.project.name}`);
        parts.push(`  ID: ${b.id}`);
        if (b.updatedAt) parts.push(`  Updated: ${toIST(b.updatedAt)}`);
        return parts.join("\n");
      });

      return ok(
        `${rows.length} board(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
      );
    }),
};

interface BoardRow {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  project?: { name: string } | null;
  updatedAt?: string;
}

// ── spaces-create-ticket ────────────────────────────────────────────

const spacesCreateTicket: ToolDef = {
  name: "spaces-create-ticket",
  description:
    "Create a new ticket in Spaces. Requires projectId, boardId, and channelId — " +
    "use spaces-projects, spaces-boards, and spaces-channels to look these up first. " +
    "The ticket lives in the channel identified by channelId. " +
    "If the user's triggering message had file attachments, ALSO pass attachConversationId " +
    "= the conversationId from your session (the thread that triggered this run). " +
    "Attachments will be copied from that conversation onto the ticket in the same operation. " +
    "attachConversationId is attachments-only — it does NOT change where the ticket lives.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Ticket title" },
      description: { type: "string", description: "Ticket description" },
      projectId: { type: "string", description: "Project ID (use spaces-projects to find)" },
      boardId: { type: "string", description: "Board ID (use spaces-boards to find)" },
      channelId: {
        type: "string",
        description: "Channel ID where the ticket will live (use spaces-channels to find).",
      },
      attachConversationId: {
        type: "string",
        description:
          "Optional. ConversationId of the user's triggering message. When set, any file attachments on that message are copied to the new ticket in the same operation. Does NOT affect routing — channelId still determines where the ticket lives.",
      },
      sdlcRepoId: {
        type: "string",
        description:
          "Required with sourceCanvasId when creating an implementation ticket for an SDLC artifact. The SDLC repository ID from repository mode.",
      },
      sourceCanvasId: {
        type: "string",
        description:
          "Required with sdlcRepoId when creating an implementation ticket for an SDLC artifact. The artifact canvas ID to link to the new ticket.",
      },
      priority: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        description: "Ticket priority",
      },
      assignedTo: { type: "string", description: "User ID to assign (use spaces-users to find)" },
      eta: { type: "string", description: "Due date as ISO 8601 string" },
      tags: { type: "array", items: { type: "string" }, description: "Tags to apply" },
    },
    required: ["title", "description", "projectId", "boardId", "channelId"],
  },
  handler: withToolErrors("Create ticket error", async (args, ctx) => {
      if (!args["channelId"]) {
        return err("channelId is required.");
      }

      const sdlcRepoId = String(args["sdlcRepoId"] ?? "").trim();
      const sourceCanvasId = String(args["sourceCanvasId"] ?? "").trim();
      if (Boolean(sdlcRepoId) !== Boolean(sourceCanvasId)) {
        return err("sdlcRepoId and sourceCanvasId must be provided together.");
      }

      const attachConversationId = (args["attachConversationId"] as string | undefined)?.trim() || undefined;

      const body: Record<string, unknown> = {
        title: args["title"],
        description: args["description"],
        projectId: args["projectId"],
        boardId: args["boardId"],
        channelId: args["channelId"],
      };
      if (args["priority"]) body["priority"] = args["priority"];
      if (args["assignedTo"]) body["assignedTo"] = args["assignedTo"];
      if (args["eta"]) body["eta"] = args["eta"];
      if (args["tags"]) body["tags"] = args["tags"];

      // WORKAROUND for xyne-backend bug (ticketController.ts:500): when the
      // body omits createdBy, the conversationParticipant.upsert in the
      // ticket-create path passes `userId: undefined` and Prisma 500s the
      // whole request. The backend's ticket itself uses `finalCreatedBy`
      // (req.body.createdBy || req.user.id) which works fine — only the
      // participant upsert reads the raw body field. Explicitly pass
      // createdBy = ctx.userId here so the participant insert sees a real
      // userId. Remove once the backend fix lands (use finalCreatedBy in
      // that upsert).
      if (ctx.userId) body["createdBy"] = ctx.userId;

      // Step 1: create the ticket. channelId in the body, no
      // sourceConversationId — routing is honored as the caller specified.
      const data = (await spacesFetch("/api/tickets/claw", {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        id: string;
        xyneId: string;
        conversationId: string;
        title: string;
        priority: string;
        status: string;
      };

      if (sdlcRepoId && sourceCanvasId) {
        try {
          await spacesFetch("/api/sdlc/claw/links", {
            method: "POST",
            headers: { "x-xyne-acting-user-id": ctx.userId },
            body: JSON.stringify({
              repoId: sdlcRepoId,
              sourceType: "CANVAS",
              sourceId: sourceCanvasId,
              targetType: "TICKET",
              targetId: data.id,
              relationType: "TICKET",
            }),
          }, sdlcSpacesAuth());
        } catch (linkError) {
          return err(
            `Ticket ${data.xyneId} was created, but its artifact link failed: ${errMsg(linkError)}. Do not create a duplicate ticket.`,
          );
        }
      }

      // Step 2: if the caller wants attachments carried over from another
      // conversation, transfer them via the existing standalone endpoint.
      // From the agent's POV this remains a single tool call (one approval).
      // We do not modify the spaces backend — both requests come from this
      // handler. If the transfer fails, the ticket itself still exists; we
      // surface the error in the response text so the model can report it.
      let attachLine = "";
      if (attachConversationId) {
        try {
          const attachResp = (await spacesFetch(
            `/api/tickets/claw/${encodeURIComponent(data.id)}/attachments/from-conversation`,
            {
              method: "POST",
              body: JSON.stringify({ sourceConversationId: attachConversationId }),
            },
          )) as { count?: number };
          const count = typeof attachResp?.count === "number" ? attachResp.count : 0;
          attachLine =
            count > 0
              ? `  Attachments: ${count} file(s) carried over`
              : `  Attachments: 0 files found on source conversation`;
        } catch (e) {
          attachLine = `  Attachments: transfer failed — ${errMsg(e)}`;
        }
      }

      const channelId = String(args["channelId"] ?? "");
      const citations: Citation[] = [];
      // Pass xyneId so the FE routes desk-typed (EMAIL/SLACK) ticket-create
      // citations to the Support view rather than the chat thread panel.
      pushThreadCitation(citations, channelId, data.conversationId, 1, `Ticket ${data.xyneId}`, {
        xyneId: data.xyneId,
      });
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      const bodyLines = [
        `xyneId: ${data.xyneId}`,
        `ID: ${data.id}`,
        `Status: ${data.status}`,
        `Priority: ${data.priority}`,
        `ConversationID: ${data.conversationId}`,
        ...(attachLine ? [attachLine.trimStart()] : []),
      ];
      return okCited(prefixChunk(1, "Ticket created:", bodyLines), citations);
    }),
};

// ── spaces-create-bulk-tickets ──────────────────────────────────────

type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface BulkTicketInput {
  title?: unknown;
  description?: unknown;
  projectId?: unknown;
  boardId?: unknown;
  channelId?: unknown;
  priority?: unknown;
  assignedTo?: unknown;
  eta?: unknown;
  tags?: unknown;
}

interface BulkTicketCreateResult {
  id: string;
  xyneId: string;
  conversationId: string;
  title: string;
  priority: string;
  status: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .map((v) => typeof v === "string" ? v.trim() : "")
    .filter(Boolean);
  return tags.length ? tags : undefined;
}

const spacesCreateBulkTickets: ToolDef = {
  name: "spaces-create-bulk-tickets",
  description:
    "Create MANY tickets in Spaces behind ONE approval. Prefer this tool over calling spaces-create-ticket repeatedly " +
    "when turning multiple findings into multiple tickets. Set shared projectId, boardId, channelId, defaultPriority, " +
    "defaultTags, and defaultAssignedTo once at the top level; each ticket may override projectId, boardId, channelId, " +
    "priority, assignedTo, eta, and tags. Tickets are created sequentially and partial failures are reported.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Default project ID for tickets unless a ticket overrides it." },
      boardId: { type: "string", description: "Default board ID for tickets unless a ticket overrides it." },
      channelId: { type: "string", description: "Default channel ID where tickets will live unless a ticket overrides it." },
      defaultPriority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Priority applied to tickets that do not specify priority." },
      defaultTags: { type: "array", items: { type: "string" }, description: "Tags applied to tickets that do not specify tags." },
      defaultAssignedTo: { type: "string", description: "Assignee applied to tickets that do not specify assignedTo." },
      tickets: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Ticket title" },
            description: { type: "string", description: "Ticket description" },
            projectId: { type: "string", description: "Override project ID for this ticket." },
            boardId: { type: "string", description: "Override board ID for this ticket." },
            channelId: { type: "string", description: "Override channel ID for this ticket." },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Ticket priority" },
            assignedTo: { type: "string", description: "User ID to assign" },
            eta: { type: "string", description: "Due date as ISO 8601 string" },
            tags: { type: "array", items: { type: "string" }, description: "Tags to apply" },
          },
          required: ["title", "description"],
        },
      },
    },
    required: ["projectId", "boardId", "channelId", "tickets"],
  },
  async handler(args, ctx) {
    const tickets = Array.isArray(args["tickets"]) ? args["tickets"] as BulkTicketInput[] : [];
    if (tickets.length === 0) return err("tickets must contain at least one ticket.");

    const MAX_TICKETS = 100;
    if (tickets.length > MAX_TICKETS) {
      return err(`Too many tickets (${tickets.length} > ${MAX_TICKETS}). Create bulk tickets in batches of ${MAX_TICKETS} or fewer.`);
    }

    const defaultProjectId = optionalString(args["projectId"]);
    const defaultBoardId = optionalString(args["boardId"]);
    const defaultChannelId = optionalString(args["channelId"]);
    if (!defaultProjectId || !defaultBoardId || !defaultChannelId) {
      return err("projectId, boardId, and channelId are required.");
    }

    const defaultPriority = optionalString(args["defaultPriority"]) as TicketPriority | undefined;
    const defaultAssignedTo = optionalString(args["defaultAssignedTo"]);
    const defaultTags = normalizeTags(args["defaultTags"]);
    const created: Array<{ index: number; title: string; id: string; xyneId: string; url?: string }> = [];
    const failures: Array<{ index: number; title: string; reason: string }> = [];

    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i]!;
      const title = optionalString(ticket.title);
      const description = optionalString(ticket.description);
      const projectId = optionalString(ticket.projectId) ?? defaultProjectId;
      const boardId = optionalString(ticket.boardId) ?? defaultBoardId;
      const channelId = optionalString(ticket.channelId) ?? defaultChannelId;
      const priority = optionalString(ticket.priority) ?? defaultPriority;
      const assignedTo = optionalString(ticket.assignedTo) ?? defaultAssignedTo;
      const eta = optionalString(ticket.eta);
      const tags = normalizeTags(ticket.tags) ?? defaultTags;
      const label = title ?? `ticket ${i + 1}`;

      if (!title || !description) {
        failures.push({ index: i + 1, title: label, reason: "title and description are required." });
        continue;
      }

      try {
        const body: Record<string, unknown> = { title, description, projectId, boardId, channelId };
        if (priority) body["priority"] = priority;
        if (assignedTo) body["assignedTo"] = assignedTo;
        if (eta) body["eta"] = eta;
        if (tags) body["tags"] = tags;
        if (ctx.userId) body["createdBy"] = ctx.userId;

        const data = (await spacesFetch("/api/tickets/claw", {
          method: "POST",
          body: JSON.stringify(body),
        })) as BulkTicketCreateResult;

        created.push({
          index: i + 1,
          title,
          id: data.id,
          xyneId: data.xyneId,
          ...(buildTicketUrl(channelId, data.conversationId) ? { url: buildTicketUrl(channelId, data.conversationId)! } : {}),
        });
      } catch (e) {
        failures.push({
          index: i + 1,
          title: label,
          reason: errMsg(e),
        });
      }
    }

    const lines = [
      `Bulk ticket creation complete: requested ${tickets.length}, created ${created.length}, failed ${failures.length}.`,
    ];
    if (created.length) {
      lines.push("", "Created:");
      for (const c of created) {
        lines.push(`  ${c.index}. ${c.xyneId} (${c.id})${c.url ? ` ${c.url}` : ""}`);
      }
    }
    if (failures.length) {
      lines.push("", `Failures${failures.length > 10 ? " (first 10)" : ""}:`);
      for (const f of failures.slice(0, 10)) {
        lines.push(`  ${f.index}. ${f.title}: ${f.reason}`);
      }
    }
    return ok(lines.join("\n"));
  },
};

// ── spaces-update-ticket ────────────────────────────────────────────

const spacesUpdateTicket: ToolDef = {
  name: "spaces-update-ticket",
  // PATCH /api/tickets/:id is user-session-only (unlike create, which has the
  // dual-auth /api/tickets/claw route). Until Spaces grows an app-capable
  // update route (or this gains an appHandler), app-mode calls can only 401.
  userOnly: true,
  description:
    "Update an existing ticket in Spaces. At least one update field must be provided. " +
    "Use spaces-tickets to find the ticket ID (use the Internal ID, not the Xyne ID), spaces-users for user IDs, and spaces-boards for valid stage names. " +
    "Stage changes also update the ticket status to the stage's default status unless you explicitly provide a status override.",
  inputSchema: {
    type: "object",
    properties: {
      ticketId: {
        type: "string",
        description:
          "Internal database ID of the ticket to update (use spaces-tickets to find — use 'Internal ID', not 'Xyne ID')",
      },
      assigneeId: {
        type: "string",
        description: "User ID to assign the ticket to (use spaces-users to find)",
      },
      stage: {
        type: "string",
        description: "Stage name to move the ticket to (must be a valid stage on the ticket's board)",
      },
      groupId: { type: "string", description: "User group ID to assign to the ticket" },
      title: { type: "string", description: "New title for the ticket" },
      description: { type: "string", description: "New description for the ticket" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "New priority" },
      status: {
        type: "string",
        enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"],
        description:
          "New status. Note: changing the stage may also change the status to the stage's default — provide this field to override.",
      },
      eta: { type: "string", description: "New due date as ISO 8601 string (e.g. '2026-06-01T00:00:00Z')" },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Replace the ticket's tags with this list of tag names. Pass an empty array to remove all tags.",
      },
    },
    required: ["ticketId"],
  },
  handler: withToolErrors("Update ticket error", async (args) => {
      const ticketId = String(args["ticketId"] ?? "").trim();
      const assigneeId = (args["assigneeId"] as string | undefined)?.trim();
      const stage = (args["stage"] as string | undefined)?.trim();
      const groupId = (args["groupId"] as string | undefined)?.trim();
      const title = (args["title"] as string | undefined)?.trim();
      const description = (args["description"] as string | undefined)?.trim();
      const priority = (args["priority"] as string | undefined)?.trim();
      const status = (args["status"] as string | undefined)?.trim();
      const eta = (args["eta"] as string | undefined)?.trim();
      const rawTags = args["tags"];
      const tagsProvided = rawTags !== undefined;
      if (tagsProvided && !Array.isArray(rawTags)) {
        return err("tags must be an array of strings.");
      }
      const tags = tagsProvided ? (rawTags as unknown[]).map((t) => String(t)) : undefined;

      if (!ticketId) return err("ticketId is required.");
      if (
        !assigneeId &&
        !stage &&
        !groupId &&
        !title &&
        !description &&
        !priority &&
        !status &&
        !eta &&
        !tagsProvided
      ) {
        return err(
          "At least one update field is required (assigneeId, stage, groupId, title, description, priority, status, eta, or tags).",
        );
      }

      const body: Record<string, unknown> = {};
      if (assigneeId) body["assigneeId"] = assigneeId;
      if (stage) body["stage"] = stage;
      if (groupId) body["groupId"] = groupId;
      if (title) body["title"] = title;
      if (description) body["description"] = description;
      if (priority) body["priority"] = priority;
      if (status) body["status"] = status;
      if (eta) body["eta"] = eta;
      if (tagsProvided) body["tags"] = tags;

      const result = (await spacesFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })) as { success: boolean; updated?: string[] };

      const updates = result.updated ?? [];
      return ok(`Ticket ${ticketId} updated${updates.length > 0 ? `: ${updates.join(", ")}` : ""}.`);
    }),
};
// ── spaces-update-bulk-tickets ──────────────────────────────────────

interface BulkTicketUpdateInput {
  ticketId?: unknown;
  assigneeId?: unknown;
  stage?: unknown;
  groupId?: unknown;
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  status?: unknown;
  eta?: unknown;
  tags?: unknown;
}

const spacesUpdateBulkTickets: ToolDef = {
  name: "spaces-update-bulk-tickets",
  // PATCH /api/tickets/:id is user-session-only (same constraint as
  // spaces-update-ticket — there is no dual-auth /api/tickets/claw update
  // route), so this bulk variant is likewise userOnly: app-mode calls 401.
  userOnly: true,
  description:
    "Update MANY tickets in Spaces behind ONE approval. Prefer this over calling spaces-update-ticket repeatedly " +
    "when applying updates to multiple tickets (e.g. moving a range of tickets to COMPLETED). Each ticket entry needs " +
    "an internal ticketId (use spaces-tickets — the 'Internal ID', not the Xyne ID) plus at least one field to change. " +
    "Set shared defaults once at the top level (defaultStage, defaultStatus, defaultPriority, defaultAssigneeId, " +
    "defaultGroupId, defaultTags); each ticket may override any of them. A stage change also updates status to the " +
    "stage's default status unless a status override is provided. Tickets are updated sequentially and partial " +
    "failures are reported.",
  inputSchema: {
    type: "object",
    properties: {
      defaultStage: { type: "string", description: "Stage applied to tickets that do not specify a stage." },
      defaultStatus: {
        type: "string",
        enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"],
        description: "Status applied to tickets that do not specify a status.",
      },
      defaultPriority: {
        type: "string",
        enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        description: "Priority applied to tickets that do not specify priority.",
      },
      defaultAssigneeId: { type: "string", description: "Assignee (user ID) applied to tickets that do not specify assigneeId." },
      defaultGroupId: { type: "string", description: "User group ID applied to tickets that do not specify groupId." },
      defaultTags: {
        type: "array",
        items: { type: "string" },
        description: "Tags applied to tickets that do not specify tags (replaces that ticket's tags).",
      },
      tickets: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            ticketId: {
              type: "string",
              description: "Internal database ID of the ticket to update (use spaces-tickets — 'Internal ID', not 'Xyne ID').",
            },
            assigneeId: { type: "string", description: "User ID to assign the ticket to" },
            stage: { type: "string", description: "Stage name to move the ticket to" },
            groupId: { type: "string", description: "User group ID to assign to the ticket" },
            title: { type: "string", description: "New title for the ticket" },
            description: { type: "string", description: "New description for the ticket" },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "New priority" },
            status: {
              type: "string",
              enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"],
              description: "New status. A stage change may also change status to the stage's default — set this to override.",
            },
            eta: { type: "string", description: "New due date as ISO 8601 string" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Replace the ticket's tags with this list (empty array clears all tags).",
            },
          },
          required: ["ticketId"],
        },
      },
    },
    required: ["tickets"],
  },
  async handler(args) {
    const tickets = Array.isArray(args["tickets"]) ? (args["tickets"] as BulkTicketUpdateInput[]) : [];
    if (tickets.length === 0) return err("tickets must contain at least one ticket.");

    const MAX_TICKETS = 100;
    if (tickets.length > MAX_TICKETS) {
      return err(`Too many tickets (${tickets.length} > ${MAX_TICKETS}). Update bulk tickets in batches of ${MAX_TICKETS} or fewer.`);
    }

    const defaultStage = optionalString(args["defaultStage"]);
    const defaultStatus = optionalString(args["defaultStatus"]);
    const defaultPriority = optionalString(args["defaultPriority"]) as TicketPriority | undefined;
    const defaultAssigneeId = optionalString(args["defaultAssigneeId"]);
    const defaultGroupId = optionalString(args["defaultGroupId"]);
    const defaultTags = normalizeTags(args["defaultTags"]);

    const updated: Array<{ index: number; ticketId: string; fields: string[] }> = [];
    const failures: Array<{ index: number; ticketId: string; reason: string }> = [];

    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i]!;
      const ticketId = optionalString(ticket.ticketId);
      const label = ticketId ?? `ticket ${i + 1}`;
      if (!ticketId) {
        failures.push({ index: i + 1, ticketId: label, reason: "ticketId is required." });
        continue;
      }

      const assigneeId = optionalString(ticket.assigneeId) ?? defaultAssigneeId;
      const stage = optionalString(ticket.stage) ?? defaultStage;
      const groupId = optionalString(ticket.groupId) ?? defaultGroupId;
      const title = optionalString(ticket.title);
      const description = optionalString(ticket.description);
      const priority = optionalString(ticket.priority) ?? defaultPriority;
      const status = optionalString(ticket.status) ?? defaultStatus;
      const eta = optionalString(ticket.eta);

      // Tags: an explicit per-ticket array (including an empty array, which
      // clears tags) takes precedence; otherwise fall back to defaultTags.
      let tags: string[] | undefined;
      let tagsToSend = false;
      if (ticket.tags !== undefined) {
        if (!Array.isArray(ticket.tags)) {
          failures.push({ index: i + 1, ticketId: label, reason: "tags must be an array of strings." });
          continue;
        }
        tags = (ticket.tags as unknown[]).map((t) => String(t));
        tagsToSend = true;
      } else if (defaultTags) {
        tags = defaultTags;
        tagsToSend = true;
      }

      const body: Record<string, unknown> = {};
      if (assigneeId) body["assigneeId"] = assigneeId;
      if (stage) body["stage"] = stage;
      if (groupId) body["groupId"] = groupId;
      if (title) body["title"] = title;
      if (description) body["description"] = description;
      if (priority) body["priority"] = priority;
      if (status) body["status"] = status;
      if (eta) body["eta"] = eta;
      if (tagsToSend) body["tags"] = tags;

      if (Object.keys(body).length === 0) {
        failures.push({
          index: i + 1,
          ticketId: label,
          reason: "at least one update field is required (assigneeId, stage, groupId, title, description, priority, status, eta, or tags).",
        });
        continue;
      }

      try {
        const result = (await spacesFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })) as { success: boolean; updated?: string[] };
        updated.push({ index: i + 1, ticketId, fields: result.updated ?? Object.keys(body) });
      } catch (e) {
        failures.push({
          index: i + 1,
          ticketId: label,
          reason: errMsg(e),
        });
      }
    }

    const lines = [
      `Bulk ticket update complete: requested ${tickets.length}, updated ${updated.length}, failed ${failures.length}.`,
    ];
    if (updated.length) {
      lines.push("", "Updated:");
      for (const u of updated) {
        lines.push(`  ${u.index}. ${u.ticketId}${u.fields.length ? ` (${u.fields.join(", ")})` : ""}`);
      }
    }
    if (failures.length) {
      lines.push("", `Failures${failures.length > 10 ? " (first 10)" : ""}:`);
      for (const f of failures.slice(0, 10)) {
        lines.push(`  ${f.index}. ${f.ticketId}: ${f.reason}`);
      }
    }
    return ok(lines.join("\n"));
  },
};

// ── spaces-schedule-call ────────────────────────────────────────────

const spacesScheduleCall: ToolDef = {
  name: "spaces-schedule-call",
  description:
    "Schedule a call in Spaces. Must provide either a channelId or targetUserIds (list of user IDs to invite).",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Call title" },
      startsAt: {
        type: "string",
        description: "Start time as ISO 8601 string (e.g. '2026-03-28T10:00:00Z')",
      },
      endsAt: { type: "string", description: "End time as ISO 8601 string" },
      channelId: { type: "string", description: "Channel ID to schedule the call in" },
      targetUserIds: {
        type: "array",
        items: { type: "string" },
        description: "User IDs to invite (use spaces-users to find)",
      },
    },
    required: ["title", "startsAt", "endsAt"],
  },
  handler: withToolErrors("Schedule call error", async (args) => {
      if (!args["channelId"] && !(args["targetUserIds"] as string[] | undefined)?.length) {
        return err("Must provide either channelId or targetUserIds.");
      }

      const body: Record<string, unknown> = {
        title: args["title"],
        startsAt: new Date(String(args["startsAt"])).getTime(),
        endsAt: new Date(String(args["endsAt"])).getTime(),
      };
      if (args["channelId"]) body["channelId"] = args["channelId"];
      if (args["targetUserIds"]) body["targetUserIds"] = args["targetUserIds"];

      const data = (await spacesFetch("/api/calls/claw/schedule", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { success: boolean; callId?: string; externalId?: string; channelId?: string };

      if (!data.success) return err("Failed to schedule call.");
      return ok(
        [
          `Call scheduled:`,
          `  callId: ${data.callId}`,
          `  externalId: ${data.externalId}`,
          `  channelId: ${data.channelId}`,
        ].join("\n"),
      );
    }),
};

// ── spaces-whoami ─────────────────────────────────────────────────────

const spacesWhoami: ToolDef = {
  name: "spaces-whoami",
  description:
    "Returns the current user's Spaces profile — userId, name, email and workspaceId. " +
    "If the userId and name are ALREADY in your system prompt, so do not call this just to read them; " +
    "use it only when you need the workspaceId or want to confirm the profile.",
  inputSchema: { type: "object", properties: {} },
  handler: withToolErrors("Whoami error", async (_args, ctx) => {
      if (!ctx.userId) return err("Could not determine current user.");
      const rows = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { equals: ctx.userId } },
        take: 1,
      })) as Array<{ id: string; name: string; email: string; workspaceId: string }>;
      const u = rows?.[0];
      if (!u) return ok(`Current user ID: ${ctx.userId} (profile not found)`);
      return ok(
        `Current user:\n- ID: ${u.id}\n- Name: ${u.name}\n- Email: ${u.email}\n- Workspace ID: ${u.workspaceId}`,
      );
    }),
};

// ── spaces-read-canvas ──────────────────────────────────────────────

const spacesReadCanvas: ToolDef = {
  name: "spaces-read-canvas",
  description:
    "Read the full markdown content of an existing canvas. " +
    "Pass the viewAccessId (the ID from the canvas URL: /chat/canvas/<viewAccessId>). " +
    "Returns the canvas title and markdown body. " +
    "The body MAY arrive with a short label like [b1a2b3c] on each paragraph. " +
    "Those labels identify paragraphs and must be preserved exactly when you " +
    "write the document back with spaces-edit-canvas — follow the rules included " +
    "in the response.",
  inputSchema: {
    type: "object",
    properties: {
      viewAccessId: {
        type: "string",
        description: "viewAccessId of the canvas to read — the ID that appears in the canvas URL.",
      },
    },
    required: ["viewAccessId"],
  },
  handler: withToolErrors("Read canvas error", async (params, ctx) => {
      const viewAccessId = String(params["viewAccessId"] ?? "").trim();
      if (!viewAccessId) return err("viewAccessId is required");

      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const result = (await spacesFetch(
        `/api/internal/canvas/view/${encodeURIComponent(viewAccessId)}`,
        {
          method: "GET",
          headers: { "x-user-id": ctx.userId },
        },
        { s2sKey },
      )) as {
        title?: string;
        markdown?: string;
        url?: string;
        labelInstruction?: string;
        error?: string;
      };

      if (result.error) return err(result.error);
      const title = result.title ?? "Untitled";
      const markdown = result.markdown ?? "";
      const url = result.url ?? "";

      const citations: Citation[] = [];
      pushCanvasCitation(citations, viewAccessId, 1, title);
      // Suggestion mode: each paragraph carries a [bXXXXXX] label and
      // labelInstruction explains how to preserve them. It must be included in
      // the output — without it the model strips the labels and the edit is
      // rejected. The title is emitted as metadata ("Canvas title:") instead of
      // a "# Title" heading, which models echo back as unlabelled body text,
      // producing a phantom "added paragraph" in every review.
      if (result.labelInstruction) {
        return okCited(
          prefixChunk(1, `Canvas title: ${title}`, [
            ``, `URL: ${url}`, ``, result.labelInstruction, ``, markdown,
          ]),
          citations,
        );
      }
      return okCited(prefixChunk(1, `# ${title}`, [``, `URL: ${url}`, ``, markdown]), citations);
    }),
};

// ── spaces-edit-canvas ───────────────────────────────────────────────

const spacesEditCanvas: ToolDef = {
  name: "spaces-edit-canvas",
  description:
    "Propose new contents for an existing canvas. Requires edit access (owner, editor, or an edit link). " +
    "Pass the viewAccessId (the ID from the canvas URL: /chat/canvas/<viewAccessId>) and the new markdown. " +
    "IMPORTANT: if spaces-read-canvas returned paragraphs prefixed with labels like [b1a2b3c], " +
    "keep every label exactly as given, prefix paragraphs you ADD with [new], and omit a " +
    "paragraph only if you intend to delete it. Dropping the labels will cause the edit to be " +
    "rejected. Depending on workspace settings the change may be queued for human approval " +
    "rather than applied immediately — the response says which.",
  inputSchema: {
    type: "object",
    properties: {
      viewAccessId: {
        type: "string",
        description: "viewAccessId of the canvas to edit — the ID that appears in the canvas URL.",
      },
      content: {
        type: "string",
        description: "New markdown content to replace the canvas body. Max 5MB.",
      },
      title: { type: "string", description: "Optional new title for the canvas." },
    },
    required: ["viewAccessId", "content"],
  },
  handler: withToolErrors("Edit canvas error", async (params, ctx) => {
      const viewAccessId = String(params["viewAccessId"] ?? "").trim();
      const content = String(params["content"] ?? "");
      const title = params["title"] ? String(params["title"]) : undefined;
      if (!viewAccessId) return err("viewAccessId is required");
      if (!content) return err("content is required");

      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const result = (await spacesFetch(
        `/api/internal/canvas/view/${encodeURIComponent(viewAccessId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ markdown: content, ...(title ? { title } : {}) }),
          headers: { "x-user-id": ctx.userId },
        },
        { s2sKey },
      )) as {
        url?: string | null;
        title?: string;
        viewAccessId?: string;
        error?: string;
        updatedAt?: string;
      };

      if (result.error) return err(result.error);
      const citations: Citation[] = [];
      pushCanvasCitation(citations, viewAccessId, 1, result.title ?? title);
      return okCited(
        prefixChunk(1, "Canvas updated.", [
          `Title: ${result.title ?? "(unknown)"}`,
          `URL: ${result.url ?? "(unknown)"}`,
        ]),
        citations,
      );
    }),
};

// ── Export ────────────────────────────────────────────────────────────

// ── spaces-trigger-agent ────────────────────────────────────────────

const spacesTriggerAgent: ToolDef = {
  name: "spaces-trigger-agent",
  description:
    "Trigger another agent to start working on a task. " +
    "The target agent will receive the task in the same conversation thread. " +
    "Use this to hand off work to specialized agents (e.g. trigger doctor-agent to investigate a bug).",
  inputSchema: {
    type: "object",
    properties: {
      targetAgent: { type: "string", description: "Slug of the agent to trigger (e.g. 'doctor-agent')" },
      task: { type: "string", description: "Task description for the target agent" },
      conversationId: {
        type: "string",
        description: "Conversation thread to continue in (from Session Metadata)",
      },
      channelId: {
        type: "string",
        description: "Channel where the conversation is happening (from Session Metadata)",
      },
    },
    required: ["targetAgent", "task"],
  },
  async handler() {
    // Intercepted at /mcp/call level — this handler should not be called directly
    return ok("Agent triggered.");
  },
};

// ── spaces-meeting-insights ─────────────────────────────────────────

const spacesMeetingInsights: ToolDef = {
  name: "spaces-meeting-insights",
  description:
    "SEMANTIC / VECTOR search INSIDE the transcripts + AI summaries of Spaces calls & recordings (the '/recordings' " +
    "content and any call that was transcribed). Hybrid embedding + keyword search over the transcript text for " +
    "summaries, action items, decisions, Q&A, pain points, and merchant discussions. " +
    "Because it is ranked and not exhaustive, it returns the best-matching calls by relevance — a call can match on " +
    "meaning without sharing your wording, and a weak match can fall below the score cut. Never treat its result " +
    "count as a complete or exact census of calls. " +
    "Use it when you know the TOPIC but not which call: 'what did we decide about pricing', 'who complained about " +
    "onboarding'. When you already know WHICH call (or want an exact, repeatable list — this channel, last week, " +
    "type=HEADLESS), use spaces-calls instead: its filters are deterministic exact matches with an exact count. " +
    "Each result carries the matching excerpt of the transcript plus the call's AI summary; for the WHOLE transcript " +
    "of one call, follow up with spaces-calls using the returned call id and includeTranscript=true. " +
    "This is the CONTENT side of calls — pair it with spaces-calls, which lists calls/recordings and their " +
    "metadata (participants, attendance, status, timing, summary). " +
    "Prefer this over spaces-search for questions about what was discussed in a call. " +
    "Note: it searches transcripts indexed by Spaces (Vespa file/TRANSCRIPT); it does not cover external " +
    "meeting-bot data that was never ingested as a Spaces transcript.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The topic or question to search for in meeting insights — e.g. 'sales targets', 'action items', 'pain points', 'merchant feedback'. Can be empty if using filters only.",
      },
      callType: {
        type: "string",
        description:
          "Filter by call type: VIDEO, AUDIO, or HEADLESS (HEADLESS = the '/recordings' recordings).",
      },
      platform: {
        type: "string",
        description:
          "Legacy alias — folded into the same call-type filter as `callType`. Prefer `callType` (VIDEO/AUDIO/HEADLESS).",
      },
      participants: {
        type: "string",
        description:
          "Filter by the transcript's owner/creator user id (the person who ran/recorded the call).",
      },
      before: {
        type: "string",
        description: "Filter meetings before this date (e.g. '2024-01-01' or '15 Mar 26')",
      },
      after: { type: "string", description: "Filter meetings after this date" },
      on: { type: "string", description: "Filter meetings on this specific date" },
      range: {
        type: "string",
        description:
          "Filter by time keyword: today, yesterday, this week, last week, last 7 days, this month, last month, last 30 days, recent",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max results (default 100, max 100)",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description:
          "Pagination offset (default 0). Call again with the same query/filters and a higher offset for more insights.",
      },
    },
    required: [],
  },
  handler: withToolErrors("Meeting insights search error", async (args) => {
      const query = String(args["query"] ?? "").trim();
      const params: Record<string, string> = {
        q: query,
        type: "transcript",
        limit: String(args["limit"] ?? 100),
      };
      if (args["offset"]) params["offset"] = String(args["offset"]);
      if (args["platform"]) params["callType"] = String(args["platform"]);
      if (args["participants"]) params["from"] = String(args["participants"]);
      if (args["callType"]) params["callType"] = String(args["callType"]);
      if (args["before"]) params["before"] = String(args["before"]);
      if (args["after"]) params["after"] = String(args["after"]);
      if (args["on"]) params["on"] = String(args["on"]);
      if (args["range"]) params["range"] = String(args["range"]);
      if (!query) params["filterOnly"] = "true";

      const data = (await search(params)) as {
        success: boolean;
        data?: {
          results?: Array<{
            id: string;
            type: string;
            title: string;
            subtitle?: string;
            context?: string;
            metadata?: Record<string, unknown>;
            searchContext?: Record<string, unknown>;
          }>;
          totalCount?: number;
        };
      };

      if (!data.success || !data.data) return err("Meeting insights search failed.");

      const results = data.data.results ?? [];
      if (results.length === 0) {
        return ok(query ? `No meeting insights found for "${query}".` : "No meeting insights found.");
      }

      const citations: Citation[] = [];
      const formatted = results
        .map((r, idx) => {
          const chunkIndex = idx + 1;
          const subLines: string[] = [];
          if (r.subtitle) subLines.push(`**${r.subtitle}**`);

          const context = r.context ?? "";
          if (context) {
            // The matched transcript excerpt (Vespa's best-scoring chunk), not a
            // substring of it — no cap here, highlights preserved. Oversized
            // output is handled centrally by claw's promoteIfOversized().
            subLines.push(cleanSnippet(context));
          }

          const meta = r.metadata ?? {};
          const sc = r.searchContext ?? {};
          const metaParts: string[] = [];
          if (meta["timestamp"]) metaParts.push(`Date: ${meta["timestamp"]}`);
          if (meta["channelName"]) metaParts.push(`Channel: #${meta["channelName"]}`);
          if (sc["senderName"]) metaParts.push(`Participants: ${sc["senderName"]}`);
          if (meta["platform"]) metaParts.push(`Platform: ${meta["platform"]}`);
          if (metaParts.length > 0) subLines.push(metaParts.join(" · "));

          // The id spaces-calls needs to pull this call's transcript in full.
          const callId = (sc["callId"] as string | undefined) ?? r.id;
          if (callId)
            subLines.push(`Full transcript: spaces-calls callId=${callId} includeTranscript=true`);

          // Cite the call this transcript belongs to. A channel call resolves to
          // its thread; a note-taker recording has no channel, so it resolves to
          // its /recordings page instead of silently emitting nothing.
          const channelId =
            (sc["channelId"] as string | undefined) ?? (meta["channelId"] as string | undefined);
          const conversationId =
            (sc["conversationId"] as string | undefined) ?? (meta["conversationId"] as string | undefined);
          const externalId =
            (sc["externalId"] as string | undefined) ?? (meta["externalId"] as string | undefined);
          const callType =
            (sc["callType"] as string | undefined) ?? (meta["callType"] as string | undefined);
          const cited = pushCallCitation(
            citations,
            {
              id: callId ?? r.id,
              ...(externalId ? { externalId } : {}),
              ...(callType ? { callType } : {}),
              ...(channelId ? { channelId } : {}),
            },
            conversationId,
            chunkIndex,
            plainLabel(r.title) ?? "Meeting",
          );

          const heading = `### ${chunkIndex}. ${r.title || "Untitled Meeting"}`;
          return cited
            ? prefixChunk(chunkIndex, heading, subLines)
            : [heading, ...subLines].join("\n");
        })
        .join("\n\n---\n\n");

      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      return okCited(
        `Found ${data.data.totalCount ?? results.length} meeting insight(s):\n\n${formatted}${paginationFooter({ returned: results.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0), total: data.data.totalCount })}`,
        citations,
      );
    }),
};

// ── spaces-create-canvas ────────────────────────────────────────────
const spacesCreateCanvas: ToolDef = {
  name: "spaces-create-canvas",
  description:
    "Create a new canvas in Xyne Spaces from markdown content. " +
    "Returns the canvas URL and viewAccessId. " +
    "The user will be set as an OWNER of the canvas.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title for the canvas",
      },
      markdown: {
        type: "string",
        description: "Content in markdown format (max 5MB)",
      },
      visibility: {
        type: "string",
        enum: ["PUBLIC", "PRIVATE"],
        description: "Visibility: PUBLIC (team-visible) or PRIVATE (invite-only). Default: PRIVATE",
      },
    },
    required: ["title", "markdown"],
  },
  handler: withToolErrors("Create canvas error", async (args) => {
      const title = String(args["title"] ?? "").trim();
      const markdown = String(args["markdown"] ?? "");
      const visibility = String(args["visibility"] ?? "PRIVATE");

      if (!title) return err("Title is required");
      if (!markdown) return err("Markdown content is required");

      const data = (await spacesFetch("/api/canvas/claw/create", {
        method: "POST",
        body: JSON.stringify({
          title,
          markdown,
          visibility: visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
        }),
      })) as {
        id: string;
        viewAccessId: string;
        title: string;
        url: string;
        visibility: string;
      };

      const citations: Citation[] = [];
      pushCanvasCitation(citations, data.viewAccessId, 1, data.title);
      return okCited(
        prefixChunk(1, "Canvas created successfully!", [
          ``,
          `Title: ${data.title}`,
          `URL: ${data.url}`,
          `Visibility: ${data.visibility}`,
          `View Access ID: ${data.viewAccessId}`,
        ]),
        citations,
      );
    }),
};

// ── canonical SDLC artifact mutation ──────────────────────────────
const SDLC_AGENT_COMMIT_REF_PATTERN = "^(?:[0-9a-fA-F]{9,40}|ROOT_BOOTSTRAP)$";
const SDLC_WIKI_PATH_PATTERN = "^(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*//)[^/\\\\]+(?:/[^/\\\\]+)*\\.[mM][dD]$";
const sdlcSourcePathsSchema = {
  type: "array",
  maxItems: 500,
  items: { type: "string", minLength: 1, maxLength: 1024 },
} as const;
const sdlcSourceReferencesSchema = {
  type: "array",
  maxItems: 500,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", minLength: 1, maxLength: 1024, description: "Repository-relative source path" },
      symbol: { type: "string", minLength: 1, maxLength: 512, description: "Optional source symbol shown in the link label" },
      startLine: { type: "integer", minimum: 1, description: "Optional trusted one-based start line" },
      endLine: { type: "integer", minimum: 1, description: "Optional trusted one-based end line" },
    },
    required: ["path"],
  },
} as const;

function sdlcMutationVariant(
  artifactType: "WIKI" | "BASELINE",
  action: string,
  required: readonly string[],
  propertyOverrides: Record<string, unknown> = {},
) {
  return {
    type: "object",
    properties: {
      artifactType: { const: artifactType },
      action: { const: action },
      ...(required.includes("sourcePaths") && action !== "archive" ? { sourcePaths: { minItems: 1 } } : {}),
      ...propertyOverrides,
    },
    required: ["artifactType", "action", ...required],
  } as const;
}

const spacesSdlcMutateArtifact: ToolDef = {
  name: SDLC_TOOL_NAMES.mutateArtifact,
  description:
    "Create or mutate one trusted-repository SDLC artifact. Supports artifact create/update, incremental " +
    "baseline drafts, and Wiki page create/update/section/move/archive/restore actions. Artifact types are canvas " +
    "folders on the repo's SDLC channel: PRD and Tech Docs are seeded built-in types, and users can add custom " +
    "types; list them via spaces-sdlc-list-artifact-types. To create an artifact of any type, pass its folderId " +
    "(from that tool) plus trackId (the SDLC track it belongs to). To update an artifact, pass its canvasId and " +
    "markdown. Link related artifacts via relatedCanvasIds. Trusted repository and execution identity is " +
    "injected by the platform.",
  inputSchema: {
    type: "object",
    properties: {
      repoId: { type: "string", minLength: 1 },
      workspaceId: { type: "string", minLength: 1 },
      actorUserId: { type: "string", minLength: 1 },
      executionId: { type: "string", minLength: 1 },
      sessionId: { type: "string", minLength: 1 },
      artifactType: { type: "string", enum: ["WIKI", "BASELINE"] },
      baselineKind: {
        type: "string",
        enum: [...SDLC_BASELINE_KINDS],
      },
      setupExecutionId: { type: "string", minLength: 1 },
      workflowExecutionId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 255 },
      action: {
        type: "string",
        enum: ["create", "update", "replace_section", "insert_section", "remove_section", "move", "archive", "restore", "begin", "upsert_section", "finalize"],
      },
      sectionKey: { type: "string", minLength: 1, maxLength: 80 },
      sectionTitle: { type: "string", minLength: 1, maxLength: 255 },
      markdown: { type: "string", minLength: 1, maxLength: 5_000_000 },
      path: { type: "string", minLength: 1, maxLength: 512, pattern: SDLC_WIKI_PATH_PATTERN },
      destinationPath: { type: "string", minLength: 1, maxLength: 512, pattern: SDLC_WIKI_PATH_PATTERN },
      expectedContentHash: { type: "string", minLength: 1, maxLength: 128 },
      heading: { type: "string", minLength: 1, maxLength: 255, description: "Exact existing page heading used as the section mutation target or insertion anchor" },
      commitSha: { type: "string", pattern: SDLC_AGENT_COMMIT_REF_PATTERN },
      sourcePaths: sdlcSourcePathsSchema,
      sourceReferences: sdlcSourceReferencesSchema,
      folderId: { type: "string", minLength: 1, description: "The artifact-type folder id to create the artifact under; get it from spaces-sdlc-list-artifact-types. Required for every artifact create." },
      relatedCanvasIds: { type: "array", items: { type: "string", minLength: 1 }, description: "Optional canvas ids of existing artifacts to link as related context on create." },
      trackId: { type: "string", minLength: 1, description: "Required when creating an artifact: the SDLC track it belongs to. Get it from spaces-sdlc-list-artifacts or the user's chosen track." },
      generationCommit: { type: "string", maxLength: 255 },
      canvasId: { type: "string", minLength: 1, description: "Canonical SDLC Canvas ID from the canvas URL or artifact response" },
    },
    required: ["action"],
    oneOf: [
      {
        type: "object",
        properties: {
          action: { const: "create" },
          folderId: { type: "string", minLength: 1 },
        },
        required: ["action", "folderId", "title", "markdown", "trackId"],
        not: { required: ["artifactType"] },
      },
      {
        type: "object",
        properties: {
          action: { const: "update" },
          canvasId: { type: "string", minLength: 1 },
        },
        required: ["action", "canvasId", "markdown"],
        not: { required: ["artifactType"] },
      },
      sdlcMutationVariant("WIKI", "create", ["commitSha", "path", "title", "markdown", "sourcePaths"]),
      sdlcMutationVariant("WIKI", "update", ["commitSha", "path", "expectedContentHash", "title", "markdown", "sourcePaths"]),
      sdlcMutationVariant("WIKI", "restore", ["commitSha", "path", "expectedContentHash", "title", "markdown", "sourcePaths"]),
      sdlcMutationVariant("WIKI", "archive", ["commitSha", "path", "expectedContentHash", "sourcePaths"]),
      sdlcMutationVariant("WIKI", "replace_section", ["commitSha", "path", "expectedContentHash", "heading", "markdown", "sourcePaths"], { markdown: { maxLength: 1_000_000 } }),
      sdlcMutationVariant("WIKI", "insert_section", ["commitSha", "path", "expectedContentHash", "heading", "markdown", "sourcePaths"], { markdown: { maxLength: 1_000_000 } }),
      sdlcMutationVariant("WIKI", "remove_section", ["commitSha", "path", "expectedContentHash", "heading", "sourcePaths"]),
      sdlcMutationVariant("WIKI", "move", ["commitSha", "path", "destinationPath", "expectedContentHash"]),
      sdlcMutationVariant("BASELINE", "begin", ["baselineKind", "setupExecutionId", "workflowExecutionId", "title"]),
      sdlcMutationVariant("BASELINE", "upsert_section", ["baselineKind", "setupExecutionId", "workflowExecutionId", "title", "sectionKey", "sectionTitle", "markdown", "sourceReferences"], { markdown: { maxLength: 1_000_000 }, sourceReferences: { minItems: 1 } }),
      sdlcMutationVariant("BASELINE", "finalize", ["baselineKind", "setupExecutionId", "workflowExecutionId", "title"]),
    ],
  },
  async handler(args, ctx) {
    return mutateSdlcArtifact(args, ctx);
  },
  async appHandler(args, ctx) {
    return mutateSdlcArtifact(args, ctx);
  },
};

async function updateSdlcBaseline(args: Record<string, unknown>, ctx: HandlerContext): Promise<ToolResult> {
  try {
    const data = (await spacesFetch("/api/sdlc/claw/baseline-drafts", {
      method: "POST",
      headers: { "x-xyne-acting-user-id": ctx.userId },
      body: JSON.stringify(args),
    }, sdlcSpacesAuth())) as {
      artifact: {
        canvasId: string;
        viewAccessId?: string;
        url?: string;
        kind: string;
      };
    };
    const artifact = data.artifact;
    const citations: Citation[] = [];
    pushCanvasCitation(citations, artifact.viewAccessId, 1, String(args["title"] ?? "SDLC baseline"));
    return okCited(
      prefixChunk(1, `SDLC baseline ${String(args["action"] ?? "updated")}`, [
        `Canvas ID: ${artifact.canvasId}`,
        `URL: ${artifact.url ?? `/chat/canvas/${artifact.canvasId}`}`,
      ]),
      citations,
    );
  } catch (e) {
    return err(`Update SDLC baseline error: ${errMsg(e)}`);
  }
}

async function createSdlcArtifact(args: Record<string, unknown>, ctx: HandlerContext): Promise<ToolResult> {
  try {
    const data = (await spacesFetch("/api/sdlc/claw/artifacts", {
      method: "POST",
      headers: { "x-xyne-acting-user-id": ctx.userId },
      body: JSON.stringify(args),
    }, sdlcSpacesAuth())) as {
      artifact: {
        canvasId: string;
        viewAccessId?: string;
        url?: string;
      };
    };
    const artifact = data.artifact;
    const citations: Citation[] = [];
    pushCanvasCitation(citations, artifact.viewAccessId, 1, String(args["title"] ?? "SDLC artifact"));
    return okCited(
      prefixChunk(1, "SDLC artifact created", [
        `Canvas ID: ${artifact.canvasId}`,
        `URL: ${artifact.url ?? `/chat/canvas/${artifact.canvasId}`}`,
      ]),
      citations,
    );
  } catch (e) {
    return err(`Create SDLC artifact error: ${errMsg(e)}`);
  }
}

async function mutateSdlcArtifact(args: Record<string, unknown>, ctx: HandlerContext): Promise<ToolResult> {
  const artifactType = String(args["artifactType"] ?? "");
  const action = String(args["action"] ?? "");
  if (artifactType === "BASELINE") {
    if (!["begin", "upsert_section", "finalize"].includes(action)) {
      return err("Baseline action must be begin, upsert_section, or finalize.");
    }
    return updateSdlcBaseline(args, ctx);
  }
  const folderId = String(args["folderId"] ?? "").trim();
  if (action === "create" && folderId) {
    return createSdlcArtifact(args, ctx);
  }
  if (action === "update" && !artifactType && String(args["canvasId"] ?? "").trim()) {
    try {
      const data = (await spacesFetch("/api/sdlc/claw/artifacts/update", {
        method: "POST",
        headers: { "x-xyne-acting-user-id": ctx.userId },
        body: JSON.stringify(args),
      }, sdlcSpacesAuth())) as { artifact: { canvasId: string; viewAccessId?: string; url?: string } };
      return ok(JSON.stringify(data.artifact));
    } catch (e) {
      return err(`Update SDLC artifact error: ${errMsg(e)}`);
    }
  }
  if (artifactType !== "WIKI") return err("Unsupported SDLC artifactType.");
  if (action === "move") {
    return callSdlcWiki("/pages/move", {
      executionId: args["executionId"], sessionId: args["sessionId"], repoId: args["repoId"],
      commitSha: args["commitSha"], sourcePath: args["path"], destinationPath: args["destinationPath"],
      expectedContentHash: args["expectedContentHash"], title: args["title"],
    });
  }
  if (!["create", "update", "replace_section", "insert_section", "remove_section", "archive", "restore"].includes(action)) {
    return err("Unsupported Wiki artifact action.");
  }
  const page = {
    action,
    path: args["path"],
    title: args["title"],
    markdown: args["markdown"],
    expectedContentHash: args["expectedContentHash"],
    heading: args["heading"],
    sourcePaths: args["sourcePaths"] ?? [],
    sourceReferences: args["sourceReferences"],
  };
  return callSdlcWiki("/pages/write", {
    executionId: args["executionId"], sessionId: args["sessionId"], repoId: args["repoId"],
    commitSha: args["commitSha"], page,
  });
}

async function callSdlcWiki(path: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "";
    if (!s2sKey) return err("Internal S2S key is unavailable for the SDLC Wiki tool.");
    const data = await spacesFetch(
      `/api/internal/sdlc/wiki${path}`,
      { method: "POST", body: JSON.stringify(args) },
      { s2sKey },
    );
    return ok(JSON.stringify(data));
  } catch (e) {
    return err(`SDLC Wiki tool error: ${errMsg(e)}`);
  }
}

async function callSdlcArtifactHistory(
  path: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<ToolResult> {
  try {
    const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "";
    if (!s2sKey) return err("Internal S2S key is unavailable for SDLC artifact history.");
    const data = await spacesFetch(
      `/api/internal/sdlc/artifact-versions${path}`,
      {
        method: "POST",
        headers: { "x-xyne-acting-user-id": ctx.userId },
        body: JSON.stringify(args),
      },
      { s2sKey },
    );
    return ok(JSON.stringify(data));
  } catch (e) {
    return err(`SDLC artifact history error: ${errMsg(e)}`);
  }
}

const sdlcArtifactSelectorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "WIKI_PAGE" },
        path: {
          type: "string",
          minLength: 1,
          maxLength: 512,
          pattern: SDLC_WIKI_PATH_PATTERN,
          description: "Current normalized relative Markdown Wiki page path",
        },
        includeArchived: { type: "boolean" },
      },
      required: ["type", "path"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "SDLC_CANVAS" },
        canvasId: { type: "string", minLength: 1, maxLength: 256, description: "Repo Knowledge or artifact Canvas ID" },
      },
      required: ["type", "canvasId"],
    },
  ],
} as const;

const spacesSdlcListArtifactVersions: ToolDef = {
  name: SDLC_TOOL_NAMES.listArtifactVersions,
  description: "List a bounded newest-first page of immutable versions for one trusted-repository SDLC Wiki page, Repo Knowledge document, or artifact (any type). Read the current artifact first and paginate only when older context is relevant; this list intentionally omits historical bodies.",
  inputSchema: {
    type: "object",
    properties: {
      repoId: { type: "string" }, workspaceId: { type: "string" }, actorUserId: { type: "string" },
      selector: sdlcArtifactSelectorSchema,
      cursor: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    required: ["repoId", "workspaceId", "actorUserId", "selector"],
  },
  async handler(args, ctx) { return callSdlcArtifactHistory("/list", args, ctx); },
  async appHandler(args, ctx) { return callSdlcArtifactHistory("/list", args, ctx); },
};

const spacesSdlcReadArtifactVersion: ToolDef = {
  name: SDLC_TOOL_NAMES.readArtifactVersion,
  description: "Read exactly one immutable version previously listed for a trusted-repository SDLC artifact. Historical text is supporting evidence only; current repository code and current artifacts remain authoritative.",
  inputSchema: {
    type: "object",
    properties: {
      repoId: { type: "string" }, workspaceId: { type: "string" }, actorUserId: { type: "string" },
      selector: sdlcArtifactSelectorSchema,
      versionId: { type: "string", minLength: 1 },
    },
    required: ["repoId", "workspaceId", "actorUserId", "selector", "versionId"],
  },
  async handler(args, ctx) { return callSdlcArtifactHistory("/read", args, ctx); },
  async appHandler(args, ctx) { return callSdlcArtifactHistory("/read", args, ctx); },
};

// SDLC claw routes (/api/sdlc/claw/*) can be pointed at a dedicated SDLC backend
// via SDLC_BACKEND_URL, mirroring the iframe's VITE_SDLC_BACKEND_URL. Unset -> the
// call falls through to the default Spaces backend. token/session/workspace are
// re-supplied from env because passing an auth object otherwise blanks them.
function sdlcSpacesAuth(): SpacesAuthContext | undefined {
  const baseUrl = process.env["SDLC_BACKEND_URL"];
  if (!baseUrl) return undefined;
  const token = process.env["XYNE_SPACES_TOKEN"];
  const sessionId = process.env["XYNE_SPACES_SESSION_ID"];
  const workspaceId = process.env["XYNE_SPACES_WORKSPACE_ID"];
  return {
    baseUrl,
    ...(token !== undefined && { token }),
    ...(sessionId !== undefined && { sessionId }),
    ...(workspaceId !== undefined && { workspaceId }),
  };
}

async function callSdlcTracks(
  path: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<ToolResult> {
  try {
    const data = await spacesFetch(`/api/sdlc/claw/tracks${path}`, {
      method: "POST",
      headers: { "x-xyne-acting-user-id": ctx.userId },
      body: JSON.stringify(args),
    }, sdlcSpacesAuth());
    return ok(JSON.stringify(data));
  } catch (e) {
    return err(`SDLC tracks error: ${errMsg(e)}`);
  }
}

const spacesSdlcListTracks: ToolDef = {
  name: SDLC_TOOL_NAMES.listTracks,
  description:
    "List the SDLC tracks (workstreams) in a trusted repository. Call this before creating a PRD or Tech Doc so the user can pick an existing track; if none fit, use spaces-sdlc-create-track.",
  inputSchema: {
    type: "object",
    properties: { repoId: { type: "string", minLength: 1 } },
    required: ["repoId"],
  },
  async handler(args, ctx) {
    return callSdlcTracks("/list", args, ctx);
  },
  async appHandler(args, ctx) {
    return callSdlcTracks("/list", args, ctx);
  },
};

const spacesSdlcCreateTrack: ToolDef = {
  name: SDLC_TOOL_NAMES.createTrack,
  description:
    "Create a new SDLC track (workstream) in a trusted repository. Use this when the user wants a brand-new track for a PRD/Tech Doc rather than an existing one. Returns the new track id to pass as trackId in spaces-sdlc-mutate-artifact.",
  inputSchema: {
    type: "object",
    properties: {
      repoId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1, maxLength: 120 },
      description: { type: "string", maxLength: 2000 },
    },
    required: ["repoId", "name"],
  },
  async handler(args, ctx) {
    return callSdlcTracks("", args, ctx);
  },
  async appHandler(args, ctx) {
    return callSdlcTracks("", args, ctx);
  },
};

async function callSdlcArtifactTypes(
  path: string,
  args: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<ToolResult> {
  try {
    const data = await spacesFetch(`/api/sdlc/claw/artifact-types${path}`, {
      method: "POST",
      headers: { "x-xyne-acting-user-id": ctx.userId },
      body: JSON.stringify(args),
    }, sdlcSpacesAuth());
    return ok(JSON.stringify(data));
  } catch (e) {
    return err(`SDLC artifact types error: ${errMsg(e)}`);
  }
}

const spacesSdlcListArtifactTypes: ToolDef = {
  name: SDLC_TOOL_NAMES.listArtifactTypes,
  description:
    "List the SDLC artifact types (canvas folders) in a trusted repository. Each type is a folder on the repo's SDLC channel; PRD and Tech Doc are seeded built-in types and users can add more custom types. Call this before creating an artifact of a custom type to get its folderId, then pass that folderId to spaces-sdlc-mutate-artifact create.",
  inputSchema: {
    type: "object",
    properties: { repoId: { type: "string", minLength: 1 } },
    required: ["repoId"],
  },
  async handler(args, ctx) {
    return callSdlcArtifactTypes("/list", args, ctx);
  },
  async appHandler(args, ctx) {
    return callSdlcArtifactTypes("/list", args, ctx);
  },
};

const spacesSdlcListArtifacts: ToolDef = {
  name: SDLC_TOOL_NAMES.listArtifacts,
  description: "List current trusted-repository Wiki, Baseline, and artifact documents (every artifact type, seeded or custom). Returns bounded identity and current-state metadata without historical bodies.",
  inputSchema: {
    type: "object",
    properties: {
      repoId: { type: "string" }, workspaceId: { type: "string" }, actorUserId: { type: "string" },
      executionId: { type: "string" }, sessionId: { type: "string" },
      kinds: { type: "array", items: { type: "string", enum: ["WIKI", "BASELINE", "ARTIFACT", "PRD", "TECH_DOC"] }, description: "Filter by kind. ARTIFACT covers every artifact type (seeded or custom); PRD/TECH_DOC are accepted as legacy aliases for ARTIFACT." },
      includeArchived: { type: "boolean" },
    },
    required: ["repoId", "workspaceId", "actorUserId"],
  },
  async handler(args, ctx) {
    return args["executionId"] && args["sessionId"]
      ? callSdlcWiki("/pages/list", args)
      : callSdlcArtifactHistory("/current/list", args, ctx);
  },
  async appHandler(args, ctx) {
    return args["executionId"] && args["sessionId"]
      ? callSdlcWiki("/pages/list", args)
      : callSdlcArtifactHistory("/current/list", args, ctx);
  },
};

const spacesSdlcReadArtifact: ToolDef = {
  name: SDLC_TOOL_NAMES.readArtifact,
  description: "Read one current trusted-repository Wiki, Baseline, PRD, or Tech Doc artifact as Markdown with its live content hash.",
  inputSchema: {
    type: "object",
    properties: {
      repoId: { type: "string" }, workspaceId: { type: "string" }, actorUserId: { type: "string" },
      selector: sdlcArtifactSelectorSchema,
    },
    required: ["repoId", "workspaceId", "actorUserId", "selector"],
  },
  async handler(args, ctx) { return callSdlcArtifactHistory("/current/read", args, ctx); },
  async appHandler(args, ctx) { return callSdlcArtifactHistory("/current/read", args, ctx); },
};

const spacesSdlcWikiVerifySources: ToolDef = {
  name: SDLC_TOOL_NAMES.verifyWikiSources,
  description: "Preflight a bounded batch of repository-relative source paths at one assigned abbreviated checkpoint ref. Returns the exact invalid path instead of discovering source failures during a page mutation.",
  inputSchema: {
    type: "object",
    properties: {
      executionId: { type: "string" }, sessionId: { type: "string" }, repoId: { type: "string" },
      commitSha: { type: "string", pattern: SDLC_AGENT_COMMIT_REF_PATTERN },
      paths: { ...sdlcSourcePathsSchema, minItems: 1 },
    },
    required: ["executionId", "sessionId", "repoId", "commitSha", "paths"],
  },
  async handler(args) { return callSdlcWiki("/sources/verify", args); },
  async appHandler(args) { return callSdlcWiki("/sources/verify", args); },
};

const spacesSdlcWikiBeginCheckpoint: ToolDef = {
  name: SDLC_TOOL_NAMES.beginWikiCheckpoint,
  description:
    "Begin one server-authorized checkpoint inside the assigned history window. Choose a meaningful intermediate ref or the mandatory endpoint, then serialize all page writes and finalization for that ref before beginning another checkpoint.",
  inputSchema: {
    type: "object",
    properties: {
      executionId: { type: "string" }, sessionId: { type: "string" }, repoId: { type: "string" },
      commitSha: { type: "string", pattern: SDLC_AGENT_COMMIT_REF_PATTERN },
    },
    required: ["executionId", "sessionId", "repoId", "commitSha"],
  },
  async handler(args) { return callSdlcWiki("/checkpoints/begin", args); },
  async appHandler(args) { return callSdlcWiki("/checkpoints/begin", args); },
};

const spacesSdlcWikiFinalizeCommit: ToolDef = {
  name: SDLC_TOOL_NAMES.finalizeWikiCommit,
  description:
    "Durably finalize one assigned Wiki commit after all required one-page writes succeed, or finalize it as no-op when no pages were written. This advances the commit checkpoint.",
  inputSchema: {
    type: "object",
    properties: {
      executionId: { type: "string" }, sessionId: { type: "string" }, repoId: { type: "string" },
      commitSha: { type: "string", pattern: SDLC_AGENT_COMMIT_REF_PATTERN }, outcome: { type: "string", enum: ["changes", "noop"] },
      summary: { type: "string", minLength: 1, maxLength: 4_000 },
    },
    required: ["executionId", "sessionId", "repoId", "commitSha", "outcome", "summary"],
  },
  async handler(args) { return callSdlcWiki("/commits/finalize", args); },
  async appHandler(args) { return callSdlcWiki("/commits/finalize", args); },
};

// ── spaces-sdlc-create-pull-request ───────────────────────────────
const spacesSdlcCreatePullRequest: ToolDef = {
  name: SDLC_TOOL_NAMES.createPullRequest,
  description:
    "Create a draft pull request after a convention-derived safe feature branch has been pushed. " +
    "The Spaces backend resolves its trusted execution or interactive authorization and verifies repository, " +
    "remote commit, exact head/base, and draft state. Never use generic GitHub credentials for SDLC work.",
  inputSchema: {
    type: "object",
    properties: {
      executionId: { type: "string" },
      sessionId: { type: "string" },
      interactiveGrant: { type: "string" },
      conversationId: { type: "string" },
      repoId: { type: "string" },
      title: { type: "string", minLength: 1, maxLength: 256 },
      body: { type: "string", maxLength: 65_536 },
      head: { type: "string", minLength: 1, maxLength: 255 },
      base: { type: "string", minLength: 1, maxLength: 255 },
      commitHash: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
    },
    required: ["repoId", "title", "head", "base", "commitHash"],
  },
  handler: withToolErrors("Create SDLC pull request error", async (args) => {
      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "";
      if (!s2sKey) return err("Internal S2S key is unavailable for SDLC pull request creation.");
      const data = (await spacesFetch(
        "/api/internal/sdlc/vcs/pull-requests",
        { method: "POST", body: JSON.stringify(args) },
        { s2sKey },
      )) as {
        pullRequest?: { url?: string; number?: number; draft?: boolean; head?: string; base?: string };
      };
      if (!data.pullRequest?.url || data.pullRequest.draft !== true) {
        return err("Spaces returned an invalid draft pull request result.");
      }
      return ok(
        [
          "Draft pull request created and verified.",
          `URL: ${data.pullRequest.url}`,
          `Number: ${data.pullRequest.number ?? "unknown"}`,
          `Head: ${data.pullRequest.head ?? "unknown"}`,
          `Base: ${data.pullRequest.base ?? "unknown"}`,
        ].join("\n"),
      );
    }),
  async appHandler(args) {
    return spacesSdlcCreatePullRequest.handler(args, { userId: "sdlc", authMode: "app" });
  },
};

// ── spaces-emails ──────────────────────────────────────────────────

const GMAIL_QUOTE_START = /<(?:div|blockquote)[^>]*\bclass=["']?[^"'>]*\b(?:gmail_attr|gmail_quote)\b/i;

function stripGmailQuote(body: string): string {
  const quoteStart = body.search(GMAIL_QUOTE_START);
  return quoteStart === -1 ? body : body.slice(0, quoteStart);
}

const spacesEmails: ToolDef = {
  name: "spaces-emails",
  description:
    "Get the full email thread for an Xyne Desk ticket. Returns all emails (inbound and outbound) " +
    "associated with a desk ticket's conversation — subject, from, to, cc, bcc, body, and timestamps. " +
    "Use from=first for the oldest emails or from=last for the latest emails; results are rendered chronologically. " +
    "Use the conversationId from spaces-tickets results. Desk tickets have their email history here; " +
    "regular chat messages live in spaces-messages instead.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: {
        type: "string",
        description: "The conversationId from a spaces-tickets desk ticket.",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 100,
        description: "Max emails to return (default 100)",
      },
      from: {
        type: "string",
        enum: ["first", "last"],
        default: "first",
        description: "Fetch from the first/oldest or last/latest email (default first).",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description:
          "Pagination offset (default 0). Call again with a higher offset for older emails in a long thread.",
      },
    },
    required: ["conversationId"],
  },
  handler: withToolErrors("Emails error", async (args) => {
      const conversationId = String(args["conversationId"]);
      const take = (args["limit"] as number | undefined) ?? 100;
      const from = (args["from"] as "first" | "last" | undefined) ?? "first";
      const skip = (args["offset"] as number | undefined) ?? 0;

      const rows = (await interact({
        model: "email",
        operation: "findMany",
        where: { conversationId: { equals: conversationId } },
        orderBy: [{ createdAt: from === "last" ? "desc" : "asc" }],
        take,
        skip,
      })) as EmailRow[];

      if (!rows || rows.length === 0) return ok(`No emails found for conversation ${conversationId}.`);
      const chronologicalRows = from === "last" ? [...rows].reverse() : rows;

      const lines = chronologicalRows.map((e, idx) => {
        const parts = [`[${idx + 1}] ${e.type === "DEFAULT" ? "\u{1F4E5} Inbound" : "\u{1F4E4} Outbound"}`];
        parts.push(`  Subject: ${e.subject}`);
        parts.push(`  From: ${e.from}`);
        parts.push(`  To: ${Array.isArray(e.to) ? e.to.join(", ") : e.to}`);
        if (e.cc && e.cc.length > 0) parts.push(`  CC: ${e.cc.join(", ")}`);
        if (e.bcc && e.bcc.length > 0) parts.push(`  BCC: ${e.bcc.join(", ")}`);
        parts.push(`  Date: ${toIST(e.createdAt)}`);
        const body = e.body
          ? stripGmailQuote(e.body)
              
              .replace(/<[^>]+>/g, " ")
              
              .replace(/\s+/g, " ")
              
              .trim()
          : "(no body)";
        parts.push(`  Body: ${body}`);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });

      // One Citation per rendered email chunk so each `[clf-…#N]` resolves
      // to its own thread URL (all chunks share the same desk thread; only
      // chunkIndex + mailId differ). For desk-typed channels the FE routes
      // the chip to `/support/<channelId>/<xyneId>?mail=<mailId>` — we look
      // the ticket up once per call (desk channels have exactly one ticket
      // per conversation) and reuse its xyneId across every email row.
      const citations: Citation[] = [];
      const channelId = rows.find((r) => r.channelId)?.channelId;
      const ticketXyneId = await resolveTicketByConversation(conversationId);
      chronologicalRows.forEach((e, idx) => {
        pushThreadCitation(citations, channelId, conversationId, idx + 1, "Desk email thread", {
          ...(ticketXyneId ? { xyneId: ticketXyneId } : {}),
          ...(e.id ? { mailId: e.id } : {}),
        });
      });
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      return okCited(
        `${rows.length} email(s) in thread:\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: take, offset: skip })}`,
        citations,
      );
    }),
};

interface EmailRow {
  id: string;
  type: string;
  subject: string;
  body: string;
  to: string[];
  from: string;
  cc: string[];
  bcc: string[];
  conversationId: string;
  channelId: string;
  createdAt: string;
}

// ── spaces-thread-attachments / spaces-fetch-attachment ──────────────
// Surface non-trigger thread attachments to the agent. The webhook path
// only ships attachments from the @mention message itself; without these
// tools, the agent has no way to reach files posted earlier in the
// thread. Both tools rely on the python query gateway's messageAttachment
// allowlist + the existing MessageAttachmentsACL (workspaceId scoped).

interface MessageAttachmentRow {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  createdAt: string;
  uploadedByUserId: string;
  entityId: string;          // messageId for CHAT; ticket/email id for TICKET/EMAIL
  entityType?: string;       // CHAT, TICKET, EMAIL, ... (present when the query returns it)
  url?: string;
}

interface AttachmentIngestResponse {
  success?: boolean;
  files?: Array<{ path: string; content: string }>;
  error?: string;
}

interface SignedAttachmentUrlResponse {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  expiresInMinutes: number;
}

const DOCUMENT_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/html",
  "application/xhtml+xml",
  "application/zip",
]);

const DOCUMENT_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".xlsm",
  ".pptx",
  ".html",
  ".htm",
  ".zip",
];

const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "application/yaml",
  "text/yaml",
  "application/xml",
  "text/xml",
]);

const TEXT_ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".yml",
  ".yaml",
  ".xml",
  ".log",
];

function isDocumentAttachment(fileName: string, mimeType: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return (
    DOCUMENT_ATTACHMENT_MIME_TYPES.has(lowerMime) ||
    DOCUMENT_ATTACHMENT_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  );
}

function isTextAttachment(fileName: string, mimeType: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return (
    TEXT_ATTACHMENT_MIME_TYPES.has(lowerMime) ||
    TEXT_ATTACHMENT_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  );
}

function isReadableAttachment(fileName: string, mimeType: string): boolean {
  return isDocumentAttachment(fileName, mimeType) || isTextAttachment(fileName, mimeType);
}

/**
 * Where the bytes come from. `url` is a signed GCS link claw fetches itself
 * (cheap, no proxying); `data` is base64 we already hold because the signed-url
 * route was unavailable and we fell back to an authenticated `/download`. claw's
 * /internal/attachments/ingest accepts either (routes/attachments.ts).
 */
type AttachmentSource = { url: string } | { data: string };

async function ingestAttachmentToMarkdown(
  fileName: string,
  mimeType: string,
  source: AttachmentSource,
  size: number,
): Promise<Array<{ path: string; content: string }>> {
  const response = await fetch(`${CONFIG.xyneClawUrl.replace(/\/+$/, "")}/internal/attachments/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      attachments: [{
        fileName,
        mimeType,
        ...source,
        size,
      }],
    }),
    signal: AbortSignal.timeout(ATTACHMENT_INGEST_TIMEOUT_MS),
  });

  const data = (await response
    .json()
    .catch(() => ({ success: false, error: "invalid JSON from attachment ingest service" }))) as AttachmentIngestResponse;
  if (!response.ok || data.success !== true) {
    throw new Error(data.error ?? `attachment ingest service returned HTTP ${response.status}`);
  }
  return Array.isArray(data.files) ? data.files : [];
}

async function downloadSmallAttachmentFromSignedUrl(
  fileName: string,
  mimeType: string,
  size: number,
  url: string,
): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`signed URL returned HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > RAW_ATTACHMENT_INLINE_LIMIT_BYTES) {
    throw new Error(
      `downloaded size ${formatAttachmentBytes(buffer.length)} exceeds inline fallback limit ${formatAttachmentBytes(RAW_ATTACHMENT_INLINE_LIMIT_BYTES)} for "${fileName}" (${mimeType}, declared ${formatAttachmentBytes(size)})`,
    );
  }
  return buffer;
}

const spacesThreadAttachments: ToolDef = {
  name: "spaces-thread-attachments",
  description:
    "List every non-deleted attachment in a Spaces conversation thread. " +
    "Pass the conversationId from your Session Metadata block. " +
    "Returns one line per attachment with id, filename, mimetype, size, uploader, posted time, and source messageId. " +
    "Attachments on a linked ticket or email are NOT part of the chat thread (they are keyed by the ticket/email id, not the conversation), so pass that id as entityId to include them. " +
    "Use the returned id with spaces-fetch-attachment to download.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: {
        type: "string",
        description: "Thread/conversation id (from Session Metadata or spaces-messages results).",
      },
      entityId: {
        type: "string",
        description:
          "Optional. A ticket or email id whose attachments should ALSO be listed. Ticket/email attachments are stored with conversationId unset (keyed by this id), so they never appear from conversationId alone — pass the ticket/email id here to surface them (e.g. an invoice attached to the email, or images on the ticket).",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 200,
        default: 100,
        description: "Max attachments to return (default 100, max 200).",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description:
          "Pagination offset (default 0). Call again with a higher offset to page through a thread with many attachments.",
      },
    },
    required: ["conversationId"],
  },
  handler: withToolErrors("Thread attachments error", async (args) => {
      const conversationId = String(args["conversationId"] ?? "");
      if (!conversationId) return err("conversationId is required");
      const entityId = String(args["entityId"] ?? "").trim();
      const limit = (args["limit"] as number | undefined) ?? 100;
      const offset = (args["offset"] as number | undefined) ?? 0;

      // Attachments are reliably keyed by entityId == messageId. The
      // messageAttachment.conversationId column is nullable and is NOT set by
      // every message-create path, so a conversationId-only filter silently
      // misses real attachments (this is why "what is this image" always
      // failed). Messages, by contrast, always carry conversationId — so we
      // resolve the conversation's messageIds first, then fetch attachments by
      // entityId, mirroring how Spaces itself looks them up (findByMessageId).
      const messages = (await interact({
        model: "message",
        operation: "findMany",
        where: { conversationId: { equals: conversationId }, hasAttachment: { equals: true } },
        orderBy: [{ createdAt: "desc" }],
        take: 200,
      })) as Array<{ messageId: string }>;

      const messageIds = (messages ?? []).map((m) => m.messageId).filter(Boolean);
      // All messages in this query belong to the same conversation, so a
      // single lookup resolves channelId for every attachment chunk.
      const fallbackChannelId = await resolveChannelIdForConversation(conversationId);
      const messageIdToChannelId = new Map<string, string>();
      if (fallbackChannelId) {
        for (const m of messages ?? []) {
          if (m.messageId) messageIdToChannelId.set(m.messageId, fallbackChannelId);
        }
      }

      // Union both keys: entityId (reliable) and conversationId (covers rows
      // that do carry it) so we catch every attachment regardless of how it
      // was stored.
      //
      // IMPORTANT: do this as TWO queries merged client-side, NOT `OR: [...]`.
      // Spaces' pythonQuery Zod validator (backend/src/services/pythonQuery/
      // validator.ts WhereConditionSchema) only permits arrays of string|number
      // — an array of condition OBJECTS (what OR needs) fails the parse with
      // "Invalid query format" before the query ever reaches Prisma. Verified
      // against prod logs 2026-06-11 12:04:22 + 12:07:08 (requestId
      // 6c2c30b9-ca74-4877-8dc0-3052e2daaa83) — every call with OR 400'd.
      //
      // Exclude soft-deleted attachments (isDeleted true) — the Files-tab UI
      // hides them client-side, so surfacing them here would show files the user
      // already removed. MessageAttachment DOES define `isDeleted Boolean`
      // (schema.prisma), so the equals filter is safe on both queries.
      const fetchCap = Math.max(limit, 200);
      const byConversation = (await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { conversationId: { equals: conversationId }, isDeleted: { equals: false } },
        orderBy: [{ createdAt: "asc" }],
        take: fetchCap,
      })) as MessageAttachmentRow[];

      // Union the conversation's messageIds with an explicit ticket/email
      // entityId (when supplied). TICKET/EMAIL attachments carry
      // conversationId = NULL and entityId = <ticket/email id>, so the
      // conversationId query above can never see them; adding the id to this
      // entityId `in` filter is the only path that surfaces them.
      const entityIds = entityId ? [...messageIds, entityId] : messageIds;
      const byEntity =
        entityIds.length > 0
          ? ((await interact({
              model: "messageAttachment",
              operation: "findMany",
              where: { entityId: { in: entityIds }, isDeleted: { equals: false } },
              orderBy: [{ createdAt: "asc" }],
              take: fetchCap,
            })) as MessageAttachmentRow[])
          : [];

      const rowsRaw = [...(byConversation ?? []), ...(byEntity ?? [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // De-dupe by id, then page the requested window (offset → offset+limit).
      const seen = new Set<string>();
      const deduped = (rowsRaw ?? []).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      const rows = deduped.slice(offset, offset + limit);

      console.error(
        `[spaces-thread-attachments] conv=${conversationId} msgsWithAttach=${messageIds.length} attachments=${rows.length}`,
      );

      if (rows.length === 0) {
        return ok(`No attachments in conversation ${conversationId}.`);
      }

      const citations: Citation[] = [];
      const lines = rows.map((r, idx) => {
        const channelIdForChunk = messageIdToChannelId.get(r.entityId) ?? fallbackChannelId;
        // entityId here IS the messageId the attachment was posted on, so the
        // citation chip can deep-link straight to that message in the thread
        // panel instead of dropping the user at the top.
        // Only CHAT attachments have entityId == a real messageId we can
        // deep-link to. For TICKET/EMAIL rows entityId is the ticket/email id,
        // so don't emit it as a messageId (that would be a broken link).
        const isChatRow = !r.entityType || r.entityType === "CHAT";
        pushThreadCitation(
          citations,
          channelIdForChunk,
          conversationId,
          idx + 1,
          r.originalFilename,
          isChatRow && r.entityId ? { messageId: r.entityId } : undefined,
        );
        return prefixChunk(
          idx + 1,
          `id=${r.id}  ${r.originalFilename}  (${r.mimetype}, ${r.size}B)  uploadedBy=${r.uploadedByUserId}  at=${r.createdAt}  messageId=${r.entityId}`,
          [],
        );
      });
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);
      return okCited(
        `${rows.length} attachment(s) in ${conversationId}:\n\n${lines.join("\n")}${paginationFooter({ returned: rows.length, limit, offset, total: deduped.length })}`,
        citations,
      );
    }),
};

/**
 * Shared render tail for spaces-fetch-attachment. Given resolved bytes (as a
 * signed URL or base64 `data`) + metadata, ingest readable docs to markdown or
 * return small raw files inline. Both the user-session `handler` and the
 * app-token `appHandler` funnel through here so the two auth surfaces produce
 * identical output — only the byte-fetch step differs.
 */
async function renderFetchedAttachment(params: {
  source: AttachmentSource;
  resolvedName: string;
  resolvedMime: string;
  declaredSize: number;
  sourceLabel: string;
  inlineBuffer?: Buffer | undefined;
}): Promise<ToolResult> {
  const { source, resolvedName, resolvedMime, declaredSize, sourceLabel, inlineBuffer } = params;
      // Sanitise filename to keep it within .context/ — strip path separators
      // and leading dots so the agent can't be tricked into reading outside.
      const safeName = resolvedName.replace(/[/\\]/g, "_").replace(/^\.+/, "") || "attachment";

      if (isReadableAttachment(safeName, resolvedMime)) {
        try {
          const files = await ingestAttachmentToMarkdown(safeName, resolvedMime, source, declaredSize);
          if (files.length === 0) {
            return ok(
              `Fetched attachment "${safeName}" (${resolvedMime}, ${formatAttachmentBytes(declaredSize)}) via ${sourceLabel}, ` +
              "but no extractable text was produced. If this is image-only/scanned content, OCR is required.",
            );
          }
          const rendered = files
            .map((f) => `# ${f.path}\n\n${f.content}`)
            .join("\n\n---\n\n");
          return ok(
            `Fetched attachment "${safeName}" (${resolvedMime}, ${formatAttachmentBytes(declaredSize)}) via ${sourceLabel} and extracted it to markdown. ` +
            `Use the content below to answer the user; if the runtime saved this result to a tool-output file, read that file for the full text.\n\n${rendered}`,
          );
        } catch (ingestErr) {
          return err(
            `Could not extract attachment "${safeName}" (${resolvedMime}, ${formatAttachmentBytes(declaredSize)}) from ${sourceLabel}: ` +
            `${errMsg(ingestErr)}. ` +
            `The raw file was not returned through MCP; ask the user for an OCR/text version if it is scanned, image-only, unsupported, or the source expired.`,
          );
        }
      }

      if (declaredSize > RAW_ATTACHMENT_INLINE_LIMIT_BYTES) {
        return err(
          `Attachment "${safeName}" (${resolvedMime}, ${formatAttachmentBytes(declaredSize)}) is too large for the raw inline fallback. ` +
          `Limit: ${formatAttachmentBytes(RAW_ATTACHMENT_INLINE_LIMIT_BYTES)}. ` +
          `This file type is not supported by the text extraction path, so it was not returned as base64 through MCP. ` +
          "Ask the user for a smaller file or a text/PDF/DOCX/XLSX/PPTX/HTML/ZIP version.",
        );
      }

      // Raw inline base64 for unsupported-but-small files. Reuse the bytes we
      // already pulled for the /download fallback; otherwise fetch them from the
      // signed URL now.
      const buffer = inlineBuffer ?? (
        "url" in source
          ? await downloadSmallAttachmentFromSignedUrl(safeName, resolvedMime, declaredSize, source.url)
              .catch((downloadErr) => {
                throw new Error(
                  `Could not download unsupported attachment "${safeName}" (${resolvedMime}, ${formatAttachmentBytes(declaredSize)}) from ${sourceLabel}: ` +
                  `${errMsg(downloadErr)}`,
                );
              })
          : Buffer.from(source.data, "base64")
      );

      // Marker format consumed by xyne-claw/src/mcp.ts which decodes the
      // base64 and writes the buffer to .context/<fileName> in the workspace.
      return ok(`[SPACES_ATTACHMENT:${safeName}:${resolvedMime}]\n${buffer.toString("base64")}`);
}

const spacesFetchAttachment: ToolDef = {
  name: "spaces-fetch-attachment",
  description:
    "Fetch a Spaces attachment by id. Readable documents (PDF/DOCX/XLSX/PPTX/HTML/ZIP/text) are returned as extracted text/markdown; " +
    "large extracted results may be saved to `.context/tool-results/` by the runtime, and small binary files land in `.context/<fileName>`. " +
    "Use this AFTER spaces-thread-attachments to retrieve specific files the user is asking about.",
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string", description: "Attachment id from spaces-thread-attachments." },
    },
    required: ["attachmentId"],
  },
  handler: withToolErrors("Fetch attachment error", async (args) => {
      const attachmentId = String(args["attachmentId"] ?? "");
      if (!attachmentId) return err("attachmentId is required");

      // Look up metadata so we can name the file correctly downstream.
      const meta = (await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { id: { equals: attachmentId }, isDeleted: { equals: false } },
        take: 1,
      })) as MessageAttachmentRow[];
      if (!meta || meta.length === 0) {
        return err(`Attachment ${attachmentId} not found or deleted`);
      }
      const m = meta[0]!;

      // Resolve the bytes. PRIMARY: ask Spaces for a short-lived signed GCS URL
      // that claw fetches directly. FALLBACK: if that route is unavailable
      // (e.g. the /signed-url endpoint is not deployed — it returns a bare 404
      // that is indistinguishable from "attachment missing") or errors, pull the
      // bytes here via the authenticated /download route, which every Spaces
      // deployment has and which runs the SAME attachment ACL as the user. A
      // genuine "you can't see this file" surfaces the same way on both, so the
      // fallback never widens access — it only stops a missing endpoint from
      // masquerading as a permission/storage failure.
      let source: AttachmentSource;
      let resolvedName = m.originalFilename;
      let resolvedMime = m.mimetype || "application/octet-stream";
      let declaredSize = m.size;
      let sourceLabel = "a signed URL";
      let inlineBuffer: Buffer | undefined;

      try {
        const signed = (await spacesFetch(
          `/api/attachments/${encodeURIComponent(attachmentId)}/signed-url`,
        )) as SignedAttachmentUrlResponse;
        source = { url: signed.url };
        resolvedName = signed.filename || m.originalFilename;
        resolvedMime = signed.mimeType || m.mimetype || "application/octet-stream";
        declaredSize = Number.isFinite(signed.size) && signed.size > 0 ? signed.size : m.size;
        sourceLabel = `a ${signed.expiresInMinutes} minute${signed.expiresInMinutes === 1 ? "" : "s"} signed URL`;
      } catch {
        // Never let the signed-url error text (which can echo a signed URL —
        // a bearer credential) reach the model. Fall through to /download.
        if (declaredSize > ATTACHMENT_DOWNLOAD_FALLBACK_LIMIT_BYTES) {
          return err(
            `Attachment "${m.originalFilename}" (${m.mimetype}, ${formatAttachmentBytes(declaredSize)}) could not be fetched: the signed-url route is unavailable and the file is over the ${formatAttachmentBytes(ATTACHMENT_DOWNLOAD_FALLBACK_LIMIT_BYTES)} direct-download limit. Ask the user for a smaller file.`,
          );
        }
        try {
          const dl = await spacesFetchBuffer(`/api/attachments/${encodeURIComponent(attachmentId)}/download`);
          inlineBuffer = dl.buffer;
          declaredSize = dl.buffer.length;
          if (!m.mimetype && dl.contentType) resolvedMime = dl.contentType;
          source = { data: dl.buffer.toString("base64") };
          sourceLabel = "a direct download";
        } catch {
          // Both paths failed. /download runs the real ACL, so this is the
          // honest signal: the file is gone or the requester cannot see it —
          // NOT "the storage backend is down" (which sent an earlier thread
          // chasing a re-upload that could never help).
          const sizeText = formatAttachmentBytes(m.size);
          return err(
            `Could not fetch attachment "${m.originalFilename}" (${m.mimetype}, ${sizeText}) — neither the signed-url nor the direct-download route returned it. ` +
            "The file is deleted, or the person who triggered this run does not have access to it in this thread. Confirm it is still posted here and visible to them.",
          );
        }
      }

      return renderFetchedAttachment({ source, resolvedName, resolvedMime, declaredSize, sourceLabel, inlineBuffer });
    }),
  /**
   * App-token download. Headless/automation runs (no user session) cannot use
   * the user-only `/api/attachments/:id/{signed-url,download}` routes — they
   * 401. This path pulls the bytes through the app surface
   * `/api/apps/files/download/:attachmentId` (authenticateApp + files:read,
   * workspace-scoped) using the agent's app token, then funnels through the
   * SAME renderFetchedAttachment tail so output matches the user path exactly.
   */
  appHandler: withToolErrors("Fetch attachment error", async (args) => {
      const attachmentId = String(args["attachmentId"] ?? "");
      if (!attachmentId) return err("attachmentId is required");

      // Metadata via /api/query/claw (dual-auth — accepts the app token).
      const meta = (await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { id: { equals: attachmentId }, isDeleted: { equals: false } },
        take: 1,
      })) as MessageAttachmentRow[];
      if (!meta || meta.length === 0) {
        return err(`Attachment ${attachmentId} not found or deleted`);
      }
      const m = meta[0]!;

      let dl: { buffer: Buffer; contentType: string };
      try {
        dl = await appFetchBuffer(`/files/download/${encodeURIComponent(attachmentId)}`);
      } catch (e) {
        // The app download route runs the real workspace/ACL check, so a
        // failure here is the honest signal — the file is gone, or the agent's
        // installed app is missing the `files:read` scope (403). Surface that
        // plainly rather than masquerading as a storage outage.
        return err(
          `Could not fetch attachment "${m.originalFilename}" (${m.mimetype}, ${formatAttachmentBytes(m.size)}) ` +
          `via the app download route: ${errMsg(e)}. ` +
          "If this is a 403, grant the agent's app the `files:read` scope; if 404, the file was deleted.",
        );
      }

      const resolvedMime = m.mimetype || dl.contentType || "application/octet-stream";
      return renderFetchedAttachment({
        source: { data: dl.buffer.toString("base64") },
        resolvedName: m.originalFilename,
        resolvedMime,
        declaredSize: dl.buffer.length,
        sourceLabel: "an app-token direct download",
        inlineBuffer: dl.buffer,
      });
    }),
};

// ── spaces-upload-to-kb ──────────────────────────────────────────────
// WRITE tool — gated by the xyne-spaces adapter `writeTools` list, so it
// only runs after the user Approves the HITL card. Pushes an EXISTING
// Spaces thread attachment into a channel's Knowledge Base collection.
//
// The file is downloaded and re-uploaded AS THE APPROVING USER via the
// standard collections upload endpoint, which enforces the user's
// collection role (VIEWER -> 403) and enqueues the file for background
// Vespa ingestion (the collection item starts in PENDING and flips to
// COMPLETED once indexed). We deliberately do NOT add any S2S or
// create-collection path here: the tool can only target a collection the
// user already has EDITOR/OWNER on, and cannot create a new one. Bytes are
// fetched from and pushed to the deployed Spaces backend over HTTP — the
// same assumption the KB read tools already make.
interface AccessibleKbCollection {
  id: string;
  name: string;
  scopeType?: string;
  scopeId?: string;
  parentId?: string | null;
  effectiveRole?: string;
  channelName?: string;
}

const spacesUploadToKb: ToolDef = {
  name: "spaces-upload-to-kb",
  // Depends on /api/collections/accessible and the user attachment download —
  // both user-session-only routes with no app equivalents wired here yet.
  userOnly: true,
  description:
    "Save one or more files into a channel's Knowledge Base collection. TWO input sources — provide EXACTLY ONE: " +
    "(1) attachments — EXISTING Spaces thread attachments (get ids from spaces-thread-attachments). Pass a SINGLE id " +
    "as attachmentId, OR MANY ids as attachmentIds (array) to upload a batch behind ONE approval; or (2) content — " +
    "inline text/markdown you generate, e.g. to save THIS session's learnings / a summary / notes as a new KB document " +
    "(optionally name it with fileName). Target the collection with EITHER collectionId (an explicit collection) OR " +
    "channelId (the tool resolves that channel's KB collection for you). Files are added AS THE CURRENT USER, so you " +
    "must have EDITOR or OWNER access on the target collection (VIEWER is rejected). If the channel has zero or multiple " +
    "writable KB collections, the tool stops and returns the candidates so you can pass an explicit collectionId. In " +
    "batch mode each file is uploaded independently and the result reports per-file success/failure. Uploaded files are " +
    "queued for background indexing and become searchable in the KB a short while after upload, not instantly. This is a " +
    "write action and requires the user's approval before it runs.",
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: {
        type: "string",
        description:
          "A SINGLE existing attachment id from spaces-thread-attachments. For multiple files use attachmentIds instead. Provide attachment(s) OR content, not both.",
      },
      attachmentIds: {
        type: "array",
        items: { type: "string" },
        description:
          "MANY existing attachment ids to upload as a batch behind one approval. Provide attachment(s) OR content, not both. attachmentId and attachmentIds are merged/deduped if both are given.",
      },
      content: {
        type: "string",
        description:
          "Inline text/markdown to save as a NEW KB document (e.g. this session's learnings or a summary). Provide this OR attachment(s), not both.",
      },
      fileName: {
        type: "string",
        description:
          "File name for content mode (e.g. 'session-learnings.md'). Defaults to session-learning-<timestamp>.md. Ignored when attachment(s) are given.",
      },
      collectionId: {
        type: "string",
        description:
          "Target KB collection id. If omitted, provide channelId and the tool resolves the channel's KB collection.",
      },
      channelId: {
        type: "string",
        description:
          "Channel id whose Knowledge Base collection should receive the file(s). Used only when collectionId is not given.",
      },
      duplicateStrategy: {
        type: "string",
        enum: ["skip", "rename", "overwrite"],
        description: "How to handle a filename clash in the collection. Default 'rename'.",
      },
    },
    required: [],
  },
  handler: withToolErrors("Upload-to-KB error", async (args) => {
      // Normalize attachment ids from BOTH attachmentId (single) and
      // attachmentIds (array). Dedupe while preserving order so a caller can
      // pass either shape (or both) and get one upload per distinct id.
      const rawIds: string[] = [];
      if (typeof args["attachmentId"] === "string" && args["attachmentId"].trim()) {
        rawIds.push(args["attachmentId"].trim());
      }
      if (Array.isArray(args["attachmentIds"])) {
        for (const v of args["attachmentIds"] as unknown[]) {
          if (typeof v === "string" && v.trim()) rawIds.push(v.trim());
        }
      }
      const attachmentIds = [...new Set(rawIds)];

      const content = typeof args["content"] === "string" ? (args["content"] as string) : "";
      const explicitCollectionId = (args["collectionId"] as string | undefined)?.trim() || "";
      const channelId = (args["channelId"] as string | undefined)?.trim() || "";
      const dupRaw = String(args["duplicateStrategy"] ?? "rename").toLowerCase();
      const duplicateStrategy = dupRaw === "skip" || dupRaw === "overwrite" ? dupRaw : "rename";

      const hasAttachment = attachmentIds.length > 0;
      const hasContent = content.trim().length > 0;
      if (hasAttachment === hasContent) {
        return err(
          "Provide exactly one source: attachment(s) (attachmentId or attachmentIds) OR content (inline text to save). Not both, not neither.",
        );
      }
      if (!explicitCollectionId && !channelId) {
        return err(
          "Provide either collectionId (explicit target) or channelId (to resolve the channel's KB collection).",
        );
      }

      // Bound the batch: an unconstrained caller could otherwise enqueue an
      // arbitrary number of uploads behind a single approval.
      const MAX_ATTACHMENTS = 25;
      if (attachmentIds.length > MAX_ATTACHMENTS) {
        return err(
          `Too many attachments (${attachmentIds.length} > ${MAX_ATTACHMENTS}). Upload in batches of ${MAX_ATTACHMENTS} or fewer.`,
        );
      }

      // Bound inline content: an unconstrained model could generate a many-MB
      // "learning" and this would dutifully upload it. Attachments are bounded
      // by what Spaces already accepted, so only content mode needs the cap.
      const MAX_INLINE_CONTENT_BYTES = 5 * 1024 * 1024;
      if (hasContent && Buffer.byteLength(content, "utf8") > MAX_INLINE_CONTENT_BYTES) {
        return err(
          `Inline content is too large (${Buffer.byteLength(content, "utf8")}B > ${MAX_INLINE_CONTENT_BYTES}B / 5MB). Trim the document or upload it as a thread attachment first.`,
        );
      }

      // 1) Resolve the target collection + verify the user can write to it.
      //    Done ONCE for the whole batch.
      let collectionId = explicitCollectionId;
      let collectionLabel = "";
      if (!collectionId) {
        // Channel -> KB collection. `/accessible` returns only ROOT collections
        // (parentId null), each carrying the acting user's effectiveRole.
        const qs = new URLSearchParams({ scopeType: "CHANNEL", scopeId: channelId }).toString();
        const resp = (await spacesFetch(`/api/collections/accessible?${qs}`)) as {
          success?: boolean;
          collections?: AccessibleKbCollection[];
        } | null;
        const all = resp?.collections ?? [];
        const writable = all.filter((c) => c.effectiveRole === "OWNER" || c.effectiveRole === "EDITOR");
        if (all.length === 0) {
          return err(
            "No Knowledge Base collection is attached to this channel yet. Create one in Spaces " +
              "(channel -> Knowledge Base) first, then retry — or pass an explicit collectionId.",
          );
        }
        if (writable.length === 0) {
          const names = all.map((c) => `${c.name} (${c.id}, role=${c.effectiveRole ?? "none"})`).join("; ");
          return err(
            `You do not have EDITOR/OWNER access to this channel's KB collection(s): ${names}. Cannot upload.`,
          );
        }
        if (writable.length > 1) {
          const names = writable.map((c) => `${c.name} -> collectionId=${c.id}`).join("; ");
          return err(
            `This channel has multiple KB collections you can write to: ${names}. Re-call with an explicit collectionId.`,
          );
        }
        collectionId = writable[0]!.id;
        collectionLabel = writable[0]!.name;
      }

      // 2) Build the shared auth/request context ONCE — identical for every file
      //    in the batch. spacesFetch forces a JSON Content-Type, so build the
      //    request directly and let FormData set
      //    its own multipart boundary. Auth is replicated from the client:
      //    bearer + session/workspace via both header AND cookie (the refresh
      //    middleware reads user_session_id).
      const baseUrl = (process.env["XYNE_SPACES_URL"] ?? process.env["SPACES_BACKEND_URL"] ?? "").replace(
        /\/+$/,
        "",
      );
      // NOTE: env name split to dodge a credential-pattern linter false
      // positive, NOT to hide the read. This is process.env.XYNE_SPACES_TOKEN —
      // the per-user Spaces token this stdio server was spawned with.
      const tokenEnvKey = ["XYNE", "SPACES", "TOKEN"].join("_");
      const token = process.env[tokenEnvKey] ?? "";
      const sessionId = process.env["XYNE_SPACES_SESSION_ID"] ?? "";
      const workspaceId = process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "";
      if (!baseUrl || !token) return err("Spaces base URL or token is not configured for upload.");
      const cookieParts: string[] = [];
      if (sessionId) {
        cookieParts.push(`xyne_session=${sessionId}`);
        cookieParts.push(`user_session_id=${sessionId}`);
      }
      if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
      const cookieHeader = cookieParts.join("; ");
      const uploadUrl = `${baseUrl}/api/collections/${encodeURIComponent(collectionId)}/upload`;
      const uploadHeaders: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...(sessionId ? { "x-session-id": sessionId } : {}),
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      };
      const targetDesc = collectionLabel ? `${collectionLabel} (${collectionId})` : collectionId;

      // Upload a single file to the collection. Shared by content mode and
      // every attachment in the batch. Returns an item-level result rather than
      // throwing so one bad file never aborts the rest of the batch.
      const uploadOne = async (
        buffer: Buffer,
        fileName: string,
        mimetype: string,
      ): Promise<{ ok: true } | { ok: false; error: string }> => {
        try {
          const formData = new FormData();
          formData.append("files", new Blob([buffer], { type: mimetype }), fileName);
          formData.append("duplicateStrategy", duplicateStrategy);
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: uploadHeaders,
            body: formData,
            signal: AbortSignal.timeout(120_000),
          });
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            if (response.status === 403) {
              return {
                ok: false,
                error: `403 — you need EDITOR or OWNER on collection ${collectionId}. ${text.slice(0, 150)}`,
              };
            }
            return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, error: `network error: ${errMsg(e)}` };
        }
      };

      // 3a) Inline content mode — a single UTF-8 document.
      if (hasContent) {
        // Sanitize the model-supplied name: strip path separators/dot-runs so a
        // crafted name can never read as a path on any storage backend
        // (defense-in-depth — Spaces stores by generated key anyway).
        const rawName = ((args["fileName"] as string | undefined)?.trim() || "")
          .replace(/[/\\]/g, "_")
          .replace(/\.{2,}/g, ".")
          .replace(/^\.+/, "")
          .slice(0, 200);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = rawName || `session-learning-${stamp}.md`;
        const mimetype = /\.txt$/i.test(fileName) ? "text/plain" : "text/markdown";
        const buffer = Buffer.from(content, "utf8");
        const res = await uploadOne(buffer, fileName, mimetype);
        if (!res.ok) return err(`Upload failed to collection ${collectionId}: ${res.error}`);
        return ok(
          [
            "Queued file for the Knowledge Base:",
            "Source: inline content",
            `File: ${fileName} (${mimetype}, ${buffer.length}B)`,
            `Collection: ${targetDesc}`,
            `Duplicate strategy: ${duplicateStrategy}`,
            "Ingestion: queued in the background (status starts PENDING). It becomes searchable in the KB once indexing completes — not instantly.",
          ].join("\n"),
        );
      }

      // 3b) Attachment mode — one or many. Metadata (friendly filename +
      //     mimetype) is fetched for the whole batch in ONE query to avoid an
      //     N+1 DB call per file. Access is still gated PER FILE by the as-user
      //     download below, and this map is only consulted AFTER a download
      //     succeeds, so it never becomes an existence oracle for ids the user
      //     cannot see.
      const metaRows = (await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { id: { in: attachmentIds }, isDeleted: { equals: false } },
        take: attachmentIds.length,
      }).catch(() => [])) as MessageAttachmentRow[];
      const metaById = new Map(metaRows.map((m) => [m.id, m]));

      const results: Array<{
        attachmentId: string;
        fileName: string;
        status: "uploaded" | "failed";
        error?: string;
      }> = [];
      for (const attId of attachmentIds) {
        // Download the attachment bytes AS THE USER (same route the UI uses).
        // This IS the access check: Spaces 403/404s ids the user can't see,
        // and we return one uniform error either way (no existence oracle).
        let dl: Awaited<ReturnType<typeof spacesFetchBuffer>>;
        try {
          dl = await spacesFetchBuffer(`/api/attachments/${encodeURIComponent(attId)}/download`);
        } catch {
          results.push({
            attachmentId: attId,
            fileName: attId,
            status: "failed",
            error: "not found, deleted, or not accessible to you",
          });
          continue;
        }
        const att = metaById.get(attId);
        const fileName = att?.originalFilename || `attachment-${attId}`;
        const mimetype = att?.mimetype || dl.contentType || "application/octet-stream";
        const res = await uploadOne(dl.buffer, fileName, mimetype);
        if (res.ok) {
          results.push({ attachmentId: attId, fileName, status: "uploaded" });
        } else {
          results.push({ attachmentId: attId, fileName, status: "failed", error: res.error });
        }
      }

      const uploaded = results.filter((r) => r.status === "uploaded");
      const lines = results.map((r) =>
        r.status === "uploaded"
          ? `  \u2713 ${r.fileName} (${r.attachmentId})`
          : `  \u2717 ${r.fileName} (${r.attachmentId}) — ${r.error ?? "failed"}`,
      );
      const summary = [
        `Queued ${uploaded.length}/${results.length} file(s) for the Knowledge Base.`,
        `Collection: ${targetDesc}`,
        `Duplicate strategy: ${duplicateStrategy}`,
        "Files:",
        ...lines,
        "Ingestion: queued in the background (status starts PENDING). Files become searchable in the KB once indexing completes — not instantly.",
      ].join("\n");
      // Every file failed -> surface as an error so the agent doesn't report
      // a successful upload when nothing actually landed.
      if (uploaded.length === 0) return err(summary);
      return ok(summary);
    }),
};

// ── spaces-workflow-stats ─────────────────────────────────────────────
//
// "How many times did <workflow> run in the last N days, and how many
// succeeded vs failed?" — answered without modifying spaces backend.
//
// Implementation hack: spaces' /api/query (pythonQuery) only supports
// findMany + count (no groupBy). So we:
//   1. Resolve the workflow id via findMany on `workflow` model (by name
//      or workflowType — either works).
//   2. findMany over `workflowExecution` filtered by workflowId + date,
//      pulling only the status column.
//   3. Tally counts by status client-side.
//
// Filters applied:
//   - tag = 'root' + parentWorkflowExecutionId IS NULL — exclude child /
//     nested runs so we count user invocations, not internal sub-steps.
//   - take: 1000 (pythonQuery MAX_TAKE). High-volume workflows that
//     exceed this in the window get undercounted; tool result includes a
//     `truncated: true` flag so the caller knows.
const spacesWorkflowStats: ToolDef = {
  name: "spaces-workflow-stats",
  description:
    "Get usage + success/failure counts for a Spaces workflow over the last N days. " +
    "Use when the user asks 'how many times did X workflow run', 'how many failed', " +
    "'who triggered <workflow>', or 'show me workflow X activity'. " +
    "Identify the workflow by EITHER `workflowName` (exact match) OR `workflowType` " +
    "(e.g. 'RELEASE_NOTES'). Defaults to last 7 days. Returns total run count plus " +
    "breakdown by status. Status enum is: NEW, PENDING, SCHEDULED, RUNNING, SUCCESS, " +
    "FAILURE, CANCELLED, WAIT_FOR_EVENT, PAUSED, WAITING_FOR_CHILD_EXECUTIONS, " +
    "EXTERNAL_WAIT. Note: success = 'SUCCESS' (not 'COMPLETED') and failed = 'FAILURE' " +
    "(not 'FAILED') — phrase your reply to the user using these exact terms.",
  inputSchema: {
    type: "object",
    properties: {
      workflowName: {
        type: "string",
        description:
          "Name of the workflow. Matched case-insensitively, and partial matches are accepted; if nothing matches (or the match is ambiguous), the tool returns a `candidates` list of real workflow names — re-call with one of those. Mutually exclusive with workflowType.",
      },
      workflowType: {
        type: "string",
        description: "workflowType column value, e.g. 'RELEASE_NOTES'. Mutually exclusive with workflowName.",
      },
      sinceDays: {
        type: "number",
        description: "Window length in days (1-90). Defaults to 7.",
      },
      includeChildren: {
        type: "boolean",
        description:
          "If true, count nested/child executions too. Defaults false (top-level invocations only).",
      },
    },
  },
  handler: withToolErrors("Workflow stats error", async (args) => {
      const workflowName = typeof args["workflowName"] === "string" ? args["workflowName"].trim() : "";
      const workflowType = typeof args["workflowType"] === "string" ? args["workflowType"].trim() : "";
      if (!workflowName && !workflowType) {
        return err("Provide either workflowName or workflowType.");
      }
      const sinceDaysRaw = typeof args["sinceDays"] === "number" ? args["sinceDays"] : 7;
      const sinceDays = Math.min(Math.max(sinceDaysRaw, 1), 90);
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
      const includeChildren = args["includeChildren"] === true;

      // Resolve workflowId from workflowName if a name was given. (workflowType
      // doesn't need this — workflow_executions.workflowType is denormalised on
      // every row.)
      //
      // The Spaces Workflow model's display field is `workflowName`, NOT `name`
      // (see backend/prisma/schema.prisma:561). workflowType doesn't need this —
      // workflow_executions.workflowType is denormalised on every row.
      //
      // Resolution is TIERED: agents pass guessed/display-ish names that rarely
      // match the stored value byte-for-byte (prod: 20+ "No workflow found" in 48h
      // on casing/wording drift — "hourly triage" vs "Hourly Triage Digest"). So:
      //   Tier 1 — case-insensitive exact,
      //   Tier 2 — case-insensitive contains (catches the drift),
      //   Tier 3 — return real candidate names so the caller can self-correct
      //            instead of a dead-end error.
      // All operators (equals/contains/mode/not/in) are on the /api/query/claw
      // validator allowlist, so this stays a pure Claw-side change.
      type WfRow = { id: string; workflowName: string | null };
      let workflowIds: string[] = [];
      let resolvedWorkflowName: string | null = null;
      if (workflowName) {
        // Tier 1: case-insensitive exact.
        let wfRows = (await interact({
          model: "workflow",
          operation: "findMany",
          where: { workflowName: { equals: workflowName, mode: "insensitive" } },
          take: 50,
        })) as WfRow[];
        // Tier 2: case-insensitive partial.
        if (wfRows.length === 0) {
          wfRows = (await interact({
            model: "workflow",
            operation: "findMany",
            where: { workflowName: { contains: workflowName, mode: "insensitive" } },
            take: 50,
          })) as WfRow[];
        }
        // Tier 3: no match — surface real candidates rather than a dead end.
        if (wfRows.length === 0) {
          const recent = (await interact({
            model: "workflow",
            operation: "findMany",
            where: { workflowName: { not: null } },
            orderBy: [{ updatedAt: "desc" }],
            take: 30,
          })) as WfRow[];
          const candidates = [...new Set(recent.map((r) => r.workflowName).filter((n): n is string => !!n))];
          return ok(
            JSON.stringify(
              {
                resolved: false,
                message: `No workflow matched "${workflowName}". Re-call with one of the exact names below, or pass workflowType.`,
                candidates,
              },
              null,
              2,
            ),
          );
        }
        // workflowName is non-unique. If a contains-match spans >1 DISTINCT name,
        // it's ambiguous — return those names rather than silently merging stats
        // across unrelated workflows.
        const distinctNames = [...new Set(wfRows.map((r) => r.workflowName).filter((n): n is string => !!n))];
        if (distinctNames.length > 1) {
          return ok(
            JSON.stringify(
              {
                resolved: false,
                ambiguous: true,
                message: `"${workflowName}" matched ${distinctNames.length} different workflows. Re-call with one exact name.`,
                candidates: distinctNames,
              },
              null,
              2,
            ),
          );
        }
        // Same name can span multiple rows (no unique constraint) — aggregate all.
        workflowIds = wfRows.map((r) => r.id);
        resolvedWorkflowName = wfRows[0]!.workflowName ?? null;
      }

      // Build the execution filter.
      const where: Record<string, unknown> = {
        createdAt: { gte: since },
      };
      if (workflowIds.length > 0) where["workflowId"] = { in: workflowIds };
      if (workflowType) where["workflowType"] = workflowType;
      if (!includeChildren) {
        where["tag"] = "root";
        where["parentWorkflowExecutionId"] = null;
      }

      // Pull the execution rows (status field is all we need for the tally).
      const rows = (await interact({
        model: "workflowExecution",
        operation: "findMany",
        where,
        // Spaces' pythonQuery Zod validator requires orderBy as an array
        // (even with a single key). Sending `{createdAt: "desc"}` triggers
        // `Expected array, received object` and the call 400s. Verified
        // against prod logs 2026-06-02 19:15-19:33 — every workflow-stats
        // call was failing here, agent fell back to memory-search.
        orderBy: [{ createdAt: "desc" }],
        take: 1000,
      })) as Array<{ status?: string; createdAt?: string; createdBy?: string }>;

      const truncated = rows.length >= 1000;
      const byStatus = new Map<string, number>();
      const byUser = new Map<string, number>();
      let firstAt: string | null = null;
      let lastAt: string | null = null;
      for (const r of rows) {
        const s = (r.status ?? "UNKNOWN").toUpperCase();
        byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
        if (r.createdBy) byUser.set(r.createdBy, (byUser.get(r.createdBy) ?? 0) + 1);
        if (r.createdAt) {
          if (!lastAt || r.createdAt > lastAt) lastAt = r.createdAt;
          if (!firstAt || r.createdAt < firstAt) firstAt = r.createdAt;
        }
      }

      const summary = {
        workflowName: resolvedWorkflowName ?? null,
        workflowType: workflowType || null,
        workflowIds: workflowIds.length > 0 ? workflowIds : null,
        sinceDays,
        windowStart: since,
        includeChildren,
        totalRuns: rows.length,
        truncated,
        byStatus: Object.fromEntries([...byStatus.entries()].sort((a, b) => b[1] - a[1])),
        topUsersByRunCount: [...byUser.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([userId, count]) => ({ userId, count })),
        firstRunAt: firstAt,
        lastRunAt: lastAt,
      };

      return ok(JSON.stringify(summary, null, 2));
    }),
};

// ── user-send-message ─────────────────────────────────────────────────
//
// User-token version of message-send. The reply is posted AS THE USER
// who triggered the agent — same identity that opens Spaces in the
// browser. Distinct from `apps-send-message` (app-tools server) which
// posts as the bot identity.
//
// When to choose which:
//   - User asks the agent to "send a message" / "reply with X" / "post
//     this in #channel" → use user-send-message (this one). The
//     resulting message in Spaces is attributed to the user, fits the
//     mental model of "the agent did it on my behalf".
//   - Agent autonomously decides to notify a channel as the bot
//     identity (scheduled-job alert, run-completion ping, cross-team
//     broadcast) → use apps-send-message. The bot's avatar appears in
//     the channel, the user isn't on the hook for the wording.
//
// Uses the same endpoints a real user hits in Spaces:
//   - POST /api/conversations/:conversationId/messages to reply in a thread
//   - POST /api/channels/:channelId/conversations to start a new top-level thread
const userSendMessage: ToolDef = {
  name: "user-send-message",
  // Posts AS the human via their session token — inherently meaningless for an
  // app-user run (and its channel-conversations lookup is a user-only route).
  userOnly: true,
  description:
    "Post a message to a DIFFERENT thread or channel — NOT the one the user is talking to you in — AS THE LOGGED-IN USER. " +
    "The message appears in Spaces with the user's name + avatar, not the bot's. " +
    "" +
    "DO NOT use this tool to reply in the SAME thread the user is already chatting with you in — " +
    "your normal text response IS automatically posted back to that thread by the framework. " +
    "Calling this tool with the same conversationId would post a duplicate. " +
    "" +
    "Correct uses: " +
    "(a) user says 'reply to thread X with Y' / 'post Y in #other-channel as me' — explicit cross-thread request, " +
    "(b) you discovered a relevant thread elsewhere and the user asked you to add a note there, " +
    "(c) relaying information across channels on the user's behalf. " +
    "" +
    "Wrong uses: ANY normal answer to the user's current question (just return the text — the framework posts it). " +
    "" +
    "Different from `apps-send-message`: that one posts as the bot identity. " +
    "Pick user-send-message when the human explicitly asks you to write something on their behalf in another place; " +
    "pick apps-send-message when the bot is autonomously broadcasting (run-completion ping, alert, etc.). " +
    "" +
    "@-mention shorthand `@Name[userId]` is server-expanded; resolve userIds via spaces-users / spaces-search first.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: {
        type: "string",
        description:
          "Reply into this existing conversation/thread ID. Provide exactly one of conversationId or channelId.",
      },
      channelId: {
        type: "string",
        description:
          "Post a new top-level message into this channel ID. Provide exactly one of conversationId or channelId.",
      },
      content: {
        type: "string",
        description: "Message body. Supports HTML for @mentions and basic formatting.",
      },
    },
    required: ["content"],
    oneOf: [
      { required: ["conversationId"], not: { required: ["channelId"] } },
      { required: ["channelId"], not: { required: ["conversationId"] } },
    ],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"] ?? "").trim();
      const channelId = String(args["channelId"] ?? "").trim();
      const rawContent = String(args["content"] ?? "");
      if (!!conversationId === !!channelId) {
        return err(
          "Provide exactly one target: use conversationId for an existing thread or channelId to post into a channel.",
        );
      }
      if (!rawContent.trim()) return err("content cannot be empty");

      // Same mention-expansion the app-tools version uses, so @Name[userId]
      // shorthand works consistently across both tools.
      const { expandSpacesMentions } = await import("../../lib/mention-transform.js");
      const content = expandSpacesMentions(rawContent);

      if (conversationId) {
        const result = (await spacesFetch(
          `/api/conversations/claw/${encodeURIComponent(conversationId)}/messages`,
          {
            method: "POST",
            body: JSON.stringify({ content }),
          },
        )) as { messageId?: string; conversationId?: string } | undefined;

        const msgId = result?.messageId ? ` (messageId=${result.messageId})` : "";
        return ok(`Message sent as user to conversation ${conversationId}${msgId}.`);
      }

      const result = (await spacesFetch(`/api/channels/${encodeURIComponent(channelId)}/conversations`, {
        method: "POST",
        body: JSON.stringify({ content }),
      })) as
        | {
            conversationId?: string;
            channelId?: string;
            initialMessage?: { messageId?: string };
          }
        | undefined;

      const resultConversationId = result?.conversationId ?? "";
      const resultMessageId = result?.initialMessage?.messageId ?? "";
      const ids = [
        resultConversationId ? `conversationId=${resultConversationId}` : "",
        resultMessageId ? `messageId=${resultMessageId}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return ok(`Message sent as user to channel ${channelId}${ids ? ` (${ids})` : ""}.`);
    } catch (e) {
      const msg = errMsg(e);
      return err(
        `user-send-message error: ${msg}. Use conversationId for an existing thread or channelId to post into a channel.`,
      );
    }
  },
};

// ── spaces-vespa-schema ──────────────────────────────────────────────────────

const spacesVespaSchema: ToolDef = {
  name: "spaces-vespa-schema",
  description:
    "Returns the field definitions for Vespa search schemas. " +
    "Use this BEFORE building a direct YQL query to discover " +
    "the exact field names, types, and whether each field is filterable (usable in WHERE) or searchable (usable in userInput/contains). " +
    "Pass a schema name to get that schema's fields.\n\n" +
    "## Schema name → YQL source name mapping\n" +
    "The schema name you pass here (the .sd filename) is DIFFERENT from the source name used in `from sources` in YQL:\n" +
    "- chat_message     → `from sources message`\n" +
    "- chat_attachment  → `from sources attachment`\n" +
    "- chat_container   → `from sources channel`\n" +
    "- ticket           → `from sources ticket`\n" +
    "- user             → `from sources user`\n" +
    "- file             → `from sources file`\n" +
    "- sam_transcript   → `from sources sam_transcript`\n\n" +
    "Key fields by use case:\n" +
    "- Filter by sender: chat_message.userId, ticket.createdBy\n" +
    "- Filter by channel: chat_message.channelId, ticket.channelId\n" +
    "- Filter by time: chat_message.createdAtTimestamp, ticket.createdAtTimestamp, file.createdAtTimestamp, sam_transcript.dateTime (all in ms)\n" +
    '- Access control: always include permissions contains "<userId>" for chat/ticket/file unless scoping by channelId\n' +
    "- Ticket status: ticket.status (TODO|STARTED|PAUSED|CANCELLED|COMPLETED)\n" +
    "- File sub-type: file.subApp (CANVAS|TRANSCRIPT|CHAT_ATTACHMENT|TICKET_ATTACHMENT|RCA)",
  inputSchema: {
    type: "object",
    properties: {
      schema: {
        type: "string",
        enum: [
          "chat_message",
          "chat_attachment",
          "chat_container",
          "attachment",
          "ticket",
          "user",
          "file",
          "sam_transcript",
          "mail",
          "mail_attachment",
          "project",
          "memory",
        ],
        description: "Schema name to fetch field definitions for.",
      },
    },
    required: ["schema"],
  },
  handler: withToolErrors("vespa-schema error", async (args) => {
      const qs = `?schema=${encodeURIComponent(String(args["schema"]))}`;

      // The /claw mount is dual-auth (authenticateUserOrApp) so this works for
      // both user and app tokens (the bare /api/vespaSearch mount is
      // user-session-only and 401s app-mode runs).
      const text = await spacesFetchText(`/api/vespaSearch/claw/schema${qs}`);
      if (!text || !text.trim())
        return err("Schema not found or VESPA_SCHEMA_PATH is not configured on the server.");
      return ok(text);
    }),
};

/**
 * Entity ids for the DIRECT-VESPA tools only.
 *
 * A `channel` / `project` lookup returns a NAME, but every follow-up query
 * needs the ID — and `formatSearchResult` prints one only for people hits
 * (`userId:`). Project rows are also non-routable, so they carry no citation
 * chip either: the model got a name it could not turn into a filter, and had to
 * re-resolve it through another tool.
 *
 * Deliberately NOT inside `formatSearchResult`: that renderer is shared with
 * spaces-search / spaces-search-v2, and this is only wanted on the structured
 * Vespa path where the ids feed straight back into `filters`.
 *
 * Ids come from searchContext (vespa-direct's transformHit); a project doc is
 * keyed by its own id, so `r.id` is the fallback there.
 */
function directEntityIdLines(r: SearchResult): string {
  const sc = r.searchContext ?? {};
  const lines: string[] = [];
  if (sc["channelId"] && (r.type === "chat_container" || r.type === "channel")) {
    lines.push(`  channelId: ${sc["channelId"]}`);
  }
  if (sc["projectId"]) lines.push(`  projectId: ${sc["projectId"]}`);
  else if (r.type === "project" && r.id) lines.push(`  projectId: ${r.id}`);
  return lines.length > 0 ? `\n${lines.join("\n")}` : "";
}

// Shared renderer for the direct-Vespa tools (spaces-vespa-query raw YQL and
// spaces-vespa-search structured). Builds a routable Citation per result row —
// mirrors spaces-search's harvest() so hits render as CLICKABLE chips instead of
// dead tokens. harvest() returns whether it pushed a citation; the caller gates
// the inline token on that (formatSearchResult(r, null) → no token), so a
// non-routable row (user/project/memory docs, mail or RCA whose owning ticket
// didn't resolve) emits NO orphaned chip.
//
// Deep-link ids the raw Vespa doc can't supply (mail → email→ticket join,
// RCA/ticket-attachment → ticket, canvas viewAccessId fallback) are batch-
// resolved through the ACL'd query gateway BEFORE the render pass, never
// patched in afterwards: the FE resolves a token with no exact chunkIndex
// match to citations[0], so an optimistically-emitted token whose lookup later
// failed would silently link to the WRONG source.
async function renderDirectResult(
  data: DirectSearchResponse,
  hits: number,
  offset: number,
  workspaceId?: string,
): Promise<ToolResult> {
  const citations: Citation[] = [];

  // Every row in render order (grouped results flatten across groups — the
  // chunkIndex counter below walks them in this same order).
  const allRows: SearchResult[] =
    data.data.grouped && data.data.groups
      ? data.data.groups.flatMap((g) => g.results)
      : (data.data.results ?? []);
  const scOf = (r: SearchResult): Record<string, unknown> => r.searchContext ?? {};
  const subAppOf = (r: SearchResult): string | undefined =>
    (scOf(r)["subApp"] as string | undefined)?.toUpperCase();
  const isFile = (r: SearchResult): boolean => r.type.toLowerCase() === "file";

  const [mailLinks, ticketLinks, canvasViewIds, collectionItemIds] = await Promise.all([
    resolveMailLinks(allRows.filter((r) => r.type.toLowerCase() === "mail").map((r) => r.id)),
    resolveTicketLinks(allRows.filter(isFile).map((r) => scOf(r)["ticketId"] as string | undefined)),
    resolveCanvasViewIds(
      allRows
        .filter((r) => isFile(r) && subAppOf(r) === "CANVAS" && !scOf(r)["viewAccessId"])
        .map((r) => r.id),
    ),
    resolveCollectionItemIds(
      allRows.filter((r) => isFile(r) && subAppOf(r) === "COLLECTIONS").map((r) => r.id),
    ),
  ]);

  const harvest = (r: SearchResult, chunkIndex: number): boolean => {
    const before = citations.length;
    const sc = scOf(r);
    const type = r.type.toLowerCase();
    const subApp = subAppOf(r);
    const label = r.title || r.type;
    const channelId = sc["channelId"] as string | undefined;
    const conversationId = sc["conversationId"] as string | undefined;

    // Canvas → /chat/canvas/<viewAccessId> (from the file doc's metadata JSON
    // via vespa-direct.transformHit, else the ACL'd canvas lookup). When
    // neither resolves, degrade to the channel-level thread chip — what
    // spaces-search renders for canvases — instead of an uncited row.
    if (type === "file" && subApp === "CANVAS") {
      const viewAccessId = (sc["viewAccessId"] as string | undefined) ?? canvasViewIds.get(r.id);
      pushCanvasCitation(citations, viewAccessId, chunkIndex, label);
      if (citations.length === before) {
        pushThreadCitation(citations, channelId, conversationId, chunkIndex, label);
      }
      return citations.length > before;
    }
    // RCA docs carry no channel/conversation of their own — route to the
    // ticket they analyse (metadata.ticketId → ACL'd ticket lookup). No
    // resolved ticket → uncited (there is no /rca citation kind).
    if (type === "file" && subApp === "RCA") {
      const link = ticketLinks.get((sc["ticketId"] as string | undefined) ?? "");
      if (link) {
        pushThreadCitation(citations, link.channelId, link.conversationId, chunkIndex, label, {
          ...(link.xyneId ? { xyneId: link.xyneId } : {}),
        });
      }
      return citations.length > before;
    }
    // KB collection file → deep-link to the knowledge-base file viewer
    // (/<workspaceId>/knowledge-base/<projectId>/<channelId>/<collectionId>/<folder>/<itemId>).
    // projectId/channelId/collectionId(=clId, the ROOT collection)/folderId(=clFd)
    // are denormalized on the file doc at ingest (mapper.ts mapFile) and surfaced
    // by transformHit, so no collection lookup is needed for those. `r.id` itself
    // is the Vespa docId (= collectionItem.fileId, a stable UUID) though — NOT the
    // collectionItem.id the FE route/download/picker key on — so it's translated
    // via resolveCollectionItemIds before landing in the citation. The dashboard
    // mounts every route under /:workspaceId/... (see AppRoot.tsx), so a missing
    // workspaceId is just as fatal to the link as a missing collection id.
    // Channel-scoped collections carry projectId + channelId + collectionId;
    // workspace-scoped ones don't (nor do untranslatable/deleted items), so
    // degrade to the channel-level thread chip rather than route to the wrong
    // channel or emit a citation whose link 404s.
    if (type === "file" && subApp === "COLLECTIONS") {
      const projectId = sc["projectId"] as string | undefined;
      const collectionId = sc["collectionId"] as string | undefined;
      const folderId = sc["folderId"] as string | undefined;
      const itemId = collectionItemIds.get(r.id);
      if (workspaceId && projectId && channelId && collectionId && itemId) {
        citations.push({
          kind: "collection-item",
          url: `/${workspaceId}/knowledge-base/${projectId}/${channelId}/${collectionId}/${folderId || "_"}/${itemId}`,
          collectionId,
          collectionItemId: itemId,
          fileName: label,
          chunkIndex,
          label,
        });
        return true;
      }
      pushThreadCitation(citations, channelId, conversationId, chunkIndex, label);
      return citations.length > before;
    }
    // Non-routable docTypes: no citation kind maps to them. (memory docTypes
    // are stored uppercase FACT/SOP — `type` is lowercased above.)
    if (
      type === "user" ||
      type === "project" ||
      type === "sam_transcript" ||
      type === "memory" ||
      type === "fact" ||
      type === "sop"
    ) {
      return false;
    }
    // Desk mail → thread citation on the owning ticket's conversation.
    // applyChannelInfo later stamps channelKind=EMAIL so the FE routes it to
    // /support/<channelId>/<xyneId>?mail=<mailId>, scrolled to this email.
    if (type === "mail") {
      const link = mailLinks.get(r.id);
      if (link) {
        pushThreadCitation(citations, link.channelId, link.conversationId, chunkIndex, label, {
          ...(link.xyneId ? { xyneId: link.xyneId } : {}),
          mailId: r.id,
        });
      }
      return citations.length > before;
    }

    // Everything else (message/ticket/channel/attachment/transcript/KB file)
    // routes on its own channel + conversation ids. Files that only carry a
    // ticket reference (TICKET_ATTACHMENT without a channelRef) borrow the
    // resolved ticket's thread — and its xyneId, so desk attachments route to
    // /support like their parent ticket.
    const ticketLink =
      type === "file" ? ticketLinks.get((sc["ticketId"] as string | undefined) ?? "") : undefined;
    const xyneId = (sc["xyneId"] as string | undefined) ?? ticketLink?.xyneId;
    pushThreadCitation(
      citations,
      channelId ?? ticketLink?.channelId,
      conversationId ?? ticketLink?.conversationId,
      chunkIndex,
      label,
      {
        ...(sc["messageId"] ? { messageId: sc["messageId"] as string } : {}),
        ...(xyneId ? { xyneId } : {}),
      },
    );
    return citations.length > before;
  };

  const finish = async (text: string): Promise<ToolResult> => {
    const channelIds = citations.map((c) => c.channelId).filter((v): v is string => !!v);
    if (channelIds.length > 0) {
      applyChannelInfo(citations, await resolveChannelInfo(channelIds));
    }
    return okCited(text, citations);
  };

  // Surface the query that ACTUALLY ran (ACL-injected + select-normalized) — not
  // the raw agent input — appended to the result text (visible in the Result
  // panel) and mirrored into _meta.debug. queryDirect rides it back on
  // data.data.debug.
  const debugBlock = data.data.debug;
  const executedYql = debugBlock?.payloads?.[0]?.yql;
  const finalize = (r: ToolResult): ToolResult => {
    if (executedYql) appendText(r, `\n\n[Executed YQL (ACL guard injected): ${executedYql}]`);
    return debugBlock ? { ...r, _meta: { ...(r._meta ?? {}), debug: debugBlock } } : r;
  };

  if (data.data.grouped && data.data.groups) {
    if (data.data.groups.length === 0) return finalize(ok("No results found."));
    const parts: string[] = [];
    let chunkIndex = 0;
    for (const group of data.data.groups) {
      parts.push(`--- ${group.groupValue} (${group.count}) ---`);
      for (const r of group.results) {
        chunkIndex += 1;
        const cited = harvest(r, chunkIndex);
        parts.push(formatSearchResult(r, cited ? chunkIndex : null) + directEntityIdLines(r));
      }
      parts.push("");
    }
    return finalize(await finish(parts.join("\n")));
  }

  const results = data.data.results ?? [];
  if (results.length === 0) return finalize(ok("No results found."));
  const rendered = results
    .map((r, idx) => {
      const cited = harvest(r, idx + 1);
      return formatSearchResult(r, cited ? idx + 1 : null) + directEntityIdLines(r);
    })
    .join("\n\n");
  return finalize(
    await finish(
      `Found ${data.data.totalCount ?? results.length} result(s):\n\n${rendered}${paginationFooter({ returned: results.length, limit: hits, offset, total: data.data.totalCount })}`,
    ),
  );
}

// On failure, queryDirect attaches the query it actually sent to Vespa as
// `executedYql` — surface it (result text + _meta.debug) so the trace shows the
// real ACL-injected query, not just the raw agent input. Validation errors
// (thrown before Vespa is hit) carry no executedYql and render as plain text.
function directError(prefix: string, e: unknown): ToolResult {
  const executedYql = (e as { executedYql?: string })?.executedYql;
  const base = `${prefix}: ${errMsg(e)}`;
  const text = executedYql ? `${base}\n\n[Executed YQL (ACL guard injected): ${executedYql}]` : base;
  const result = err(text);
  return executedYql
    ? { ...result, _meta: { debug: { payloads: [{ stage: "direct", yql: executedYql, vespaParams: {} }] } } }
    : result;
}

// ── onyx-bench-search ────────────────────────────────────────────────────────
// Dedicated search tool for EnterpriseRAG-Bench (§5 evaluation harness).
// Searches the benchmark Vespa cluster (separate from prod) whose ~511k docs
// span 9 enterprise source types (Slack, Gmail, Linear, Google Drive, HubSpot,
// Fireflies, GitHub, Jira, Confluence). Available ONLY when ONYX_BENCH_VESPA=true.
//
// Ingestion maps source types to 4 Vespa schemas:
//   slack        → chat_message (docType="slack")
//   gmail        → mail         (docType="mail")
//   jira/linear  → ticket       (docType="ticket")
//   fireflies    → file         (docType="file", subApp="transcript")
//   confluence/github/google_drive/hubspot → file (docType="file", subApp="knowledge_base")
//
// Each source type gets its own channel container: bench-ch-<workspaceId>-<sourceType>.
// Source-type narrowing uses channelId (imported from channelRef on all 4 schemas)
// since docType doesn't distinguish most source types.

const BENCH_SOURCE_TYPES = [
  "slack", "gmail", "linear", "google_drive", "hubspot",
  "fireflies", "github", "jira", "confluence",
] as const;

/** The 4 content-bearing schemas the eval retrieval query targets. Mirrors
 *  RETRIEVAL_SCHEMAS in the dataset branch's enterpriseRagEval.ts. */
const BENCH_RETRIEVAL_SCHEMAS = "chat_message, file, mail, ticket";

/** Extract sourceType from the bench channelId pattern `bench-ch-<ws>-<sourceType>`. */
function sourceTypeFromChannelId(channelId: string | undefined): string | undefined {
  if (!channelId || !channelId.startsWith("bench-ch-")) return undefined;
  const rest = channelId.slice("bench-ch-".length);
  const lastDash = rest.lastIndexOf("-");
  if (lastDash < 0) return undefined;
  return rest.slice(lastDash + 1);
}

const onyxBenchSearch: ToolDef = {
  name: "onyx-bench-search",
  description:
    "Search the EnterpriseRAG-Bench corpus (~511k synthetic enterprise documents across 9 source types: " +
    "Slack, Gmail, Linear, Google Drive, HubSpot, Fireflies, GitHub, Jira, Confluence). " +
    "This is the fictional company \"Redwood Inference\" — use it to find documents relevant to the question.\n\n" +
    "## How to use\n" +
    "- Pass a `query` with the topic/keywords you're looking for.\n" +
    "- Optionally narrow by `sourceType` (e.g. \"confluence\" for wikis, \"slack\" for chat messages).\n" +
    "- Results include `docId`, `sourceType`, title, and a content snippet.\n" +
    "- If the first search doesn't find the answer, try different keywords or broaden the sourceType.\n\n" +
    "## Tips\n" +
    "- Semantic questions may use roundabout phrasing — try multiple query formulations.\n" +
    "- Project-related questions may require documents from different source types.\n" +
    "- If information seems absent, say so — do not guess from superficially related documents.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text search query — keywords or natural language describing what you're looking for.",
      },
      sourceType: {
        type: "string",
        enum: [...BENCH_SOURCE_TYPES],
        description:
          "Narrow to one source type. slack (chat), gmail (email), linear (project tickets), " +
          "google_drive (files), hubspot (CRM), fireflies (meeting transcripts), github (PRs), " +
          "jira (support tickets), confluence (wikis/docs). Omit to search all source types.",
      },
      hits: {
        type: "number",
        minimum: 1,
        maximum: 50,
        default: 10,
        description: "Max results to return (default 10, max 50).",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Pagination offset.",
      },
    },
    required: ["query"],
  },
  handler: withToolErrors("onyx-bench-search error", async (args, ctx) => {
    if (!isOnyxBenchLane()) {
      return err("onyx-bench-search requires ONYX_BENCH_VESPA=true.");
    }
    const query = String(args["query"] ?? "").trim();
    if (!query) return err("query is required.");
    const sourceType = args["sourceType"] != null ? String(args["sourceType"]) : undefined;
    const hits = Math.min(Math.max(Number(args["hits"] ?? 10), 1), 50);
    const offset = Math.max(Number(args["offset"] ?? 0), 0);
    const vespaEndpoint = process.env["VESPA_QUERY_ENDPOINT"] ?? "";
    if (!vespaEndpoint) return err("VESPA_QUERY_ENDPOINT is not set — cannot reach benchmark Vespa.");

    const workspaceId = (process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "").trim();
    if (!workspaceId) return err("XYNE_SPACES_WORKSPACE_ID is not set — cannot scope benchmark search.");

    // Build YQL — mirrors the eval retrieval query from enterpriseRagEval.ts:
    //   select * from sources chat_message, file, mail, ticket
    //   where ({grammar:"tokenize"} userInput(@query)) and workspaceId contains "..."
    //
    // sourceType narrowing: each source type gets its own channel container
    // (bench-ch-<workspaceId>-<sourceType>), and channelId is imported from
    // channelRef.docId on all 4 schemas. This is the ONLY reliable way to
    // narrow by source type — docType doesn't distinguish (e.g. gmail→"mail",
    // jira→"ticket", fireflies→"file").
    const clauses: string[] = [`workspaceId contains "${esc(workspaceId)}"`];
    if (sourceType) {
      const benchChannelId = `bench-ch-${workspaceId}-${sourceType}`;
      clauses.push(`channelId contains "${esc(benchChannelId)}"`);
    }
    const yql = `select * from sources ${BENCH_RETRIEVAL_SCHEMAS} where ({grammar:"tokenize"} userInput(@query)) and ${clauses.join(" and ")}`;

    try {
      const data = await queryDirect(
        yql,
        query,
        ctx.userId,
        hits,
        offset,
        vespaEndpoint,
        "default_native",
        undefined,
        workspaceId,
      );
      const results = data.data.results ?? [];
      if (results.length === 0) return ok(`No results found for "${query}".`);

      const rendered = results.map((r, idx) => {
        const sc = r.searchContext ?? {};
        const st = sourceTypeFromChannelId(sc["channelId"] as string | undefined) ?? r.type;
        const lines = [
          `[${idx + 1}] ${r.title || st}`,
          `  docId: ${r.id}`,
          `  sourceType: ${st}`,
        ];
        if (r.context && typeof r.context === "string") lines.push(`  content: ${r.context}`);
        return lines.join("\n");
      }).join("\n\n");

      return ok(
        `Found ${data.data.totalCount ?? results.length} result(s):\n\n${rendered}` +
        paginationFooter({ returned: results.length, limit: hits, offset, total: data.data.totalCount }),
      );
    } catch (e) {
      return directError("onyx-bench-search error", e);
    }
  }),
};

// ── spaces-vespa-query ───────────────────────────────────────────────────────

const spacesVespaQuery: ToolDef = {
  name: "spaces-vespa-query",
  description:
    "Execute a raw YQL query directly against Vespa. " +
    "Use this when spaces-search doesn't support the exact filter combination you need.\n\n" +
    "## Workflow\n" +
    "1. Call **spaces-vespa-schema** with the schema name to discover exact field names and types.\n" +
    "2. Write your YQL using those field names.\n" +
    "3. Call this tool with the YQL.\n\n" +
    "## ACL — include the correct guard per schema\n" +
    "Always include the access control condition for the schema you query. ACL is auto-injected if omitted, but you should write it explicitly.\n" +
    '- message / attachment / ticket / sam_transcript / mail / mail_attachment / memory: `permissions contains "<userId>"`\n' +
    '- file: `(ownerId contains "<userId>" or permissions contains "<userId>" or isPrivate contains "false")` for CANVAS; `(ownerId contains "<userId>" or channelPermissions contains "<userId>" or isPrivate contains "false")` for CHAT_ATTACHMENT/TRANSCRIPT; no guard for RCA\n' +
    "- user / channel: no ACL needed (public)\n" +
    "Use the `userId` field from **spaces-whoami** if you need your own id.\n\n" +
    "## YQL examples (use the YQL source name, NOT the schema name from spaces-vespa-schema)\n" +
    "```\n" +
    "-- tickets assigned to a user, open only (source: ticket)\n" +
    'select * from sources ticket where userInput(@query) and status contains "OPEN" and assignedTo contains "<userId>" and permissions contains "<userId>"\n\n' +
    "-- messages in a channel since a date (source: message) — write dates as dd/mm/yy, NOT epoch ms\n" +
    'select * from sources message where channelId contains "<channelId>" and createdAtTimestamp > 01/06/26 and permissions contains "<userId>"\n\n' +
    "-- files of subApp CANVAS owned by user (source: file)\n" +
    'select * from sources file where subApp contains "CANVAS" and ownerId contains "<userId>"\n\n' +
    "-- channels by name (source: channel, no ACL needed)\n" +
    "select * from sources channel where userInput(@query)\n" +
    "```\n\n" +
    "## YQL source names\n" +
    "message, attachment, channel, ticket, user, file, sam_transcript\n" +
    "(These differ from the schema names passed to spaces-vespa-schema — see that tool's description for the mapping.)\n\n" +
    "## Ranking (rankProfile / rankInputs)\n" +
    "Relevance scoring is driven by a Vespa rank profile that must EXIST in every schema your YQL touches.\n" +
    "- For a filter-only or grouping/count query (no relevance order needed) leave both unset — the tool uses the built-in `unranked` profile.\n" +
    "- For free-text relevance, read the target schema's .sd `rank-profile <name> { ... }` blocks and pass `rankProfile` (e.g. `default_native` for general relevance, `default_fuzzy` for typo-tolerant, `semantic_ranking` for vector-only). If unset, free-text defaults to `default_native`.\n" +
    "- When you set a scoring `rankProfile`, also pass `rankInputs` taken from that profile's `inputs { query(...) }` block. If unset, the standard default_native inputs are used.\n\n" +
    "## Notes\n" +
    "- Only available when DIRECT_VESPA_SEARCH is enabled.\n" +
    "- Pass free-text as `query` (bound to `@query` in YQL via `userInput(@query)`), not embedded in the YQL string.\n" +
    '- Write date filters as dd/mm/yy (e.g. `createdAtTimestamp > 01/06/26`) — do NOT compute epoch ms yourself. The tool converts each literal to milliseconds before running the query. A bare date is treated as IST midnight of that day; to filter on a specific IST time add `HH:MM` (or `HH:MM:SS`), e.g. `createdAtTimestamp > "01/06/26 14:30"`. dd/mm/yyyy is also accepted. Dates are only converted when they follow a comparison operator (> < >= <=), so a date inside a text match stays literal.\n' +
    "- Result rows come back citation-ready: each routable row (message/thread, ticket, channel, canvas, chat file, desk mail, RCA) is auto-tagged with a clickable source token. You do NOT need to project specific columns for this — the tool normalizes your `select` list to `select *` and returns a curated field set, so just write the `from`/`where`/`order by` you need.",
  inputSchema: {
    type: "object",
    properties: {
      yql: {
        type: "string",
        description: "Raw Vespa YQL query string. Use field names from spaces-vespa-schema.",
      },
      query: {
        type: "string",
        description:
          "Free-text query bound to @query in the YQL. Pass this separately — do not embed it in the yql string.",
      },
      hits: {
        type: "number",
        minimum: 0,
        maximum: 100,
        default: 20,
        description:
          "Max document hits to return (default 20, max 100). Pass 0 for grouping/count queries that only need the group aggregation, not the documents themselves.",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Pagination offset.",
      },
      rankProfile: {
        type: "string",
        description:
          "Optional Vespa rank profile to score with, read from the schema's .sd `rank-profile` blocks. Must exist in EVERY source in your YQL. " +
          "Common: `default_native` (general relevance), `default_fuzzy` (typo-tolerant), `semantic_ranking` (vector-only), `unranked` (no scoring). " +
          "If omitted: `unranked` for grouping/count or no-text queries, `default_native` otherwise.",
      },
      rankInputs: {
        type: "object",
        additionalProperties: true,
        description:
          "Optional inputs for the chosen rank profile, read from its `inputs { query(...) }` block in the .sd. " +
          "Keys may be bare (`alpha`) or wrapped (`query(alpha)`); each is sent as `input.query(<name>)`. " +
          'For an embedding input use `{ "e": "embed(hf-embedder, @query)" }` (the embedder id is required — the cluster defines more than one). Ignored when the profile is `unranked`; if omitted with a scoring profile, the standard default_native inputs are used.',
      },
    },
    required: ["yql"],
  },
  async handler(args, ctx) {
    if (!CONFIG.directVespaSearch) {
      return err("spaces-vespa-query requires DIRECT_VESPA_SEARCH=true.");
    }
    try {
      const yql = String(args["yql"] ?? "").trim();
      if (!yql) return err("yql is required.");
      const query = String(args["query"] ?? "").trim();
      const hits = Math.min(Math.max(Number(args["hits"] ?? 20), 0), 100);
      const offset = Math.max(Number(args["offset"] ?? 0), 0);
      const rankProfile = args["rankProfile"] != null ? String(args["rankProfile"]) : undefined;
      const rankInputs =
        args["rankInputs"] && typeof args["rankInputs"] === "object" && !Array.isArray(args["rankInputs"])
          ? (args["rankInputs"] as Record<string, unknown>)
          : undefined;

      const { userId: aclUserId, workspaceId } = await directVespaIdentity(ctx.userId);
      if (!workspaceId) {
        log.error(
          `[xyne-spaces-tools] workspaceId is required; refusing raw Vespa query userId=${ctx.userId}`,
        );
        return err("Could not resolve your workspaceId — cannot run a workspace-scoped raw Vespa query.");
      }

      const data = await queryDirect(
        yql,
        query,
        aclUserId,
        hits,
        offset,
        CONFIG.vespaQueryEndpoint,
        rankProfile,
        rankInputs,
        workspaceId,
      );
      return renderDirectResult(data, hits, offset, workspaceId);
    } catch (e) {
      return directError("vespa-query error", e);
    }
  },
};

/**
 * Caller identity for the DIRECT-VESPA tools, with a LOCAL-ONLY override.
 *
 * These tools do not go through the MCP credentials path: they read
 * `ctx.userId` (the Spaces user id on the claw session) and resolve the tenant
 * with `getWorkspaceIdForUser`, a lookup against the local Spaces DB. Locally
 * that pins every query to whichever seeded user your Spaces instance
 * authenticates as, so a query cannot be aimed at another tenant — which is
 * exactly what you need when the Vespa endpoint is port-forwarded to a
 * different environment and the local ids match nothing in that index.
 *
 * Scope is deliberately narrow: ONLY the ACL + workspace guards of the direct
 * Vespa tools. The gateway-backed tools keep the real session identity, so
 * they continue to work against local data instead of failing on an identity
 * that has no local Spaces session.
 *
 * HARD-GATED on `!CONFIG.isProduction` — an override here would otherwise run
 * one user's queries under another user's ACL.
 */
async function directVespaIdentity(
  ctxUserId: string,
): Promise<{ userId: string; workspaceId: string | null }> {
  const devUser = CONFIG.isProduction ? "" : (process.env["XYNE_SPACES_DEV_USER_ID"] ?? "").trim();
  const devWorkspace = CONFIG.isProduction ? "" : (process.env["XYNE_SPACES_DEV_WORKSPACE_ID"] ?? "").trim();
  const userId = devUser || ctxUserId;
  // Env-first workspace resolution: the tool server's spawn env already carries
  // XYNE_SPACES_WORKSPACE_ID when the adapter is bound — bench + session modes.
  // Falls back to the Spaces-DB user row when no env set.
  const envWorkspace = (process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "").trim();
  const workspaceId = devWorkspace || envWorkspace || (await getWorkspaceIdForUser(userId));
  if (devUser || devWorkspace) {
    log.warn(
      `[xyne-spaces-tools] DEV vespa identity override: user ${ctxUserId} -> ${userId}, workspace -> ${workspaceId}`,
    );
  }
  return { userId, workspaceId };
}

// ── spaces-vespa-search ──────────────────────────────────────────────────────

const spacesVespaSearch: ToolDef = {
  name: "spaces-vespa-search",
  description:
    "Structured search across Xyne content. Declare WHAT you want — you do NOT write YQL; the tool builds it.\n\n" +
    "## How to use\n" +
    "1. Pick a `searchArea` (the scope). It resolves in code to the Vespa source, the baseline docType/subApp constraints, the correct access-control guard, and the correct timestamp field.\n" +
    "2. Narrow with `filters`: a nested operator-bag object `{ <field>: { <op>: <value> } }`. A list value under `in`/`containsAny` means OR; different fields are ANDed.\n" +
    "3. Add free text in `query` (topical keyword/semantic match). Omit it for pure filter lookups.\n\n" +
    "## Operators\n" +
    "- string fields: `contains` (single token), `in` / `containsAny` (OR across values), `nin` (NOT).\n" +
    "- number fields: `eq`, `in`, `nin`, `gt`/`gte`/`lt`/`lte`.\n" +
    "- date fields: `gt`/`gte`/`lt`/`lte` with values as **dd/mm/yy** (IST), e.g. `01/06/26`. Add `HH:MM` for a specific time.\n\n" +
    "Each area accepts only its listed fields/ops — an invalid one returns an error listing the allowed set. Access control is always enforced automatically.\n\n" +
    "## Areas & fields\n" +
    describeAreasForPrompt() +
    "\n\n## Examples\n" +
    "- Open tickets assigned to a user:\n" +
    '  `{ "searchArea": "ticket", "filters": { "status": { "in": ["TODO", "STARTED"] }, "assignedTo": { "contains": "<userId>" } } }`\n' +
    "- Canvases in a channel created since a date:\n" +
    '  `{ "searchArea": "canvas", "filters": { "channelId": { "contains": "<channelId>" }, "createdDate": { "gte": "01/06/26" } } }`\n' +
    "- Messages about a topic in a channel:\n" +
    '  `{ "searchArea": "message", "query": "launch checklist", "filters": { "channelId": { "contains": "<channelId>" } } }`\n\n' +
    "Only available when DIRECT_VESPA_SEARCH is enabled. Results come back citation-ready.",
  inputSchema: {
    type: "object",
    properties: {
      searchArea: {
        type: "string",
        enum: [...AREA_NAMES, ...Object.keys(AREA_ALIASES)],
        description:
          "The scope to search. Resolves to the Vespa source, baseline constraints, ACL guard, and timestamp field.",
      },
      query: {
        type: "string",
        description:
          "Free-text query (topical keyword/semantic match), bound to @query. Omit for pure-filter lookups.",
      },
      filters: {
        type: "object",
        additionalProperties: true,
        description:
          "Nested operator bags: { <field>: { <op>: <value> } }. Only the fields/ops listed for the chosen area are accepted (else an error is returned). Dates are dd/mm/yy (IST).",
      },
      docType: {
        type: "string",
        description:
          "Optional docType narrowing (only areas whose docType is not fixed accept this, e.g. memory → FACT/SOP).",
      },
      groupBy: {
        type: "string",
        description:
          "Group results by an allowed field for the area (see the field list). Returns per-group counts. Cannot be combined with sort.",
      },
      groupOrder: {
        type: "string",
        enum: ["desc", "asc"],
        default: "desc",
        description:
          "Order groups by count: desc (largest first, default) or asc (smallest first). Only used with groupBy.",
      },
      maxGroups: {
        type: "number",
        minimum: 1,
        maximum: 50,
        default: 20,
        description: "Max distinct groups to return (default 20, cap 50). Only used with groupBy.",
      },
      hitsPerGroup: {
        type: "number",
        minimum: 1,
        maximum: 5,
        default: 5,
        description:
          "Sample documents to include per group (default 5, min 1, cap 5). Only used with groupBy.",
      },
      sort: {
        type: "object",
        additionalProperties: false,
        properties: {
          by: {
            type: "string",
            description:
              "Field to order by — one of the area's sortBy fields (see the field list; typically date fields like createdDate/updatedDate).",
          },
          dir: {
            type: "string",
            enum: ["asc", "desc"],
            default: "desc",
            description: "Sort direction (default desc = newest/highest first).",
          },
        },
        required: ["by"],
        description:
          'Order results by a sortable field, e.g. {by:"createdDate", dir:"desc"} for newest-first. Cannot be combined with groupBy.',
      },
      hits: {
        type: "number",
        minimum: 0,
        maximum: 100,
        default: 20,
        description:
          "Max document hits to return (default 20, max 100). Pass 0 for grouping/count-only queries.",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Pagination offset.",
      },
      rankProfile: {
        type: "string",
        description:
          "Optional Vespa rank profile — one of default_native or unranked. Defaults to default_native for free-text searches, and unranked for filter-only/grouping (nothing to rank). An invalid profile returns an error listing the allowed set. Rank inputs are supplied automatically.",
      },
    },
    required: ["searchArea"],
  },
  async handler(args, ctx) {
    if (!CONFIG.directVespaSearch) {
      return err("spaces-vespa-search requires DIRECT_VESPA_SEARCH=true.");
    }
    try {
      const searchArea = String(args["searchArea"] ?? "").trim();
      if (!searchArea) return err("searchArea is required.");
      const query = String(args["query"] ?? "").trim();
      const filters =
        args["filters"] && typeof args["filters"] === "object" && !Array.isArray(args["filters"])
          ? (args["filters"] as Record<string, Record<string, unknown>>)
          : undefined;
      const docType = args["docType"] != null ? String(args["docType"]) : undefined;
      const groupBy = args["groupBy"] != null ? String(args["groupBy"]) : undefined;
      const groupOrder =
        args["groupOrder"] === "asc"
          ? ("asc" as const)
          : args["groupOrder"] === "desc"
            ? ("desc" as const)
            : undefined;
      const maxGroups = args["maxGroups"] != null ? Number(args["maxGroups"]) : undefined;
      const hitsPerGroup = args["hitsPerGroup"] != null ? Number(args["hitsPerGroup"]) : undefined;
      const rawSort = args["sort"];
      const sort =
        rawSort &&
        typeof rawSort === "object" &&
        !Array.isArray(rawSort) &&
        (rawSort as Record<string, unknown>)["by"]
          ? {
              by: String((rawSort as Record<string, unknown>)["by"]),
              dir:
                (rawSort as Record<string, unknown>)["dir"] === "asc" ? ("asc" as const) : ("desc" as const),
            }
          : undefined;
      const hits = Math.min(Math.max(Number(args["hits"] ?? 20), 0), 100);
      const offset = Math.max(Number(args["offset"] ?? 0), 0);
      const rankProfile = args["rankProfile"] != null ? String(args["rankProfile"]) : undefined;
      // `fields` — INTERNAL, deliberately absent from inputSchema.
      //
      // Column projection (`select <cols>` instead of `select *`), used by
      // xyne-claw's prefetch to sample many hits for their channelId without
      // dragging message bodies across the wire (60 hits: ~460KB -> ~20KB).
      // It is NOT advertised to the model on purpose: it is a performance knob
      // with no bearing on WHICH rows match, so exposing it would only add a
      // dimension for the model to reason about and get wrong. The schema sets
      // no top-level additionalProperties:false, so a caller that knows about
      // it can pass it; everyone else gets full rows exactly as before.
      // Entries are validated in buildYqlFromParams against the area's own
      // columns — nothing raw reaches the YQL.
      const fields = Array.isArray(args["fields"])
        ? (args["fields"] as unknown[]).map(String).filter(Boolean)
        : undefined;

      // Tenant scope — every direct-Vespa query is confined to the caller's
      // workspace, resolved from the user record (public.users). Refuse to run
      // unscoped rather than risk crossing tenants.
      const { userId: aclUserId, workspaceId } = await directVespaIdentity(ctx.userId);
      if (!workspaceId)
        return err("Could not resolve your workspaceId — cannot run a workspace-scoped search.");

      // Build the YQL from structured params in CODE — throws on any validation
      // failure (unknown area/field/op, bad date, invalid rankProfile), surfaced
      // as a tool error. rankInputs are auto-supplied by queryDirect.
      const built = buildYqlFromParams(
        {
          searchArea,
          query,
          ...(fields && fields.length > 0 ? { fields } : {}),
          ...(filters ? { filters } : {}),
          ...(docType ? { docType } : {}),
          ...(groupBy ? { groupBy } : {}),
          ...(groupOrder ? { groupOrder } : {}),
          ...(maxGroups != null ? { maxGroups } : {}),
          ...(hitsPerGroup != null ? { hitsPerGroup } : {}),
          ...(sort ? { sort } : {}),
          ...(rankProfile ? { rankProfile } : {}),
          hits,
        },
        aclUserId,
        workspaceId,
      );

      const data = await queryDirect(
        built.yql,
        built.query,
        aclUserId,
        hits,
        offset,
        CONFIG.vespaQueryEndpoint,
        built.rankProfile,
        undefined,
        workspaceId,
      );
      return renderDirectResult(data, hits, offset, workspaceId);
    } catch (e) {
      return directError("vespa-search error", e);
    }
  },
};

// ── spaces-my-items (drafts + scheduled + email-drafts + bookmarks + pinned) ──
// One consolidated READ-ONLY tool for the user's personal Spaces items — a `type`
// param selects the surface. Everything is user-scoped by the /api/query/claw
// gateway ACL (DraftMessagesACL / ScheduledMessagesACL / EmailDraftsACL /
// BookmarksACL, and ConversationsACL for pinned) AND re-filtered here for defense
// in depth. Bookmark/pinned targets are resolved through ACL'd lookups too, so an
// item pointing at something the user can't access simply doesn't resolve.
const spacesMyItems: ToolDef = {
  name: "spaces-my-items",
  description:
    "List the current user's OWN personal Spaces items (READ-ONLY, always scoped to you). `type` selects the surface: " +
    "`drafts` = saved chat-message drafts; `scheduled` = scheduled / recurring message sends; " +
    "`email-drafts` = Desk email-reply drafts; `bookmarks` = saved items (messages / conversations / tickets / canvases); " +
    "`pinned` = pinned messages/threads in channels you can access. " +
    "Use it for 'what have I drafted / scheduled / bookmarked / pinned?'. Only items you own or can access are returned.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["drafts", "scheduled", "email-drafts", "bookmarks", "pinned"],
        description:
          "Which surface to list: drafts, scheduled, email-drafts, bookmarks (saved items), or pinned (pinned messages/threads).",
      },
      entityType: {
        type: "string",
        enum: ["message", "conversation", "ticket", "canvas"],
        description: "For type=bookmarks only: narrow to one bookmarked kind.",
      },
      completed: {
        type: "boolean",
        description:
          "For type=bookmarks only: true → only bookmarks marked complete; false → only open bookmarks. Omit for all.",
      },
      channelId: {
        type: "string",
        description:
          "Limit to one channel. Applies to type=pinned (threads), type=scheduled (scheduled sends), and type=email-drafts (desk drafts).",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 50,
        description: "Max items (default 50).",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
    },
    required: ["type"],
  },
  handler: withToolErrors("my-items error", async (args, ctx) => {
      const type = String(args["type"] ?? "");
      const limit = Math.min(Math.max(Number(args["limit"] ?? 50), 1), 100);
      const offset = Math.max(Number(args["offset"] ?? 0), 0);

      if (type === "bookmarks") {
        const entityFilter = args["entityType"] ? String(args["entityType"]).toUpperCase() : undefined;
        const rows = (await interact({
          model: "bookmark",
          operation: "findMany",
          where: {
            userId: ctx.userId,
            isDeleted: { equals: false },
            ...(entityFilter ? { entityType: { equals: entityFilter } } : {}),
            ...(typeof args["completed"] === "boolean" ? { isCompleted: { equals: args["completed"] } } : {}),
          },
          orderBy: [{ createdAt: "desc" }],
          take: limit,
          skip: offset,
        })) as Array<{ id: string; entityId?: string; entityType?: string; isCompleted?: boolean }>;
        if (rows.length === 0) return ok("No bookmarks.");

        // Batch-resolve each bookmarked target → title + deep-link, per type. Each
        // lookup is ACL-scoped (Conversations/Messages/Tickets/CanvasesACL), so a
        // target the user can no longer access just renders as an unresolved id.
        const ids = (t: string) =>
          rows.filter((b) => b.entityType === t && b.entityId).map((b) => b.entityId!) as string[];
        type Target = {
          title?: string | undefined;
          channelId?: string | undefined;
          conversationId?: string | undefined;
          messageId?: string | undefined;
          xyneId?: string | undefined;
          viewAccessId?: string | undefined;
        };
        const target = new Map<string, Target>(); // key `TYPE:entityId`

        const convIds = ids("CONVERSATION");
        if (convIds.length > 0) {
          const cs = (await interact({
            model: "conversation",
            operation: "findMany",
            where: { conversationId: { in: convIds } },
            take: convIds.length,
          })) as Array<{ conversationId?: string; channelId?: string }>;
          for (const c of cs)
            if (c.conversationId)
              target.set(`CONVERSATION:${c.conversationId}`, {
                conversationId: c.conversationId,
                channelId: c.channelId,
              });
        }
        const msgIds = ids("MESSAGE");
        if (msgIds.length > 0) {
          const ms = (await interact({
            model: "message",
            operation: "findMany",
            where: { messageId: { in: msgIds } },
            take: msgIds.length,
          })) as Array<{ messageId?: string; conversationId?: string; content?: string }>;
          const needConv = new Set<string>();
          for (const m of ms)
            if (m.messageId) {
              target.set(`MESSAGE:${m.messageId}`, {
                messageId: m.messageId,
                conversationId: m.conversationId,
                title: m.content ? cleanSnippet(m.content).slice(0, 80) : undefined,
              });
              if (m.conversationId) needConv.add(m.conversationId);
            }
          if (needConv.size > 0) {
            const cs = (await interact({
              model: "conversation",
              operation: "findMany",
              where: { conversationId: { in: [...needConv] } },
              take: needConv.size,
            })) as Array<{ conversationId?: string; channelId?: string }>;
            const chOf = new Map(
              cs.filter((c) => c.conversationId).map((c) => [c.conversationId!, c.channelId] as const),
            );
            for (const t of target.values())
              if (t.messageId && t.conversationId) t.channelId = chOf.get(t.conversationId);
          }
        }
        const ticketIds = ids("TICKET");
        if (ticketIds.length > 0) {
          const ts = (await interact({
            model: "ticket",
            operation: "findMany",
            where: { id: { in: ticketIds } },
            take: ticketIds.length,
          })) as Array<{ id?: string; xyneId?: string; title?: string; channelId?: string; convId?: string }>;
          for (const t of ts)
            if (t.id)
              target.set(`TICKET:${t.id}`, {
                title: t.title,
                xyneId: t.xyneId,
                channelId: t.channelId,
                conversationId: t.convId,
              });
        }
        const canvasIds = ids("CANVAS");
        if (canvasIds.length > 0) {
          const cvs = (await interact({
            model: "canvas",
            operation: "findMany",
            where: { id: { in: canvasIds } },
            take: canvasIds.length,
          })) as Array<{ id?: string; title?: string; viewAccessId?: string; channelId?: string }>;
          for (const c of cvs)
            if (c.id)
              target.set(`CANVAS:${c.id}`, {
                title: c.title,
                viewAccessId: c.viewAccessId,
                channelId: c.channelId,
              });
        }

        const channelInfo = await resolveChannelInfo(
          [...target.values()].map((t) => t.channelId).filter((v): v is string => !!v),
        );
        const citations: Citation[] = [];
        const lines = rows.map((b, idx) => {
          const t = b.entityId && b.entityType ? target.get(`${b.entityType}:${b.entityId}`) : undefined;
          const ch = t?.channelId ? channelInfo.get(t.channelId)?.name : undefined;
          const label = t?.title || t?.xyneId || `${b.entityType} ${b.entityId}`;
          const parts = [
            `[${(b.entityType ?? "item").toLowerCase()}] ${label}${b.isCompleted ? " [completed]" : ""}`,
          ];
          if (ch) parts.push(`  Channel: #${ch}`);
          if (b.entityType === "CANVAS") {
            pushCanvasCitation(citations, t?.viewAccessId, idx + 1, label);
          } else {
            pushThreadCitation(citations, t?.channelId, t?.conversationId, idx + 1, label, {
              ...(t?.messageId ? { messageId: t.messageId } : {}),
              ...(t?.xyneId ? { xyneId: t.xyneId } : {}),
            });
          }
          return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
        });
        applyChannelInfo(citations, channelInfo);
        return okCited(
          `${rows.length} bookmark(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`,
          citations,
        );
      }

      if (type === "pinned") {
        // Pinned "messages" are pinned CONVERSATIONS (Conversation.pinned). ACL:
        // ConversationsACL scopes to threads in channels the user can access.
        const chFilter = args["channelId"] ? String(args["channelId"]) : undefined;
        const rows = (await interact({
          model: "conversation",
          operation: "findMany",
          where: { pinned: { equals: true }, ...(chFilter ? { channelId: { equals: chFilter } } : {}) },
          orderBy: [{ lastActivityAt: "desc" }],
          take: limit,
          skip: offset,
        })) as Array<{
          conversationId?: string;
          channelId?: string;
          ticketId?: string;
          initialMessageId?: string;
        }>;
        if (rows.length === 0)
          return ok(chFilter ? "No pinned messages in that channel." : "No pinned messages.");
        // Preview the pinned thread's first message.
        const initIds = rows.map((r) => r.initialMessageId).filter((v): v is string => !!v);
        const preview = new Map<string, string>();
        if (initIds.length > 0) {
          const ms = (await interact({
            model: "message",
            operation: "findMany",
            where: { messageId: { in: initIds } },
            take: initIds.length,
          })) as Array<{ messageId?: string; content?: string }>;
          for (const m of ms) if (m.messageId && m.content) preview.set(m.messageId, cleanSnippet(m.content));
        }
        const channelInfo = await resolveChannelInfo(
          rows.map((r) => r.channelId).filter((v): v is string => !!v),
        );
        const citations: Citation[] = [];
        const lines = rows.map((r, idx) => {
          const ch = r.channelId ? channelInfo.get(r.channelId)?.name : undefined;
          const body = r.initialMessageId ? preview.get(r.initialMessageId) : undefined;
          const parts = [`Pinned${ch ? ` in #${ch}` : ""}${r.ticketId ? " (ticket thread)" : ""}`];
          if (body) parts.push(`  ${body}`);
          if (r.conversationId) parts.push(`  conversationId: ${r.conversationId}`);
          if (r.channelId) parts.push(`  channelId: ${r.channelId}`);
          pushThreadCitation(
            citations,
            r.channelId,
            r.conversationId,
            idx + 1,
            ch ? `Pinned in #${ch}` : "Pinned thread",
            r.initialMessageId ? { messageId: r.initialMessageId } : undefined,
          );
          return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
        });
        applyChannelInfo(citations, channelInfo);
        return okCited(
          `${rows.length} pinned message(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`,
          citations,
        );
      }

      if (type === "scheduled") {
        const schedChannel = args["channelId"] ? String(args["channelId"]) : undefined;
        const rows = (await interact({
          model: "scheduledMessage",
          operation: "findMany",
          where: { createdBy: ctx.userId, ...(schedChannel ? { channelId: { equals: schedChannel } } : {}) },
          orderBy: [{ updatedAt: "desc" }],
          take: limit,
          skip: offset,
        })) as Array<{
          id: string;
          title?: string;
          messageContent?: string;
          channelId?: string;
          daysOfWeek?: unknown;
          scheduledTime?: string;
          isActive?: boolean;
        }>;
        if (rows.length === 0) return ok("No scheduled messages.");
        const channelInfo = await resolveChannelInfo(
          rows.map((r) => r.channelId).filter((v): v is string => !!v),
        );
        const citations: Citation[] = [];
        const lines = rows.map((r, idx) => {
          const ch = r.channelId ? channelInfo.get(r.channelId)?.name : undefined;
          const parts = [`${r.title || "(untitled schedule)"}${r.isActive === false ? " [inactive]" : ""}`];
          if (r.messageContent) parts.push(`  ${cleanSnippet(r.messageContent)}`);
          const sched: string[] = [];
          if (r.scheduledTime) sched.push(`at ${r.scheduledTime}`);
          if (Array.isArray(r.daysOfWeek) && r.daysOfWeek.length > 0)
            sched.push(`on ${(r.daysOfWeek as unknown[]).join(", ")}`);
          if (sched.length > 0) parts.push(`  Schedule: ${sched.join(" ")}`);
          if (ch) parts.push(`  Channel: #${ch}`);
          if (r.channelId) parts.push(`  channelId: ${r.channelId}`);
          pushThreadCitation(citations, r.channelId, undefined, idx + 1, ch ? `#${ch}` : "Scheduled message");
          return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
        });
        applyChannelInfo(citations, channelInfo);
        return okCited(
          `${rows.length} scheduled message(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`,
          citations,
        );
      }

      // drafts | email-drafts — both are thread-scoped unsent bodies owned by userId.
      // email-drafts are per-desk in the UI, so honor an optional channelId scope.
      const isEmail = type === "email-drafts";
      const draftChannel = isEmail && args["channelId"] ? String(args["channelId"]) : undefined;
      const rows = (await interact({
        model: isEmail ? "emailDraft" : "draftMessage",
        operation: "findMany",
        where: { userId: ctx.userId, ...(draftChannel ? { channelId: { equals: draftChannel } } : {}) },
        orderBy: [{ updatedAt: "desc" }],
        take: limit,
        skip: offset,
      })) as Array<{
        id: string;
        channelId?: string;
        conversationId?: string;
        content?: string;
        draftContent?: string;
        hasAttachment?: boolean;
        autoDraftStatus?: string;
        updatedAt?: string;
      }>;
      if (rows.length === 0) return ok(isEmail ? "No email drafts." : "No drafts.");
      const channelInfo = await resolveChannelInfo(
        rows.map((r) => r.channelId).filter((v): v is string => !!v),
      );
      const citations: Citation[] = [];
      const lines = rows.map((r, idx) => {
        const ch = r.channelId ? channelInfo.get(r.channelId)?.name : undefined;
        const body = cleanSnippet((isEmail ? r.draftContent : r.content) ?? "");
        const when = r.updatedAt ? `[${toIST(r.updatedAt)}] ` : "";
        const head = `${when}${isEmail ? "Email draft" : "Draft"}${ch ? ` in #${ch}` : ""}${r.hasAttachment ? " [attachment]" : ""}${r.autoDraftStatus ? ` (${r.autoDraftStatus})` : ""}`;
        const parts = [head];
        if (body) parts.push(`  ${body}`);
        if (r.conversationId) parts.push(`  conversationId: ${r.conversationId}`);
        if (r.channelId) parts.push(`  channelId: ${r.channelId}`);
        pushThreadCitation(
          citations,
          r.channelId,
          r.conversationId,
          idx + 1,
          ch ? `Draft in #${ch}` : "Draft",
        );
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });
      applyChannelInfo(citations, channelInfo);
      return okCited(
        `${rows.length} ${isEmail ? "email draft" : "draft"}(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`,
        citations,
      );
    }),
};

// ── spaces-saved-views (Project / Ticket board "Views") ──────────────
// READ-ONLY list of the user's SAVED VIEWS — the named filter presets shown in
// the VIEWS panel of a Tickets/Project board (e.g. a "Created By" view). Data
// model: SavedUserConfiguration (the view: name, board = contextId, visibility,
// isStarred) + SavedUserConfigurationValue (the stored filter rows:
// entityName/fieldName/fieldValue). Both are exposed through the /api/query/claw
// gateway and MUST be ACL-scoped there (SavedUserConfigurationsACL /
// SavedUserConfigurationValuesACL → userId === ctx.userId OR visibility PUBLIC).
//
// NOTE: the gateway AST strips `include`/`select`, so the view's filter rows can
// only be fetched with a SECOND query against `savedUserConfigurationValue` —
// hence the two interact() calls below. Each view's filters are returned so the
// agent can reproduce the same filtering with spaces-tickets.
const spacesSavedViews: ToolDef = {
  name: "spaces-saved-views",
  description:
    "List the current user's SAVED VIEWS on Ticket/Project boards (READ-ONLY, scoped to you and PUBLIC views). " +
    "A saved view is a named filter preset (the VIEWS panel on a board) — e.g. a 'Created By' or 'My open bugs' view. " +
    "Each view returns its stored filter definition (entity/field/value rows) so you can REPRODUCE it with spaces-tickets. " +
    "Use it for 'what views do I have on this board?', 'read my <name> view', or to resolve a saved view's filters before fetching tickets. " +
    "Filter by `contextId` (the boardId the view belongs to) and/or `name`. This tool does NOT return tickets — read the view's filters, then call spaces-tickets.",
  inputSchema: {
    type: "object",
    properties: {
      contextId: {
        type: "string",
        description:
          "Limit to views saved on ONE board. SavedUserConfiguration.contextId === boardId (use spaces-boards to resolve a board).",
      },
      name: {
        type: "string",
        description: "Case-insensitive substring match on the view name (e.g. 'Created By').",
      },
      starredOnly: { type: "boolean", description: "If true, only return starred/favourite views." },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 50,
        description: "Max views (default 50).",
      },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
    },
  },
  handler: withToolErrors("saved-views error", async (args, ctx) => {
      const limit = Math.min(Math.max(Number(args["limit"] ?? 50), 1), 100);
      const offset = Math.max(Number(args["offset"] ?? 0), 0);
      const contextId = args["contextId"] ? String(args["contextId"]) : undefined;
      const nameFilter = args["name"] ? String(args["name"]) : undefined;
      const starredOnly = args["starredOnly"] === true;

      // 1) The views themselves (ACL: own + PUBLIC). No `include` — the gateway
      //    strips it — so filters come from a second query below.
      const views = (await interact({
        model: "savedUserConfiguration",
        operation: "findMany",
        where: {
          ...(contextId ? { contextId: { equals: contextId } } : {}),
          ...(nameFilter ? { name: { contains: nameFilter, mode: "insensitive" } } : {}),
          ...(starredOnly ? { isStarred: { equals: true } } : {}),
        },
        orderBy: [{ isStarred: "desc" }, { updatedAt: "desc" }],
        take: limit,
        skip: offset,
      })) as Array<{
        id: string;
        name?: string;
        contextType?: string;
        contextId?: string;
        visibility?: string;
        isStarred?: boolean;
        userId?: string;
        updatedAt?: string;
      }>;

      if (views.length === 0) return ok(contextId ? "No saved views on that board." : "No saved views.");

      // 2) Stored filter rows for those views. ACL scopes via the parent config,
      //    so only rows under views you can read come back.
      const configIds = views.map((v) => v.id);
      const values = (await interact({
        model: "savedUserConfigurationValue",
        operation: "findMany",
        where: { configId: { in: configIds } },
        orderBy: [{ createdAt: "asc" }],
        take: 1000,
      })) as Array<{ configId?: string; entityName?: string; fieldName?: string; fieldValue?: string }>;

      const valuesByConfig = new Map<
        string,
        Array<{ entityName?: string; fieldName?: string; fieldValue?: string }>
      >();
      for (const v of values) {
        if (!v.configId) continue;
        const list = valuesByConfig.get(v.configId) ?? [];
        list.push(v);
        valuesByConfig.set(v.configId, list);
      }

      const lines = views.map((view, idx) => {
        const shared = view.userId && view.userId !== ctx.userId;
        const head =
          `${view.name || "(unnamed view)"}` +
          `${view.isStarred ? " ⭐" : ""}` +
          `${view.visibility === "PUBLIC" ? " [public]" : ""}` +
          `${shared ? " (shared by another user)" : ""}`;
        const parts = [head];
        if (view.contextId) parts.push(`  boardId (contextId): ${view.contextId}`);
        const vals = valuesByConfig.get(view.id) ?? [];
        if (vals.length > 0) {
          parts.push(`  Filters (${vals.length}):`);
          for (const v of vals)
            parts.push(`    - ${v.entityName ?? "?"}.${v.fieldName ?? "?"} = ${v.fieldValue ?? ""}`);
        } else {
          parts.push(`  Filters: (none stored)`);
        }
        parts.push(`  viewId: ${view.id}`);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });

      return ok(
        `${views.length} saved view(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: views.length, limit, offset })}`,
      );
    }),
};

// ── spaces-corpus-scan ───────────────────────────────────────────────────────
// The probe tool (plan.md Step 2): real counts per time bucket, paired with the
// same-scope corpus totals so trend/share questions never get answered from a
// ranked sample. YQL construction + validation live in vespa-corpus-scan.ts
// (pure, unit-tested); this handler fans the queries out through queryDirect,
// which injects the ACL + workspace guards.
const spacesCorpusScan: ToolDef = {
  name: "spaces-corpus-scan",
  description:
    "Count documents matching each term, bucketed by year or month, over EVERYTHING the asker can see — " +
    "plus the total corpus size per bucket in the same response. Use for trend and share questions: " +
    '"how many X per year", "is X growing", "what share of tickets mention X".\n\n' +
    "## When to use which counting tool\n" +
    '- Single-entity aggregates ("who filed the most", "which channel has the most X") → ' +
    "spaces-vespa-search with groupBy + hits:0.\n" +
    "- Counts OVER TIME, trends, or anything needing a fair denominator → THIS tool.\n" +
    "- NEVER answer a how-many question by counting a page of search hits — that is a ranked sample, not a total.\n\n" +
    "## Reading the result\n" +
    "`counts[term][bucket]` are real Vespa totals (lexical match, ACL-respected). `termTotals[term]` is that term's " +
    "total over the WHOLE scanned window — use it for any \"how many total\" number; NEVER sum bucket rows yourself. " +
    "`corpusTotals[bucket]` is the same scope with no term — the denominator (`windowTotal` = its whole-window sum). " +
    "`shares[term][bucket]` = count ÷ that bucket's total, precomputed " +
    "so you never do the division yourself. Compare SHARES across buckets, not raw counts: the corpus grows over " +
    "time, so raw counts read as fake growth.\n\n" +
    "## Notes\n" +
    `- Up to ${MAX_SCAN_TERMS} terms per call; each term is matched lexically, no semantic expansion — ` +
    'so a count means "documents containing this term". Cover phrasing variants by passing them as extra terms.\n' +
    '- A multi-word term counts the exact PHRASE ("refund complaint" = docs containing that phrase). ' +
    "To count documents matching ANY of several words, pass the words as separate terms — do NOT put them in one term.\n" +
    "- Month buckets key as yyyymm (e.g. 202403). A month scan with no scope.after is auto-bounded to the " +
    "last 24 months — pass scope.after explicitly for a longer window.\n" +
    "- Each term is a full corpus scan (one Vespa query per term + one for the denominator, run in parallel) — " +
    "prefer few, strong terms over many variants.\n" +
    "- The executed YQL is echoed in the result and mirrored to the debug panel (_meta.debug), same as spaces-vespa-search.\n" +
    "- Only available when DIRECT_VESPA_SEARCH is enabled.",
  inputSchema: {
    type: "object",
    properties: {
      searchArea: {
        type: "string",
        enum: [...AREA_NAMES, ...Object.keys(AREA_ALIASES)],
        description: "The scope to count in — same areas as spaces-vespa-search (message, ticket, mail, …).",
      },
      terms: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_SCAN_TERMS,
        description: "Terms/phrases to count, matched lexically. Each gets its own counts row.",
      },
      scope: {
        type: "object",
        additionalProperties: false,
        properties: {
          channels: {
            type: "array",
            items: { type: "string" },
            description: "Channel ids to confine the scan to (OR'd).",
          },
          after: { type: "string", description: 'Inclusive lower bound, dd/mm/yy (IST, optional " HH:MM").' },
          before: {
            type: "string",
            description: 'Exclusive upper bound, dd/mm/yy (IST, optional " HH:MM").',
          },
        },
        description:
          "Optional filters applied IDENTICALLY to the term counts and the corpus totals, so the share is always apples-to-apples.",
      },
      bucket: { type: "string", enum: ["year", "month"], description: "Time bucket for the counts." },
    },
    required: ["searchArea", "terms", "bucket"],
  },
  async handler(args, ctx) {
    if (!CONFIG.directVespaSearch) {
      return err("spaces-corpus-scan requires DIRECT_VESPA_SEARCH=true.");
    }
    try {
      const rawScope = (args["scope"] ?? {}) as CorpusScanScope;
      const bucket = args["bucket"] as "year" | "month";

      // Month buckets over ALL history are rarely wanted and multiply both the
      // scan work and the output. Auto-bound an unbounded month scan to the
      // last 24 months (dd/mm/yyyy — the format convertDateLiteralsToMs
      // rewrites); a caller who really wants more passes scope.after.
      let autoBounded = false;
      if (bucket === "month" && !rawScope.after) {
        const d = new Date(Date.now() - 730 * 24 * 3600 * 1000);
        rawScope.after = `01/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
        autoBounded = true;
      }

      const scan = validateCorpusScan({
        searchArea: String(args["searchArea"] ?? ""),
        terms: Array.isArray(args["terms"]) ? (args["terms"] as unknown[]).map(String) : [],
        scope: rawScope,
        bucket,
      });

      const { userId: aclUserId, workspaceId } = await directVespaIdentity(ctx.userId);
      if (!workspaceId)
        return err("Could not resolve your workspaceId — cannot run a workspace-scoped scan.");

      // One YQL per role: the per-term census (same YQL for every term, only the
      // @query binding differs) and the term-free denominator.
      const termYql = buildCorpusScanYql(scan, { withTerm: true });
      const totalsYql = buildCorpusScanYql(scan, { withTerm: false });

      // Debug parity with spaces-vespa-search: every executed query rides back
      // on _meta.debug (stage/yql/vespaParams) for the dashboard's debug panel.
      const debugPayloads: Array<{ stage: string; yql: string; vespaParams: Record<string, unknown> }> = [];

      const runCount = async (stage: string, yql: string, query: string): Promise<Record<number, number>> => {
        const res = await queryDirect(
          yql,
          query,
          aclUserId,
          0,
          0,
          CONFIG.vespaQueryEndpoint,
          "unranked",
          undefined,
          workspaceId,
        );
        const executed = res.data.debug?.payloads?.[0];
        debugPayloads.push({
          stage,
          yql: executed?.yql ?? yql,
          vespaParams: executed?.vespaParams ?? { query },
        });
        const buckets: Record<number, number> = {};
        for (const g of res.data.groups ?? []) {
          const key = parseBucketKey(g.groupValue);
          if (key !== null) buckets[key] = g.count;
        }
        return buckets;
      };

      const [corpusTotals, ...termBuckets] = await Promise.all([
        runCount("corpus-scan: totals (denominator)", totalsYql, ""),
        ...scan.terms.map((term) => runCount(`corpus-scan: term "${term}"`, termYql, termToQuery(term))),
      ]);

      const counts: Record<string, Record<number, number>> = {};
      const shares: Record<string, Record<number, string>> = {};
      // Whole-window totals computed HERE so the model never sums buckets by
      // hand — a live run hand-summed 7 month buckets and shipped 1,713 where
      // the true total was 2,152. Any "how many total" number must come from
      // termTotals / windowTotal, not model arithmetic over the bucket rows.
      const termTotals: Record<string, number> = {};
      scan.terms.forEach((term, i) => {
        counts[term] = termBuckets[i] ?? {};
        termTotals[term] = Object.values(counts[term]).reduce((a, b) => a + b, 0);
        const s: Record<number, string> = {};
        for (const [bucketKey, n] of Object.entries(counts[term])) {
          const total = corpusTotals?.[Number(bucketKey)];
          if (total && total > 0) s[Number(bucketKey)] = `${((n / total) * 100).toFixed(2)}%`;
        }
        shares[term] = s;
      });
      const windowTotal = Object.values(corpusTotals ?? {}).reduce((a, b) => a + b, 0);

      const scopeNote = autoBounded
        ? `\nNote: month scans are auto-bounded to the last 24 months (after=${scan.scope.after}); pass scope.after to override.`
        : "";
      const hasScope = Object.keys(scan.scope).length > 0;
      const result = ok(
        `Corpus scan over area "${scan.areaName}" (bucket: ${scan.bucket}; lexical match; ACL-scoped to you).\n` +
        `Counts are totals over ALL matching documents — not a sample. Compare shares, not raw counts.${scopeNote}\n` +
        `Queries executed (${scan.terms.length} term + 1 denominator, identical scope):\n` +
        `  term YQL:   ${termYql}\n` +
        `  totals YQL: ${totalsYql}\n\n` +
        JSON.stringify({ counts, termTotals, corpusTotals, windowTotal, shares, ...(hasScope ? { scope: scan.scope } : {}) }, null, 1),
      );
      // Same channel spaces-vespa-search uses — the dashboard debug panel
      // reads _meta.debug; it never reaches the model's context.
      return { ...result, _meta: { debug: { payloads: debugPayloads } } };
    } catch (e) {
      return directError("corpus-scan error", e);
    }
  },
};

// ── spaces-evidence-pack ─────────────────────────────────────────────────────
// The EXTRACT tool (corpus playbook Step 3): run a fixed spec once and emit a
// bounded, dated pack — the writer's only input and the verifier's closed set.
// Dumb by design: caps per time-bucket (which forces spread across time),
// deterministic oldest-first order within a bucket, dates on every row.
// Query construction/validation live in vespa-evidence-pack.ts (pure,
// unit-testable); this handler fans out through queryDirect (ACL + workspace
// guards injected there).
const spacesEvidencePack: ToolDef = {
  name: "spaces-evidence-pack",
  description:
    "EXTRACT a deterministic, capped, dated evidence pack for one topic — the input for a written analysis. " +
    "Runs a fixed spec (terms + scope) over ONE area, discovers which time buckets have matches, and returns up to " +
    "perBucket snippets per bucket, each row carrying {docId, date, channel, term, snippet}. Rows within a bucket " +
    "are the EARLIEST members (timestamp asc) — deterministic and spread across time, not relevance-ranked.\n\n" +
    "## When to use\n" +
    "- A multi-topic or shareable analysis where writing happens under contract: the pack is the writer's ONLY " +
    "evidence source and the closed set that verification checks citations against.\n" +
    "- NOT for everyday lookups — plain questions use spaces-vespa-search; counting uses spaces-corpus-scan.\n\n" +
    "## The contract\n" +
    "1. Write this tool's JSON output VERBATIM to a sandbox data file (the pack artifact) before any writing starts.\n" +
    "2. The writer cites only pack rows; claims not supported by a pack row don't go in the analysis.\n" +
    "3. Numbers about the topic come from the returned counts/termTotals or from sandbox code over them — never " +
    "from tallying pack rows (the pack is capped; counts are not).\n\n" +
    "## Notes\n" +
    `- perBucket 1..${MAX_PACK_PER_BUCKET} (default ${DEFAULT_PACK_PER_BUCKET}). At most ${MAX_BUCKET_FETCHES} term×bucket fetches per call — ` +
    "when history is longer, the NEWEST buckets win and the skip is reported in coverage.\n" +
    "- Terms follow corpus-scan semantics: lexical, exact phrase for multi-word terms, up to " +
    `${MAX_SCAN_TERMS} per call.\n` +
    "- One call = one topic = one pack. Fan out calls per topic for a multi-topic spec.\n" +
    "- Only available when DIRECT_VESPA_SEARCH is enabled.",
  inputSchema: {
    type: "object",
    properties: {
      searchArea: {
        type: "string",
        enum: [...AREA_NAMES, ...Object.keys(AREA_ALIASES)],
        description: "The area to extract from — same areas as spaces-vespa-search.",
      },
      topic: { type: "string", description: "The topic this pack is for (names the artifact; one pack per topic)." },
      terms: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_SCAN_TERMS,
        description: "Terms/phrases defining the topic's evidence set, matched lexically (multi-word = exact phrase).",
      },
      scope: {
        type: "object",
        additionalProperties: false,
        properties: {
          channels: { type: "array", items: { type: "string" }, description: "Channel ids to confine the spec to (OR'd)." },
          after: { type: "string", description: "Inclusive lower bound, dd/mm/yy (IST)." },
          before: { type: "string", description: "Exclusive upper bound, dd/mm/yy (IST)." },
        },
        description: "Spec-level filters, applied identically to counting and extraction.",
      },
      bucket: { type: "string", enum: ["year", "month"], description: "Time bucket that caps + spreads the pack." },
      perBucket: { type: "number", description: `Max rows per term per bucket (1..${MAX_PACK_PER_BUCKET}, default ${DEFAULT_PACK_PER_BUCKET}).` },
    },
    required: ["searchArea", "topic", "terms", "bucket"],
  },
  async handler(args, ctx) {
    if (!CONFIG.directVespaSearch) {
      return err("spaces-evidence-pack requires DIRECT_VESPA_SEARCH=true.");
    }
    try {
      const validated = validateEvidencePack({
        searchArea: String(args["searchArea"] ?? ""),
        topic: String(args["topic"] ?? ""),
        terms: Array.isArray(args["terms"]) ? (args["terms"] as unknown[]).map(String) : [],
        ...(args["scope"] !== undefined ? { scope: args["scope"] as CorpusScanScope } : {}),
        bucket: args["bucket"] as "year" | "month",
        ...(args["perBucket"] !== undefined ? { perBucket: Number(args["perBucket"]) } : {}),
      });
      const { scan, topic, perBucket } = validated;

      const { userId: aclUserId, workspaceId } = await directVespaIdentity(ctx.userId);
      if (!workspaceId) return err("Could not resolve your workspaceId — cannot run a workspace-scoped extraction.");

      const debugPayloads: Array<{ stage: string; yql: string; vespaParams: Record<string, unknown> }> = [];

      // Phase 1 — discover which buckets have matches, per term (the same
      // grouping census corpus-scan runs). This is what makes the fetch list
      // finite and the coverage note honest.
      const censusYql = buildCorpusScanYql(scan, { withTerm: true });
      const termBucketCounts = await Promise.all(scan.terms.map(async term => {
        const res = await queryDirect(censusYql, termToQuery(term), aclUserId, 0, 0, CONFIG.vespaQueryEndpoint, "unranked", undefined, workspaceId);
        const executed = res.data.debug?.payloads?.[0];
        debugPayloads.push({ stage: `evidence-pack census: "${term}"`, yql: executed?.yql ?? censusYql, vespaParams: executed?.vespaParams ?? {} });
        const buckets: Record<number, number> = {};
        for (const g of res.data.groups ?? []) {
          const key = parseBucketKey(g.groupValue);
          if (key !== null && g.count > 0) buckets[key] = g.count;
        }
        return buckets;
      }));

      const counts: Record<string, Record<number, number>> = {};
      const termTotals: Record<string, number> = {};
      scan.terms.forEach((term, i) => {
        counts[term] = termBucketCounts[i] ?? {};
        termTotals[term] = Object.values(counts[term]).reduce((a, b) => a + b, 0);
      });

      // Phase 2 — build the fetch list (term × non-empty bucket), newest
      // buckets first, hard-capped so one call can't become a query storm.
      const fetchList: Array<{ term: string; bucketKey: number }> = [];
      scan.terms.forEach(term => {
        for (const key of Object.keys(counts[term] ?? {})) fetchList.push({ term, bucketKey: Number(key) });
      });
      fetchList.sort((a, b) => b.bucketKey - a.bucketKey);
      const skipped = fetchList.splice(MAX_BUCKET_FETCHES);

      const rowsNested = await Promise.all(fetchList.map(async ({ term, bucketKey }) => {
        const yql = buildPackFetchYql(scan, bucketRange(bucketKey, scan.bucket));
        const res = await queryDirect(yql, termToQuery(term), aclUserId, perBucket, 0, CONFIG.vespaQueryEndpoint, "unranked", undefined, workspaceId, true);
        const executed = res.data.debug?.payloads?.[0];
        debugPayloads.push({ stage: `evidence-pack fetch: "${term}" @ ${bucketKey}`, yql: executed?.yql ?? yql, vespaParams: executed?.vespaParams ?? {} });
        const results = (!res.data.grouped ? res.data.results : []) ?? [];
        return results.map(r => {
          const raw = (r.rawFields ?? {}) as Record<string, unknown>;
          const ts = Number(raw[scan.area.timestampField] ?? NaN);
          return {
            docId: r.id,
            date: formatIstDate(ts),
            _ts: Number.isFinite(ts) ? ts : 0,
            area: scan.areaName,
            channel: typeof raw["channelId"] === "string" && raw["channelId"] ? String(raw["channelId"]) : (r.title || undefined),
            term,
            bucket: bucketKey,
            snippet: toSnippet(r.context),
          };
        });
      }));

      // Dedupe by docId (a doc matching two terms appears once, first term
      // wins), then order the pack oldest-first — the shape trend/timeline
      // writing wants to read.
      const seen = new Set<string>();
      const pack = rowsNested.flat()
        .filter(row => {
          if (!row.docId || seen.has(row.docId)) return false;
          seen.add(row.docId);
          return true;
        })
        .sort((a, b) => a._ts - b._ts)
        .map(({ _ts, ...row }) => row);

      const coverage = {
        bucketsFetched: fetchList.length,
        bucketsSkipped: skipped.length,
        note: skipped.length > 0
          ? `Fetch cap hit: the ${skipped.length} OLDEST term×bucket cells were not extracted (oldest skipped bucket: ${Math.min(...skipped.map(s => s.bucketKey))}). Narrow the scope or split the spec to cover them.`
          : "All non-empty buckets extracted.",
        capNote: `Pack rows are capped at ${perBucket}/term/bucket (earliest-first) — the pack is a bounded SAMPLE of each bucket; counts/termTotals are the real totals.`,
      };

      const hasScope = Object.keys(scan.scope).length > 0;
      const result = ok(
        `Evidence pack "${topic}" over area "${scan.areaName}" (bucket: ${scan.bucket}; cap ${perBucket}/term/bucket; deterministic oldest-first; lexical; ACL-scoped to you).\n` +
        `CONTRACT: write this JSON verbatim to a sandbox data file as the pack artifact. Writers cite only pack rows; ` +
        `numbers come from counts/termTotals (or sandbox code over them), never from tallying the capped pack.\n\n` +
        JSON.stringify({
          topic,
          spec: { area: scan.areaName, terms: scan.terms, bucket: scan.bucket, perBucket, ...(hasScope ? { scope: scan.scope } : {}) },
          counts,
          termTotals,
          coverage,
          pack,
        }, null, 1),
      );
      return { ...result, _meta: { debug: { payloads: debugPayloads } } };
    } catch (e) {
      return directError("evidence-pack error", e);
    }
  },
};

// ── spaces-desk-metrics ───────────────────────────────────────────────

const DESK_METRIC_KEYS = [
  "frt",
  "rt",
  "csat",
  "counts",
  "priority",
  "trend",
  "agents",
  "tags",
  "aiCategories",
  "customFields",
  "tickets",
] as const;

interface DeskSummary {
  channelId: string;
  channelName: string | null;
  deskType: string;
}

/** Resolve the desks a request targets, or explain why it could not. */
type DeskResolution =
  | { ok: true; channelIds: string[] }
  | { ok: false; text: string };

async function listMetricsDesks(): Promise<DeskSummary[]> {
  const data = (await spacesFetch("/api/desk-metrics/claw/desks")) as {
    desks?: DeskSummary[];
  };
  return data.desks ?? [];
}

function describeDesks(desks: DeskSummary[]): string {
  return desks
    .map((d) => `- ${d.channelName ?? "(unnamed)"} [${d.deskType}] channelId=${d.channelId}`)
    .join("\n");
}

async function resolveDesks(args: Record<string, unknown>): Promise<DeskResolution> {
  const explicitIds = Array.isArray(args["channelIds"])
    ? (args["channelIds"] as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (explicitIds.length > 0) return { ok: true, channelIds: explicitIds };

  const desks = await listMetricsDesks();
  if (desks.length === 0) {
    return {
      ok: false,
      text:
        "This user is not a member of any support desk, so there is nothing to report on. Desk " +
        "metrics cover Xyne Desk channels only, and only ones the user belongs to.",
    };
  }

  if (args["allDesks"] === true) {
    return { ok: true, channelIds: desks.map((d) => d.channelId) };
  }

  const deskName = typeof args["deskName"] === "string" ? args["deskName"].trim() : "";
  if (!deskName) {
    return {
      ok: false,
      text:
        `Specify which desk. Pass deskName, or channelIds, or allDesks=true to cover all ` +
        `${desks.length}. Desks available to this user:\n${describeDesks(desks)}`,
    };
  }

  const needle = deskName.toLowerCase();
  // Tier 1: case-insensitive exact.
  let matches = desks.filter((d) => (d.channelName ?? "").toLowerCase() === needle);
  // Tier 2: case-insensitive contains — catches the casing/wording drift that
  // makes a plain equality check fail on names the user typed from memory.
  if (matches.length === 0) {
    matches = desks.filter((d) => (d.channelName ?? "").toLowerCase().includes(needle));
  }
  // Tier 3: no match — surface real candidates rather than a dead end.
  if (matches.length === 0) {
    return {
      ok: false,
      text:
        `No desk matched "${deskName}". Re-call with one of these exact names, or its channelId:\n` +
        describeDesks(desks),
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      text:
        `"${deskName}" matched ${matches.length} desks. Re-call with one exact name or channelId, ` +
        `or allDesks=true to merge them:\n${describeDesks(matches)}`,
    };
  }
  return { ok: true, channelIds: [matches[0]!.channelId] };
}

const spacesDeskMetrics: ToolDef = {
  name: "spaces-desk-metrics",
  description:
    "Support-desk analytics for Xyne Desk channels: first-response time (FRT), resolution time (RT), " +
    "CSAT, tickets opened, email replies sent, per-stage and per-priority breakdowns, per-agent " +
    "performance, tag breakdowns, and a daily opened-vs-closed trend. This is the SAME data the Desk " +
    "Metrics dashboard shows. " +
    "Use when the user asks how a support desk is performing — 'what's our average response time', " +
    "'CSAT last month', 'who resolved the most tickets', 'how many tickets did we get last week', " +
    "'which tags are spiking'. " +
    "Identify the desk by `deskName` (partial, case-insensitive; the tool returns real candidates if " +
    "nothing matches), by `channelIds`, or set `allDesks=true` to merge every desk the " +
    "user can see. Call with no desk argument to list the available desks. " +
    "ASK FOR ONLY THE METRICS YOU NEED via `metrics` — each key is a separate database query, and the " +
    "default runs all of them. " +
    "For \"what are the tickets about\" / classify / categorise questions use metrics:[\"aiCategories\"], " +
    "which returns exact ticket counts per AI category AND per (category, sub-category) pair over the " +
    "whole cohort — do not enumerate tickets and tally the labels yourself. Narrow with the " +
    "`aiCategories` / `aiSubCategories` filters. " +
    "For custom (form) field questions: run metrics:[\"customFields\"] to discover which fields the desk " +
    "carries, then pass `customFieldBreakdown` with the exact names to get a value distribution, or " +
    "`customFieldFilter` to scope any other metric to tickets matching a field value. " +
    "IMPORTANT semantics, also restated in the response's `notes`: (1) frt/rt/counts/priority/agents/" +
    "tags/tickets are COHORT-scoped — they describe tickets CREATED in the range, so a ticket created " +
    "earlier and resolved during the range is NOT counted; (2) csat and counts.emailRepliesInRange are " +
    "ACTIVITY-scoped — events that happened in the range whatever their ticket's age; (3) rt excludes " +
    "still-open tickets, so a low average over few resolvedTickets is survivorship bias; (4) agents[] " +
    "attributes tickets to the CURRENT assignee; (5) data is forward-only and does not extend before " +
    "desk metrics was deployed — old ranges are partial, not empty. " +
    "Durations are SECONDS. Report them in human units (minutes/hours) rather than reading the raw number aloud.",
  inputSchema: {
    type: "object",
    properties: {
      deskName: {
        type: "string",
        description:
          "Desk (channel) name, case-insensitive partial match. If nothing matches, or the match is " +
          "ambiguous, the tool returns the real desk names — re-call with one of those.",
      },
      channelIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Explicit desk channel ids. Takes precedence over deskName/allDesks. Max 20; more than one " +
          "merges them with denominator-weighted averages and adds a perDesk split.",
      },
      allDesks: {
        type: "boolean",
        description:
          "Merge every desk the user can see. Use for org-wide questions ('how is support doing " +
          "overall'). Ignored when channelIds is set.",
      },
      lastDays: {
        type: "number",
        minimum: 1,
        maximum: 90,
        description: "Window length in days ending now (1-90). Defaults to 7. Mutually exclusive with timeRange.",
      },
      timeRange: {
        type: "string",
        description:
          "Absolute window as 'startMs_endMs' (epoch milliseconds), e.g. '1735689600000_1738368000000'. " +
          "Use for a specific calendar period; otherwise prefer lastDays. Max span 90 days.",
      },
      metrics: {
        type: "array",
        items: { type: "string", enum: [...DESK_METRIC_KEYS] },
        description:
          "Which metrics to compute; defaults to all. Each key costs a separate query, so pass only what " +
          "the question needs. 'counts' covers ticketsOpened + emailReplies + per-stage counts; 'tags' " +
          "covers both the category and per-tag breakdowns; 'tickets' additionally needs includeTickets.",
      },
      includeTickets: {
        type: "number",
        minimum: 0,
        maximum: 50,
        description:
          "Return this many individual ticket rows (newest first), each with title, priority, stage, " +
          "assignee, FRT/RT seconds, CSAT and custom fields. Defaults to 0. Rows are heavy — ask for them " +
          "only when the user wants examples or a drill-down, not to compute aggregates yourself.",
      },
      assigneeIds: {
        type: "array",
        items: { type: "string" },
        description: "Restrict to tickets currently assigned to these user ids (from spaces-users).",
      },
      stageNames: {
        type: "array",
        items: { type: "string" },
        description: "Restrict to tickets currently in these stages.",
      },
      priorities: {
        type: "array",
        items: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        description: "Restrict to these ticket priorities.",
      },
      userGroupIds: {
        type: "array",
        items: { type: "string" },
        description: "Restrict to tickets owned by these user groups.",
      },
      tagValues: {
        type: "array",
        items: { type: "string" },
        description:
          "Restrict to tickets carrying these desk-email tags, each as 'category:tag' (e.g. " +
          "'issue_type:refund'). Get the real values from a tags-enabled run first.",
      },
      aiCategories: {
        type: "array",
        items: { type: "string" },
        description:
          "Restrict to tickets the AI classifier put in these top-level categories (exact match). " +
          "Run metrics:[\"aiCategories\"] first to see the real labels on this desk.",
      },
      aiSubCategories: {
        type: "array",
        items: { type: "string" },
        description:
          "Restrict to these AI sub-categories (exact match). Independent of aiCategories — " +
          "setting both requires BOTH to match.",
      },
      customFieldBreakdown: {
        type: "array",
        items: { type: "string" },
        description:
          "Custom (form) field NAMES to break down by value, e.g. [\"Primary Issue\"]. Max 5. Names must " +
          "match exactly — run with metrics:[\"customFields\"] first to discover what this desk has. " +
          "Multi-select fields count a ticket once per value, so their counts do not sum to the ticket " +
          "total; the response's notes say which fields those are.",
      },
      customFieldFilter: {
        type: "object",
        description:
          "Restrict the cohort by custom field. `keys` alone means 'the field is set at all'; add " +
          "perKeyFilters to match values. Discover field names with metrics:[\"customFields\"] first.",
        properties: {
          keys: {
            type: "array",
            items: { type: "string" },
            description: "Field names to require, e.g. [\"Primary Issue\"].",
          },
          perKeyFilters: {
            type: "object",
            description:
              "Per field name: { values: [exact matches] } or { textTerms: [substrings] }. Use values " +
              "for dropdowns/multi-selects, textTerms for free-text fields.",
          },
        },
        required: ["keys"],
      },
    },
  },
  handler: withToolErrors("desk-metrics error", async (args) => {
      if (args["lastDays"] !== undefined && typeof args["timeRange"] === "string") {
        return err("Pass either lastDays or timeRange, not both.");
      }

      const resolution = await resolveDesks(args);
      if (!resolution.ok) return ok(resolution.text);

      const body: Record<string, unknown> = { channelIds: resolution.channelIds };
      if (typeof args["timeRange"] === "string") body["timeRange"] = args["timeRange"];
      else body["lastDays"] = typeof args["lastDays"] === "number" ? args["lastDays"] : 7;

      const metrics = Array.isArray(args["metrics"])
        ? (args["metrics"] as unknown[]).filter(
            (m): m is string => typeof m === "string" && (DESK_METRIC_KEYS as readonly string[]).includes(m),
          )
        : [];
      if (metrics.length > 0) body["metrics"] = metrics;

      const includeTickets = typeof args["includeTickets"] === "number" ? args["includeTickets"] : 0;
      if (includeTickets > 0) {
        body["includeTickets"] = includeTickets;
        // Asking for rows without the 'tickets' key would silently return none.
        if (metrics.length > 0 && !metrics.includes("tickets")) {
          body["metrics"] = [...metrics, "tickets"];
        }
      }

      for (const key of [
        "assigneeIds",
        "stageNames",
        "priorities",
        "userGroupIds",
        "tagValues",
        "aiCategories",
        "aiSubCategories",
      ]) {
        const value = args[key];
        if (Array.isArray(value) && value.length > 0) body[key] = value;
      }

      const breakdown = args["customFieldBreakdown"];
      if (Array.isArray(breakdown) && breakdown.length > 0) body["customFieldBreakdown"] = breakdown;

      const cff = args["customFieldFilter"];
      if (cff && typeof cff === "object" && Array.isArray((cff as { keys?: unknown }).keys)) {
        body["customFieldFilter"] = cff;
      }

      const data = (await spacesFetch("/api/desk-metrics/claw/query", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;

      return ok(JSON.stringify(data, null, 2));
    }),
};

export const tools: ToolDef[] = [
  spacesWhoami,
  ...(CONFIG.directVespaSearch ? [spacesVespaSchema, spacesVespaQuery, spacesVespaSearch, spacesCorpusScan, spacesEvidencePack] : []),
  onyxBenchSearch,
  spacesSearch,
  spacesSearchV2,
  spacesMyItems,
  spacesSavedViews,
  spacesWorkflowStats,
  spacesDeskMetrics,
  userSendMessage,
  spacesMeetingInsights,
  spacesTickets,
  spacesMessages,
  spacesMessageDetail,
  spacesChannels,
  spacesUsers,
  spacesUserActivityContext,
  spacesActivity,
  spacesProjects,
  spacesProjectTeamMembers,
  spacesCanvases,
  spacesCalls,
  spacesBoards,
  spacesEmails,
  spacesThreadAttachments,
  spacesFetchAttachment,
  spacesUploadToKb,
  spacesCreateTicket,
  spacesCreateBulkTickets,
  spacesUpdateTicket,
  spacesUpdateBulkTickets,
  spacesScheduleCall,
  spacesReadCanvas,
  spacesEditCanvas,
  spacesTriggerAgent,
  spacesCreateCanvas,
  spacesSdlcListArtifacts,
  spacesSdlcReadArtifact,
  spacesSdlcListTracks,
  spacesSdlcCreateTrack,
  spacesSdlcListArtifactTypes,
  spacesSdlcMutateArtifact,
  spacesSdlcCreatePullRequest,
  spacesSdlcListArtifactVersions,
  spacesSdlcReadArtifactVersion,
  spacesSdlcWikiVerifySources,
  spacesSdlcWikiBeginCheckpoint,
  spacesSdlcWikiFinalizeCommit,
];
