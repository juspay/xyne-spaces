// backend/src/utils/urlUtils.ts
import { config } from '@/config/env';
import { NodeType, parse, type HTMLElement, type Node } from 'node-html-parser';

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

const TOP_TLDS = [
  // global / generic
  "com","org","net","info","biz","io","app","dev","ai","xyz","online","site","tech","cloud","shop","store",
  "blog","live","pro","me","tv","fm","gg","loan","media","design","solutions","systems","agency","network",
  "company","digital","group","software","tools","support","data",

  // country / major
  "us","uk","de","jp","fr","nl","ru","br","au","ca","in","it","es","se","no","fi","be","ch","pl","pt","mx","ar",
  "cl","co","tr","kr","tw","hk","sg","id","my","th","vn","ph","za","eg","ae","sa","il","gr","ie","cz","hu","ro",

  // misc commons
  "edu","gov","mil","int"
];

// Add a few multi-part ccTLDs common in the wild (escaped)
const EXTRA_MULTI_PART_TLDS = ["co\\.uk", "co\\.in", "com\\.au", "com\\.br", "com\\.mx"];

// Build the final TLD group for regex. Escape any dots already present.
const ALL_TLDS = [...TOP_TLDS.map(t => t.replace(/\./g, "\\.")), ...EXTRA_MULTI_PART_TLDS];
const TLD_GROUP = ALL_TLDS.join("|");

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
      .replace(/&#13;/g, '\r')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
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

/**
 * Remove HTML tags and replace them with spaces (so adjacent words don't glue together).
 * Also performs a lightweight decode of common HTML entities and collapses whitespace.
 */
export function stripAndDecodeHtml(input: string): string {
  if (!input) return "";

  // 1) Remove tags
  let s = input.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<pre[\s\S]*?<\/pre>/gi, " ");
  s = s.replace(/<code[\s\S]*?<\/code>/gi, " ");
  s = s.replace(/<\/?[^>]+>/g, " "); // remove remaining tags

  // 2) Decode common entities (basic, covers majority cases)
  s = s.replace(/&amp;/g, "&")
       .replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'");

  // Numeric entities (decimal & hex)
  s = s.replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)));
  s = s.replace(/&#x([0-9A-Fa-f]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));

  // 3) Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Main regex:
 * - Optional protocol (http/https)
 * - Optional www.
 * - domain/subdomains (letters/digits/hyphen)
 * - a dot + TLD (from curated list), TLD is required
 * - optional path/query/fragment until whitespace or < " ' >
 *
 * We use a negative lookbehind to avoid matching things that look like emails (user@domain)
 * and simple trimming of surrounding punctuation is done after matching.
 */
export const URL_REGEX = new RegExp(
  String.raw`(?<![@\w\/])((?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:${TLD_GROUP})(?:\/[^\s<>"')\]]*)?)`,
  "gi"
);

/** Trim leading/trailing punctuation that can get captured in loose contexts. */
function trimSurroundingPunctuation(s: string): string {
  return s.replace(/^[\(\[\<"'“‘\s]+|[\)\]\>\.'"”’\s,:;]+$/g, "");
}

/**
 * Extract all unique URLs from some (possibly HTML) text.
 * Returns array in order of first occurrence.
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];

  const clean = stripAndDecodeHtml(text);
  const matches = [...clean.matchAll(URL_REGEX)].map(m => m[1]);

  if (!matches || matches.length === 0) return [];

  // Trim punctuation and dedupe while preserving first-occurrence order
  const seen = new Set<string>();
  const result: string[] = [];
  for (let raw of matches) {
    const trimmed = trimSurroundingPunctuation(raw);
    if (!trimmed) continue;

    // If protocol missing and it looks like a bare domain, keep as-is (frontend can add https://)
    // Normalize trailing punctuation removed above.
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Extract first URL or null.
 */
export function extractFirstUrl(text: string): string | null {
  const urls = extractUrls(text);
  return urls.length > 0 ? urls[0] : null;
}

// ---------------------------------------------------------------------------
// Internal link detection
// ---------------------------------------------------------------------------

const INTERNAL_HOSTS = [
  'spaces.xyne.juspay.net',
  'spaces.sandbox.xyne.juspay.net',
  'app.spaces.xyne.juspay.net',
  'xyne-spaces.web.app',
];

const INTERNAL_HOSTS_WITH_PORT = [
  'localhost:5173',
  '127.0.0.1:5173',
];

// Pre-compiled regex for internal URL extraction (avoids creating new RegExp on each call)
// Matches: production and sandbox domains. Allows an optional `/{workspaceId}` segment
// between the host and `/chat/...` (introduced by org/workspace routing, XYNE-11716).
const INTERNAL_URL_REGEX =
  /https?:\/\/(?:spaces\.xyne\.juspay\.net|spaces\.sandbox\.xyne\.juspay\.net|app\.spaces\.xyne\.juspay\.net|xyne-spaces\.web\.app|localhost:\d+|127\.0\.0\.1:\d+)(?:\/[^/\s]+)?\/chat\/[^\s<>"'\)\]]*/i;

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
