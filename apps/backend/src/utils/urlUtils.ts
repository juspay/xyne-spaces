// backend/src/utils/urlUtils.ts
import { config } from '@/config/env';
import { NodeType, parse, type HTMLElement, type Node } from 'node-html-parser';
import { stripAndDecodeHtml, trimSurroundingPunctuation } from '@xyne/shared';

/**
 * URL detection utilities
 *
 * - Strips HTML tags and decodes common HTML entities before running regex.
 * - Matches bare domains (google.com), www-prefixed domains, and http(s) URLs.
 * - Uses a curated list of ~100 common TLDs (expandable).
 *
 * Usage:
 *   extractUrls('<p>google.com</p>') => ['google.com']
 *   extractFirstUrl('<a>https://example.com/foo</a>') => 'https://example.com/foo'
 */

// URL detection itself (extractUrls & co.) lives in @xyne/shared so the encryption
// service's link extractor and this file use one implementation; re-exported here.
export {
  extractUrls,
  extractFirstUrl,
  stripAndDecodeHtml,
  URL_REGEX,
} from '@xyne/shared';

export function canonicalizeMessageLink(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  let absolute = trimmed;
  try {
    const direct = new URL(trimmed);
    if (direct.protocol !== 'http:' && direct.protocol !== 'https:') return null;
  } catch {
    if (trimmed.startsWith('//')) {
      absolute = `http:${trimmed}`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(absolute);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

const RENDERED_AUTO_LINK_REGEX = /https?:\/\/[^\s<|]+[^<>|.,:;"')\]\s]/gi;
const AUTO_LINK_EXCLUDED_TAGS = new Set(['a', 'code', 'pre', 'script', 'style']);

function collectMessageLinks(node: Node, links: Set<string>): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    for (const match of node.text.matchAll(RENDERED_AUTO_LINK_REGEX)) {
      const canonical = canonicalizeMessageLink(match[0]);
      if (canonical) links.add(canonical);
    }
    return;
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) return;

  const element = node as HTMLElement;
  // node-html-parser represents the document root as an element without a tag name.
  const tagName = (element.rawTagName || '').toLowerCase();
  if (tagName === 'a') {
    const href = element.getAttribute('href');
    if (!href) return;
    const canonical = canonicalizeMessageLink(href);
    if (canonical) links.add(canonical);
    return;
  }

  if (AUTO_LINK_EXCLUDED_TAGS.has(tagName)) return;
  for (const child of element.childNodes) collectMessageLinks(child, links);
}

export function extractMessageLinks(content: string): string[] {
  if (typeof content !== 'string' || !content) return [];

  const links = new Set<string>();

  try {
    const root = parse(content);
    collectMessageLinks(root, links);
  } catch {
    // Malformed imported HTML should not block message ingestion.
  }

  return [...links];
}

const FLOW_TEXT_LINK_REGEX =
  /<(https?:[^|>]+)\|[^>]+>|<(https?:[^>\s]+)>|(https?:\/\/[^\s<>|]+[^\s<>|.,:;"')\]])/g;

export function extractFlowTextLinks(text: string): string[] {
  if (!text) return [];

  const links = new Set<string>();
  for (const match of text.matchAll(FLOW_TEXT_LINK_REGEX)) {
    const candidate = match[1] ?? match[2] ?? match[3];
    if (!candidate) continue;
    const canonical = canonicalizeMessageLink(candidate);
    if (canonical) links.add(canonical);
  }

  return [...links];
}

const FLOW_LINK_PROPS = ['href', 'url', 'detailsUrl'] as const;

function collectFlowLinks(components: unknown[], links: Set<string>): void {
  for (const comp of components) {
    if (!comp || typeof comp !== 'object') continue;
    const c = comp as Record<string, unknown>;

    if (c['props'] && typeof c['props'] === 'object') {
      const props = c['props'] as Record<string, unknown>;

      for (const key of FLOW_LINK_PROPS) {
        const value = props[key];
        if (typeof value !== 'string' || !value.trim()) continue;
        const canonical = canonicalizeMessageLink(value);
        if (canonical) links.add(canonical);
      }

      const text = props['content'];
      if (typeof text === 'string' && text) {
        for (const link of extractFlowTextLinks(text)) links.add(link);
      }
    }

    if (Array.isArray(c['children'])) {
      collectFlowLinks(c['children'] as unknown[], links);
    }
  }
}

function extractFlowJsonLinks(content: string): string[] {
  const attrMatch = content.match(/data-flow-json="([^"]+)"/);
  if (!attrMatch?.[1]) return [];

  try {
    const json = attrMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r');
    const flow = JSON.parse(json) as { components?: unknown[] };

    const links = new Set<string>();
    if (Array.isArray(flow.components)) collectFlowLinks(flow.components, links);
    return [...links];
  } catch {
    return [];
  }
}

export function extractLinksFromContent(content: string): string[] {
  if (typeof content !== 'string' || !content) return [];

  try {
    return [
      ...new Set([...extractFlowJsonLinks(content), ...extractMessageLinks(content)]),
    ];
  } catch {
    return [];
  }
}


// ---------------------------------------------------------------------------
// Internal link detection
// ---------------------------------------------------------------------------

// First-party app hosts: FRONTEND_URL's host plus INTERNAL_APP_HOSTS (deployment
// config — no hostnames are hardcoded here). Entries carrying a port are matched
// on `host` (hostname:port); the rest on `hostname`.
function frontendHost(): string | null {
  try {
    return new URL(config.frontendUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

const CONFIGURED_HOSTS = [...new Set([frontendHost(), ...config.internalAppHosts].filter((h): h is string => !!h))];

const INTERNAL_HOSTS = CONFIGURED_HOSTS.filter((h) => !h.includes(':'));

const INTERNAL_HOSTS_WITH_PORT = [
  ...CONFIGURED_HOSTS.filter((h) => h.includes(':')),
  'localhost:5173',
  '127.0.0.1:5173',
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pre-compiled regex for internal URL extraction (avoids creating new RegExp on each call)
// Matches: the configured app hosts and local dev hosts. Allows an optional `/{workspaceId}`
// segment between the host and `/chat/...` (introduced by org/workspace routing, XYNE-11716).
const INTERNAL_URL_REGEX = new RegExp(
  `https?:\\/\\/(?:${[...INTERNAL_HOSTS, ...INTERNAL_HOSTS_WITH_PORT].map(escapeRegex).join('|')}|localhost:\\d+|127\\.0\\.0\\.1:\\d+)(?:\\/[^/\\s]+)?\\/chat\\/[^\\s<>"'\\)\\]]*`,
  'i'
);

export interface InternalLinkInfo {
  type: 'message' | 'conversation' | 'ticket';
  url: string;
  channelId: string;
  conversationId?: string;
  messageId?: string;
  ticketId?: string;
}

/**
 * Extract the first URL that points to our own app from (possibly HTML) text.
 * Handles localhost:port variants and the production domain.
 */
export function extractInternalUrl(text: string): string | null {
  if (!text) return null;
  const clean = stripAndDecodeHtml(text);
  const m = clean.match(INTERNAL_URL_REGEX);
  return m ? trimSurroundingPunctuation(m[0]) : null;
}

/**
 * Parse an internal app URL into its route components.
 * Returns null when the URL does not match known app patterns.
 */
export function parseInternalUrl(url: string): InternalLinkInfo | null {
  try {
    const parsed = new URL(url);
    const isAllowedHost =
      INTERNAL_HOSTS.includes(parsed.hostname) || INTERNAL_HOSTS_WITH_PORT.includes(parsed.host);
    if (!isAllowedHost) return null;

    // [/:workspaceId]/chat/(dir|dm|bookmarks|activity)/:channelId[/:conversationId][/:ticketId]
    // [/:workspaceId]/chat/(dir|dm|bookmarks|activity)/:channelId/tickets/:ticketId
    // Workspace prefix added by org/workspace routing (XYNE-11716).
    const pathMatch = parsed.pathname.match(
      /^(?:\/[^/]+)?\/chat\/(?:dir|dm|bookmarks|activity)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/
    );
    if (!pathMatch) return null;

    const channelId = pathMatch[1];
    const secondSegment = pathMatch[2];
    const thirdSegment = pathMatch[3];
    const isTicketSubroute = secondSegment === 'tickets' && !!thirdSegment;

    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const messageId = hashParams.get('messageId') ?? undefined;
    const originConversationId = hashParams.get('origin') ?? undefined;
    const queryConversationId = parsed.searchParams.get('conversationId') ?? undefined;
    const queryTicketId = parsed.searchParams.get('ticketId') ?? undefined;

    if (isTicketSubroute) {
      return {
        type: 'ticket',
        url,
        channelId,
        conversationId: queryConversationId,
        ticketId: thirdSegment,
      };
    }

    if (thirdSegment) {
      return {
        type: 'ticket',
        url,
        channelId,
        conversationId: secondSegment,
        ticketId: thirdSegment,
      };
    }

    const conversationId = secondSegment || queryConversationId || originConversationId;

    if (queryTicketId) {
      return {
        type: 'ticket',
        url,
        channelId,
        conversationId,
        ticketId: queryTicketId,
      };
    }

    if (messageId && conversationId) {
      return { type: 'message', url, channelId, conversationId, messageId };
    }

    return { type: 'conversation', url, channelId, conversationId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Xyne call link detection
// ---------------------------------------------------------------------------

export interface CallLinkInfo {
  url: string;
  externalId: string;
}

const ABSOLUTE_URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

/** Hosts (with port, when non-default) whose bare `/call/<id>` path is ours. */
function callLinkHosts(): Set<string> {
  const hosts = new Set<string>([...INTERNAL_HOSTS, ...INTERNAL_HOSTS_WITH_PORT]);

  // The invite host is deployment config, often not an app host.
  try {
    const invite = new URL(config.externalCallInviteBaseUrl);
    hosts.add(invite.hostname);
    hosts.add(invite.host);
  } catch {
    // Misconfigured — the /external/call/ shape below still matches.
  }

  return hosts;
}

/**
 * Xyne call URL -> external id, or null. Mirrors the dashboard's parseCallInviteLink:
 * `/external/call/<id>` is ours on any host, bare `/call/<id>` needs a host match.
 */
export function parseCallUrl(url: string): CallLinkInfo | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    const segments = parsed.pathname.split('/').filter(Boolean);

    if (segments[0] === 'external' && segments[1] === 'call' && segments[2]) {
      return { url, externalId: decodeURIComponent(segments[2]) };
    }

    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isOurHost = isLoopback || callLinkHosts().has(parsed.hostname) || callLinkHosts().has(parsed.host);
    if (isOurHost && segments[0] === 'call' && segments[1]) {
      return { url, externalId: decodeURIComponent(segments[1]) };
    }

    return null;
  } catch {
    return null;
  }
}

/** First Xyne call link in (possibly HTML) message content. */
export function extractCallLink(text: string): CallLinkInfo | null {
  if (!text) return null;

  const clean = stripAndDecodeHtml(text);
  for (const raw of clean.match(ABSOLUTE_URL_REGEX) ?? []) {
    const info = parseCallUrl(trimSurroundingPunctuation(raw));
    if (info) return info;
  }

  return null;
}

// ---------------------------------------------------------------------------

/**
 * Validate using native URL parser when possible.
 * If input is a bare domain (no protocol), we attempt to prepend "https://" for validation.
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    // If it's a bare domain (no protocol), try with https://
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) {
      new URL(`https://${url}`);
    } else {
      new URL(url);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the external call invite URL for a given call.
 * Uses EXTERNAL_CALL_INVITE_BASE_URL from config so the path (including any
 * /external/ prefix) is driven entirely by the environment, not hardcoded.
 */
export function buildCallInviteUrl(externalId: string): string {
  return `${config.externalCallInviteBaseUrl}/call/${externalId}`;
}
