import { isChatConversation, isDirectChatConversation } from "./conversation-kind.js";

/**
 * Multi-agent direct chats.
 *
 * A direct chat (`chat-*` conversation) can be answered by different agents on
 * different turns: the user switches A → B mid-conversation and later back.
 * The chat transcript is ONE tree in chat_messages (agentSlug per row), but
 * each agent keeps its own private pi session in claw (`<conv>_<slug>`), with
 * its own tool calls and tool results. That split is deliberate — B must not
 * replay A's tool calls under B's tool set, or read A's raw tool output.
 *
 * This module holds the two pure pieces built on that model:
 *
 *   Hand-off note       what an agent is told about the turns its own session
 *                       has not seen (buildAgentHandoff)
 *   Conversation list   the one history across every agent, a switched chat
 *                       listed once, in pages (conversationEntries → selectPage
 *                       → buildConversationList)
 */

// ── Hand-off note ─────────────────────────────────────────────────────────
//
// When an agent is asked to answer, it gets a text note of the turns its own
// session has not seen: the user's messages to other agents and those agents'
// replies. Two variants are built because only claw knows whether the agent's
// session actually exists on this branch (a branch, an expired archive, or a
// first appearance all start fresh):
//
//   resume  the turns after this agent's last reply on the selected path
//   fresh   the whole path, this agent's own earlier replies included
//
// Single-agent paths get no note at all (null), so every conversation that
// never switched agents runs exactly as it did before this existed.

export const HANDOFF_MAX_MESSAGES = 40;
export const HANDOFF_MAX_CHARS = 24_000;
const HANDOFF_MAX_MESSAGE_CHARS = 4_000;

export interface HandoffMessage {
  id: string;
  role: string;
  content: string;
  status?: string | null;
  agentSlug: string;
  runProvider?: string | null;
  parentId: string | null;
  createdAt: Date;
}

export interface AgentHandoff {
  /** For a run that resumes this agent's own session: only what it missed. */
  resume: string | null;
  /** For a run that starts a fresh session: the whole path, its own turns included. */
  fresh: string | null;
}

/** Narrow chat_messages rows to what the note needs. */
export function handoffMessagesFrom(
  rows: Array<{
    id: string;
    role: string;
    content: string;
    status?: string | null;
    agentSlug: string;
    runProvider?: string | null;
    parentId?: string | null;
    createdAt: Date;
  }>,
): HandoffMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status ?? null,
    agentSlug: row.agentSlug,
    runProvider: row.runProvider ?? null,
    parentId: row.parentId ?? null,
    createdAt: row.createdAt,
  }));
}

