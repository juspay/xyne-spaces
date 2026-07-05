/**
 * Fetch conversational data out of Spaces and normalize it into the
 * role-tagged transcript the eval extractor consumes.
 *
 * Read-only: every fetch goes through the Spaces `/api/query` AST endpoint via
 * interact(), which is ACL-scoped to the calling user — you can only pull
 * channels you're allowed to see. We never touch the Spaces DB directly here.
 *
 * Output: a list of "threads", each a `{ externalId, title, kind, messages }`
 * where messages is `[{ id, role, text }]` — exactly what /eval-extract eats.
 */
import { interact, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";

export type TurnRole = "customer" | "human-agent" | "bot" | "other";

export interface NormalizedMessage {
  id: string;
  role: TurnRole;
  text: string;
}

export type ImportKind = "thread" | "channel" | "email-channel";

// ── Text cleaning ─────────────────────────────────────────────────────────

/** Strip HTML to readable text, dropping hidden tracking spans. */
function htmlToText(raw: string): string {
  if (!raw) return "";
  let b = raw;
  // Hidden tracking spans Spaces injects (transparent / zero line-height).
  b = b.replace(/<span[^>]*(?:color:\s*transparent|line-height:\s*0)[^>]*>[\s\S]*?<\/span>/gi, " ");
  b = b.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n");
  b = b.replace(/<[^>]+>/g, " ");
  b = b.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"');
  return b;
}

/** Cut quoted prior-message tails: both "On … wrote:" and Outlook From:/Sent: blocks. */
function stripQuotedTail(text: string): string {
  let t = text;
  const onWrote = t.search(/\n\s*On .{0,120}? wrote:/);
  if (onWrote !== -1) t = t.slice(0, onWrote);
  const outlook = t.search(/\n\s*From:\s.+\n\s*Sent:\s/);
  if (outlook !== -1) t = t.slice(0, outlook);
  return t;
}

function clean(raw: string, isHtml: boolean): string {
  const text = isHtml ? htmlToText(raw) : raw;
  return stripQuotedTail(text)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s.slice(0, 400));
}

// ── Field helpers (rows come back as loose JSON) ────────────────────────────

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === "string" ? v : "";
}

function asRows(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? (data.filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>) : [];
}

// ── Role tagging ────────────────────────────────────────────────────────────

function chatRole(msg: Record<string, unknown>): TurnRole {
  const msgType = str(msg, "msgType");
  const sender = (msg["sender"] && typeof msg["sender"] === "object" ? msg["sender"] : {}) as Record<string, unknown>;
  const userType = str(sender, "userType");
  const role = str(sender, "role");
  if (msgType === "BOT" || userType === "BOT" || userType === "APP") return "bot";
  if (role === "ADMIN" || role === "OWNER") return "human-agent";
  return "customer";
}

/** Email direction is the strongest signal: inbound DEFAULT = customer,
 *  outbound REPLY/REPLY_ALL = the desk's responder. */
function emailRole(email: Record<string, unknown>): TurnRole {
  const type = str(email, "type");
  return type === "REPLY" || type === "REPLY_ALL" ? "human-agent" : "customer";
}

// ── Fetch + normalize ───────────────────────────────────────────────────────

export interface SpacesChannel {
  id: string;
  name: string;
  type: string;
}

/** List the channels the user can see (ACL-scoped), for the import picker.
 *  The dialog splits these by `type`: EMAIL → "email channel" mode, DEFAULT /
 *  SLACK → "chat channel" mode. DM and group-DM scopes are excluded — they
 *  aren't eval sources and render as raw user ids (a DM is scopeType DM with
 *  type DEFAULT, so it must be filtered on scopeType, not type). */
