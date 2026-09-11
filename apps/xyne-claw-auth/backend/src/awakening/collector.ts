/**
 * Collects everything that happened in the watched channels during a window.
 *
 * Two-stage by necessity: Message has no channelId column (only conversationId),
 * so we first find the threads a channel touched in the window, then page their
 * messages. Both stages are index-served —
 *   conversations: @@index([channelId, lastActivityAt])
 *   messages:      @@index([conversationId, createdAt, messageId])
 *
 * Stage 1 is prefiltered by `lastActivityAt >= windowStart - overlap` rather
 * than by message time. A thread whose last activity predates the window
 * cannot contain a message inside it, so this is a safe and very large cut.
 *
 * Every read is bounded (see spaces-read.ts) and the whole collection is capped
 * at config.limits.maxEvents. Hitting the cap sets `truncated`, which the
 * renderer surfaces to the agent — a silent cut would read as "quiet window".
 */

import { boundedInteract, pageBounded, SPACES_MAX_TAKE } from "./spaces-read.js";
import { messageToText, threadTitleFrom } from "./message-text.js";
import type { AgentSpacesIdentity, ResolvedChannel, WindowEvent } from "./types.js";
import type { AwakeningConfig } from "./config.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-collector");

const MESSAGE_PAGE = 500;
const CONVERSATION_PAGE = 500;

interface RawConversation {
  conversationId: string;
  channelId: string;
  initialMessageId: string;
  initial_message_md: string | null;
  createdAt: string;
}

interface RawMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  msgType: string;
  edited: boolean;
  createdAt: string;
}

interface RawUser {
  id: string;
  name: string | null;
  email: string | null;
}

/** Words that mark a message as needing someone to do something. */
const ACTION_PATTERNS: Array<{ signal: string; re: RegExp }> = [
  { signal: "urgent", re: /\b(urgent|asap|immediately|right away)\b/i },
  { signal: "blocked", re: /\b(blocked|blocker|stuck|can'?t proceed)\b/i },
  { signal: "escalation", re: /\b(p0|p1|sev1|sev-1|escalat\w*|outage|incident)\b/i },
  { signal: "request", re: /\b(can someone|could someone|who can|please (?:help|review|check|look))\b/i },
];

function detectActionSignals(text: string): string[] {
  return ACTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.signal);
}

function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text.trim()) || /^(who|what|when|where|why|how|is|are|can|should|does|did)\b/i.test(text.trim());
}

/**
 * Spaces renders a mention as the user id inside the message body. Matching on
 * the raw id is deliberate: display names change, ids do not.
 */
function mentionsUser(text: string, userId: string): boolean {
  return userId.length > 0 && text.includes(userId);
}

function titleOf(conv: RawConversation | undefined): string {
  return threadTitleFrom(conv?.initial_message_md);
}

/**
 * Resolve display names for the senders in a window.
 *
 * A separate query because the Spaces query AST supports neither `select` nor
 * `include` — QueryASTSchema drops both, so a relation select is silently a
 * no-op and every row comes back whole. Names matter: an artifact full of raw
 * cuids is unreadable, and the agent cannot address anyone by name.
 *
 * Best-effort. If the lookup fails the window still renders, just with ids.
 */
async function resolveSenderNames(
  messages: RawMessage[],
  auth: { token: string; workspaceId: string },
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(messages.map((m) => m.senderId).filter(Boolean))];
  if (ids.length === 0) return names;

  try {
    const users = await boundedInteract<RawUser[]>(
      {
        model: "user",
        operation: "findMany",
        where: { id: { in: ids } },
        take: Math.min(ids.length, SPACES_MAX_TAKE),
      },
      auth,
    );
    for (const u of users) {
      const label = u.name?.trim() || u.email?.trim();
      if (u.id && label) names.set(u.id, label);
    }
  } catch (err) {
    log.warn(`[awakening] sender name lookup failed; falling back to ids: ${err instanceof Error ? err.message : err}`);
  }
  return names;
}

export interface CollectResult {
  events: WindowEvent[];
  truncated: boolean;
  activeChannels: Set<string>;
}

/**
 * Pull the window's messages for the given channels.
 * Returns events in chronological order with `L` left at 0 — the renderer
 * assigns line numbers once the final ordering is fixed.
 */
