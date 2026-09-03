import { isDeskChannelType, type Channel } from '@xyne/shared';
import type { DisplaySearchResult, DisplayEntityType } from '../../../../types/search';
import type { SidePanelState } from './PanelTypes';

// ————————————————————————————————————————————————————————————————
// Public contracts
// ————————————————————————————————————————————————————————————————

// A click on a search result resolves to exactly one of these. Navigation (desk) is a
// first-class variant — desk routes away, it doesn't render a pane.
export type ResultClickAction =
  | { kind: 'panel'; panel: NonNullable<SidePanelState> } // open this pane
  | { kind: 'navigate'; to: string; state?: unknown } // route away (desk /support, …)
  | { kind: 'userDm'; userId: string }; // user → resolve/create DM, then open (async)

// ————————————————————————————————————————————————————————————————
// Public API
// ————————————————————————————————————————————————————————————————

// The single source of truth for search-result clicks — one Map lookup.
export function resolveResultClick(
  result: DisplaySearchResult,
  channels: readonly Channel[],
): ResultClickAction | null {
  return RESULT_CLICK_RESOLVERS[result.type](result, channels);
}

// ————————————————————————————————————————————————————————————————
// Registry (bindings)
// ————————————————————————————————————————————————————————————————

// Contract: every resolver maps a result (+ the user's channels) to one action, or null when
// the result isn't routable from this screen.
type ResultClickResolver = (
  result: DisplaySearchResult,
  channels: readonly Channel[],
) => ResultClickAction | null;

// Keys: DisplayEntityType (result.type). type → resolver, bound in one block. The Record is
// total, so a new entity type won't compile until it's registered here — no silent fallthrough.
const RESULT_CLICK_RESOLVERS: Record<DisplayEntityType, ResultClickResolver> = {
  user: result => ({ kind: 'userDm', userId: result.id }),
  channel: resolveChannelClick,
  ticket: resolveTicketClick,
  conversation: resolveConversationClick,
  attachment: resolveAttachmentClick,
  collection: () => null, // knowledge-base docs aren't surfaced on this screen
};

// ————————————————————————————————————————————————————————————————
// Internal — click resolvers
// ————————————————————————————————————————————————————————————————

const SUPPORT_ROUTE = '/support';
const CHAT_DIR_ROUTE = '/chat/dir';
const DEFAULT_ATTACHMENT_MIME_TYPE = 'application/octet-stream';

// Vespa wraps query matches in <hi> tags; strip them before the name is shown in the pane
// header or used for file-type detection — a highlighted ".md" would break extension matching.
const stripHighlightTags = (value: string): string => value.replace(/<\/?hi>/gi, '');

// True when the channel is an EMAIL/Desk channel — those route to /support, not a pane.
const isDeskChannel = (channels: readonly Channel[], channelId?: string): boolean =>
  isDeskChannelType(channels.find(channel => channel.id === channelId)?.type);

// Normal channel/DM → chat pane; desk (EMAIL) channel → Support view.
function resolveChannelClick(
  result: DisplaySearchResult,
  channels: readonly Channel[],
): ResultClickAction {
  const channelId = result.searchContext?.channelId ?? result.id;
  return isDeskChannel(channels, channelId)
    ? { kind: 'navigate', to: `${SUPPORT_ROUTE}/${channelId}` }
    : { kind: 'panel', panel: { kind: 'channel', channelId } };
}

// Desk ticket → desk-ticket pane (SupportTicketDetail); board ticket → thread pane (full ticket view).
function resolveTicketClick(
  result: DisplaySearchResult,
  channels: readonly Channel[],
): ResultClickAction | null {
  const searchContext = result.searchContext;
  if (!searchContext?.channelId || !searchContext.conversationId) return null;
  if (isDeskChannel(channels, searchContext.channelId) && searchContext.xyneId) {
    return {
      kind: 'panel',
      panel: {
        kind: 'deskTicket',
        title: stripHighlightTags(result.title),
        channelId: searchContext.channelId,
        ticketXyneId: searchContext.xyneId,
        ticketId: searchContext.ticketId ?? result.id,
        conversationId: searchContext.conversationId,
      },
    };
  }
  return {
    kind: 'panel',
    panel: {
      kind: 'thread',
      thread: {
        channelId: searchContext.channelId,
        conversationId: searchContext.conversationId,
        ticketId: searchContext.ticketId ?? result.id,
      },
    },
  };
}