export async function listSpacesChannels(auth: SpacesAuthContext): Promise<SpacesChannel[]> {
  const data = await interact(
    {
      model: "channel",
      operation: "findMany",
      where: {
        type: { in: ["EMAIL", "DEFAULT", "SLACK"] },
        scopeType: { notIn: ["DM", "GROUP_DM"] },
      },
      orderBy: [{ lastActivityAt: "desc" }],
      select: { id: true, name: true, type: true },
      take: 300,
    },
    auth,
  );
  return asRows(data)
    .map((c) => ({ id: str(c, "id"), name: str(c, "name"), type: str(c, "type") }))
    .filter((c) => c.id);
}

/**
 * Page conversation IDs in a channel within a time window, newest→oldest, by
 * keyset cursor on lastActivityAt. Returns IDs + timestamps only (cheap) — the
 * worker pulls full bodies one conversation at a time. `cursor` is the
 * lastActivityAt of the last conversation processed in the previous page.
 */
export async function fetchConversationPage(
  channelId: string,
  opts: { from: Date; to: Date; cursor?: Date | null; limit: number },
  auth: SpacesAuthContext,
): Promise<Array<{ conversationId: string; lastActivityAt: string }>> {
  const lastActivityAt = opts.cursor
    ? { gte: opts.from.toISOString(), lt: opts.cursor.toISOString() }
    : { gte: opts.from.toISOString(), lte: opts.to.toISOString() };
  const data = await interact(
    {
      model: "conversation",
      operation: "findMany",
      where: { channelId, lastActivityAt },
      orderBy: [{ lastActivityAt: "desc" }],
      select: { conversationId: true, lastActivityAt: true },
      take: opts.limit,
    },
    auth,
  );
  return asRows(data)
    .map((r) => ({ conversationId: str(r, "conversationId"), lastActivityAt: str(r, "lastActivityAt") }))
    .filter((r) => r.conversationId);
}

/** Fetch + normalize ONE conversation. `mode` picks the source; "auto" tries
 *  chat messages first, falling back to emails. */
export async function fetchOneThread(
  conversationId: string,
  mode: "chat" | "email" | "auto",
  auth: SpacesAuthContext,
): Promise<{ kind: "chat" | "email"; messages: NormalizedMessage[] }> {
  if (mode === "email") {
    return { kind: "email", messages: normalizeEmailGroup(await fetchEmails({ conversationId }, auth)) };
  }
  const messages = await fetchChatMessages(conversationId, auth);
  if (messages.length > 0 || mode === "chat") return { kind: "chat", messages };
  // auto + no chat messages → try emails
  return { kind: "email", messages: normalizeEmailGroup(await fetchEmails({ conversationId }, auth)) };
}

async function fetchChatMessages(conversationId: string, auth: SpacesAuthContext): Promise<NormalizedMessage[]> {
  const data = await interact(
    {
      model: "message",
      operation: "findMany",
      where: { conversationId, isDeleted: false },
      orderBy: [{ createdAt: "asc" }],
      include: { sender: { select: { userType: true, role: true, name: true } } },
      take: 300,
    },
    auth,
  );
  const out: NormalizedMessage[] = [];
  for (const m of asRows(data)) {
    if (str(m, "msgType") === "SYSTEM") continue;
    const content = str(m, "content");
    const text = clean(content, looksHtml(content));
    const id = str(m, "messageId") || str(m, "id");
    if (id && text) out.push({ id, role: chatRole(m), text });
  }
  return out;
}

async function fetchEmails(
  where: Record<string, unknown>,
  auth: SpacesAuthContext,
): Promise<Array<Record<string, unknown>>> {
  const data = await interact(
    { model: "email", operation: "findMany", where, orderBy: [{ createdAt: "asc" }], take: 500 },
    auth,
  );
  return asRows(data);
}

function normalizeEmailGroup(emails: Array<Record<string, unknown>>): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const e of emails) {
    const body = str(e, "body");
    const text = clean(body, looksHtml(body));
    const id = str(e, "id");
    // Full id — it's the key the extractor selects by and we reconstruct from;
    // truncating risks collisions that cross-wire query/response.
    if (id && text) out.push({ id, role: emailRole(e), text: text.slice(0, 4000) });
  }
  return out;
}