export async function collectWindow(
  channels: ResolvedChannel[],
  startMs: number,
  endMs: number,
  identity: AgentSpacesIdentity,
  config: AwakeningConfig,
): Promise<CollectResult> {
  const auth = { token: identity.appToken, workspaceId: identity.workspaceId };
  const activeChannels = new Set<string>();
  if (channels.length === 0) return { events: [], truncated: false, activeChannels };

  const channelNameById = new Map(channels.map((c) => [c.id, c.name]));
  const overlapStart = new Date(startMs - config.cursor.overlapMs).toISOString();

  const conversations = await boundedInteract<RawConversation[]>(
    {
      model: "conversation",
      operation: "findMany",
      where: {
        channelId: { in: channels.map((c) => c.id) },
        lastActivityAt: { gte: overlapStart },
      },
      orderBy: [{ lastActivityAt: "desc" }],
      take: Math.min(config.limits.maxActiveThreads, CONVERSATION_PAGE),
    },
    auth,
  );

  if (conversations.length === 0) return { events: [], truncated: false, activeChannels };

  const convById = new Map(conversations.map((c) => [c.conversationId, c]));
  const messages = await pageBounded<RawMessage>(
    {
      model: "message",
      operation: "findMany",
      where: {
        conversationId: { in: conversations.map((c) => c.conversationId) },
        createdAt: { gt: new Date(startMs).toISOString(), lte: new Date(endMs).toISOString() },
        isDeleted: { equals: false },
      },
      orderBy: [{ createdAt: "asc" }, { messageId: "asc" }],
    },
    auth,
    config.limits.maxEvents + 1,
    MESSAGE_PAGE,
    // Keyset resume: strictly after (createdAt, messageId) of the last row.
    (last) => ({
      OR: [
        { createdAt: { gt: last.createdAt } },
        { AND: [{ createdAt: { equals: last.createdAt } }, { messageId: { gt: last.messageId } }] },
      ],
    }),
  );

  const senderNames = await resolveSenderNames(messages, auth);
  const truncated = messages.length > config.limits.maxEvents;
  const capped = truncated ? messages.slice(0, config.limits.maxEvents) : messages;
  if (truncated) {
    log.warn(
      `[awakening] window truncated at maxEvents=${config.limits.maxEvents} for agent=${identity.spacesAppUserId}`,
    );
  }

  const events: WindowEvent[] = capped.map((m) => {
    const conv = convById.get(m.conversationId);
    const channelId = conv?.channelId ?? "";
    // Two forms of the body: the stored HTML, and readable text. Signals and
    // the artifact use the text; the mention check stays on the RAW html
    // because that is where a mention's user id lives as a span attribute —
    // and it still matches after conversion, which preserves the id.
    const rawContent = (m.content ?? "").trim();
    const text = messageToText(rawContent);
    const isMe = m.senderId === identity.spacesAppUserId;
    if (channelId) activeChannels.add(channelId);

    return {
      L: 0,
      kind: "message",
      at: new Date(m.createdAt).toISOString(),
      atMs: new Date(m.createdAt).getTime(),
      id: m.messageId,
      ch: channelId,
      chName: channelNameById.get(channelId) ?? "",
      cv: m.conversationId,
      cvTitle: titleOf(conv),
      sender: senderNames.get(m.senderId) ?? m.senderId,
      senderId: m.senderId,
      isHuman: m.msgType === "USER" && !isMe,
      isMe,
      root: conv?.initialMessageId === m.messageId,
      mentionsMe: mentionsUser(rawContent, identity.spacesAppUserId),
      unanswered: false,
      covered: false,
      coveredBy: null,
      question: isQuestion(text),
      actionSignals: detectActionSignals(text),
      edited: Boolean(m.edited),
      chars: text.length,
      text,
    };
  });

  markUnanswered(events);
  return { events, truncated, activeChannels };
}

/**
 * Mark the last event of each thread as unanswered when it is a human message
 * — i.e. somebody said something and nobody (human or agent) followed up
 * inside this window. This is the single most load-bearing signal for deciding
 * whether an agent has anything useful to do.
 */
export function markUnanswered(events: WindowEvent[]): void {
  const lastByThread = new Map<string, WindowEvent>();
  for (const e of events) {
    const prev = lastByThread.get(e.cv);
    if (!prev || e.atMs >= prev.atMs) lastByThread.set(e.cv, e);
  }
  for (const last of lastByThread.values()) {
    if (last.isHuman) last.unanswered = true;
  }
}
