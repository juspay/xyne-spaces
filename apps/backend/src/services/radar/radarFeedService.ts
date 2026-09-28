import { DatabaseClient } from '@/database/client';
import {
  canAccessConversation,
  viewerAccessibleChannelIds,
  viewerChannelAccess,
} from '@/services/radar/radarAcl';
import { radarScopeFor, scopeKeyFor, type RadarScope } from '@/services/radar/radarScope';
import { explainItemMute, mutedItemIds } from '@/services/radar/radarRuleEvaluator';
import { compile } from 'html-to-text';
import { replaceCustomEmojiImagesWithAltText } from '@/utils/contentUtils';

const prisma = DatabaseClient.getInstance();

/** Feeds page per thread-card, not per item; this bounds what the viewer sees. */
export const MAX_FEED_ITEMS = 500;
/** The Muted drawer's own budget, spent separately from the live list's, so a
 *  rule can neither crowd out the feed nor be crowded out of the drawer. */
export const MAX_MUTED_ITEMS = 500;
/** Over-fetch: capping before the ACL filter would silently shorten the feed. */
export const FEED_SCAN_LIMIT = MAX_FEED_ITEMS * 4;
const THREAD_PREVIEW_CHARS = 200;
/** Worker runs shown in one thread's debug drawer, newest first. */
const MAX_DEBUG_RUNS = 50;

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Tags the rich editor writes. Matching only these keeps markdown such as a
 *  `<https://…>` autolink, or prose like "use <select>", out of the converter,
 *  which would otherwise drop it as an unknown tag. */
const EDITOR_HTML = /<\/?(p|div|span|br|ul|ol|li|a|strong|b|em|i|u|s|code|pre|blockquote|h[1-6]|img)\b[^>]*>/i;
/** How much of an HTML message is converted: enough to fill the preview after
 *  markup is stripped, without parsing a long message to keep 200 characters. */
const PREVIEW_SOURCE_CHARS = THREAD_PREVIEW_CHARS * 10;
/** Built once — a feed read converts every card's opening message, and
 *  rebuilding the options per call dominated the cost. Only the text matters
 *  for a one-line preview: links keep their label, images drop out, headings
 *  keep their case. */
const htmlToPreviewText = compile({
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map(selector => ({
      selector,
      options: { uppercase: false },
    })),
  ],
});
const previewTextOf = (html: string): string => {
  try {
    return htmlToPreviewText(replaceCustomEmojiImagesWithAltText(html));
  } catch {
    return stripHtml(html);
  }
};

/** A thread's opening message as a one-line headline. Rich-editor messages are
 *  stored as HTML with escaped entities, so they are converted to text before
 *  the cut — cutting first could end mid-tag. A `:::initialMessage` block is
 *  not converted, only cut like plain text; the panel sees it is cut short and
 *  falls back to the item's title. */
const threadPreviewOf = (md: string | null | undefined): string | null => {
  if (!md) return null;
  const isHtml = !md.trimStart().startsWith(':::initialMessage') && EDITOR_HTML.test(md);
  const text = isHtml
    ? previewTextOf(md.slice(0, PREVIEW_SOURCE_CHARS)).replace(/\s+/g, ' ').trim()
    : md;
  return text.slice(0, THREAD_PREVIEW_CHARS) || null;
};

interface AuthContext {
  userId: string;
  workspaceId: string;
  /** Required: the ACL needs it to tell a guest from a member. */
  role: string;
}

export interface FeedItem {
  id: string;
  conversationId: string;
  channelId: string;
  sourceMessageId: string;
  title: string;
  contextSummary: string | null;
  requestedBy: string[];
  pendingOn: string[];
  /** User groups the source message @mentioned, stamped at parse time. */
  mentionedGroupIds: string[];
  createdAt: Date;
  updatedAt: Date;
  /** True when one of the VIEWER's own rules mutes this item. Decided per read
   *  and never stored — one item is a single row several people can see, and an
   *  edited rule must re-answer for every item. */
  muted: boolean;
}

