/**
 * Xyne Spaces MCP tool definitions.
 *
 * Each tool has a name, description, JSON Schema inputSchema, and async handler.
 * Handlers call the Spaces HTTP client and return MCP-formatted results.
 */

import { interact, search, memorySearch, spacesFetch, spacesFetchBuffer, spacesFetchText, appFetch } from "./xyne-spaces-client.js";
import { queryDirect, type DirectSearchResponse } from "./vespa-direct.js";
import { buildYqlFromParams, AREA_NAMES, AREA_ALIASES, describeAreasForPrompt } from "./vespa-search-areas.js";
import { getWorkspaceIdForUser } from "../../lib/spaces-db.js";
import type { Citation } from "xyne-claw-shared";
import { CONFIG } from "../../config.js";

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
   * Optional app-token implementation, hits the `/api/apps/*` routes. A tool is
   * only available in APP MODE if it defines this. As Spaces adds app routes for
   * search / ticket-filter / user-search, give those tools an `appHandler` here
   * — no duplicate `apps-*` tool is created; it's the SAME tool, app backend.
   */
  appHandler?: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>;
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
function paginationFooter(p: { returned: number; limit: number; offset: number; total?: number | undefined }): string {
  const { returned, limit, offset, total } = p;
  const next = offset + returned;
  if (typeof total === "number") {
    if (next < total) {
      return `\n\n[Showing ${offset + 1}-${next} of ${total}. More results available — call again with offset=${next} and the same filters/query for the next page.]`;
    }
    return offset > 0 || total > limit ? `\n\n[Showing ${offset + 1}-${next} of ${total} — end of results.]` : "";
  }
  // No exact total: a full page almost always means there's more behind it.
  if (returned >= limit) {
    return `\n\n[Showing ${returned} result(s) starting at offset ${offset}. There may be more — call again with offset=${next} and the same filters to continue paginating.]`;
  }
  return offset > 0 ? `\n\n[Showing ${returned} result(s) starting at offset ${offset} — end of results.]` : "";
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
async function resolveChannelInfo(channelIds: Iterable<string>): Promise<Map<string, { name?: string; scopeType?: string; type?: string }>> {
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
async function resolveChannelIdForConversation(conversationId: string | undefined | null): Promise<string | undefined> {
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
async function resolveTicketByConversation(conversationId: string | undefined | null): Promise<string | undefined> {
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
    const convIds = [...new Set(emails.map((e) => e.conversationId).filter((v): v is string => !!v))]
      .slice(0, GATEWAY_MAX_TAKE);
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
async function resolveUserInfo(userIds: Iterable<string>): Promise<Map<string, { name?: string; email?: string }>> {
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
  withId = false,
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
): Promise<{ channelId?: string; replyCount?: number; createdBy?: string; lastActivityAt?: string } | undefined> {
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
    const userIds = m[2]!.split(",").map((s) => s.trim()).filter(Boolean);
    if (userIds.length > 0) out.push({ emoji, userIds });
  }
  return out;
}

/**
 * Render reactions_md as "👍 Asha, Ravi · 🔥 Meera" when a resolveUserInfo map is
 * supplied (WHO reacted), or "👍 2 · 🔥 1" (counts only) when it isn't. Reactor
 * ids that don't resolve fall back to the raw id. Returns "" when there are none.
 */
function formatReactions(md: string | undefined | null, userInfo?: Map<string, { name?: string; email?: string }>): string {
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
    "- Meeting content (action items, decisions, transcripts) → use **spaces-meeting-insights**.\n" +
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
      query: { type: "string", description: "Search query text. OPTIONAL — omit it (or leave empty) to search by filters alone (type/from/in/range/etc.); the tool handles filter-only mode for you." },
      apps: { type: "string", description: "Comma-separated apps to search: chat, ticket, user, file (default: all). Prefer `type` over this." },
      type: {
        type: "string",
        enum: ["messages", "attachments", "channels", "tickets", "files", "transcript", "canvas", "rca", "emails", "users", "people"],
        description: "Narrow to one surface. messages | attachments | channels | tickets | files | emails | users. transcript, canvas, rca are file sub-surfaces.",
      },
      from: { type: "string", description: "Filter by SENDER/AUTHOR user ID(s), comma-separated — a user id ONLY. NEVER pass a channel/conversation id here (use `in` for those); resolve names → ids via spaces-users first. A wrong id type here can produce a bad request." },
      in: { type: "string", description: "Channel ID(s) to scope into, comma-separated. ALWAYS set this when the user is asking about a specific channel or has a channel attached as context. This is the ONLY place a channel id goes." },
      status: { type: "string", description: "Filter by ticket status(es), comma-separated. Prefer spaces-tickets for ticket queries." },
      priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "CRITICAL"], description: "Filter by ticket priority. Prefer spaces-tickets." },
      board: { type: "string", description: "Filter by board name. Prefer spaces-tickets." },
      tags: { type: "string", description: "Filter by tags, comma-separated." },
      stage: { type: "string", description: "Filter by ticket stage. Prefer spaces-tickets." },
      assignee: { type: "string", description: "Filter by assigned user ID. Prefer spaces-tickets." },
      before: { type: "string", description: "Created before date — ISO 8601 or '15 Mar 26'. Prefer `range` for natural windows." },
      after: { type: "string", description: "Created after date — ISO 8601 or '15 Mar 26'. Prefer `range` for natural windows." },
      range: { type: "string", description: "Natural time window: today | yesterday | this week | last 7 days | last 30 days." },
      orderBy: { type: "string", enum: ["newest", "oldest", "relevance"], description: "Sort order: newest (latest first), oldest (earliest first), relevance (default). Use newest for 'latest message', 'most recent' queries." },
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
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results per group (default 100, max 100)." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0)." },
    },
    // required: ["query"],
  },
  async handler(args, ctx) {
    try {
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

      console.error("[spaces-search]", args);

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
          ? { content: [{ type: "text", text: "Search failed." }], isError: true, _meta: { debug: debugBlock } }
          : err("Search failed.");
      }

      const citations: Citation[] = [];
      const harvest = (r: SearchResult, chunkIndex: number): void => {
        const sc = r.searchContext ?? {};
        const meta = r.metadata ?? {};
        const channelId = (sc["channelId"] as string | undefined) ?? (meta["channelId"] as string | undefined);
        const conversationId = (sc["conversationId"] as string | undefined) ?? (meta["conversationId"] as string | undefined);
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
        const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
        applyChannelInfo(citations, channelInfo);
        // Grouped: `limit` is per-group, so an exact total isn't meaningful.
        // Signal "more" when any group filled its page.
        const groupLimit = Number(args["limit"] ?? 100);
        const groupOffset = Number(args["offset"] ?? 0);
        const maxReturned = groups.reduce((m, g) => Math.max(m, g.results.length), 0);
        const groupFooter = maxReturned >= groupLimit
          ? `\n\n[Results are grouped; each group shows up to ${groupLimit}. More may exist — call again with offset=${groupOffset + groupLimit} and the same query/filters to page deeper.]`
          : "";
        return withDebug(okCited(parts.join("\n") + groupFooter, citations));
      }

      const results = data.data.results ?? [];
      if (results.length === 0) return withDebug(ok(`No results found for "${args["query"]}".`));
      results.forEach((r, idx) => harvest(r, idx + 1));
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);
      return withDebug(okCited(
        `Found ${data.data.totalCount ?? results.length} result(s):\n\n${results
          .map((r, idx) => formatSearchResult(r, idx + 1))
          .join("\n\n")}${paginationFooter({ returned: results.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0), total: data.data.totalCount })}`,
        citations,
      ));
    } catch (e) {
      return err(`Search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
    "- Meeting content (action items, decisions, transcripts) → use **spaces-meeting-insights**.\n" +
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
    "## Counting — \"how many X\"\n" +
    "- Do NOT count the snippets this tool returns. A single call returns a capped PAGE; in grouped mode the per-group \"(N)\" can be the capped page size, not the true total. Tallying visible rows is the #1 cause of undercounts.\n" +
    "- Pass `type=<surface>` to run UNGROUPED — the result then leads with \"Found N result(s)\", the count for that surface. For ticket counts specifically, prefer **spaces-tickets**.\n" +
    "- A concept can span more than one surface (e.g. \"issues\" = tickets, support-desk items, AND messages raised in-channel) — count each relevant `type` and sum; one grouped call is not a count.\n" +
    "- If a surface is still capped, PAGINATE TO EXHAUSTION (below) and count what you page through. Never report the visible row count from one grouped call as \"how many\".\n\n" +
    "## Pagination\n" +
    "- `limit` (1–50, default 10) is the PAGE SIZE — and it is PER GROUP when results are grouped — NOT a total. A page (or group) that comes back FULL (results == `limit`) means THERE ARE MORE.\n" +
    "- To cover a whole set, LOOP: repeat the call with `offset` += `limit` until a page returns FEWER than `limit`. What you've paged through is then the complete set. (Paging returns a FLAT ranked list — grouping is dropped once offset>0.)\n" +
    "- Bump `limit` to 25–50 to cut round-trips, but one bumped call is still ONE page — keep paging until a page comes back short. Don't treat a single page as the whole set.\n\n" +
    "## Empty results — verify before concluding \"none\"\n" +
    "- An empty result under a filter (especially a date `range`/`before`/`after`, or an `in=<channelId>` scope) is ambiguous: truly nothing, or the scope/filter is wrong. Before answering \"none\", re-run WITHOUT the time filter: still empty → re-check the channel/scope (right channelId? right `type`?); non-empty → the window is genuinely empty, say so with context. Never report a bare \"none\" off one empty filtered call.\n\n" +
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

const toIST = (d: Date | string | number): string =>
  new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

/** Decode the common HTML entities that survive tag-stripping. `&amp;` is decoded
 *  LAST so `&amp;lt;` → `&lt;` → `<` doesn't double-decode into a real tag char. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n: string) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
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
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatSearchResult(r: SearchResult, chunkIndex: number | null): string {
  const subApp = (r.searchContext?.["subApp"] as string | undefined)?.toUpperCase();
  const displayType = r.type === 'transcript' || subApp === 'TRANSCRIPT' ? 'call'
                    : r.type === 'canvas' || subApp === 'CANVAS' ? 'canvas'
                    : r.type;
  const lines = [`[${displayType}] ${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}`];
  if (r.context && typeof r.context === "string") lines.push(`  ${cleanSnippet(r.context)}`);
  const meta = r.metadata;
  const detail: string[] = [];
  if (meta) {
    if (meta["timestamp"]) detail.push(toIST(meta["timestamp"] as string));
    if (meta["channelName"]) detail.push(`#${meta["channelName"]}`);
    if (meta["status"]) detail.push(`status: ${meta["status"]}`);
  }
  // Relevance score gives the model a ranking-confidence signal it never had
  // before. Forwarded by the backend on every TransformedSearchResult.
  if (typeof r.relevanceScore === "number") detail.push(`score: ${r.relevanceScore.toFixed(3)}`);
  if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
  const sc = r.searchContext;
  if (sc) {
    // Sender line now carries the email when the transform surfaced it.
    if (sc["senderName"] || sc["senderEmail"]) {
      const name = (sc["senderName"] as string) || "";
      const email = sc["senderEmail"] ? `<${sc["senderEmail"]}>` : "";
      lines.push(`  From: ${[name, email].filter(Boolean).join(" ")}`);
    }
    // People hits: the userId so the agent can reuse it (from=<id>, assignee, …).
    if (sc["userId"]) lines.push(`  userId: ${sc["userId"]}`);
    // Ticket hits: creator/assignee/closer names the transform always computed
    // but this renderer never printed. Skip the "Unknown Creator" fallback so an
    // unresolved createdBy doesn't render a misleading line.
    if (sc["creatorName"] && sc["creatorName"] !== "Unknown Creator") lines.push(`  Created by: ${sc["creatorName"]}`);
    if (sc["assigneeName"]) lines.push(`  Assigned to: ${sc["assigneeName"]}`);
    if (sc["closedByName"]) lines.push(`  Closed by: ${sc["closedByName"]}`);
    const bp: string[] = [];
    if (sc["boardName"]) bp.push(`Board: ${sc["boardName"]}`);
    if (sc["projectName"]) bp.push(`Project: ${sc["projectName"]}`);
    if (bp.length > 0) lines.push(`  ${bp.join(" · ")}`);
    // File hits: type + size.
    const ff: string[] = [];
    if (sc["mimeType"]) ff.push(String(sc["mimeType"]));
    if (typeof sc["fileSize"] === "number") { const b = formatBytes(sc["fileSize"] as number); if (b) ff.push(b); }
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
    "Prefer this over spaces-search for ticket queries — it returns richer, more accurate data.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "Filter by status" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Filter by priority" },
      assignedTo: { type: "string", description: "Filter by assigned user — accepts either the user's ID (cm…) or their email address. Email is resolved to userId server-side before the ticket query." },
      createdBy: { type: "string", description: "Filter by ticket creator — accepts either the user's ID (cm…) or their email address. Email is resolved to userId server-side before the ticket query." },
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
      tags: { type: "string", description: "Filter by tag name(s), comma-separated (e.g. 'April-Launch,Q2')" },
      channelId: { type: "string", description: "Filter to tickets in this channel only" },
      // ── Multi-select variants (mirror the Spaces tickets UI, which is multi-select
      //    on every dropdown). Each is an array → Prisma `in`; when both a singular
      //    field above and its plural form are passed, the plural (array) wins. ──
      statusIn: { type: "array", items: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"] }, description: "Filter by MULTIPLE statuses (matches any). Multi-select form of `status`." },
      priorityIn: { type: "array", items: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }, description: "Filter by MULTIPLE priorities (matches any). Multi-select form of `priority`." },
      boardIdIn: { type: "array", items: { type: "string" }, description: "Filter by MULTIPLE board ids (matches any). Multi-select form of `boardId`." },
      stageNameIn: { type: "array", items: { type: "string" }, description: "Filter by MULTIPLE stage names (matches any). Multi-select form of `stageName`." },
      assignedToIn: { type: "array", items: { type: "string" }, description: "Filter by assignee across MANY users (matches any) — array of emails or userIds (mix allowed); emails resolved server-side. Multi-select form of `assignedTo` (strict assignee match, no assigned-or-created union). If set, singular `assignedTo` is ignored." },
      userGroupIds: { type: "array", items: { type: "string" }, description: "Filter by owning user group — one or more user-group ids (matches any)." },
      ticketTypes: { type: "array", items: { type: "string" }, description: "Filter by ticket type(s) — the ticketType lookup string, e.g. 'Bug', 'Feature' (matches any)." },
      aiCategory: { type: "array", items: { type: "string" }, description: "Filter by AI-classified category label(s), e.g. 'Mandate', 'Refund' (matches any)." },
      prReviewers: { type: "array", items: { type: "string" }, description: "Filter to tickets where ANY of these users is a PR reviewer (a ticket_assignments participant with responsibility PR_REVIEWER). Array of emails or userIds; emails resolved server-side." },
      qaAssigned: { type: "array", items: { type: "string" }, description: "Filter to tickets where ANY of these users is QA-assigned (a ticket_assignments participant with responsibility QA). Array of emails or userIds; emails resolved server-side." },
      dueAfter: { type: "string", description: "ISO 8601 timestamp — only tickets whose due date (ETA) is at or after this time." },
      dueBefore: { type: "string", description: "ISO 8601 timestamp — only tickets whose due date (ETA) is at or before this time." },
      createdAfter: { type: "string", description: "ISO 8601 timestamp — only tickets created at or after this time (e.g. '2026-04-20T00:00:00Z')" },
      createdBefore: { type: "string", description: "ISO 8601 timestamp — only tickets created strictly before this time" },
      limit: { type: "number", minimum: 1, maximum: 500, default: 100, description: "Max tickets (default 100, max 500). Use higher values with createdByIn for team-wide reports." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      orderBy: { type: "string", enum: ["updatedAt", "createdAt"], default: "updatedAt", description: "Sort field: updatedAt (default, most recently changed) or createdAt (when the ticket was opened)." },
      sortOrder: { type: "string", enum: ["desc", "asc"], default: "desc", description: "Sort direction: desc (default, newest first) or asc (oldest first)." },
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
  async handler(args) {
    try {
      const baseWhere: Record<string, unknown> = {};
      if (args["status"]) baseWhere["statusV2"] = { equals: args["status"] };
      if (args["priority"]) baseWhere["priority"] = { equals: args["priority"] };
      if (args["boardId"]) baseWhere["boardId"] = { equals: args["boardId"] };
      if (args["projectId"]) baseWhere["projectId"] = { equals: args["projectId"] };
      if (args["stageName"]) baseWhere["stageName"] = { equals: args["stageName"] };
      if (args["channelId"]) baseWhere["channelId"] = { equals: args["channelId"] };
      if (args["tags"]) {
        const tagNames = (args["tags"] as string).split(",").map((t) => t.trim()).filter(Boolean);
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
            ? v.split(",").map((s) => s.trim()).filter(Boolean)
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
      const include = {
        assignedToUser: { select: { name: true, email: true } },
        createdByUser: { select: { name: true, email: true } },
        board: { select: { name: true } },
        project: { select: { name: true } },
        tags: { select: { name: true } },
      };

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
          return ok(`No matching users found for any of the ${assignedToInRaw.length} assignedToIn entries. Unresolved: ${unresolved.join(", ")}.`);
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
      const collectParticipant = async (raw: string[], responsibility: "PR_REVIEWER" | "QA"): Promise<void> => {
        if (!raw.length) return;
        const { userIds, unresolved } = await resolveUserIdentifiersBatch(raw);
        participantUnresolved.push(...unresolved);
        if (userIds.length > 0) participantSomes.push({ responsibility, userIds });
      };
      await collectParticipant(asStrArr(args["prReviewers"]), "PR_REVIEWER");
      await collectParticipant(asStrArr(args["qaAssigned"]), "QA");

      // De-duplicated note appended to whichever success path returns, so unresolved
      // participant emails are never silently dropped.
      const participantNote = participantUnresolved.length > 0
        ? `\n\n_Note: ${participantUnresolved.length} participant email(s) did not match any user and were excluded: ${[...new Set(participantUnresolved)].join(", ")}_`
        : "";

      const participantSome = (p: { responsibility: "PR_REVIEWER" | "QA"; userIds: string[] }): Record<string, unknown> =>
        ({ some: { userResponsibility: { equals: p.responsibility }, userId: { in: p.userIds } } });

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
              where: { assignments: participantSome(p) },
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
        if (args["createdBy"] && !createdByUserId) return ok(`No user found for createdBy='${args["createdBy"]}'.`);
      }

      // Single-user merged fetch (assigned OR created by the same person) only
      // applies when bulk isn't in play, createdBy wasn't supplied, and the
      // multi-assignee `assignedToIn` filter isn't driving the assignee match.
      if (assignedToUserId && !bulkActive && !createdByUserId && !assignedToInApplied) {
        const [assigned, created] = await Promise.all([
          interact({ model: "ticket", operation: "findMany", where: { ...baseWhere, assignedTo: { equals: assignedToUserId } }, orderBy: orderByClause, take, skip, include }) as Promise<TicketRow[]>,
          interact({ model: "ticket", operation: "findMany", where: { ...baseWhere, createdBy: { equals: assignedToUserId } }, orderBy: orderByClause, take, skip, include }) as Promise<TicketRow[]>,
        ]);
        const seen = new Set<string>();
        const merged: TicketRow[] = [];
        for (const t of [...(assigned ?? []), ...(created ?? [])]) {
          if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
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
        appendText(mergedResult, paginationFooter({ returned: mergedPage.length, limit: take, offset: skip }));
        if (participantNote) appendText(mergedResult, participantNote);
        return mergedResult;
      }

      // Explicit single createdBy filter (only when bulk isn't active).
      if (createdByUserId) {
        baseWhere["createdBy"] = { equals: createdByUserId };
      }

      const rows = (await interact({ model: "ticket", operation: "findMany", where: baseWhere, orderBy: orderByClause, take, skip, include })) as TicketRow[];

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
    } catch (e) {
      return err(`Tickets error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

/**
 * Resolve a mixed list of emails + userIds to a flat userId list in a single
 * `user findMany` query. Returns the resolved userIds and any emails that
 * didn't match any user. Inputs that don't contain '@' are passed through as
 * userIds without DB lookup.
 */
async function resolveUserIdentifiersBatch(raw: string[]): Promise<{ userIds: string[]; unresolved: string[] }> {
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
    if (t.closedBy) missingIds.add(t.closedBy);   // resolver
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
    parts.push(`  Board Status: ${t.statusV2} (workflow state, not PR verification) · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`);
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
      parts.push(`  Closed: ${t.closedAt ? `${toIST(t.closedAt)} IST` : "(time n/a)"}${t.closedBy ? ` by ${userLabel(t.closedBy)}` : ""}`);
    }
    if (t.isArchived) parts.push(`  Archived: yes`);
    if (opts.classifyActionable) {
      const reason = reasons.get(t.id) ?? null;
      parts.push(`  Action: ${reason ?? "none"}`);
    }
    // Carry xyneId on the citation so the FE can route desk-typed tickets
    // (EMAIL/SLACK channels) to `/support/<channelId>/<xyneId>` — mirrors
    // `navigateToTicket` in dashboard/src/utils/searchNavigation.ts.
    pushThreadCitation(
      citations,
      t.channelId,
      t.conversationId,
      idx + 1,
      `Ticket ${t.xyneId}`,
      { xyneId: t.xyneId },
    );
    return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
  });
  const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
  applyChannelInfo(citations, channelInfo);

  // Render order matters: a large response (200+ tickets) can exceed claw's
  // promoteIfOversized() retrieval cap and spill to a file behind an inline
  // preview. Putting the Summary at the TOP keeps it in that preview (and ahead
  // of any tail that gets spilled), so the most useful info always reaches the
  // model.
  const bodyParts: string[] = [];
  if (opts.summary) {
    const summary = buildSummary(rows, reasons, nameMap, opts.expectedUserGroup ?? [], opts.classifyActionable === true);
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
      const status = Object.entries(u.byStatus).map(([k, v]) => `${k}=${v}`).join(",");
      const prio = Object.entries(u.byPriority).map(([k, v]) => `${k}=${v}`).join(",");
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
  updatedBy?: string;          // last editor
  closedBy?: string;           // resolver
  closedAt?: string;           // resolution time
  firstRespondedAt?: string;   // SLA: first response
  userGroupId?: string;        // owning group (id; name is gateway-blocked)
  ticketType?: string;         // categorization (e.g. Bug/Fix)
  isArchived?: boolean;        // live PG archived state
  aiCategory?: string;         // AI triage label
  aiSubCategory?: string;      // AI triage sub-label
  referenceTicket?: string[];  // related/duplicate ticket ids → resolved to xyneIds
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
    "Read messages in a conversation thread. Use the conversationId field from spaces-tickets results (NOT the channel ID or ticket ID). " +
    "Messages are returned in chronological order, each showing the sender's name <email>, edited/attachment markers, and reaction counts; " +
    "the header shows the channel name and total reply count — no follow-up call needed to resolve who said what.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "The conversationId from spaces-tickets or spaces-activity results." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max messages (default 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      sortOrder: { type: "string", enum: ["asc", "desc"], default: "asc", description: "Order by message time: asc (default, oldest→newest, normal reading order) or desc (newest first — pair with limit to grab the latest replies)." },
      hasAttachment: { type: "boolean", description: "Only messages that carry a file attachment (the thread 'Files' view)." },
      msgType: { type: "array", items: { type: "string", enum: ["USER", "BOT", "SYSTEM", "FORWARDED"] }, description: "Restrict to these message types (matches any). USER = human replies; BOT/SYSTEM = automation & workflow posts (the thread 'Workflows' view); FORWARDED = forwarded messages." },
    },
    required: ["conversationId"],
  },
  async handler(args) {
    try {
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
          .join("\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`,
        citations,
      );
    } catch (e) {
      return err(`Messages error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
    "Get detailed information about a specific message including full content, sender details, " +
    "reactions (with counts), and attachments. Use messageId from spaces-messages or spaces-activity results.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "The messageId from spaces-messages or spaces-activity results." },
    },
    required: ["messageId"],
  },
  async handler(args) {
    try {
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
        `From: ${formatUserRef(m.senderId, userInfo, true)}`,
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
    } catch (e) {
      return err(`Message detail error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
    "and participant name. Use the name filter to find a specific channel by name. " +
    "To find a DM between two people, use scopeType='DM' and participantName to filter by one of them. " +
    "Returns per channel: name, member COUNT, creator, created / updated / last-active times, archived status, " +
    "and (when the channel has recent activity) its latest-thread conversation ID to pass to spaces-messages — no follow-up call needed. " +
    "Member NAMES are omitted by default (a busy channel can have hundreds); set includeMembers=true to list them, " +
    "paging with membersLimit / membersOffset so the output stays bounded.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Filter by channel name (case-insensitive partial match). Use this to find a specific channel." },
      description: { type: "string", description: "Filter by channel description / topic (case-insensitive partial match)." },
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility" },
      scopeType: { type: "string", enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"], description: "Filter by scope type" },
      channelType: {
        type: "string",
        enum: ["DEFAULT", "EMAIL", "SUPPORT", "SLACK", "APP"],
        description: "Filter by channel TYPE (distinct from scopeType). DEFAULT = regular chat channels (what the chat directory shows); EMAIL/SUPPORT/SLACK/APP = desk / integration channels. Set DEFAULT to exclude desk/integration channels.",
      },
      participantName: { type: "string", description: "Filter channels by participant name (partial match)" },
      includeMembers: { type: "boolean", default: false, description: "List participant NAMES (not just the count). Off by default to keep results compact — a busy channel can have hundreds of members. Prefer narrowing to one channel (via name) before turning this on. Names are paged with membersLimit / membersOffset." },
      membersLimit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "When includeMembers=true, max member names to show per channel (default 20). The count is always exact regardless of this." },
      membersOffset: { type: "number", minimum: 0, default: 0, description: "When includeMembers=true, skip this many member names per channel before listing (pagination). Raise it to page through a large member list." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max channels (default 100)" },
      orderBy: { type: "string", enum: ["lastActivityAt", "createdAt", "name"], default: "lastActivityAt", description: "Sort field: lastActivityAt (default, most recently active first), createdAt (newest channels), or name (alphabetical)." },
      sortOrder: { type: "string", enum: ["desc", "asc"], default: "desc", description: "Sort direction: desc (default) or asc. For name, asc = A→Z." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0). Call again with a higher offset for more channels." },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["name"]) where["name"] = { contains: args["name"] as string, mode: "insensitive" };
      if (args["description"]) where["description"] = { contains: args["description"] as string, mode: "insensitive" };
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["scopeType"]) where["scopeType"] = { equals: args["scopeType"] };
      if (args["channelType"]) where["type"] = { equals: args["channelType"] };
      if (args["participantName"]) where["participants"] = { some: { user: { name: { contains: args["participantName"] as string } } } };

      // Caller-controlled sort, clamped to known columns; defaults preserve the
      // prior most-recently-active-first behaviour.
      const sortField = ["createdAt", "name"].includes(String(args["orderBy"])) ? String(args["orderBy"]) : "lastActivityAt";
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
        ? rows.flatMap((c) => (participantsByChannel.get(c.id) ?? []).slice(membersOffset, membersOffset + membersLimit))
        : [];
      const creatorInfo = await resolveUserInfo([
        ...rows.map((c) => c.createdBy).filter((v): v is string => !!v),
        ...memberNameIds,
      ]);
      const latestConv = await resolveChannelLatestConversation(rows.map((c) => c.id));

      const citations: Citation[] = [];
      const lines = rows.map((c, idx) => {
        const convId = c.conversationId ?? latestConv.get(c.id);
        const parts = [`#${c.name} (${c.scopeType}, ${c.visibility})${c.isArchived ? " [archived]" : ""}`];
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
            const pager = membersOffset > 0 || shownTo < memberIds.length
              ? ` [members ${membersOffset + 1}-${shownTo} of ${countLabel}; raise membersOffset for more]`
              : "";
            parts.push(`  Members (${countLabel}): ${names.join(", ")}${pager}`);
          } else {
            parts.push(`  Members: ${countLabel} [membersOffset ${membersOffset} is past the last member]`);
          }
        } else {
          parts.push(`  Members: ${countLabel}`);
        }
        if (c.createdBy) parts.push(`  Created by: ${formatUserRef(c.createdBy, creatorInfo, true)}`);
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
      const channelInfo = await resolveChannelInfo(citations.map((cc) => cc.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);

      return okCited(`${rows.length} channel(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`, citations);
    } catch (e) {
      return err(`Channels error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  // APP MODE: list channels via the app-token route `/api/apps/channel/list`
  // (returns {items:[{id,name,description,scopeType,...}], hasMore, nextCursor}).
  // The app route supports scopeType + limit + cursor only, so name filtering
  // is applied client-side over the returned page.
  async appHandler(args) {
    try {
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
      const moreNote = items.length >= appLimit
        ? `\n\n[Showing ${items.length} channel(s) — more may exist. Raise limit or refine with name/scopeType filters.]`
        : "";
      return ok(`${items.length} channel(s):\n\n${lines.join("\n\n")}${moreNote}`);
    } catch (e) {
      return err(`Channels error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
      nameOrEmail: { type: "string", description: "Person's name to search by name, or email address (with @ or .) to search by email. Optional when groupId is given (to list a whole group)." },
      groupId: { type: "string", description: "List members of this user group (team). Can be used alone to enumerate a group, or combined with nameOrEmail/status to narrow within it." },
      status: { type: "string", enum: ["ACTIVE", "INACTIVE"], description: "Filter by account status. Omit to include departed/deactivated users (the default, so you can answer 'did this person leave?'); set ACTIVE to list only current members." },
      orderBy: { type: "string", enum: ["name", "createdAt", "lastActiveAt"], description: "Sort field: name (A→Z with sortOrder=asc), createdAt (join date), or lastActiveAt (recency). Omit to keep default relevance order." },
      sortOrder: { type: "string", enum: ["asc", "desc"], default: "asc", description: "Sort direction for orderBy (default asc; use desc for newest/most-recent first)." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results (default 100, max 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0). Call again with the same query and a higher offset for more matches." },
    },
  },
  async handler(args) {
    try {
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
        return ok(nameOrEmail ? `No users found matching "${nameOrEmail}".` : "No users found in that group.");
      }

      const lines = rows.map((u, idx) => prefixChunk(idx + 1, userTitle(u), userDetailLines(u)));
      return ok(`${rows.length} user(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`);
    } catch (e) {
      return err(`Users error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
    "eta_warning", "eta_breach", "stage_eta_breach", "ticket_assigned", "ticket_status",
    "ticket_eta", "ticket_board", "ticket_assigned_to", "ticket_pr_created", "ticket_pr_updated",
    "ticket_pr_merged", "ticket_pr_declined", "ticket_pr_reviewer_assigned", "ticket_qa_assigned",
    "ticket_priority", "ticket_user_group", "ticket_title", "ticket_description", "ticket_rca_created",
    "ticket_rca_updated", "ticket_subticket_added", "ticket_reference_added", "ticket_reference_removed",
    "ticket_multi_updated", "workflow_question", "stage_approval_requested", "stage_approval_approved",
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
        description: "Filter to one of the activity-feed tabs (mirrors the dashboard): your_mentions | replies | reactions | group_mentions | tickets | canvas. Each maps to the set of activity action types that tab shows.",
      },
      actorActions: {
        type: "array",
        items: { type: "string" },
        description: "Advanced: filter to these raw activity action types (matches any), e.g. ['ticket_assigned','ticket_status']. Use `tab` for the common groupings instead. If both are given, actorActions wins.",
      },
      classification: { type: "string", description: "Filter by classification (e.g. 'ACTIONABLE', 'FYI', 'PENDING')" },
      unreadOnly: { type: "boolean", description: "Show only unread activity" },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max entries (default 100)" },
      sortOrder: { type: "string", enum: ["desc", "asc"], default: "desc", description: "Order by activity time: desc (default, newest first) or asc (oldest first)." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0). Call again with the same filters and a higher offset to page through older activity." },
    },
  },
  async handler(args, ctx) {
    try {
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
      const actions = rawActions.length > 0 ? rawActions : (ACTIVITY_TAB_ACTIONS[String(args["tab"] ?? "")] ?? []);
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

      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);
      return okCited(`${rows.length} activity entries:\n\n${lines.join("\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`, citations);
    } catch (e) {
      return err(`Activity error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
      search: { type: "string", description: "Filter by project name OR code/shortcode (case-insensitive partial match)." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results (default 100, max 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
      const search = args["search"] ? String(args["search"]) : "";
      const limit = (args["limit"] as number | undefined) ?? 100;
      const offset = (args["offset"] as number | undefined) ?? 0;

      let rows: ProjectRow[];
      if (search) {
        // Match name OR code. The gateway rejects an OR array-of-objects, so run
        // the two `contains` queries separately and union client-side, then
        // paginate the merged set (projects are few, so fetching broadly is fine).
        const [byName, byCode] = await Promise.all([
          interact({ model: "project", operation: "findMany", where: { name: { contains: search, mode: "insensitive" } }, orderBy: [{ createdAt: "desc" }], take: 1000 }) as Promise<ProjectRow[]>,
          interact({ model: "project", operation: "findMany", where: { code: { contains: search, mode: "insensitive" } }, orderBy: [{ createdAt: "desc" }], take: 1000 }) as Promise<ProjectRow[]>,
        ]);
        const seen = new Set<string>();
        const merged = [...(byName ?? []), ...(byCode ?? [])].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
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

      if (!rows || rows.length === 0) return ok(search ? `No projects found matching "${search}".` : "No projects found.");

      const lines = rows.map((p, idx) => {
        const parts = [`${p.name}${p.code ? ` [${p.code}]` : ""}`];
        if (p.description) parts.push(`  ${p.description}`);
        parts.push(`  ID: ${p.id}`);
        if (p.updatedAt) parts.push(`  Updated: ${toIST(p.updatedAt)}`);
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });

      return ok(`${rows.length} project(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`);
    } catch (e) {
      return err(`Projects error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
  async handler(args) {
    try {
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
      if (uniqueUserIds.length === 0) return ok(`No team members found in any channel for project ${projectId}.`);

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
    } catch (e) {
      return err(`Project team members error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-canvases ─────────────────────────────────────────────────

// Canvas metadata.source values the dashboard hides by default (auto-generated
// RCA / PRD / summary / migration docs). Kept in lockstep with the frontend's
// EXCLUDED_CALL_GENERATED_SOURCES (dashboard/src/components/Canvas/canvasFilters.ts).
const EXCLUDED_CALL_GENERATED_SOURCES = new Set([
  "call_prd", "call_detailed_summary", "genius_dm_response", "genius_canvas_long_response",
  "jira_migration_report", "release_notes", "workflow_knowledge", "commit_analysis",
  "genius_investigation", "xyne_auto_rca",
]);

/** True when a canvas row's metadata.source marks it auto/call-generated. */
function isCallGeneratedCanvas(metadata: unknown): boolean {
  let meta = metadata;
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { return false; } }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const source = (meta as Record<string, unknown>)["source"];
  return typeof source === "string" && EXCLUDED_CALL_GENERATED_SOURCES.has(source);
}

const spacesCanvases: ToolDef = {
  name: "spaces-canvases",
  description:
    "Search and list Canvas documents in Spaces (collaborative docs, Quarto bundles, slides). " +
    "Filter by title, channel, project, folder, visibility, doc type, creator, or starred-only; " +
    "set excludeCallGenerated=true to hide auto-generated RCA/PRD/summary docs (as the dashboard does by default). " +
    "Returns canvas IDs, titles, channel, creator, and last-edited time.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by canvas title (case-insensitive partial match)" },
      channelId: { type: "string", description: "Filter by channel ID" },
      projectId: { type: "string", description: "Filter to canvases in this project" },
      folderId: { type: "string", description: "Filter to canvases in this folder. Pass the literal 'none' to list ungrouped/personal canvases (folderId is null)." },
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility (canvases are PUBLIC or PRIVATE)." },
      docType: { type: "string", enum: ["Canvas", "Quarto"], description: "Filter by document type" },
      createdBy: { type: "string", description: "Filter by creator user ID" },
      starredOnly: { type: "boolean", description: "Only canvases you have starred." },
      excludeCallGenerated: { type: "boolean", description: "Hide auto-generated call/RCA/PRD/summary/migration canvases (matches the dashboard's default view). Default false (returns everything)." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results (default 100, max 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args, ctx) {
    try {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["title"] = { contains: args["search"] as string, mode: "insensitive" };
      if (args["channelId"]) where["channelId"] = { equals: args["channelId"] };
      if (args["projectId"]) where["projectId"] = { equals: args["projectId"] };
      if (args["folderId"]) where["folderId"] = String(args["folderId"]) === "none" ? null : { equals: args["folderId"] };
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["docType"]) where["docType"] = { equals: args["docType"] };
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
        rows = (fetched ?? []).filter((c) => !isCallGeneratedCanvas(c.metadata)).slice(offset, offset + limit);
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

      if (!rows || rows.length === 0) return ok(args["search"] ? `No canvases found matching "${args["search"]}".` : "No canvases found.");

      const citations: Citation[] = [];
      const lines = rows.map((c, idx) => {
        const parts = [c.title];
        parts.push(`  Type: ${c.docType ?? "Canvas"} · Visibility: ${c.visibility}`);
        if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`);
        if (c.createdBy) parts.push(`  Created by: ${c.createdBy}`);
        if (c.lastEditedAt) parts.push(`  Last edited: ${toIST(c.lastEditedAt)}`);
        else if (c.updatedAt) parts.push(`  Updated: ${toIST(c.updatedAt)}`);
        parts.push(`  ID: ${c.id}`);
        if (c.viewAccessId) {
          pushCanvasCitation(citations, c.viewAccessId, idx + 1, c.title);
        }
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });

      return okCited(`${rows.length} canvas(es):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`, citations);
    } catch (e) {
      return err(`Canvases error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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

const spacesCalls: ToolDef = {
  name: "spaces-calls",
  description:
    "Search and list calls, meetings, and RECORDINGS in Spaces. Filter by title, channel, status " +
    "(ACTIVE/ENDED/SCHEDULED), call type (VIDEO/AUDIO/HEADLESS), organizer, creator, or recurring; page with limit/offset. " +
    "HEADLESS = xyne-automation recordings (the '/recordings' page) — pass callType='HEADLESS' to list only recordings. " +
    "Returns call ids, titles, organizer + creator names, channel, status, timing, and the participant list with each " +
    "person's attendance (accepted / declined / left / missed, external guests included). The AI summary is returned " +
    "inline; the readable TRANSCRIPT text is indexed in Vespa (file schema, subApp=TRANSCRIPT) — search or read it with " +
    "spaces-meeting-insights (semantic) or spaces-search type=transcript. (A regular meeting call's summary may also be " +
    "posted in its Spaces thread — open via spaces-messages.)",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by call title (case-insensitive partial match)" },
      channelId: { type: "string", description: "Filter by channel ID" },
      status: { type: "string", enum: ["ACTIVE", "IN_PROGRESS", "ENDED", "SCHEDULED", "CANCELLED"], description: "Filter by a single call status." },
      statusIn: { type: "array", items: { type: "string", enum: ["ACTIVE", "IN_PROGRESS", "ENDED", "SCHEDULED", "CANCELLED"] }, description: "Filter by MULTIPLE statuses (matches any). e.g. ['ACTIVE','IN_PROGRESS','ENDED'] for the Recents view. Overrides `status` when both are set." },
      callType: { type: "string", enum: ["VIDEO", "AUDIO", "HEADLESS"], description: "Filter by call type. HEADLESS = xyne-automation recordings (the '/recordings' page) — pass callType='HEADLESS' to list recordings, combinable with any other filter." },
      callOrigin: { type: "string", enum: ["CHANNEL", "CONVERSATION", "GOOGLE_CALENDAR", "MICROSOFT_CALENDAR"], description: "Filter by where the call originated: channel/conversation calls vs Google/Microsoft calendar meetings." },
      organizerId: { type: "string", description: "Filter by organizer user ID" },
      createdByUserId: { type: "string", description: "Filter by creator user ID (outgoing calls when set to yourself)." },
      notCreatedByUserId: { type: "string", description: "Filter to calls NOT created by this user ID (incoming calls when set to yourself). Ignored if createdByUserId is also set." },
      participantId: { type: "string", description: "Filter to calls this user attended / was invited to (a participant). Accepts a userId." },
      after: { type: "string", description: "ISO 8601 — only calls that started at or after this time (by actual start time)." },
      before: { type: "string", description: "ISO 8601 — only calls that started at or before this time." },
      isRecurring: { type: "boolean", description: "Filter recurring calls only" },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results (default 100, max 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
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
      if (args["participantId"]) where["participants"] = { some: { userId: { equals: args["participantId"] } } };
      // Date range on actual start time (startedAt is always present; startsAt is
      // only the scheduled time and is null for many calls/recordings).
      const startedAt: Record<string, string> = {};
      if (args["after"]) startedAt["gte"] = args["after"] as string;
      if (args["before"]) startedAt["lte"] = args["before"] as string;
      if (Object.keys(startedAt).length > 0) where["startedAt"] = startedAt;
      if (typeof args["isRecurring"] === "boolean") where["isRecurring"] = { equals: args["isRecurring"] };

      const rows = (await interact({
        model: "call",
        operation: "findMany",
        where,
        orderBy: [{ lastActivityAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 100,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as CallRow[];

      if (!rows || rows.length === 0) return ok(args["search"] ? `No calls found matching "${args["search"]}".` : "No calls found.");

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
      for (const list of participantsByCall.values()) for (const p of list) if (p.userId) userIds.add(p.userId);
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
                : (p.displayName || "unknown");
            const state = p.response || p.meetingStatus;
            return state ? `${name} [${state}]` : name;
          });
          const more = plist.length > 20 ? ` +${plist.length - 20} more` : "";
          parts.push(`  Participants (${plist.length}): ${shown.join(", ")}${more}`);
        }
        // AI summary is stored as TEXT on the call row, so surface it inline.
        // The transcript field is a GCS path (not text) — the readable transcript
        // is indexed as searchable chunks in Vespa (file schema, subApp=TRANSCRIPT),
        // so point the agent at the tools that read it rather than dumping a URL.
        if (c.aiSummary) parts.push(`  Summary: ${cleanSnippet(c.aiSummary)}`);
        if (c.transcript) parts.push(`  Transcript: available — search/read it with spaces-meeting-insights, or spaces-search type=transcript`);
        parts.push(`  ID: ${c.id}`);
        const conversationId = (c.metadata as { conversationId?: string } | null | undefined)?.conversationId;
        pushThreadCitation(citations, c.channelId, conversationId, idx + 1, c.title ?? "Call");
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);

      return okCited(`${rows.length} call(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`, citations);
    } catch (e) {
      return err(`Calls error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface CallRow {
  id: string;
  title?: string;
  description?: string;
  callType?: string;
  status: string;
  channelId?: string;
  organizerId?: string;
  createdByUserId?: string;
  /** AI meeting/recording summary — stored as TEXT on the call row. */
  aiSummary?: string;
  /** GCS path to the transcript (NOT the text); non-empty = a transcript exists.
   *  The readable transcript is indexed as searchable chunks in the Vespa `file`
   *  schema (subApp=TRANSCRIPT) — read it via spaces-meeting-insights / type=transcript. */
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
      projectId: { type: "string", description: "Filter by project ID (use spaces-projects to find project IDs)" },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results (default 100, max 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
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

      if (!rows || rows.length === 0) return ok(args["search"] ? `No boards found matching "${args["search"]}".` : "No boards found.");

      const lines = rows.map((b) => {
        const parts = [b.name];
        if (b.description) parts.push(`  ${b.description}`);
        if (b.project) parts.push(`  Project: ${b.project.name}`);
        parts.push(`  ID: ${b.id}`);
        if (b.updatedAt) parts.push(`  Updated: ${toIST(b.updatedAt)}`);
        return parts.join("\n");
      });

      return ok(`${rows.length} board(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0) })}`);
    } catch (e) {
      return err(`Boards error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
      channelId: { type: "string", description: "Channel ID where the ticket will live (use spaces-channels to find)." },
      attachConversationId: {
        type: "string",
        description: "Optional. ConversationId of the user's triggering message. When set, any file attachments on that message are copied to the new ticket in the same operation. Does NOT affect routing — channelId still determines where the ticket lives.",
      },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Ticket priority" },
      assignedTo: { type: "string", description: "User ID to assign (use spaces-users to find)" },
      eta: { type: "string", description: "Due date as ISO 8601 string" },
      tags: { type: "array", items: { type: "string" }, description: "Tags to apply" },
    },
    required: ["title", "description", "projectId", "boardId", "channelId"],
  },
  async handler(args, ctx) {
    try {
      if (!args["channelId"]) {
        return err("channelId is required.");
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
      })) as { id: string; xyneId: string; conversationId: string; title: string; priority: string; status: string };

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
          attachLine = count > 0
            ? `  Attachments: ${count} file(s) carried over`
            : `  Attachments: 0 files found on source conversation`;
        } catch (e) {
          attachLine = `  Attachments: transfer failed — ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      const channelId = String(args["channelId"] ?? "");
      const citations: Citation[] = [];
      // Pass xyneId so the FE routes desk-typed (EMAIL/SLACK) ticket-create
      // citations to the Support view rather than the chat thread panel.
      pushThreadCitation(
        citations,
        channelId,
        data.conversationId,
        1,
        `Ticket ${data.xyneId}`,
        { xyneId: data.xyneId },
      );
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
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
    } catch (e) {
      return err(`Create ticket error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-update-ticket ────────────────────────────────────────────

const spacesUpdateTicket: ToolDef = {
  name: "spaces-update-ticket",
  description:
    "Update an existing ticket in Spaces. At least one update field must be provided. " +
    "Use spaces-tickets to find the ticket ID (use the Internal ID, not the Xyne ID), spaces-users for user IDs, and spaces-boards for valid stage names. " +
    "Stage changes also update the ticket status to the stage's default status unless you explicitly provide a status override.",
  inputSchema: {
    type: "object",
    properties: {
      ticketId: { type: "string", description: "Internal database ID of the ticket to update (use spaces-tickets to find — use 'Internal ID', not 'Xyne ID')" },
      assigneeId: { type: "string", description: "User ID to assign the ticket to (use spaces-users to find)" },
      stage: { type: "string", description: "Stage name to move the ticket to (must be a valid stage on the ticket's board)" },
      groupId: { type: "string", description: "User group ID to assign to the ticket" },
      title: { type: "string", description: "New title for the ticket" },
      description: { type: "string", description: "New description for the ticket" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "New priority" },
      status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "New status. Note: changing the stage may also change the status to the stage's default — provide this field to override." },
      eta: { type: "string", description: "New due date as ISO 8601 string (e.g. '2026-06-01T00:00:00Z')" },
    },
    required: ["ticketId"],
  },
  async handler(args) {
    try {
      const ticketId = String(args["ticketId"] ?? "").trim();
      const assigneeId = (args["assigneeId"] as string | undefined)?.trim();
      const stage = (args["stage"] as string | undefined)?.trim();
      const groupId = (args["groupId"] as string | undefined)?.trim();
      const title = (args["title"] as string | undefined)?.trim();
      const description = (args["description"] as string | undefined)?.trim();
      const priority = (args["priority"] as string | undefined)?.trim();
      const status = (args["status"] as string | undefined)?.trim();
      const eta = (args["eta"] as string | undefined)?.trim();

      if (!ticketId) return err("ticketId is required.");
      if (!assigneeId && !stage && !groupId && !title && !description && !priority && !status && !eta) {
        return err("At least one update field is required (assigneeId, stage, groupId, title, description, priority, status, or eta).");
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

      const result = (await spacesFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })) as { success: boolean; updated?: string[] };

      const updates = result.updated ?? [];
      return ok(`Ticket ${ticketId} updated${updates.length > 0 ? `: ${updates.join(", ")}` : ""}.`);
    } catch (e) {
      return err(`Update ticket error: ${e instanceof Error ? e.message : String(e)}`);
    }
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
      startsAt: { type: "string", description: "Start time as ISO 8601 string (e.g. '2026-03-28T10:00:00Z')" },
      endsAt: { type: "string", description: "End time as ISO 8601 string" },
      channelId: { type: "string", description: "Channel ID to schedule the call in" },
      targetUserIds: { type: "array", items: { type: "string" }, description: "User IDs to invite (use spaces-users to find)" },
    },
    required: ["title", "startsAt", "endsAt"],
  },
  async handler(args) {
    try {
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
      return ok([
        `Call scheduled:`,
        `  callId: ${data.callId}`,
        `  externalId: ${data.externalId}`,
        `  channelId: ${data.channelId}`,
      ].join("\n"));
    } catch (e) {
      return err(`Schedule call error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};


// ── spaces-whoami ─────────────────────────────────────────────────────

const spacesWhoami: ToolDef = {
  name: "spaces-whoami",
  description:
    "Returns the current user's Spaces profile — userId, name, email and workspaceId of the User " +
    "Call this first to get the userId needed for filtering other tools (e.g. assignedTo, from, createdBy).",
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    try {
      if (!ctx.userId) return err("Could not determine current user.");
      const rows = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { equals: ctx.userId } },
        take: 1,
      })) as Array<{ id: string; name: string; email: string; workspaceId: string }>;
      const u = rows?.[0];
      if (!u) return ok(`Current user ID: ${ctx.userId} (profile not found)`);
      return ok(`Current user:\n- ID: ${u.id}\n- Name: ${u.name}\n- Email: ${u.email}\n- Workspace ID: ${u.workspaceId}`);
    } catch (e) {
      return err(`Whoami error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-publish-docs ─────────────────────────────────────────────

const spacesPublishDocs: ToolDef = {
  name: "spaces-publish-docs",
  description:
    "Publish a Quarto book or documentation to Xyne Spaces. " +
    "Accepts a base64-encoded zip of the rendered HTML output and uploads it. " +
    "Returns the published docs URL on success.",
  inputSchema: {
    type: "object",
    properties: {
      zipBase64: { type: "string", description: "Base64-encoded zip file containing the rendered HTML output" },
      userRepo: { type: "string", description: "Unique identifier in org/repo/branch format (e.g. 'pgm-agent/my-program/main')" },
      title: { type: "string", description: "Display title for the published docs" },
      entryFile: { type: "string", description: "Entry HTML file name (default: index.html)" },
      channelId: { type: "string", description: "Channel ID to publish to, or omit for personal/private docs" },
      docType: { type: "string", enum: ["book", "docs", "website", "slides"], description: "Document type (default: book)" },
    },
    required: ["zipBase64", "userRepo", "title"],
  },
  async handler(params) {
    try {
      const zipBase64 = params["zipBase64"] as string;
      const userRepo = params["userRepo"] as string;
      const title = params["title"] as string;
      const entryFile = (params["entryFile"] as string) || "index.html";
      const channelId = params["channelId"] as string | undefined;
      const docType = (params["docType"] as string) || "book";

      if (!zipBase64 || !userRepo || !title) {
        return err("zipBase64, userRepo, and title are required");
      }

      const zipBuffer = Buffer.from(zipBase64, "base64");
      console.error(`[spaces-publish-docs] Publishing ${title} (${(zipBuffer.length / 1024).toFixed(0)} KB) as ${userRepo}`);

      const formData = new FormData();
      formData.append("docs", new Blob([zipBuffer], { type: "application/zip" }), "docs.zip");
      formData.append("userRepo", userRepo);
      formData.append("title", title);
      formData.append("entryFile", entryFile);
      formData.append("docType", docType);
      if (channelId) formData.append("channelId", channelId);

      const baseUrl = (process.env["XYNE_SPACES_URL"] ?? "").replace(/\/+$/, "");
      const token = process.env["XYNE_SPACES_TOKEN"] ?? "";
      const sessionId = process.env["XYNE_SPACES_SESSION_ID"] ?? "";
      const workspaceId = process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "";
      const cookieParts: string[] = [];
      if (sessionId) cookieParts.push(`xyne_session=${sessionId}`);
      if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
      const cookieHeader = cookieParts.join("; ");
      const url = `${baseUrl}/api/docs/claw/publish`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(sessionId ? { "x-session-id": sessionId } : {}),
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });

      const result = (await response.json()) as Record<string, unknown>;

      if (response.ok && result["success"]) {
        const docsUrl = typeof result["docsUrl"] === "string" ? (result["docsUrl"] as string) : "";
        const citations: Citation[] = docsUrl
          ? [{ kind: "external", url: docsUrl, chunkIndex: 1, label: title }]
          : [];
        return okCited(
          prefixChunk(1, "Published successfully!", [
            `URL: ${docsUrl}`,
            `Title: ${title}`,
            `UserRepo: ${userRepo}`,
          ]),
          citations,
        );
      } else {
        return err(`Publish failed (${response.status}): ${result["error"] || "Unknown error"}`);
      }
    } catch (e) {
      return err(`Publish error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-read-canvas ──────────────────────────────────────────────

const spacesReadCanvas: ToolDef = {
  name: "spaces-read-canvas",
  description:
    "Read the full markdown content of an existing canvas. " +
    "Pass the viewAccessId (the ID from the canvas URL: /chat/canvas/<viewAccessId>). " +
    "Returns the canvas title and markdown body.",
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
  async handler(params, ctx) {
    try {
      const viewAccessId = String(params["viewAccessId"] ?? "").trim();
      if (!viewAccessId) return err("viewAccessId is required");

      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const result = (await spacesFetch(
        `/api/internal/canvas/view/${encodeURIComponent(viewAccessId)}`,
        {
          method: "GET",
          headers: { "x-user-id": ctx.userId },
        },
        { s2sKey }
      )) as { title?: string; markdown?: string; url?: string; error?: string };

      if (result.error) return err(result.error);
      const title = result.title ?? "Untitled";
      const markdown = result.markdown ?? "";
      const url = result.url ?? "";

      const citations: Citation[] = [];
      pushCanvasCitation(citations, viewAccessId, 1, title);
      return okCited(
        prefixChunk(1, `# ${title}`, [``, `URL: ${url}`, ``, markdown]),
        citations,
      );
    } catch (e) {
      return err(`Read canvas error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-edit-canvas ───────────────────────────────────────────────

const spacesEditCanvas: ToolDef = {
  name: "spaces-edit-canvas",
  description:
    "Replace the contents of an existing canvas. Requires edit access (owner, editor, or an edit link). " +
    "Pass the viewAccessId (the ID from the canvas URL: /chat/canvas/<viewAccessId>) and the new markdown. " +
    "Returns the canvas URL on success.",
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
  async handler(params, ctx) {
    try {
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
        { s2sKey }
      )) as { url?: string | null; title?: string; viewAccessId?: string; error?: string; updatedAt?: string };

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
    } catch (e) {
      return err(`Edit canvas error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
      targetAgent: { type: "string", description: "Slug of the agent to trigger (e.g. 'doctor-agent', 'pgm-agent')" },
      task: { type: "string", description: "Task description for the target agent" },
      conversationId: { type: "string", description: "Conversation thread to continue in (from Session Metadata)" },
      channelId: { type: "string", description: "Channel where the conversation is happening (from Session Metadata)" },
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
    "Semantic search INSIDE the transcripts + AI summaries of Spaces calls & recordings (the '/recordings' " +
    "content and any call that was transcribed). Searches the transcript text for summaries, action items, " +
    "decisions, Q&A, pain points, and merchant discussions. " +
    "Use this when the user asks what was said/decided/actioned in a call or recording. " +
    "This is the CONTENT side of calls — pair it with spaces-calls, which lists calls/recordings and their " +
    "metadata (participants, attendance, status, timing, summary). " +
    "Prefer this over spaces-search for questions about what was discussed in a call. " +
    "Note: it searches transcripts indexed by Spaces (Vespa file/TRANSCRIPT); it does not cover external " +
    "meeting-bot data that was never ingested as a Spaces transcript.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The topic or question to search for in meeting insights — e.g. 'sales targets', 'action items', 'pain points', 'merchant feedback'. Can be empty if using filters only." },
      callType: { type: "string", description: "Filter by call type: VIDEO, AUDIO, or HEADLESS (HEADLESS = the '/recordings' recordings)." },
      platform: { type: "string", description: "Legacy alias — folded into the same call-type filter as `callType`. Prefer `callType` (VIDEO/AUDIO/HEADLESS)." },
      participants: { type: "string", description: "Filter by the transcript's owner/creator user id (the person who ran/recorded the call)." },
      before: { type: "string", description: "Filter meetings before this date (e.g. '2024-01-01' or '15 Mar 26')" },
      after: { type: "string", description: "Filter meetings after this date" },
      on: { type: "string", description: "Filter meetings on this specific date" },
      range: { type: "string", description: "Filter by time keyword: today, yesterday, this week, last week, last 7 days, this month, last month, last 30 days, recent" },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max results (default 100, max 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0). Call again with the same query/filters and a higher offset for more insights." },
    },
    required: [],
  },
  async handler(args) {
    try {
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
      const formatted = results.map((r, idx) => {
        const chunkIndex = idx + 1;
        const subLines: string[] = [];
        if (r.subtitle) subLines.push(`**${r.subtitle}**`);

        const context = r.context ?? "";
        if (context) {
          // Full context — no cap; highlights preserved. Oversized output is
          // handled centrally by claw's promoteIfOversized().
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

        // Harvest a thread citation when the search row carries channel +
        // conversation IDs (matches what spaces-search:harvest does at :241).
        const channelId =
          (sc["channelId"] as string | undefined) ?? (meta["channelId"] as string | undefined);
        const conversationId =
          (sc["conversationId"] as string | undefined) ?? (meta["conversationId"] as string | undefined);
        pushThreadCitation(citations, channelId, conversationId, chunkIndex, r.title || "Meeting");

        return prefixChunk(chunkIndex, `### ${chunkIndex}. ${r.title || "Untitled Meeting"}`, subLines);
      }).join("\n\n---\n\n");

      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);

      return okCited(`Found ${data.data.totalCount ?? results.length} meeting insight(s):\n\n${formatted}${paginationFooter({ returned: results.length, limit: Number(args["limit"] ?? 100), offset: Number(args["offset"] ?? 0), total: data.data.totalCount })}`, citations);
    } catch (e) {
      return err(`Meeting insights search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
  async handler(args) {
    try {
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
    } catch (e) {
      return err(`Create canvas error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};


// ── spaces-emails ──────────────────────────────────────────────────

const spacesEmails: ToolDef = {
  name: "spaces-emails",
  description:
    "Get the full email thread for an Xyne Desk ticket. Returns all emails (inbound and outbound) " +
    "associated with a desk ticket's conversation — subject, from, to, cc, bcc, body, and timestamps. " +
    "Use the conversationId from spaces-tickets results. Desk tickets have their email history here; " +
    "regular chat messages live in spaces-messages instead.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "The conversationId from a spaces-tickets desk ticket." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 100, description: "Max emails to return (default 100)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0). Call again with a higher offset for older emails in a long thread." },
    },
    required: ["conversationId"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"]);
      const take = (args["limit"] as number | undefined) ?? 100;
      const skip = (args["offset"] as number | undefined) ?? 0;

      const rows = (await interact({
        model: "email",
        operation: "findMany",
        where: { conversationId: { equals: conversationId } },
        orderBy: [{ createdAt: "asc" }],
        take,
        skip,
      })) as EmailRow[];

      if (!rows || rows.length === 0) return ok(`No emails found for conversation ${conversationId}.`);

      const lines = rows.map((e, idx) => {
        const parts = [`[${idx + 1}] ${e.type === "DEFAULT" ? "\u{1F4E5} Inbound" : "\u{1F4E4} Outbound"}`];
        parts.push(`  Subject: ${e.subject}`);
        parts.push(`  From: ${e.from}`);
        parts.push(`  To: ${Array.isArray(e.to) ? e.to.join(", ") : e.to}`);
        if (e.cc && e.cc.length > 0) parts.push(`  CC: ${e.cc.join(", ")}`);
        if (e.bcc && e.bcc.length > 0) parts.push(`  BCC: ${e.bcc.join(", ")}`);
        parts.push(`  Date: ${toIST(e.createdAt)}`);
        // Full body — strip HTML / collapse whitespace for readability, but no
        // length cap (claw's promoteIfOversized() handles oversized results).
        const body = e.body
          ? e.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
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
      rows.forEach((e, idx) => {
        pushThreadCitation(
          citations,
          channelId,
          conversationId,
          idx + 1,
          "Desk email thread",
          {
            ...(ticketXyneId ? { xyneId: ticketXyneId } : {}),
            ...(e.id ? { mailId: e.id } : {}),
          },
        );
      });
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      return okCited(`${rows.length} email(s) in thread:\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit: take, offset: skip })}`, citations);
    } catch (e) {
      return err(`Emails error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
  entityId: string;          // messageId for CHAT entityType
  url?: string;
}

const spacesThreadAttachments: ToolDef = {
  name: "spaces-thread-attachments",
  description:
    "List every non-deleted attachment in a Spaces conversation thread. " +
    "Pass the conversationId from your Session Metadata block. " +
    "Returns one line per attachment with id, filename, mimetype, size, uploader, posted time, and source messageId. " +
    "Use the returned id with spaces-fetch-attachment to download.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "Thread/conversation id (from Session Metadata or spaces-messages results)." },
      limit: { type: "number", minimum: 1, maximum: 200, default: 100, description: "Max attachments to return (default 100, max 200)." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0). Call again with a higher offset to page through a thread with many attachments." },
    },
    required: ["conversationId"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"] ?? "");
      if (!conversationId) return err("conversationId is required");
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

      const byEntity = messageIds.length > 0
        ? ((await interact({
            model: "messageAttachment",
            operation: "findMany",
            where: { entityId: { in: messageIds }, isDeleted: { equals: false } },
            orderBy: [{ createdAt: "asc" }],
            take: fetchCap,
          })) as MessageAttachmentRow[])
        : [];

      const rowsRaw = [...(byConversation ?? []), ...(byEntity ?? [])]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // De-dupe by id, then page the requested window (offset → offset+limit).
      const seen = new Set<string>();
      const deduped = (rowsRaw ?? [])
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      const rows = deduped.slice(offset, offset + limit);

      console.error(
        `[spaces-thread-attachments] conv=${conversationId} msgsWithAttach=${messageIds.length} attachments=${rows.length}`,
      );

      if (rows.length === 0) {
        return ok(`No attachments in conversation ${conversationId}.`);
      }

      const citations: Citation[] = [];
      const lines = rows.map((r, idx) => {
        const channelIdForChunk =
          messageIdToChannelId.get(r.entityId) ?? fallbackChannelId;
        // entityId here IS the messageId the attachment was posted on, so the
        // citation chip can deep-link straight to that message in the thread
        // panel instead of dropping the user at the top.
        pushThreadCitation(
          citations,
          channelIdForChunk,
          conversationId,
          idx + 1,
          r.originalFilename,
          r.entityId ? { messageId: r.entityId } : undefined,
        );
        return prefixChunk(
          idx + 1,
          `id=${r.id}  ${r.originalFilename}  (${r.mimetype}, ${r.size}B)  uploadedBy=${r.uploadedByUserId}  at=${r.createdAt}  messageId=${r.entityId}`,
          [],
        );
      });
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);
      return okCited(`${rows.length} attachment(s) in ${conversationId}:\n\n${lines.join("\n")}${paginationFooter({ returned: rows.length, limit, offset, total: deduped.length })}`, citations);
    } catch (e) {
      return err(`Thread attachments error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

const spacesFetchAttachment: ToolDef = {
  name: "spaces-fetch-attachment",
  description:
    "Download a Spaces attachment by id. The file lands in `.context/<fileName>` inside the agent's workspace; " +
    "use the standard `read` tool to view it afterwards. " +
    "Use this AFTER spaces-thread-attachments to retrieve specific files the user is asking about.",
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string", description: "Attachment id from spaces-thread-attachments." },
    },
    required: ["attachmentId"],
  },
  async handler(args) {
    try {
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

      // Download via the user-token route. The MCP child has the user's
      // bearer in XYNE_SPACES_TOKEN, so this resolves the same as a UI fetch.
      const { buffer } = await spacesFetchBuffer(`/api/attachments/${encodeURIComponent(attachmentId)}/download`);

      // Sanitise filename to keep it within .context/ — strip path separators
      // and leading dots so the agent can't be tricked into reading outside.
      const safeName = m.originalFilename.replace(/[/\\]/g, "_").replace(/^\.+/, "");

      // Marker format consumed by xyne-claw/src/mcp.ts which decodes the
      // base64 and writes the buffer to .context/<fileName> in the workspace.
      return ok(`[SPACES_ATTACHMENT:${safeName}:${m.mimetype}]\n${buffer.toString("base64")}`);
    } catch (e) {
      return err(`Fetch attachment error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
        description: "Name of the workflow. Matched case-insensitively, and partial matches are accepted; if nothing matches (or the match is ambiguous), the tool returns a `candidates` list of real workflow names — re-call with one of those. Mutually exclusive with workflowType.",
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
        description: "If true, count nested/child executions too. Defaults false (top-level invocations only).",
      },
    },
  },
  async handler(args) {
    try {
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
          return ok(JSON.stringify({
            resolved: false,
            message: `No workflow matched "${workflowName}". Re-call with one of the exact names below, or pass workflowType.`,
            candidates,
          }, null, 2));
        }
        // workflowName is non-unique. If a contains-match spans >1 DISTINCT name,
        // it's ambiguous — return those names rather than silently merging stats
        // across unrelated workflows.
        const distinctNames = [...new Set(wfRows.map((r) => r.workflowName).filter((n): n is string => !!n))];
        if (distinctNames.length > 1) {
          return ok(JSON.stringify({
            resolved: false,
            ambiguous: true,
            message: `"${workflowName}" matched ${distinctNames.length} different workflows. Re-call with one exact name.`,
            candidates: distinctNames,
          }, null, 2));
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
        byStatus: Object.fromEntries(
          [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
        ),
        topUsersByRunCount: [...byUser.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([userId, count]) => ({ userId, count })),
        firstRunAt: firstAt,
        lastRunAt: lastAt,
      };

      return ok(JSON.stringify(summary, null, 2));
    } catch (e) {
      return err(`Workflow stats error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
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
// Uses POST /api/conversations/:conversationId/messages — the same
// endpoint a real user hits when typing in their Spaces thread.
const userSendMessage: ToolDef = {
  name: "user-send-message",
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
        description: "Target conversation thread ID. Required.",
      },
      content: {
        type: "string",
        description: "Message body. Supports HTML for @mentions and basic formatting.",
      },
    },
    required: ["conversationId", "content"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"] ?? "").trim();
      const rawContent = String(args["content"] ?? "");
      if (!conversationId) return err("conversationId is required");
      if (!rawContent.trim()) return err("content cannot be empty");

      // Same mention-expansion the app-tools version uses, so @Name[userId]
      // shorthand works consistently across both tools.
      const { expandSpacesMentions } = await import("../../lib/mention-transform.js");
      const content = expandSpacesMentions(rawContent);

      const result = (await spacesFetch(
        `/api/conversations/claw/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content }),
        },
      )) as { messageId?: string; conversationId?: string } | undefined;

      const msgId = result?.messageId ? ` (messageId=${result.messageId})` : "";
      return ok(`Message sent as user to conversation ${conversationId}${msgId}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(`user-send-message error: ${msg}`);
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
    "- Access control: always include permissions contains \"<userId>\" for chat/ticket/file unless scoping by channelId\n" +
    "- Ticket status: ticket.status (TODO|STARTED|PAUSED|CANCELLED|COMPLETED)\n" +
    "- File sub-type: file.subApp (CANVAS|TRANSCRIPT|CHAT_ATTACHMENT|TICKET_ATTACHMENT|RCA)",
  inputSchema: {
    type: "object",
    properties: {
      schema: {
        type: "string",
        enum: ["chat_message", "chat_attachment", "chat_container", "attachment", "ticket", "user", "file", "sam_transcript", "mail", "mail_attachment", "project", "memory"],
        description: "Schema name to fetch field definitions for.",
      },
    },
    required: ["schema"],
  },
  async handler(args) {
    try {
      const qs = `?schema=${encodeURIComponent(String(args["schema"]))}`;

      const text = await spacesFetchText(`/api/vespaSearch/schema${qs}`);
      if (!text || !text.trim()) return err("Schema not found or VESPA_SCHEMA_PATH is not configured on the server.");
      return ok(text);
    } catch (e) {
      return err(`vespa-schema error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

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
): Promise<ToolResult> {
  const citations: Citation[] = [];

  // Every row in render order (grouped results flatten across groups — the
  // chunkIndex counter below walks them in this same order).
  const allRows: SearchResult[] =
    data.data.grouped && data.data.groups
      ? data.data.groups.flatMap((g) => g.results)
      : data.data.results ?? [];
  const scOf = (r: SearchResult): Record<string, unknown> => r.searchContext ?? {};
  const subAppOf = (r: SearchResult): string | undefined =>
    (scOf(r)["subApp"] as string | undefined)?.toUpperCase();
  const isFile = (r: SearchResult): boolean => r.type.toLowerCase() === "file";

  const [mailLinks, ticketLinks, canvasViewIds] = await Promise.all([
    resolveMailLinks(allRows.filter((r) => r.type.toLowerCase() === "mail").map((r) => r.id)),
    resolveTicketLinks(
      allRows.filter(isFile).map((r) => scOf(r)["ticketId"] as string | undefined),
    ),
    resolveCanvasViewIds(
      allRows
        .filter((r) => isFile(r) && subAppOf(r) === "CANVAS" && !scOf(r)["viewAccessId"])
        .map((r) => r.id),
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
    // Non-routable docTypes: no citation kind maps to them. (memory docTypes
    // are stored uppercase FACT/SOP — `type` is lowercased above.)
    if (type === "user" || type === "project" || type === "sam_transcript" ||
        type === "memory" || type === "fact" || type === "sop") {
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
    const ticketLink = type === "file"
      ? ticketLinks.get((sc["ticketId"] as string | undefined) ?? "")
      : undefined;
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
    const channelIds = citations.map(c => c.channelId).filter((v): v is string => !!v);
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
        parts.push(formatSearchResult(r, cited ? chunkIndex : null));
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
      return formatSearchResult(r, cited ? idx + 1 : null);
    })
    .join("\n\n");
  return finalize(await finish(
    `Found ${data.data.totalCount ?? results.length} result(s):\n\n${rendered}${paginationFooter({ returned: results.length, limit: hits, offset, total: data.data.totalCount })}`,
  ));
}

// On failure, queryDirect attaches the query it actually sent to Vespa as
// `executedYql` — surface it (result text + _meta.debug) so the trace shows the
// real ACL-injected query, not just the raw agent input. Validation errors
// (thrown before Vespa is hit) carry no executedYql and render as plain text.
function directError(prefix: string, e: unknown): ToolResult {
  const executedYql = (e as { executedYql?: string })?.executedYql;
  const base = `${prefix}: ${e instanceof Error ? e.message : String(e)}`;
  const text = executedYql ? `${base}\n\n[Executed YQL (ACL guard injected): ${executedYql}]` : base;
  const result = err(text);
  return executedYql
    ? { ...result, _meta: { debug: { payloads: [{ stage: "direct", yql: executedYql, vespaParams: {} }] } } }
    : result;
}

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
    "- message / attachment / ticket / sam_transcript / mail / mail_attachment / memory: `permissions contains \"<userId>\"`\n" +
    "- file: `(ownerId contains \"<userId>\" or permissions contains \"<userId>\" or isPrivate contains \"false\")` for CANVAS; `(ownerId contains \"<userId>\" or channelPermissions contains \"<userId>\" or isPrivate contains \"false\")` for CHAT_ATTACHMENT/TRANSCRIPT; no guard for RCA\n" +
    "- user / channel: no ACL needed (public)\n" +
    "Use the `userId` field from **spaces-whoami** if you need your own id.\n\n" +
    "## YQL examples (use the YQL source name, NOT the schema name from spaces-vespa-schema)\n" +
    "```\n" +
    "-- tickets assigned to a user, open only (source: ticket)\n" +
    "select * from sources ticket where userInput(@query) and status contains \"OPEN\" and assignedTo contains \"<userId>\" and permissions contains \"<userId>\"\n\n" +
    "-- messages in a channel since a date (source: message) — write dates as dd/mm/yy, NOT epoch ms\n" +
    "select * from sources message where channelId contains \"<channelId>\" and createdAtTimestamp > 01/06/26 and permissions contains \"<userId>\"\n\n" +
    "-- files of subApp CANVAS owned by user (source: file)\n" +
    "select * from sources file where subApp contains \"CANVAS\" and ownerId contains \"<userId>\"\n\n" +
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
    "- Write date filters as dd/mm/yy (e.g. `createdAtTimestamp > 01/06/26`) — do NOT compute epoch ms yourself. The tool converts each literal to milliseconds before running the query. A bare date is treated as IST midnight of that day; to filter on a specific IST time add `HH:MM` (or `HH:MM:SS`), e.g. `createdAtTimestamp > \"01/06/26 14:30\"`. dd/mm/yyyy is also accepted. Dates are only converted when they follow a comparison operator (> < >= <=), so a date inside a text match stays literal.\n" +
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
        description: "Free-text query bound to @query in the YQL. Pass this separately — do not embed it in the yql string.",
      },
      hits: {
        type: "number",
        minimum: 0,
        maximum: 100,
        default: 20,
        description: "Max document hits to return (default 20, max 100). Pass 0 for grouping/count queries that only need the group aggregation, not the documents themselves.",
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
          "For an embedding input use `{ \"e\": \"embed(@query)\" }`. Ignored when the profile is `unranked`; if omitted with a scoring profile, the standard default_native inputs are used.",
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

      const data = await queryDirect(yql, query, ctx.userId, hits, offset, CONFIG.vespaQueryEndpoint, rankProfile, rankInputs);
      return renderDirectResult(data, hits, offset);
    } catch (e) {
      return directError("vespa-query error", e);
    }
  },
};

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
    "  `{ \"searchArea\": \"ticket\", \"filters\": { \"status\": { \"in\": [\"TODO\", \"STARTED\"] }, \"assignedTo\": { \"contains\": \"<userId>\" } } }`\n" +
    "- Canvases in a channel created since a date:\n" +
    "  `{ \"searchArea\": \"canvas\", \"filters\": { \"channelId\": { \"contains\": \"<channelId>\" }, \"createdDate\": { \"gte\": \"01/06/26\" } } }`\n" +
    "- Messages about a topic in a channel:\n" +
    "  `{ \"searchArea\": \"message\", \"query\": \"launch checklist\", \"filters\": { \"channelId\": { \"contains\": \"<channelId>\" } } }`\n\n" +
    "Only available when DIRECT_VESPA_SEARCH is enabled. Results come back citation-ready.",
  inputSchema: {
    type: "object",
    properties: {
      searchArea: {
        type: "string",
        enum: [...AREA_NAMES, ...Object.keys(AREA_ALIASES)],
        description: "The scope to search. Resolves to the Vespa source, baseline constraints, ACL guard, and timestamp field.",
      },
      query: {
        type: "string",
        description: "Free-text query (topical keyword/semantic match), bound to @query. Omit for pure-filter lookups.",
      },
      filters: {
        type: "object",
        additionalProperties: true,
        description: "Nested operator bags: { <field>: { <op>: <value> } }. Only the fields/ops listed for the chosen area are accepted (else an error is returned). Dates are dd/mm/yy (IST).",
      },
      docType: {
        type: "string",
        description: "Optional docType narrowing (only areas whose docType is not fixed accept this, e.g. memory → FACT/SOP).",
      },
      groupBy: {
        type: "string",
        description: "Group results by an allowed field for the area (see the field list). Returns per-group counts. Cannot be combined with sort.",
      },
      groupOrder: {
        type: "string",
        enum: ["desc", "asc"],
        default: "desc",
        description: "Order groups by count: desc (largest first, default) or asc (smallest first). Only used with groupBy.",
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
        description: "Sample documents to include per group (default 5, min 1, cap 5). Only used with groupBy.",
      },
      sort: {
        type: "object",
        additionalProperties: false,
        properties: {
          by: { type: "string", description: "Field to order by — one of the area's sortBy fields (see the field list; typically date fields like createdDate/updatedDate)." },
          dir: { type: "string", enum: ["asc", "desc"], default: "desc", description: "Sort direction (default desc = newest/highest first)." },
        },
        required: ["by"],
        description: "Order results by a sortable field, e.g. {by:\"createdDate\", dir:\"desc\"} for newest-first. Cannot be combined with groupBy.",
      },
      hits: {
        type: "number",
        minimum: 0,
        maximum: 100,
        default: 20,
        description: "Max document hits to return (default 20, max 100). Pass 0 for grouping/count-only queries.",
      },
      offset: {
        type: "number",
        minimum: 0,
        default: 0,
        description: "Pagination offset.",
      },
      rankProfile: {
        type: "string",
        description: "Optional Vespa rank profile — one of default_native or unranked. Defaults to default_native for free-text searches, and unranked for filter-only/grouping (nothing to rank). An invalid profile returns an error listing the allowed set. Rank inputs are supplied automatically.",
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
      const groupOrder = args["groupOrder"] === "asc" ? ("asc" as const) : args["groupOrder"] === "desc" ? ("desc" as const) : undefined;
      const maxGroups = args["maxGroups"] != null ? Number(args["maxGroups"]) : undefined;
      const hitsPerGroup = args["hitsPerGroup"] != null ? Number(args["hitsPerGroup"]) : undefined;
      const rawSort = args["sort"];
      const sort =
        rawSort && typeof rawSort === "object" && !Array.isArray(rawSort) && (rawSort as Record<string, unknown>)["by"]
          ? {
              by: String((rawSort as Record<string, unknown>)["by"]),
              dir: (rawSort as Record<string, unknown>)["dir"] === "asc" ? ("asc" as const) : ("desc" as const),
            }
          : undefined;
      const hits = Math.min(Math.max(Number(args["hits"] ?? 20), 0), 100);
      const offset = Math.max(Number(args["offset"] ?? 0), 0);
      const rankProfile = args["rankProfile"] != null ? String(args["rankProfile"]) : undefined;

      // Tenant scope — every direct-Vespa query is confined to the caller's
      // workspace, resolved from the user record (public.users). Refuse to run
      // unscoped rather than risk crossing tenants.
      const workspaceId = await getWorkspaceIdForUser(ctx.userId);
      if (!workspaceId) return err("Could not resolve your workspaceId — cannot run a workspace-scoped search.");

      // Build the YQL from structured params in CODE — throws on any validation
      // failure (unknown area/field/op, bad date, invalid rankProfile), surfaced
      // as a tool error. rankInputs are auto-supplied by queryDirect.
      const built = buildYqlFromParams(
        { searchArea, query, ...(filters ? { filters } : {}), ...(docType ? { docType } : {}), ...(groupBy ? { groupBy } : {}), ...(groupOrder ? { groupOrder } : {}), ...(maxGroups != null ? { maxGroups } : {}), ...(hitsPerGroup != null ? { hitsPerGroup } : {}), ...(sort ? { sort } : {}), ...(rankProfile ? { rankProfile } : {}), hits },
        ctx.userId,
        workspaceId,
      );

      const data = await queryDirect(built.yql, built.query, ctx.userId, hits, offset, CONFIG.vespaQueryEndpoint, built.rankProfile, undefined);
      return renderDirectResult(data, hits, offset);
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
        description: "Which surface to list: drafts, scheduled, email-drafts, bookmarks (saved items), or pinned (pinned messages/threads).",
      },
      entityType: {
        type: "string",
        enum: ["message", "conversation", "ticket", "canvas"],
        description: "For type=bookmarks only: narrow to one bookmarked kind.",
      },
      completed: {
        type: "boolean",
        description: "For type=bookmarks only: true → only bookmarks marked complete; false → only open bookmarks. Omit for all.",
      },
      channelId: { type: "string", description: "Limit to one channel. Applies to type=pinned (threads), type=scheduled (scheduled sends), and type=email-drafts (desk drafts)." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 50, description: "Max items (default 50)." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
    },
    required: ["type"],
  },
  async handler(args, ctx) {
    try {
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
        const ids = (t: string) => rows.filter((b) => b.entityType === t && b.entityId).map((b) => b.entityId!) as string[];
        type Target = { title?: string | undefined; channelId?: string | undefined; conversationId?: string | undefined; messageId?: string | undefined; xyneId?: string | undefined; viewAccessId?: string | undefined };
        const target = new Map<string, Target>(); // key `TYPE:entityId`

        const convIds = ids("CONVERSATION");
        if (convIds.length > 0) {
          const cs = (await interact({ model: "conversation", operation: "findMany", where: { conversationId: { in: convIds } }, take: convIds.length })) as Array<{ conversationId?: string; channelId?: string }>;
          for (const c of cs) if (c.conversationId) target.set(`CONVERSATION:${c.conversationId}`, { conversationId: c.conversationId, channelId: c.channelId });
        }
        const msgIds = ids("MESSAGE");
        if (msgIds.length > 0) {
          const ms = (await interact({ model: "message", operation: "findMany", where: { messageId: { in: msgIds } }, take: msgIds.length })) as Array<{ messageId?: string; conversationId?: string; content?: string }>;
          const needConv = new Set<string>();
          for (const m of ms) if (m.messageId) { target.set(`MESSAGE:${m.messageId}`, { messageId: m.messageId, conversationId: m.conversationId, title: m.content ? cleanSnippet(m.content).slice(0, 80) : undefined }); if (m.conversationId) needConv.add(m.conversationId); }
          if (needConv.size > 0) {
            const cs = (await interact({ model: "conversation", operation: "findMany", where: { conversationId: { in: [...needConv] } }, take: needConv.size })) as Array<{ conversationId?: string; channelId?: string }>;
            const chOf = new Map(cs.filter((c) => c.conversationId).map((c) => [c.conversationId!, c.channelId] as const));
            for (const t of target.values()) if (t.messageId && t.conversationId) t.channelId = chOf.get(t.conversationId);
          }
        }
        const ticketIds = ids("TICKET");
        if (ticketIds.length > 0) {
          const ts = (await interact({ model: "ticket", operation: "findMany", where: { id: { in: ticketIds } }, take: ticketIds.length })) as Array<{ id?: string; xyneId?: string; title?: string; channelId?: string; convId?: string }>;
          for (const t of ts) if (t.id) target.set(`TICKET:${t.id}`, { title: t.title, xyneId: t.xyneId, channelId: t.channelId, conversationId: t.convId });
        }
        const canvasIds = ids("CANVAS");
        if (canvasIds.length > 0) {
          const cvs = (await interact({ model: "canvas", operation: "findMany", where: { id: { in: canvasIds } }, take: canvasIds.length })) as Array<{ id?: string; title?: string; viewAccessId?: string; channelId?: string }>;
          for (const c of cvs) if (c.id) target.set(`CANVAS:${c.id}`, { title: c.title, viewAccessId: c.viewAccessId, channelId: c.channelId });
        }

        const channelInfo = await resolveChannelInfo([...target.values()].map((t) => t.channelId).filter((v): v is string => !!v));
        const citations: Citation[] = [];
        const lines = rows.map((b, idx) => {
          const t = b.entityId && b.entityType ? target.get(`${b.entityType}:${b.entityId}`) : undefined;
          const ch = t?.channelId ? channelInfo.get(t.channelId)?.name : undefined;
          const label = t?.title || t?.xyneId || `${b.entityType} ${b.entityId}`;
          const parts = [`[${(b.entityType ?? "item").toLowerCase()}] ${label}${b.isCompleted ? " [completed]" : ""}`];
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
        return okCited(`${rows.length} bookmark(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`, citations);
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
        })) as Array<{ conversationId?: string; channelId?: string; ticketId?: string; initialMessageId?: string }>;
        if (rows.length === 0) return ok(chFilter ? "No pinned messages in that channel." : "No pinned messages.");
        // Preview the pinned thread's first message.
        const initIds = rows.map((r) => r.initialMessageId).filter((v): v is string => !!v);
        const preview = new Map<string, string>();
        if (initIds.length > 0) {
          const ms = (await interact({ model: "message", operation: "findMany", where: { messageId: { in: initIds } }, take: initIds.length })) as Array<{ messageId?: string; content?: string }>;
          for (const m of ms) if (m.messageId && m.content) preview.set(m.messageId, cleanSnippet(m.content));
        }
        const channelInfo = await resolveChannelInfo(rows.map((r) => r.channelId).filter((v): v is string => !!v));
        const citations: Citation[] = [];
        const lines = rows.map((r, idx) => {
          const ch = r.channelId ? channelInfo.get(r.channelId)?.name : undefined;
          const body = r.initialMessageId ? preview.get(r.initialMessageId) : undefined;
          const parts = [`Pinned${ch ? ` in #${ch}` : ""}${r.ticketId ? " (ticket thread)" : ""}`];
          if (body) parts.push(`  ${body}`);
          if (r.conversationId) parts.push(`  conversationId: ${r.conversationId}`);
          if (r.channelId) parts.push(`  channelId: ${r.channelId}`);
          pushThreadCitation(citations, r.channelId, r.conversationId, idx + 1, ch ? `Pinned in #${ch}` : "Pinned thread", r.initialMessageId ? { messageId: r.initialMessageId } : undefined);
          return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
        });
        applyChannelInfo(citations, channelInfo);
        return okCited(`${rows.length} pinned message(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`, citations);
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
        })) as Array<{ id: string; title?: string; messageContent?: string; channelId?: string; daysOfWeek?: unknown; scheduledTime?: string; isActive?: boolean }>;
        if (rows.length === 0) return ok("No scheduled messages.");
        const channelInfo = await resolveChannelInfo(rows.map((r) => r.channelId).filter((v): v is string => !!v));
        const citations: Citation[] = [];
        const lines = rows.map((r, idx) => {
          const ch = r.channelId ? channelInfo.get(r.channelId)?.name : undefined;
          const parts = [`${r.title || "(untitled schedule)"}${r.isActive === false ? " [inactive]" : ""}`];
          if (r.messageContent) parts.push(`  ${cleanSnippet(r.messageContent)}`);
          const sched: string[] = [];
          if (r.scheduledTime) sched.push(`at ${r.scheduledTime}`);
          if (Array.isArray(r.daysOfWeek) && r.daysOfWeek.length > 0) sched.push(`on ${(r.daysOfWeek as unknown[]).join(", ")}`);
          if (sched.length > 0) parts.push(`  Schedule: ${sched.join(" ")}`);
          if (ch) parts.push(`  Channel: #${ch}`);
          if (r.channelId) parts.push(`  channelId: ${r.channelId}`);
          pushThreadCitation(citations, r.channelId, undefined, idx + 1, ch ? `#${ch}` : "Scheduled message");
          return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
        });
        applyChannelInfo(citations, channelInfo);
        return okCited(`${rows.length} scheduled message(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`, citations);
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
      })) as Array<{ id: string; channelId?: string; conversationId?: string; content?: string; draftContent?: string; hasAttachment?: boolean; autoDraftStatus?: string; updatedAt?: string }>;
      if (rows.length === 0) return ok(isEmail ? "No email drafts." : "No drafts.");
      const channelInfo = await resolveChannelInfo(rows.map((r) => r.channelId).filter((v): v is string => !!v));
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
        pushThreadCitation(citations, r.channelId, r.conversationId, idx + 1, ch ? `Draft in #${ch}` : "Draft");
        return prefixChunk(idx + 1, parts[0]!, parts.slice(1));
      });
      applyChannelInfo(citations, channelInfo);
      return okCited(`${rows.length} ${isEmail ? "email draft" : "draft"}(s):\n\n${lines.join("\n\n")}${paginationFooter({ returned: rows.length, limit, offset })}`, citations);
    } catch (e) {
      return err(`my-items error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

export const tools: ToolDef[] = [
  spacesWhoami,
  ...(CONFIG.directVespaSearch ? [spacesVespaSchema, spacesVespaQuery, spacesVespaSearch] : []),
  spacesSearch,
  spacesSearchV2,
  spacesMyItems,
  spacesWorkflowStats,
  userSendMessage,
  spacesMeetingInsights,
  spacesTickets,
  spacesMessages,
  spacesMessageDetail,
  spacesChannels,
  spacesUsers,
  spacesActivity,
  spacesProjects,
  spacesProjectTeamMembers,
  spacesCanvases,
  spacesCalls,
  spacesBoards,
  spacesEmails,
  spacesThreadAttachments,
  spacesFetchAttachment,
  spacesCreateTicket,
  spacesUpdateTicket,
  spacesScheduleCall,
  spacesPublishDocs,
  spacesReadCanvas,
  spacesEditCanvas,
  spacesTriggerAgent,
  spacesCreateCanvas,
];
