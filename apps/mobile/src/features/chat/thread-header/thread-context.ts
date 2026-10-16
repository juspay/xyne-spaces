import { decodeHtmlEntities } from '@/src/utils/htmlText';
import type { DisplaySearchResult } from '@/src/types/search';

export type ThreadContextItem = {
  id: string;
  title: string;
  type: DisplaySearchResult['type'];
  url: string;
};
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const segment = encodeURIComponent;

/** Dashboard routes, so context replies work on every client. */
export function contextItemFromResult(result: DisplaySearchResult): ThreadContextItem | null {
  const ctx = result.searchContext;
  let url = '';
  switch (result.type) {
    case 'channel':
      url = `/chat/dir/${segment(result.id)}`;
      break;
    case 'user':
      url = `/chat/dir/user/${segment(result.id)}`;
      break;
    case 'conversation':
      if (!ctx?.channelId || !ctx.conversationId) return null;
      url = `/chat/dir/${segment(ctx.channelId)}${ctx.replyCount && ctx.replyCount > 0 ? `/${segment(ctx.conversationId)}` : ''}#origin=${segment(ctx.conversationId)}${ctx.replyCount && ctx.messageId ? `&messageId=${segment(ctx.messageId)}` : ''}`;
      break;
    case 'ticket':
      if (!ctx?.channelId || !ctx.conversationId) return null;
      url = `/chat/dir/${segment(ctx.channelId)}/${segment(ctx.conversationId)}/${segment(ctx.ticketId || result.id)}?selectedTab=details`;
      break;
    case 'attachment':
      url =
        ctx?.internalUrl ||
        ctx?.originalUrl ||
        (ctx?.channelId ? `/chat/dir/${segment(ctx.channelId)}` : '');
      break;
  }
  // No executable schemes or protocol-relative links in a posted message.
  if (!url || !/^(https?:\/\/|\/(?!\/))/.test(url)) return null;
  const title =
    result.type === 'conversation' && ctx?.channelTitle
      ? `Message in #${ctx.channelTitle}`
      : decodeHtmlEntities(result.title.replace(/<[^>]*>/g, ''));
  return { id: `${result.type}-${result.id}`, title, type: result.type, url };
}

export function buildThreadContextMessage(items: readonly ThreadContextItem[]): string {
  const labels = {
    channel: 'Channels',
    conversation: 'Messages',
    ticket: 'Tickets',
    attachment: 'Attachments',
    user: 'Users',
  };
  const groups = new Map<ThreadContextItem['type'], ThreadContextItem[]>();
  for (const item of items) groups.set(item.type, [...(groups.get(item.type) ?? []), item]);
  return [
    '<strong>Relevant Contexts:</strong>',
    ...[...groups].map(
      ([type, group]) =>
        `<strong>${labels[type]}:</strong><br>${group.map((item, i) => `&nbsp;&nbsp;&nbsp;&nbsp;${i + 1}. <a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`).join('<br>')}`,
    ),
  ].join('<br>');
}
