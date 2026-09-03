import React from 'react';

export type InternalXyneLinkKind =
  | 'canvas'
  | 'channel'
  | 'thread'
  | 'message'
  | 'ticket'
  | 'call'
  | 'unknown';

export interface ParsedInternalXyneLink {
  kind: InternalXyneLinkKind;
  href: string;
  channelId?: string;
  conversationId?: string;
  ticketId?: string;
  messageId?: string;
  canvasId?: string;
  callId?: string;
}

export type AnchorTargetProps = Pick<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'target' | 'rel'
>;

const INTERNAL_XYNE_HOSTS = new Set([
  'spaces.xyne.juspay.net',
  'app.spaces.xyne.juspay.net',
  'spaces.sandbox.xyne.juspay.net',
  'app.spaces.sandbox.xyne.juspay.net',
  'call.xyne.juspay.net',
  'call.sandbox.xyne.juspay.net',
  'xyne-spaces.web.app',
  'localhost',
  '127.0.0.1',
]);

/** Paths that should be treated as external (no internal router handling) */
const EXTERNAL_PATH_PREFIXES = ['/claw', '/claw-preview', '/changelog'];

/**
 * Extract the call id from a Xyne call invite link.
 *
 * Every call is shared through a single URL — `{EXTERNAL_CALL_INVITE_BASE_URL}
 * /call/<externalId>` — so a host can send the same link to teammates and to
 * guests. That invite host is deployment config and is not always the
 * dashboard's own origin, so the `/external/call/<id>` shape is accepted on any
 * host: it is ours and nobody else's. The bare `/call/<id>` form is the
 * dashboard's own route, so it stays behind the internal-host check.
 */
export const parseCallInviteLink = (href: string): string | null => {
  try {
    const url = new URL(href, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'external' && segments[1] === 'call' && segments[2]) {
      return segments[2];
    }

    const isOurHost =
      INTERNAL_XYNE_HOSTS.has(url.hostname) || url.origin === window.location.origin;
    if (isOurHost && segments[0] === 'call' && segments[1]) {
      return segments[1];
    }
    return null;
  } catch {
    return null;
  }
};

export const parseInternalXyneLink = (href: string): ParsedInternalXyneLink | null => {
  // Checked before the host allowlist: an invite link may point at a call host
  // that is not one of our app hosts.
  const inviteCallId = parseCallInviteLink(href);
  if (inviteCallId) {
    return { kind: 'call', href, callId: inviteCallId };
  }

  try {
    const url = new URL(href, window.location.origin);
    const isOurHost =
      INTERNAL_XYNE_HOSTS.has(url.hostname) || url.origin === window.location.origin;
    if (!isOurHost) {
      return null;
    }

    // Treat certain paths as external - no internal routing exists
    if (EXTERNAL_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
      return null;
    }

    const fallbackUnknownLink: ParsedInternalXyneLink = {
      kind: 'unknown',
      href,
    };

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'chat' && segments[1] === 'chat') {
      segments.shift();
    }
    if (segments[0] !== 'chat') {
      return fallbackUnknownLink;
    }

    if (segments[1] === 'canvas' && segments[2]) {
      return {
        kind: 'canvas',
        href,
        canvasId: segments[2],
      };
    }

    if (segments.length < 3) {
      return fallbackUnknownLink;
    }

    const section = segments[1];
    if (!section || !['dir', 'activity', 'dm', 'bookmarks'].includes(section)) {
      return fallbackUnknownLink;
    }

    const channelId = segments[2];
    if (!channelId) {
      return fallbackUnknownLink;
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

/**
 * Converts legacy internal Xyne URL formats to the current format.
 * Handles old workspace-scoped paths and legacy hostname rewrites.
 */
export const patchLegacyInternalUrl = (href: string): string => {
  try {
    const url = new URL(href, window.location.origin);
    // Legacy workspace-scoped paths: /workspace/<id>/chat/... → /chat/...
    const workspacePrefixMatch = url.pathname.match(/^\/workspace\/[^/]+(\/.*)$/);
    if (workspacePrefixMatch) {
      url.pathname = workspacePrefixMatch[1] ?? href;
      return url.toString();
    }
    return href;
  } catch {
    return href;
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
  channelLabel: string | undefined,
  ticketXyneId: string | undefined,
  canvasTitle: string | undefined,
): string => {
  switch (parsedLink.kind) {
    case 'canvas':
      return canvasTitle ? `Canvas: ${canvasTitle}` : 'Open canvas';
    case 'ticket':
      return ticketXyneId ? `Ticket ${ticketXyneId}` : 'View ticket';
    case 'message':
      return channelLabel ? `Message in ${channelLabel}` : 'View message';
    case 'thread':
      return channelLabel ? `Thread in ${channelLabel}` : 'Open thread';
    case 'channel':
      return channelLabel ? `Open ${channelLabel}` : 'Open channel';
    case 'call':
      return 'Join call';
    default:
      return 'Open link';
  }
};