/** The conversation columns the feed needs, read once per request. */
interface FeedConversation {
  conversationId: string;
  channelId: string;
  initial_message_md: string | null;
  lastActivityAt: Date;
  /** Decides whether this conversation is a card of its own or folds into its channel. */
  scopeType: string | null;
}

/** One page of Pending Others, filtered on the server. */
export interface PendingOthersPageQuery {
  /** Zero-based; clamped to the last page. */
  page: number;
  /** The Muted drawer's own page, over the muted half of the same list. */
  mutedPage: number;
  pageSize: number;
  /** Keep a thread when any of its items is held by one of these. */
  holderIds: string[];
  /** Keep a thread in one of these channels. */
  channelIds: string[];
  /** Keep a thread whose earliest item was raised in this window. */
  createdFrom: Date | null;
  createdTo: Date | null;
}

export interface PendingOthersPage {
  threads: FeedThreadCard[];
  totalThreads: number;
  page: number;
  mutedThreads: FeedThreadCard[];
  mutedTotalThreads: number;
  mutedItemCount: number;
  mutedPage: number;
  /** Unmuted open items left after the filters — the tab's badge. */
  openItemCount: number;
  /** What the pickers offer. Holders come from the whole feed, channels from the
   *  feed after the holder filter — each ignores its own selection, so ticking
   *  one option never hides the rest. */
  facets: { holderIds: string[]; channelIds: string[] };
}

export interface FeedThreadCard {
  /**
   * What this card IS: a thread, or a whole DM. Bulk actions address the card
   * through this, since a DM card spans several conversations and a
   * conversation-scoped call would clear only one of them.
   */
  scopeKey: string;
  /** Representative conversation — the most recently updated item's. Per-item
   *  navigation uses the item's own conversationId, not this. */
  conversationId: string;
  channelId: string;
  threadPreview: string | null;
  lastActivityAt: Date | null;
  items: FeedItem[];
}

/**
 * The GIN-backed reads the engine exists to serve:
 *
 * - Pending Me: pendingOn ∋ me.
 * - Waiting On: requestedBy ∋ me, minus items I also hold. An ownerless item
 *   (pendingOn: []) stays here — tracked, nobody on the hook yet.
 * - Pending Others: held by someone who is not me, whoever asked — plus my
 *   own ownerless asks, so it is a superset of Waiting On.
 */
class RadarFeedService {
  async pendingMe(auth: AuthContext): Promise<FeedThreadCard[]> {
    return this.buildFeed(auth, { pendingOn: { has: auth.userId } });
  }

  async waitingOn(auth: AuthContext): Promise<FeedThreadCard[]> {
    return this.buildFeed(auth, {
      requestedBy: { has: auth.userId },
      NOT: { pendingOn: { has: auth.userId } },
    });
  }

  /**
   * Where Waiting On answers "what have I chased", this answers "what is this
   * team holding" — every open item held by someone else, whoever asked, plus
   * the viewer's own asks that nobody holds yet, since this is the only feed
   * fetched in All mode and an ownerless ask is still the viewer's.
   *
   * It covers Waiting On only while the workspace fits inside the cap. This
   * scan is workspace-wide and capped at MAX_FEED_ITEMS by recency, where the
   * other two are GIN-scoped to the viewer and so are effectively unbounded
   * for one person. Past that, an old ownerless ask of the viewer's is visible
   * under "requested by me" and missing here, and a team narrows only what
   * reached the workspace-wide window — silently, with nothing saying the feed
   * was truncated.
   *
   * The other feeds name the viewer in a GIN predicate, so their scan window
   * is about the viewer by construction. This one is not, so the viewer's
   * channel rule goes into the WHERE as a channel id list — a leading
   * predicate the (channelId, status) index can drive off, which a relation
   * filter through each item's conversation could not. The bound has to be
   * there at all because the scan is capped: a row dropped by the cap can
   * never be put back by the check that runs after it.
   *
   * item.channelId is safe to scope on: reparenting a thread rewrites it in
   * the same transaction that moves the conversation. The Jira migration is
   * the one path that moves a conversation without it, so an item it touched
   * could be missed here — never wrongly shown, since viewerChannelAccess
   * still resolves through the conversation afterwards.
   *
   * An item the viewer stepped away from that a colleague still holds belongs
   * here: Dismiss changes who is on the hook, not what the viewer may see.
   */
  async pendingOthers(auth: AuthContext): Promise<FeedThreadCard[]> {
    const scoped = await viewerAccessibleChannelIds(auth);
    return this.buildFeed(
      auth,
      {
        channelId: { in: scoped },
        NOT: { pendingOn: { has: auth.userId } },
        OR: [{ pendingOn: { isEmpty: false } }, { requestedBy: { has: auth.userId } }],
      },
      scoped
    );
  }

