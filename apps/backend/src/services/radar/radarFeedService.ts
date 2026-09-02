import { DatabaseClient } from '@/database/client';
import { canAccessConversation, viewerChannelAccess } from '@/services/radar/radarAcl';

const prisma = DatabaseClient.getInstance();

/** Feeds page per thread-card, not per item; this bounds what the viewer sees. */
export const MAX_FEED_ITEMS = 500;
/** Over-fetch: capping before the ACL filter would silently shorten the feed. */
export const FEED_SCAN_LIMIT = MAX_FEED_ITEMS * 4;
const THREAD_PREVIEW_CHARS = 200;
/** Worker runs shown in one thread's debug drawer, newest first. */
const MAX_DEBUG_RUNS = 50;

interface AuthContext {
  userId: string;
  workspaceId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

/** The conversation columns the feed needs, read once per request. */
interface FeedConversation {
  conversationId: string;
  channelId: string;
  initial_message_md: string | null;
  lastActivityAt: Date;
}

export interface FeedThreadCard {
  conversationId: string;
  channelId: string;
  threadPreview: string | null;
  lastActivityAt: Date | null;
  items: FeedItem[];
}

/**
 * The two GIN-backed reads the engine exists to serve:
 *
 * - Pending Me: pendingOn ∋ me.
 * - Waiting On: requestedBy ∋ me, minus items I also hold. An ownerless item
 *   (pendingOn: []) stays here — tracked, nobody on the hook yet.
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
  ): Promise<FeedThreadCard[]> {
    const items = await this.openItems(auth, filter);
    if (items.length === 0) return [];
    const conversations = await this.conversationsFor(items.map(i => i.conversationId));
    return this.groupByThread(await this.aclFilter(auth, items, conversations), conversations);
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
  ): Promise<FeedItem[]> {
    if (items.length === 0) return items;
    // Resolve each item's channel from its conversation rather than trusting
    // item.channelId, which is stamped at creation and never refreshed. An
    // item whose conversation has since vanished is denied.
    const access = await viewerChannelAccess(
      auth,
      [...conversations.values()].map(c => c.channelId),
    );
    return items
      .filter(i => {
        const channelId = conversations.get(i.conversationId)?.channelId;
        return channelId ? access.get(channelId)?.allowed : false;
      })
      .slice(0, MAX_FEED_ITEMS);
  }

  /**
   * conversationId -> everything the feed needs from the conversation row, in
   * one query: the channel for the ACL check, plus the preview and activity
   * stamp the cards render.
   */
  private async conversationsFor(
    conversationIds: string[],
  ): Promise<Map<string, FeedConversation>> {
    const unique = [...new Set(conversationIds)];
    if (unique.length === 0) return new Map();
    const conversations = await prisma.conversation.findMany({
      where: { conversationId: { in: unique } },
      select: {
        conversationId: true,
        channelId: true,
        initial_message_md: true,
        lastActivityAt: true,
      },
    });
    return new Map(conversations.map(c => [c.conversationId, c]));
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
    // Authorize against the conversation, not item.channelId: that column is a
    // stamp taken when the item was created and is never refreshed.
    if (!(await canAccessConversation(auth, item.conversationId))) return null;
    const mutations = await prisma.executionItemMutation.findMany({
      where: { itemId },
      orderBy: { createdAt: 'asc' },
    });

    const messageIds = [
      ...new Set(
        [item.sourceMessageId, ...mutations.map(m => m.sourceMessageId)].filter(
          (id): id is string => !!id,
        ),
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
    const stripHtml = (html: string): string =>
      html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const sourceMessages = Object.fromEntries(
      messages.map(m => [
        m.messageId,
        {
          senderId: m.senderId,
          senderName: m.sender?.name ?? 'Unknown',
          text: stripHtml(m.content).slice(0, 300),
          createdAt: m.createdAt,
        },
      ]),
    );

    const [threadState, latestMessage] = await Promise.all([
      prisma.executionThreadState.findUnique({
        where: { conversationId: item.conversationId },
        select: { watermarkCreatedAt: true, watermarkMsgId: true, updatedAt: true },
      }),
      prisma.message.findFirst({
        where: { conversationId: item.conversationId, isDeleted: false },
        orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
        select: { messageId: true, createdAt: true },
      }),
    ]);

    return { item, mutations, sourceMessages, threadState, latestMessage };
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

    const runs = await prisma.executionRunLog.findMany({
      where: { workspaceId: auth.workspaceId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_DEBUG_RUNS,
    });

    const [threadState, latestMessage, items] = await Promise.all([
      prisma.executionThreadState.findUnique({
        where: { conversationId },
        select: { watermarkCreatedAt: true, watermarkMsgId: true, updatedAt: true },
      }),
      prisma.message.findFirst({
        where: { conversationId, isDeleted: false },
        orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
        select: { messageId: true, createdAt: true },
      }),
      // Every item the thread ever produced (resolved included), so a debug
      // lookup by thread id can render the full trail set.
      prisma.executionItem.findMany({
        where: { conversationId, workspaceId: auth.workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true, status: true },
      }),
    ]);
    return { runs, threadState, latestMessage, items };
  }

  private openItems(auth: AuthContext, filter: Record<string, unknown>): Promise<FeedItem[]> {
    return prisma.executionItem.findMany({
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
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private groupByThread(
    items: FeedItem[],
    conversations: Map<string, FeedConversation>,
  ): FeedThreadCard[] {
    if (items.length === 0) return [];

    const cards = new Map<string, FeedThreadCard>();
    for (const item of items) {
      let card = cards.get(item.conversationId);
      if (!card) {
        const conversation = conversations.get(item.conversationId);
        card = {
          conversationId: item.conversationId,
          channelId: item.channelId,
          threadPreview:
            conversation?.initial_message_md?.slice(0, THREAD_PREVIEW_CHARS) ?? null,
          lastActivityAt: conversation?.lastActivityAt ?? null,
          items: [],
        };
        cards.set(item.conversationId, card);
      }
      card.items.push(item);
    }

    // Newest thread activity first; items inside a card are already
    // updatedAt-desc from the query.
    return [...cards.values()].sort(
      (a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0),
    );
  }
}

export const radarFeedService = new RadarFeedService();
