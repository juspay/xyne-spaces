import type { ChannelScopeType } from '@xyne/shared';
import { isDMChannel } from '../../components/Chat/ChatDirectory/ChatDirectory.utils';
import type { DisplayEntityType, DisplaySearchResult } from '../../types/search';
import type { ColumnSource } from './Streams.types';

/**
 * A cmd+K search result, read as "which column would this be?".
 *
 * The add palette runs the real command menu, so what comes back out of it is a
 * `DisplaySearchResult` — the same shape the menu would have *navigated* to.
 * This is the fork in the road: everywhere else in the app that result becomes a
 * route (`computeSearchResultPath`), and here it becomes a column instead.
 *
 * The two must stay in step. A result that navigates to a ticket has to lay down
 * a ticket column, not a channel scrolled near it, or the palette quietly means
 * something different from every other search box in the product. The switch
 * below is deliberately shaped like `computeSearchResultPath`'s, case for case,
 * so a change there is easy to mirror.
 *
 * Returns null when the result cannot become a column *yet* — a person you have
 * never DM'd is the only real case, because opening that DM is an async create
 * and this is a pure function. The caller says so out loud rather than dropping
 * the click on the floor.
 */
/**
 * Only what the DM lookup reads.
 *
 * Structural rather than `Channel` on purpose: the channel list arrives from
 * Zero as a deeply readonly query result, and naming the shared mutable type
 * here would force a cast at every call site to no benefit — `searchNavigation`
 * declares its own narrow shape for the same reason.
 */
interface ChannelLike {
  id: string;
  scopeType: ChannelScopeType;
  participants?: readonly { userId: string }[] | undefined;
}

export const columnFromResult = (
  result: DisplaySearchResult,
  channels: readonly ChannelLike[],
): ColumnSource | null => {
  const ctx = result.searchContext;

  switch (result.type) {
    case 'channel':
      return { kind: 'channel', channelId: result.id };

    /**
     * A person is not a column; their DM is.
     *
     * Matched the same way `computeSearchResultPath` matches it — a two-party DM
     * containing them — so the palette lands on exactly the conversation cmd+K
     * would have opened. No DM yet means there is nothing to open without
     * creating one, which is a write, and a picker should not write.
     */
    case 'user': {
      const dm = channels.find(
        channel =>
          isDMChannel(channel.scopeType) &&
          channel.participants?.length === 2 &&
          channel.participants.some(participant => participant.userId === result.id),
      );
      return dm ? { kind: 'channel', channelId: dm.id } : null;
    }

    /**
     * A message becomes a *thread* column, not a channel scrolled to it.
     *
     * The channel it lives in is usually already in the stream — that is why you
     * were searching from here — so re-opening it as a second channel column
     * would duplicate what is beside you. The thread on its own is the thing the
     * result actually pointed at.
     *
     * A root message with no replies is not a thread yet, so that one does open
     * the channel, focused on the message.
     */
    case 'conversation': {
      const channelId = ctx?.channelId;
      const conversationId = ctx?.conversationId;
      if (!channelId) return null;
      if (!conversationId) return { kind: 'channel', channelId };
      const isThread = (ctx?.replyCount ?? 0) > 0;
      return isThread
        ? { kind: 'thread', channelId, conversationId }
        : { kind: 'channel', channelId, focusConversationId: conversationId };
    }

    /**
     * Unlike the route, a ticket column does not *need* its channel and thread —
     * it renders from the ticket id alone. They are carried when present because
     * the column offers a way across to the discussion, and a ticket column
     * without one is a dead end.
     */
    case 'ticket': {
      const ticketId = ctx?.ticketId ?? result.id;
      return {
        kind: 'ticket',
        ticketId,
        ...(ctx?.channelId !== undefined ? { channelId: ctx.channelId } : {}),
        ...(ctx?.conversationId !== undefined ? { conversationId: ctx.conversationId } : {}),
      };
    }

    /**
     * `subApp` is what separates the four things Vespa files under one type.
     * Canvas is a document column; a real attachment is a file column; a
     * transcript or a recording has no column of its own, so it opens the
     * conversation it belongs to rather than nothing at all.
     */
    case 'attachment': {
      const subApp = ctx?.subApp;
      if (subApp === 'CANVAS') {
        return {
          kind: 'document',
          canvasId: result.id,
          ...(ctx?.channelId !== undefined ? { channelId: ctx.channelId } : {}),
        };
      }
      if (subApp === 'TRANSCRIPT' || subApp === 'RECORDING') {
        const channelId = ctx?.channelId;
        if (!channelId) return null;
        const conversationId = ctx.conversationId;
        return conversationId !== undefined
          ? { kind: 'thread', channelId, conversationId }
          : { kind: 'channel', channelId };
      }
      const attachmentId = ctx?.attachmentId ?? result.id;
      // The file viewer picks its renderer from the mime type *before* fetching,
      // and falls back to the extension when it is blank — which it is for older
      // indexed attachments. Passing '' is the documented fallback path, not a
      // missing value to guard against.
      return {
        kind: 'file',
        attachmentId,
        fileName: ctx?.fileName ?? result.title,
        mimeType: ctx?.mimeType ?? '',
        ...(ctx?.fileSize !== undefined ? { fileSize: ctx.fileSize } : {}),
        ...(ctx?.channelId !== undefined ? { channelId: ctx.channelId } : {}),
      };
    }

    // Knowledge-base collections have no column surface.
    default:
      return null;
  }
};

/**
 * A stream `sourceKey` re-spelled as the composite id the command menu ticks on.
 *
 * The menu marks a row chosen by string-matching `${type}-${id}`
 * (`buildContextItemFromResult`), so "already in this stream" only shows up if we
 * hand it the same spelling. Both sides are `kind:id` pairs over the same
 * entities, so this is a translation between two id dialects and nothing more —
 * which is why it takes the key rather than the source, and the palette needs no
 * new prop to answer the question.
 *
 * Null for the kinds a search result can never be: a board, the thread list, Ask
 * AI and feeds live in the palette's own header, not in the menu's corpus, so
 * no row could match them anyway.
 */
export const contextIdForKey = (key: string): { id: string; type: DisplayEntityType } | null => {
  const separator = key.indexOf(':');
  if (separator < 0) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id) return null;

  switch (kind) {
    case 'channel':
      return { id: `channel-${id}`, type: 'channel' };
    case 'ticket':
      return { id: `ticket-${id}`, type: 'ticket' };
    // `thread:` keys on the conversation id, which is what the menu calls a
    // conversation result — same entity, different word for it on each side.
    case 'thread':
      return { id: `conversation-${id}`, type: 'conversation' };
    // Canvases and attachments are one Vespa type, so both keys land on the
    // same prefix here even though the stream keeps them as separate kinds.
    case 'document':
    case 'file':
      return { id: `attachment-${id}`, type: 'attachment' };
    default:
      return null;
  }
};