  /**
   * Pending Others one page at a time. This is the one workspace-wide feed, so
   * sending all of it to be filtered and paged in the browser meant every load
   * shipped up to a thousand items to draw five threads.
   *
   * The filters are applied to whole threads, after grouping — the same as the
   * panel did: a thread is kept when any of its items matches, and keeps all
   * of its items. Pushing the holder filter into the WHERE would instead drop a
   * matching thread's other items. Mute rules still run here rather than in
   * SQL (keyword rules match item text), so the scan itself stays bounded by
   * FEED_SCAN_LIMIT; what shrinks is everything after it: the thread previews
   * are read for the page only, and the response is one page.
   */
  async pendingOthersPage(
    auth: AuthContext,
    query: PendingOthersPageQuery
  ): Promise<PendingOthersPage> {
    const scoped = await viewerAccessibleChannelIds(auth);
    const items = await this.openItems(auth, {
      channelId: { in: scoped },
      NOT: { pendingOn: { has: auth.userId } },
      OR: [{ pendingOn: { isEmpty: false } }, { requestedBy: { has: auth.userId } }],
    });
    const empty: PendingOthersPage = {
      threads: [],
      totalThreads: 0,
      page: 0,
      mutedThreads: [],
      mutedTotalThreads: 0,
      mutedItemCount: 0,
      mutedPage: 0,
      openItemCount: 0,
      facets: { holderIds: [], channelIds: [] },
    };
    if (items.length === 0) return empty;
    const conversations = await this.conversationsFor(
      items.map((i) => i.conversationId),
      { withPreview: false }
    );
    const allowed = await this.aclFilter(auth, items, conversations, scoped);
    const muted = await mutedItemIds(
      auth,
      allowed.map((i) => ({
        ...i,
        channelId: conversations.get(i.conversationId)?.channelId ?? i.channelId,
      }))
    );
    for (const item of allowed) item.muted = muted.has(item.id);

    let cards = this.groupByThread(allowed, conversations);
    const holderIds = [...new Set(allowed.flatMap((i) => i.pendingOn))];

    if (query.holderIds.length) {
      const holders = new Set(query.holderIds);
      cards = cards.filter((c) => c.items.some((i) => i.pendingOn.some((id) => holders.has(id))));
    }
    const channelIds = [...new Set(cards.map((c) => c.channelId))];

    if (query.createdFrom || query.createdTo) {
      // When the item was raised, not when the thread was last touched.
      const from = query.createdFrom?.getTime() ?? 0;
      const to = query.createdTo?.getTime() ?? Infinity;
      cards = cards.filter((c) => {
        const t = Math.min(...c.items.map((i) => i.createdAt.getTime()));
        return t >= from && t <= to;
      });
    }
    if (query.channelIds.length) {
      const channels = new Set(query.channelIds);
      cards = cards.filter((c) => channels.has(c.channelId));
    }

    // A thread whose items disagree is split, as the panel did: the asks inside
    // a thread are the unit of attention, not the thread.
    const live: FeedThreadCard[] = [];
    const hushed: FeedThreadCard[] = [];
    let mutedItemCount = 0;
    for (const card of cards) {
      const kept = card.items.filter((i) => !i.muted);
      const quiet = card.items.filter((i) => i.muted);
      if (kept.length) live.push({ ...card, items: kept });
      if (quiet.length) {
        hushed.push({ ...card, items: quiet });
        mutedItemCount += quiet.length;
      }
    }
    // Newest of the thread's own activity and its items' updates.
    const activity = (c: FeedThreadCard): number =>
      Math.max(c.lastActivityAt?.getTime() ?? 0, ...c.items.map((i) => i.updatedAt.getTime()));
    live.sort((a, b) => activity(b) - activity(a));
    hushed.sort((a, b) => activity(b) - activity(a));

    const slice = (list: FeedThreadCard[], page: number) => {
      const last = Math.max(0, Math.ceil(list.length / query.pageSize) - 1);
      const at = Math.min(Math.max(0, page), last);
      return { at, rows: list.slice(at * query.pageSize, (at + 1) * query.pageSize) };
    };
    const livePage = slice(live, query.page);
    const mutedPage = slice(hushed, query.mutedPage);
    await this.attachPreviews([...livePage.rows, ...mutedPage.rows]);

    return {
      threads: livePage.rows,
      totalThreads: live.length,
      page: livePage.at,
      mutedThreads: mutedPage.rows,
      mutedTotalThreads: hushed.length,
      mutedItemCount,
      mutedPage: mutedPage.at,
      openItemCount: live.reduce((n, c) => n + c.items.length, 0),
      facets: { holderIds, channelIds },
    };
  }

