import React from 'react';

export type InternalXyneLinkKind =
  | 'canvas'
  | 'channel'
  | 'thread'
  | 'message'
  | 'ticket'
  | 'unknown';

export interface ParsedInternalXyneLink {
  kind: InternalXyneLinkKind;
  href: string;
  channelId?: string;
  conversationId?: string;
  ticketId?: string;
  messageId?: string;
  canvasId?: string;
}

export type AnchorTargetProps = Pick<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'target' | 'rel'
>;

const INTERNAL_XYNE_HOSTS = new Set([
  'spaces.xyne.juspay.net',
  'app.spaces.xyne.juspay.net',
  'spaces.sandbox.xyne.juspay.net',
  'xyne-spaces.web.app',
  'localhost',
  '127.0.0.1',
]);

export const parseInternalXyneLink = (href: string): ParsedInternalXyneLink | null => {
  try {
    const url = new URL(href, window.location.origin);
    const isOurHost =
      INTERNAL_XYNE_HOSTS.has(url.hostname) || url.origin === window.location.origin;
    if (!isOurHost) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'chat') {
      return {
        kind: 'unknown',
        href,
      };
    }

    if (segments[1] === 'canvas' && segments[2]) {
      return {
        kind: 'canvas',
        href,
        canvasId: segments[2],
      };
    }

    if (segments.length < 3) {
      return null;
    }

    const section = segments[1];
    if (!section || !['dir', 'activity', 'dm', 'bookmarks'].includes(section)) {
      return null;
    }

    const channelId = segments[2];
    if (!channelId) {
      return null;
    }

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const queryConversationId = url.searchParams.get('conversationId') || undefined;
    const hashConversationId = hashParams.get('origin') || undefined;
    const hasThreadPath = Boolean(segments[3] && segments[3] !== 'tickets');
    const conversationId =
      (hasThreadPath ? segments[3] : undefined) || queryConversationId || hashConversationId;
    const ticketId =
      (segments[3] === 'tickets' ? segments[4] : undefined) ||
      url.searchParams.get('ticketId') ||
      undefined;
    const messageId = hashParams.get('messageId') || undefined;

    let kind: InternalXyneLinkKind = 'channel';
    if (ticketId) {
      kind = 'ticket';
    } else if (hasThreadPath) {
      kind = 'thread';
    } else if (hashConversationId && !hasThreadPath) {
      kind = 'message';
    } else if (messageId) {
      kind = 'message';
    } else if (conversationId) {
      kind = 'thread';
    }

    return {
      kind,
      href,
      channelId,
      ...(conversationId ? { conversationId } : {}),
      ...(ticketId ? { ticketId } : {}),
      ...(messageId ? { messageId } : {}),
    };
  } catch {
    return null;
  }
};

const normalizeUrlForComparison = (value: string): string => value.trim().replace(/\/+$/, '');

export const isExternalUrl = (url: string): boolean => {
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return true;
  }
};

export const getAnchorTargetProps = (url: string): AnchorTargetProps => {
  return isExternalUrl(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
};

const extractTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join('');
  }
  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: React.ReactNode }>;
    return extractTextFromChildren(element.props.children);
  }
  return '';
};

export const shouldReplaceWithSemanticLabel = (
  children: React.ReactNode,
  href: string,
): boolean => {
  const text = extractTextFromChildren(children).trim();
  if (!text) return true;
  return normalizeUrlForComparison(text) === normalizeUrlForComparison(href);
};

export const getInternalLinkLabel = (
  parsedLink: ParsedInternalXyneLink,
  channelName: string | undefined,
  ticketXyneId: string | undefined,
  canvasTitle: string | undefined,
): string => {
  const channelLabel = channelName ? `#${channelName}` : 'channel';

  switch (parsedLink.kind) {
    case 'canvas':
      return canvasTitle ? `Canvas: ${canvasTitle}` : 'Open canvas';
    case 'ticket':
      return ticketXyneId ? `Ticket ${ticketXyneId}` : 'View ticket';
    case 'message':
      return channelName ? `Message in ${channelLabel}` : 'View message';
    case 'thread':
      return channelName ? `Thread in ${channelLabel}` : 'Open thread';
    case 'channel':
      return channelName ? `Open ${channelLabel}` : 'Open channel';
    default:
      return 'Open link';
  }
};
