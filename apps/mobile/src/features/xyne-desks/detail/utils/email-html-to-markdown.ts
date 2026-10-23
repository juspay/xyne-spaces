import { htmlToMD } from '@/src/features/chat/v2/components/conversation-composer/utils/htmlToMD';

import { looksLikeHtml, preprocessEmailHtml } from './preprocess-email-html';
import { decodeBasicEntitiesWithApos, stripHtmlTags } from '@/src/utils/htmlText';

/**
 * Convert desk email HTML → chat markdown for `ConversationComposerMarkdownBody`
 * / enriched-markdown rendering.
 *
 * Mentions:
 * - Internal Xyne users (`data-user-id` on recipient pills) → chat `@mention` links
 * - External `+Name` mailto / pills without user id → plain text only
 */
export function emailHtmlToMarkdown(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const preprocessed = preprocessEmailHtml(raw);
  if (!looksLikeHtml(preprocessed)) {
    return preprocessed.trim();
  }

  const normalized = normalizeEmailMentionsForChat(preprocessed);
  return htmlToMD(normalized);
}

function stripTags(value: string): string {
  return decodeBasicEntitiesWithApos(stripHtmlTags(value)).trim();
}

function extractMentionName(text: string, fallbackEmail?: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('+')) {
    const name = trimmed.slice(1).trim();
    if (name) return name;
  }
  if (trimmed) return trimmed;
  if (fallbackEmail) {
    const local = fallbackEmail.split('@')[0]?.trim();
    if (local) return local;
  }
  return fallbackEmail || 'Recipient';
}

function attrValue(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(attrs);
  return match?.[1];
}

function chatUserMentionSpan(userId: string, name: string): string {
  const safeName = name.replace(/"/g, '');
  return `<span data-user-id="${userId}" data-username="${safeName}">@${safeName}</span>`;
}

/**
 * Flatten recipient-pill chrome, then map internal users to chat mention spans
 * and external mentions to plain text so `htmlToMD` can do the rest.
 */
function normalizeEmailMentionsForChat(html: string): string {
  let out = html;

  // Flatten nested pill chrome so outer pill matching is safe.
  out = out.replace(/<span\b[^>]*\bemail-recipient-pill-initial\b[^>]*>[\s\S]*?<\/span>/gi, '');
  out = out.replace(/<span\b[^>]*\bemail-recipient-pill-label\b[^>]*>([\s\S]*?)<\/span>/gi, '$1');
  out = out.replace(/<a\b[^>]*\bemail-recipient-pill-link\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  // Platform recipient pills: <span data-recipient-pill ...>
  out = out.replace(
    /<span\b([^>]*\bdata-recipient-pill\b[^>]*)>([\s\S]*?)<\/span>/gi,
    (_, attrs: string, inner: string) => {
      const userId = attrValue(attrs, 'data-user-id');
      const email = attrValue(attrs, 'data-recipient-email') ?? '';
      const nameFromAttr = attrValue(attrs, 'data-recipient-name');
      const name = extractMentionName(nameFromAttr || stripTags(inner), email);
      if (userId) return chatUserMentionSpan(userId, name);
      return name;
    },
  );

  // Anchors marked as recipient pills (post-dashboard normalize shape)
  out = out.replace(
    /<a\b([^>]*(?:\bdata-recipient-pill\b|\bemail-recipient-pill\b)[^>]*)>([\s\S]*?)<\/a>/gi,
    (_, attrs: string, inner: string) => {
      const userId = attrValue(attrs, 'data-user-id');
      const email =
        attrValue(attrs, 'data-recipient-email') ??
        parseMailtoEmail(attrValue(attrs, 'href') ?? '');
      const nameFromAttr = attrValue(attrs, 'data-recipient-name');
      const name = extractMentionName(nameFromAttr || stripTags(inner), email ?? undefined);
      if (userId) return chatUserMentionSpan(userId, name);
      return name;
    },
  );

  // Ingested Gmail / third-party `+Name` mailto links → plain text (external)
  out = out.replace(
    /<a\b([^>]*href=["']mailto:[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi,
    (match, attrs: string, inner: string) => {
      const text = stripTags(inner);
      if (!text.startsWith('+')) return match;
      const email = parseMailtoEmail(attrValue(attrs, 'href') ?? '') ?? undefined;
      return extractMentionName(text, email);
    },
  );

  return out;
}

function parseMailtoEmail(href: string): string | null {
  if (!href.toLowerCase().startsWith('mailto:')) return null;
  let remainder = href.slice(7);
  const queryIdx = remainder.indexOf('?');
  if (queryIdx >= 0) remainder = remainder.slice(0, queryIdx);
  const angleMatch = remainder.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim();
  return remainder.trim() || null;
}