  /** Thread previews for the cards actually being sent. A DM card spans
   *  conversations and has no single opening message, so it stays null. */
  private async attachPreviews(cards: FeedThreadCard[]): Promise<void> {
    const threadCards = cards.filter((c) => c.scopeKey === c.conversationId);
    if (threadCards.length === 0) return;
    const rows = await prisma.conversation.findMany({
      where: { conversationId: { in: [...new Set(threadCards.map((c) => c.conversationId))] } },
      select: { conversationId: true, initial_message_md: true },
    });
    const byId = new Map(rows.map((r) => [r.conversationId, r.initial_message_md]));
    for (const card of threadCards) {
      card.threadPreview = threadPreviewOf(byId.get(card.conversationId));
    }
  }

  /**
   * Read items, narrow to what the viewer may open, group into thread cards.
   *
   * The conversation rows are fetched ONCE and threaded through both halves:
   * the ACL filter needs channelId, the card builder needs the preview and
   * last activity, and fetching them separately meant two queries against the
   * same table with overlapping ids in a single request.
   */
  private async buildFeed(
    auth: AuthContext,
    filter: Record<string, unknown>,
    /** Channel ids the caller already resolved for the scan bound, so the
     *  post-query check does not repeat the lookup. */
    scopedChannelIds?: string[]
  ): Promise<FeedThreadCard[]> {
    const items = await this.openItems(auth, filter);
    if (items.length === 0) return [];
    const conversations = await this.conversationsFor(items.map((i) => i.conversationId));
    const allowed = await this.aclFilter(auth, items, conversations, scopedChannelIds);
    // After the ACL, never before: an item the viewer may not open is not
    // theirs to have an opinion about, and evaluating it would be work spent on
    // rows that are about to be thrown away. But BEFORE the page cap, so a
    // broad rule cannot spend the budget on rows the reader asked to tuck away
    // and push the ones they want past the end of the window.
    // Judged on the channel the CONVERSATION is in, which is what the ACL just
    // resolved against. item.channelId is kept in sync by the reparent path
    // (conversationRepository moves it in the same transaction as the
    // conversation), but the Jira migration moves a conversation without it —
    // so a channel rule reads the same source the permission check did rather
    // than a column with one known stale path.
    const muted = await mutedItemIds(
      auth,
      allowed.map((i) => ({
        ...i,
        channelId: conversations.get(i.conversationId)?.channelId ?? i.channelId,
      }))
    );
    for (const item of allowed) item.muted = muted.has(item.id);
    const visible = this.capByVerdict(allowed);
    return this.groupByThread(visible, conversations);
  }