/** Root → leaf path through the chat tree, following parentId links. */
export function conversationPath(
  messages: HandoffMessage[],
  leafId: string | null | undefined,
): HandoffMessage[] {
  if (!leafId) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const path: HandoffMessage[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(leafId);
  while (cursor && !seen.has(cursor.id)) {
    path.push(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse();
}

/** Distinct agents on the path plus the one about to answer, in first-use order. */
export function agentsOnPath(path: HandoffMessage[], agentSlug: string): string[] {
  const slugs: string[] = [];
  for (const message of path) {
    if (message.agentSlug && !slugs.includes(message.agentSlug)) slugs.push(message.agentSlug);
  }
  if (!slugs.includes(agentSlug)) slugs.push(agentSlug);
  return slugs;
}

function isUsable(message: HandoffMessage): boolean {
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (message.status === "running" || message.status === "failed") return false;
  return typeof message.content === "string" && message.content.trim().length > 0;
}

function renderLine(message: HandoffMessage, agentSlug: string): string {
  const raw = message.content.trim();
  const content = raw.length > HANDOFF_MAX_MESSAGE_CHARS
    ? `${raw.slice(0, HANDOFF_MAX_MESSAGE_CHARS)}… (truncated)`
    : raw;
  if (message.role === "user") return `[User]: ${content}`;
  if (message.agentSlug === agentSlug) return `[You (@${agentSlug})]: ${content}`;
  return `[@${message.agentSlug} (another agent)]: ${content}`;
}

function renderNote(messages: HandoffMessage[], agentSlug: string, scope: "resume" | "fresh"): string | null {
  const usable = messages.filter(isUsable);
  if (usable.length === 0) return null;

  let kept = usable.slice(-HANDOFF_MAX_MESSAGES);
  let truncated = kept.length < usable.length;
  const render = (list: HandoffMessage[]): string =>
    list.map((message) => renderLine(message, agentSlug)).join("\n\n");
  while (kept.length > 1 && render(kept).length > HANDOFF_MAX_CHARS) {
    kept = kept.slice(1);
    truncated = true;
  }

  const intro = scope === "resume"
    ? "These are the turns since your last reply, which another agent answered:"
    : "This is the conversation so far:";
  return [
    "## Earlier in this conversation",
    `This is ONE conversation in which the user picks which agent answers each turn. You are @${agentSlug}; other agents answered some earlier turns.`,
    "Everything below happened in this same conversation and is shared with you. Treat what the user told another agent as told to you, and use the other agents' replies as context. Those replies are theirs: do not adopt their voice or identity, and do not claim their work as yours.",
    intro,
    ...(truncated ? ["(earlier messages omitted)"] : []),
    render(kept),
  ].join("\n\n");
}

/**
 * Build the note for `agentSlug` answering after `path`. `isOwnSessionTurn`
 * picks the assistant rows whose content already lives in the session a resume
 * would load (for a server run: this agent's server-side replies; for a local
 * harness run: this agent's replies on that harness provider). Returns null
 * when the path holds no other agent, which keeps single-agent chats unchanged.
 */
export function buildAgentHandoff(args: {
  path: HandoffMessage[];
  agentSlug: string;
  isOwnSessionTurn: (message: HandoffMessage) => boolean;
}): AgentHandoff | null {
  const { path, agentSlug } = args;
  if (agentsOnPath(path, agentSlug).length <= 1) return null;

  let lastOwnIdx = -1;
  path.forEach((message, index) => {
    if (message.role === "assistant" && message.agentSlug === agentSlug && args.isOwnSessionTurn(message)) {
      lastOwnIdx = index;
    }
  });

  const fresh = renderNote(path, agentSlug, "fresh");
  const resume = lastOwnIdx === -1 ? fresh : renderNote(path.slice(lastOwnIdx + 1), agentSlug, "resume");
  if (!fresh && !resume) return null;
  return { resume, fresh };
}

/** Accept a caller-supplied note only in the shape this module builds, with
 *  each variant capped (the note is plain context, never instructions with
 *  more authority than the run's own `context` field). */
export function sanitizeAgentHandoff(value: unknown): AgentHandoff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pick = (field: unknown): string | null =>
    typeof field === "string" && field.trim() ? field.slice(0, HANDOFF_MAX_CHARS * 2) : null;
  const resume = pick(record["resume"]);
  const fresh = pick(record["fresh"]);
  if (!resume && !fresh) return null;
  return { resume, fresh };
}

// ── Conversation list ─────────────────────────────────────────────────────
//
// One history for every agent the user chats with — the only list
// implementation, behind both GET /agent-chat/conversations and the legacy
// per-agent GET /agent-chat/:slug/conversations. A direct chat the user
// switched agents in is ONE row naming every agent. Anything else (a Spaces
// thread, an awakening thread) keeps one row per agent, because those reads
// are per agent — a thread shares its id with a mentioned user's digital twin,
// and merging them would mix the two slices.
//
// Built in two steps so a page only pays for its own rows: entries come from
// one aggregate over chat_messages (cheap for the whole history), and titles
// and pins are resolved for just the entries on the page.

export interface ConversationAgentGroup {
  conversationId: string;
  agentSlug: string;
  firstAt: Date;
  lastAt: Date;
  count: number;
}

export interface ConversationMetaRow {
  conversationId: string;
  agentSlug: string;
  title: string | null;
  pinned: boolean;
}

export interface FirstUserMessageRow {
  conversationId: string;
  agentSlug: string;
  content: string;
}

/** A list row before its title and pin are resolved. */
export interface ConversationEntry {
  /** Unique per row: the conversation id, or `<id>:<agent>` for a per-agent row. */
  rowId: string;
  conversationId: string;
  lastMessageAt: Date;
  /** Every agent that answered, in first-use order (length 1 when only one). */
  agentSlugs: string[];
  /** The agent active most recently — the one to continue with. */
  latestAgentSlug: string;
  messageCount: number;
  /** Which agent's meta row holds this row's title and pin: a switched direct
   *  chat's home agent (first message), otherwise the row's own agent. */
  metaAgentSlug: string;
  /** Which agent's first user message the title falls back to; null = any agent. */
  fallbackAgentSlug: string | null;
}

export interface ConversationListRow {
  rowId: string;
  conversationId: string;
  title: string;
  titleGenerated: boolean;
  pinned: boolean;
  messageCount: number;
  lastMessageAt: Date;
  /** The agent to open and continue the conversation with: the one that was
   *  active most recently. */
  agentSlug: string;
  agentSlugs: string[];
}

export const CONVERSATION_PAGE_SIZE = 50;
export const CONVERSATION_PAGE_MAX = 100;
const TITLE_FALLBACK_CHARS = 80;

/** Newest activity first; the row id breaks ties so paging is deterministic. */
function newestFirst(a: { lastMessageAt: Date; rowId: string }, b: { lastMessageAt: Date; rowId: string }): number {
  const byTime = b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  if (byTime !== 0) return byTime;
  return a.rowId < b.rowId ? 1 : a.rowId > b.rowId ? -1 : 0;
}

/** Every list row of the user's history, newest first. */
export function conversationEntries(groups: ConversationAgentGroup[]): ConversationEntry[] {
  const direct = new Map<string, ConversationAgentGroup[]>();
  const entries: ConversationEntry[] = [];
  const entry = (
    rowId: string,
    conversationId: string,
    agents: ConversationAgentGroup[],
    fallbackAgentSlug: string | null,
  ): ConversationEntry => {
    const latest = agents.reduce((a, b) => (b.lastAt.getTime() > a.lastAt.getTime() ? b : a));
    return {
      rowId,
      conversationId,
      lastMessageAt: latest.lastAt,
      agentSlugs: agents.map((agent) => agent.agentSlug),
      latestAgentSlug: latest.agentSlug,
      messageCount: agents.reduce((sum, agent) => sum + agent.count, 0),
      metaAgentSlug: agents[0]!.agentSlug,
      fallbackAgentSlug,
    };
  };
  for (const group of groups) {
    if (!isChatConversation(group.conversationId)) continue;
    if (isDirectChatConversation(group.conversationId)) {
      const list = direct.get(group.conversationId) ?? [];
      list.push(group);
      direct.set(group.conversationId, list);
      continue;
    }
    entries.push(entry(`${group.conversationId}:${group.agentSlug}`, group.conversationId, [group], group.agentSlug));
  }
  for (const [conversationId, agents] of direct) {
    agents.sort((a, b) => a.firstAt.getTime() - b.firstAt.getTime());
    entries.push(entry(conversationId, conversationId, agents, null));
  }
  return entries.sort(newestFirst);
}

/** The key of the meta row holding an entry's title and pin. */
export function entryMetaKey(entry: ConversationEntry): string {
  return `${entry.conversationId}:${entry.metaAgentSlug}`;
}

/** Every agent in the history with how many rows it appears in, most recently
 *  active first — the agent filter's options, independent of filter and page. */
export function agentFacets(entries: ConversationEntry[]): Array<{ slug: string; count: number }> {
  const byAgent = new Map<string, number>();
  // Entries are newest first, so first sight is the agent's latest activity.
  for (const entry of entries) {
    for (const slug of entry.agentSlugs) byAgent.set(slug, (byAgent.get(slug) ?? 0) + 1);
  }
  return [...byAgent.entries()].map(([slug, count]) => ({ slug, count }));
}

/** Conversations whose entries' meta rows lack a title, so their first user
 *  message is needed. */
export function entriesNeedingFallbackTitle(entries: ConversationEntry[], meta: ConversationMetaRow[]): string[] {
  const titled = new Set<string>(meta.filter((m) => m.title).map((m) => `${m.conversationId}:${m.agentSlug}`));
  return [...new Set(entries.filter((e) => !titled.has(entryMetaKey(e))).map((e) => e.conversationId))];
}

/** Resolve entries into list rows, keeping their order. */
export function buildConversationList(args: {
  entries: ConversationEntry[];
  meta: ConversationMetaRow[];
  firstUserMessages: FirstUserMessageRow[];
}): ConversationListRow[] {
  const metaByKey = new Map<string, ConversationMetaRow>(args.meta.map((m) => [`${m.conversationId}:${m.agentSlug}`, m]));
  // Rows arrive oldest-first, so the first one seen per key is the earliest.
  const firstAny = new Map<string, string>();
  const firstByAgent = new Map<string, string>();
  for (const row of args.firstUserMessages) {
    if (!firstAny.has(row.conversationId)) firstAny.set(row.conversationId, row.content);
    const key = `${row.conversationId}:${row.agentSlug}`;
    if (!firstByAgent.has(key)) firstByAgent.set(key, row.content);
  }
  return args.entries.map((entry): ConversationListRow => {
    const meta = metaByKey.get(entryMetaKey(entry));
    const fallback = entry.fallbackAgentSlug
      ? firstByAgent.get(`${entry.conversationId}:${entry.fallbackAgentSlug}`)
      : firstAny.get(entry.conversationId);
    return {
      rowId: entry.rowId,
      conversationId: entry.conversationId,
      title: meta?.title ?? (fallback ?? "").slice(0, TITLE_FALLBACK_CHARS),
      titleGenerated: Boolean(meta?.title),
      pinned: meta?.pinned ?? false,
      messageCount: entry.messageCount,
      lastMessageAt: entry.lastMessageAt,
      agentSlug: entry.latestAgentSlug,
      agentSlugs: entry.agentSlugs,
    };
  });
}

interface PageCursor {
  lastMessageAt: Date;
  rowId: string;
}

function encodeCursor(item: { lastMessageAt: Date; rowId: string }): string {
  return Buffer.from(`${item.lastMessageAt.toISOString()}|${item.rowId}`, "utf8").toString("base64url");
}

/** Parse a page cursor; null for one this module did not mint. */
export function decodeCursor(raw: string): PageCursor | null {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const bar = text.indexOf("|");
  if (bar <= 0 || bar === text.length - 1) return null;
  const ms = Date.parse(text.slice(0, bar));
  if (!Number.isFinite(ms)) return null;
  return { lastMessageAt: new Date(ms), rowId: text.slice(bar + 1) };
}

/**
 * One page of a newest-first list: the first page carries every pinned item
 * (the list shows them above everything, however old) plus the `limit` newest
 * others; each later page continues the others after the cursor. A keyset
 * cursor rather than an offset, so a chat that moves to the top between loads
 * neither repeats nor pushes another one off the next page.
 */
export function selectPage<T extends { lastMessageAt: Date; rowId: string }>(
  items: T[],
  opts: { isPinned: (item: T) => boolean; limit: number; cursor: PageCursor | null },
): { items: T[]; nextCursor: string | null } {
  const { cursor } = opts;
  const others = items.filter((item) => !opts.isPinned(item));
  const start = cursor
    ? others.findIndex((item) => newestFirst(item, cursor) > 0)
    : 0;
  const page = start === -1 ? [] : others.slice(start, start + opts.limit);
  const hasMore = start !== -1 && start + opts.limit < others.length;
  const pinned = cursor ? [] : items.filter(opts.isPinned);
  return {
    items: [...pinned, ...page].sort(newestFirst),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  };
}
