import { ChannelScopeType, parseForwardedMessageXml } from '@xyne/shared';

import { callPreviewFromMetadata } from '@/src/features/chat/v3/model/callPreview';
import { isFlowJsonHtml } from '@/src/utils/flowJsonMarkdown';

import { oneLine } from './contextPicks';

const PREVIEW_MAX = 100;

/** Route params that scope Xyne AI to a channel. DMs are no scope, as on the dashboard. */
export const channelScopeParams = (
  channel: { id: string; name: string; scopeType?: string | null } | undefined,
): { channelId?: string; channelName?: string } =>
  channel &&
  channel.scopeType !== ChannelScopeType.DM &&
  channel.scopeType !== ChannelScopeType.GROUP_DM
    ? { channelId: channel.id, channelName: channel.name }
    : {};

/**
 * The pill for asking about a message, never blank and never an id: a call by its name, a forward
 * by its comment or text, an agent card or empty message by its files.
 */
export const messageScopeParams = (
  message: {
    senderId: string;
    content?: string | null;
    metadata?: unknown;
    attachments?: readonly unknown[] | null;
  },
  toPlainText: (html: string) => string,
): { previewText: string; senderId?: string } => {
  const metadata = (message.metadata ?? null) as Record<string, unknown> | null;
  const call = callPreviewFromMetadata(metadata);
  if (call) return { previewText: call.title };
  const content = message.content ?? '';
  const forwarded = parseForwardedMessageXml(content);
  const html = forwarded
    ? forwarded.optionalText || forwarded.content
    : metadata?.['isFlowJson'] === true || isFlowJsonHtml(content)
      ? ''
      : content;
  const files = message.attachments?.length ?? 0;
  const fallback = files === 0 ? 'Message' : files === 1 ? 'Attachment' : `${files} Attachments`;
  return {
    previewText: oneLine(toPlainText(html)).slice(0, PREVIEW_MAX) || fallback,
    senderId: message.senderId,
  };
};