  /**
   * Two independent budgets, not one shared pool. Sharing it meant either a
   * broad rule spending the live list's room on rows the reader tucked away,
   * or — once the live list was served first — a reader at the cap seeing an
   * empty Muted drawer, which reads as "no rule matched anything" rather than
   * "the budget ran out". Separate budgets can do neither.
   *
   * The cap bounds the response, it does not rank, so kept rows stay in
   * recency order. Worst case is MAX_FEED_ITEMS + MAX_MUTED_ITEMS rows.
   */
  private capByVerdict(items: FeedItem[]): FeedItem[] {
    if (items.length <= MAX_FEED_ITEMS) return items;
    const keep = new Set<string>();
    let live = 0;
    let hushed = 0;
    for (const item of items) {
      if (item.muted) {
        if (hushed < MAX_MUTED_ITEMS) {
          keep.add(item.id);
          hushed += 1;
        }
      } else if (live < MAX_FEED_ITEMS) {
        keep.add(item.id);
        live += 1;
      }
    }
    return items.filter((i) => keep.has(i.id));
  }

  /**
   * Viewer channel ACL over the whole feature: even the viewer's own feeds
   * are narrowed to channels they may open — being mentioned in a private
   * channel they're not part of must not leak that thread through a card.
   */
  private async aclFilter(
    auth: AuthContext,
    items: FeedItem[],
    conversations: Map<string, FeedConversation>,
    scopedChannelIds?: string[]
  ): Promise<FeedItem[]> {
    if (items.length === 0) return items;
    // Resolve each item's channel from its conversation rather than from
    // item.channelId. The reparent path does keep that column in sync — see
    // conversationRepository, which moves it in the same transaction — but the
    // Jira migration moves a conversation without it, and the conversation is
    // the row the permission actually belongs to. An item whose conversation
    // has since vanished is denied.
    const access = await viewerChannelAccess(
      auth,
      [...conversations.values()].map((c) => c.channelId),
      scopedChannelIds
    );
    // Not capped here: buildFeed caps after classifying, so the budget goes to
    // rows the reader wants rather than to whatever was newest.
    return items.filter((i) => {
      const channelId = conversations.get(i.conversationId)?.channelId;
      return channelId ? access.get(channelId)?.allowed : false;
    });
  }

  /**
   * conversationId -> everything the feed needs from the conversation row, in
   * one query: the channel for the ACL check, plus the preview and activity
   * stamp the cards render.
   */
  private async conversationsFor(
    conversationIds: string[],
    /** The opening message is the heaviest column here; a paged read fetches
     *  it afterwards for the page's threads only. */
    { withPreview = true }: { withPreview?: boolean } = {}
  ): Promise<Map<string, FeedConversation>> {
    const unique = [...new Set(conversationIds)];
    if (unique.length === 0) return new Map();
    const conversations = await prisma.conversation.findMany({
      where: { conversationId: { in: unique } },
      select: {
        conversationId: true,
        channelId: true,
        initial_message_md: withPreview,
        lastActivityAt: true,
        channel: { select: { scopeType: true } },
      },
    });
    return new Map(
      conversations.map((c) => [
        c.conversationId,
        { ...c, scopeType: c.channel?.scopeType ?? null },
      ])
    );
  }

  /**
   * The parse scope a conversation belongs to. Run logs and the watermark are
   * keyed by scope, not by conversation, so a DM's debug view has to resolve
   * its channel before it can find either.
   */
  private async scopeOf(conversationId: string): Promise<RadarScope | null> {
    const conversation = await prisma.conversation.findUnique({
      where: { conversationId },
      select: { channelId: true, channel: { select: { scopeType: true } } },
    });
    if (!conversation?.channelId) return null;
    return radarScopeFor(
      conversation.channel?.scopeType ?? null,
      conversation.channelId,
      conversationId
    );
  }