// Desk mail → desk-ticket pane (its ticket, scrolled to the mail); regular message → thread or channel pane.
function resolveConversationClick(result: DisplaySearchResult): ResultClickAction | null {
  const searchContext = result.searchContext;
  if (searchContext?.subApp === 'DESK') {
    if (!searchContext.channelId || !searchContext.xyneId || !searchContext.conversationId) {
      return null;
    }
    return {
      kind: 'panel',
      panel: {
        kind: 'deskTicket',
        title: stripHighlightTags(result.title),
        channelId: searchContext.channelId,
        ticketXyneId: searchContext.xyneId,
        ticketId: searchContext.ticketId ?? result.id,
        conversationId: searchContext.conversationId,
        ...(searchContext.mailId && { mailId: searchContext.mailId }),
      },
    };
  }
  if (!searchContext?.channelId || !searchContext.conversationId) return null;
  // Mirrors the message card: replies → thread pane, standalone → channel pane.
  const anchor = {
    channelId: searchContext.channelId,
    conversationId: searchContext.conversationId,
    matchedMessageId: searchContext.messageId ?? null,
  };
  return searchContext.replyCount && searchContext.replyCount > 0
    ? { kind: 'panel', panel: { kind: 'thread', thread: anchor } }
    : { kind: 'panel', panel: { kind: 'channel', ...anchor } };
}

function resolveAttachmentClick(result: DisplaySearchResult): ResultClickAction | null {
  const searchContext = result.searchContext;
  // subApp casing is inconsistent from the backend, so normalize.
  const subApp = searchContext?.subApp?.toUpperCase();
  if (subApp === 'CANVAS') {
    return { kind: 'panel', panel: { kind: 'canvas', canvasId: result.id } };
  }
  // Call recordings/transcripts aren't downloadable attachments (they live at /calls/recordings/{id},
  // not /attachments/{id}/download). Open the focused reply thread where the call was shared (CallBubble
  // renders inline) — the `thread` pane, not the `channel` container view. Falls back to the channel
  // when there's no conversation to anchor a thread to.
  if (subApp === 'TRANSCRIPT') {
    const { channelId, conversationId, messageId } = searchContext ?? {};
    if (channelId && conversationId) {
      return {
        kind: 'panel',
        panel: {
          kind: 'thread',
          thread: { channelId, conversationId, matchedMessageId: messageId ?? null },
        },
      };
    }
    return channelId ? { kind: 'panel', panel: { kind: 'channel', channelId } } : null;
  }
  // A file-backed attachment previews in the pane via its id. originalUrl/internalUrl are internal
  // storage keys (e.g. "attachments/CONVERSATION/temp/…"), not openable URLs — never window.open them.
  if (searchContext?.attachmentId) {
    return {
      kind: 'panel',
      panel: {
        kind: 'attachment',
        attachmentId: searchContext.attachmentId,
        fileName: stripHighlightTags(searchContext.fileName ?? result.title),
        mimeType: searchContext.mimeType ?? DEFAULT_ATTACHMENT_MIME_TYPE,
        fileSize: searchContext.fileSize ?? 0,
      },
    };
  }
  // No stored file id — open the channel where it was shared (mirrors navigateToAttachment).
  return searchContext?.channelId
    ? {
        kind: 'navigate',
        to: `${CHAT_DIR_ROUTE}/${searchContext.channelId}`,
        state: { attachmentId: searchContext.attachmentId ?? result.id, openAttachment: true },
      }
    : null;
}
