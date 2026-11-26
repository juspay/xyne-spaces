/**
 * X polling: fills what the activity stream missed (it has no replay on self-serve) and powers the
 * desk's manual sync. Everything polled maps to the same externalIds as the stream, so overlap
 * with streamed items is deduplicated by ingest.
 *
 * Budgets (X limits per user, per 15 min): mentions 450, DM events 15 — so every run is capped and
 * reports whether it covered its whole window; an incomplete run must not advance the cursor.
 */
import type { ExternalSource } from '@prisma/client';
import { logger } from '@/utils/logger';
import { xApiClient, type XApiClient } from './client';
import { fromPolledDms, fromPolledPosts } from './normalizer';
import { parseXCredentials, xchatAccountFor, xTokenService, type XTokenService } from './tokenService';
import type { XInboundItem, XPost, XUser } from './types';
import { xchatService, type XChatService } from './xchat';

const TAG = '[XPoller]';

export const X_POLL_LIMITS = {
  mentionPages: 5, // × 100
  dmPages: 2, // × 100; DM events allow 15 calls / 15 min per user
  chatConversations: 30, // one events call each
  /** Consecutive conversations with nothing in the window before the scan stops. */
  chatQuietStop: 3,
} as const;

export interface XPollWindow {
  start: Date;
  end?: Date;
}

export interface XPollResult {
  items: XInboundItem[];
  /** False when a cap stopped a run before it reached the window start. */
  complete: boolean;
}

const inWindow = (at: Date, w: XPollWindow) => at >= w.start && (!w.end || at <= w.end);

export class XPoller {
  constructor(
    private readonly client: XApiClient = xApiClient,
    private readonly tokens: XTokenService = xTokenService,
    private readonly xchat: XChatService = xchatService,
  ) {}

  async poll(source: ExternalSource, window: XPollWindow): Promise<XPollResult> {
    const creds = parseXCredentials(source.credentials);
    // Each part keeps what it fetched even if another fails (e.g. the DM endpoint's 15-per-15-min
    // limit returns 429): a failed part only makes the run incomplete, so the cursor stays put.
    const names = ['mentions', 'dms', 'chats'] as const;
    const settled = await Promise.allSettled([
      this.mentions(source, creds.xUserId, window),
      this.dms(source, creds.xUserId, window),
      this.chats(source, creds.xUserId, window),
    ]);
    const parts: XPollResult[] = [];
    const failures: unknown[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        parts.push(outcome.value);
        return;
      }
      failures.push(outcome.reason);
      logger.warn(`${TAG} Poll part failed`, { sourceId: source.id, part: names[i], error: String(outcome.reason) });
    });
    // Nothing worked at all: surface it rather than report an empty, "successful" sync.
    if (parts.length === 0) throw failures[0];
    const result = {
      items: parts.flatMap((p) => p.items),
      complete: failures.length === 0 && parts.every((p) => p.complete),
    };
    logger.info(`${TAG} Polled`, {
      sourceId: source.id,
      start: window.start.toISOString(),
      items: result.items.length,
      complete: result.complete,
    });
    return result;
  }

  /** Mentions timeline (includes replies to the brand), oldest page last. */
  private async mentions(source: ExternalSource, xUserId: string, window: XPollWindow): Promise<XPollResult> {
    const posts: XPost[] = [];
    const users: XUser[] = [];
    let token: string | undefined;
    for (let page = 0; page < X_POLL_LIMITS.mentionPages; page++) {
      const res = await this.tokens.withUserToken(source, (t) =>
        this.client.getMentions(t, xUserId, { startTime: window.start.toISOString(), paginationToken: token }),
      );
      posts.push(...(res.data ?? []));
      users.push(...(res.includes?.users ?? []));
      token = res.meta.next_token;
      if (!token) break;
    }
    const items = fromPolledPosts(
      posts.filter((p) => !p.created_at || inWindow(new Date(p.created_at), window)),
      users,
      xUserId,
    );
    return { items, complete: !token };
  }

  /** Legacy DMs: newest first with no time filter, so page until past the window start. */
  private async dms(source: ExternalSource, xUserId: string, window: XPollWindow): Promise<XPollResult> {
    const items: XInboundItem[] = [];
    let token: string | undefined;
    for (let page = 0; page < X_POLL_LIMITS.dmPages; page++) {
      const res = await this.tokens.withUserToken(source, (t) => this.client.getDmEvents(t, { paginationToken: token }));
      const events = res.data ?? [];
      const fresh = events.filter((e) => e.created_at && inWindow(new Date(e.created_at), window));
      items.push(...fromPolledDms(fresh, res.includes?.users, xUserId));
      const oldest = events[events.length - 1]?.created_at;
      token = res.meta.next_token;
      if (!token || (oldest && new Date(oldest) < window.start)) return { items, complete: true };
    }
    return { items, complete: false };
  }

  /**
   * XChat: conversations, then each conversation's newest events. Event timestamps and senders are
   * not encrypted, so only new customer messages (plus the key changes) are decrypted. Skipped
   * when XChat is not enabled for the source — the stream still records those as placeholders.
   */
  private async chats(source: ExternalSource, xUserId: string, window: XPollWindow): Promise<XPollResult> {
    const account = xchatAccountFor(source, this.tokens);
    if (!account) return { items: [], complete: true };

    const conversations = await this.tokens.withUserToken(source, (t) =>
      this.client.listChatConversations(t, { maxResults: X_POLL_LIMITS.chatConversations }),
    );
    const items: XInboundItem[] = [];
    let quiet = 0;
    let reachedEnd = !conversations.meta?.has_more;
    let truncated = false;
    for (const conversation of conversations.data ?? []) {
      if (conversation.type !== 'direct') continue;
      const page = await this.tokens.withUserToken(source, (t) => this.client.getChatEvents(t, conversation.id, { maxResults: 50 }));
      const fresh = (page.data ?? []).filter(
        (e) => e.encoded_event && e.sender_id !== xUserId && e.created_at && inWindow(new Date(e.created_at), window),
      );
      // One page per conversation: if it is entirely inside the window and X has more, older
      // messages in the window were not read.
      const events = page.data ?? [];
      const oldest = events[events.length - 1]?.created_at;
      if (page.meta?.next_token && oldest && new Date(oldest) >= window.start) truncated = true;
      if (fresh.length === 0) {
        if (++quiet >= X_POLL_LIMITS.chatQuietStop) {
          reachedEnd = true; // assumes most-recent-first ordering (observed, not documented)
          break;
        }
        continue;
      }
      quiet = 0;
      const { messages } = await this.xchat.decrypt(account, [
        ...(page.meta?.conversation_key_events ?? []),
        ...fresh.map((e) => e.encoded_event as string),
      ]);
      items.push(
        ...messages.map((m) => ({
          kind: 'dm' as const,
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          text: m.text,
          createdAt: m.createdAt,
          channel: 'xchat' as const,
        })),
      );
    }
    return { items, complete: reachedEnd && !truncated };
  }
}

export const xPoller = new XPoller();