  /**
   * Debug panel, per-item trail: the item row, its append-only mutation
   * history (who did what, when), the actual messages that produced each
   * mutation, and where the thread's watermark currently sits relative to
   * its latest message.
   */
  async debugItemTrail(auth: AuthContext, itemId: string) {
    const item = await prisma.executionItem.findUnique({ where: { id: itemId } });
    if (!item || item.workspaceId !== auth.workspaceId) return null;
    // Authorize against the conversation, not item.channelId: the reparent path
    // keeps that column in sync, but the Jira migration does not, and the
    // conversation is the row the permission belongs to.
    if (!(await canAccessConversation(auth, item.conversationId))) return null;
    const mutations = await prisma.executionItemMutation.findMany({
      where: { itemId },
      orderBy: { createdAt: 'asc' },
    });

    const messageIds = [
      ...new Set(
        [item.sourceMessageId, ...mutations.map((m) => m.sourceMessageId)].filter(
          (id): id is string => !!id
        )
      ),
    ];
    const messages = messageIds.length
      ? await prisma.message.findMany({
          where: { messageId: { in: messageIds } },
          select: {
            messageId: true,
            senderId: true,
            content: true,
            createdAt: true,
            sender: { select: { name: true } },
          },
        })
      : [];
    const sourceMessages = Object.fromEntries(
      messages.map((m) => [
        m.messageId,
        {
          senderId: m.senderId,
          senderName: m.sender?.name ?? 'Unknown',
          text: stripHtml(m.content).slice(0, 300),
          createdAt: m.createdAt,
        },
      ])
    );

    const itemScope = await this.scopeOf(item.conversationId);
    const [threadState, latestMessage] = await Promise.all([
      prisma.executionThreadState.findUnique({
        where: { conversationId: itemScope?.key ?? item.conversationId },
        select: { watermarkCreatedAt: true, watermarkMsgId: true, updatedAt: true },
      }),
      prisma.message.findFirst({
        where: {
          ...(itemScope?.isDmChannel
            ? { conversation: { channelId: itemScope.channelId } }
            : { conversationId: item.conversationId }),
          isDeleted: false,
        },
        orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
        select: { messageId: true, createdAt: true },
      }),
    ]);

    // The asking viewer's own answer and the rules behind it. Not a property of
    // the item — somebody else opening this trail sees their own. Judged on the
    // conversation's channel, the same source the feed uses, so the drawer
    // cannot explain a verdict the feed did not reach.
    const rules = await explainItemMute(auth, {
      ...item,
      channelId: itemScope?.channelId ?? item.channelId,
    });

    return { item, mutations, sourceMessages, threadState, latestMessage, rules };
  }

  /**
   * Debug panel: the most recent worker runs, newest first. When scoped to
   * one thread, also reports the watermark ("processed till here") relative
   * to the thread's latest message.
   *
   * Thread-scoped ONLY, deliberately. This used to accept no conversationId
   * and return the workspace's newest runs across every thread. That listing
   * was ACL-filtered, but it was still a cross-thread window over assessments
   * and parser payloads handed to any authenticated caller — and nothing ever
   * called it, since the drawer always opens on one thread. It also filtered
   * AFTER taking the newest N, so a viewer in few channels could get an empty
   * list while runs existed. Requiring the id removes all of that.
   */
  async debugRuns(auth: AuthContext, conversationId: string) {
    // ACL first: a pasted conversationId must not open a thread the viewer
    // couldn't reach through chat itself. Denied and unknown look identical.
    if (!(await canAccessConversation(auth, conversationId))) {
      return null;
    }

    // Runs, watermark and "latest message" are all scope-keyed. For a DM that
    // is the channel, so a drawer opened on any one of its conversations shows
    // the whole DM's trail rather than the single message that started it.
    const scope = await this.scopeOf(conversationId);
    const scopeKey = scope?.key ?? conversationId;
    const messageScope = scope?.isDmChannel
      ? { conversation: { channelId: scope.channelId } }
      : { conversationId };

    const runs = await prisma.executionRunLog.findMany({
      where: { workspaceId: auth.workspaceId, conversationId: scopeKey },
      orderBy: { createdAt: 'desc' },
      take: MAX_DEBUG_RUNS,
    });

    const [threadState, latestMessage, items] = await Promise.all([
      prisma.executionThreadState.findUnique({
        where: { conversationId: scopeKey },
        select: { watermarkCreatedAt: true, watermarkMsgId: true, updatedAt: true },
      }),
      prisma.message.findFirst({
        where: { ...messageScope, isDeleted: false },
        orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
        select: { messageId: true, createdAt: true, senderId: true, content: true },
      }),
      // Every item the thread ever produced (resolved included), so a debug
      // lookup by thread id can render the full trail set.
      prisma.executionItem.findMany({
        where: {
          ...(scope?.isDmChannel ? { channelId: scope.channelId } : { conversationId }),
          workspaceId: auth.workspaceId,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true, status: true },
      }),
    ]);

    // The watermark as a message rather than a timestamp: "processed till 4
    // minutes ago" does not say which message that was, which is the thing
    // anyone reading this panel is trying to establish.
    const watermarkMessage = threadState?.watermarkMsgId
      ? await prisma.message.findUnique({
          where: { messageId: threadState.watermarkMsgId },
          select: { messageId: true, createdAt: true, senderId: true, content: true },
        })
      : null;

    const asPreview = (
      m: { messageId: string; createdAt: Date; senderId: string | null; content: string } | null
    ) =>
      m && {
        messageId: m.messageId,
        createdAt: m.createdAt,
        senderId: m.senderId,
        text: stripHtml(m.content).slice(0, 300),
      };

    return {
      runs,
      threadState,
      latestMessage: asPreview(latestMessage),
      watermarkMessage: asPreview(watermarkMessage),
      items,
    };
  }

  private async openItems(auth: AuthContext, filter: Record<string, unknown>): Promise<FeedItem[]> {
    // `muted` is not a column — it belongs to whoever is asking, and is filled
    // in by buildFeed once their rules have been read. Defaulted here so the
    // rest of the pipeline never handles a half-built item.
    const rows = await prisma.executionItem.findMany({
      where: {
        workspaceId: auth.workspaceId,
        status: 'OPEN',
        ...filter,
      },
      orderBy: { updatedAt: 'desc' },
      take: FEED_SCAN_LIMIT,
      select: {
        id: true,
        conversationId: true,
        channelId: true,
        sourceMessageId: true,
        title: true,
        contextSummary: true,
        requestedBy: true,
        pendingOn: true,
        mentionedGroupIds: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({ ...row, muted: false }));
  }

  private groupByThread(
    items: FeedItem[],
    conversations: Map<string, FeedConversation>
  ): FeedThreadCard[] {
    if (items.length === 0) return [];

    const cards = new Map<string, FeedThreadCard>();
    for (const item of items) {
      const conversation = conversations.get(item.conversationId);
      // Resolved from the conversation, not item.channelId — same reason as the
      // ACL above: one migration path moves a conversation without it.
      const channelId = conversation?.channelId ?? item.channelId;
      const scopeKey = scopeKeyFor(conversation?.scopeType, channelId, item.conversationId);
      const isDmCard = scopeKey !== item.conversationId;

      let card = cards.get(scopeKey);
      if (!card) {
        card = {
          scopeKey,
          conversationId: item.conversationId,
          channelId,
          // A DM card spans conversations, so one conversation's opening message
          // is not the card's subject. The channel label is, and the header
          // already renders it.
          threadPreview: isDmCard ? null : threadPreviewOf(conversation?.initial_message_md),
          lastActivityAt: conversation?.lastActivityAt ?? null,
          items: [],
        };
        cards.set(scopeKey, card);
      } else if (
        conversation?.lastActivityAt &&
        (!card.lastActivityAt || conversation.lastActivityAt > card.lastActivityAt)
      ) {
        // Newest activity across everything the card covers, or a busy DM would
        // sort by whichever of its conversations happened to be seen first.
        card.lastActivityAt = conversation.lastActivityAt;
      }
      card.items.push(item);
    }

    // Newest thread activity first; items inside a card are already
    // updatedAt-desc from the query.
    return [...cards.values()].sort(
      (a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0)
    );
  }
}

export const radarFeedService = new RadarFeedService();
