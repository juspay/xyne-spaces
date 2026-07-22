import type { MentionResult } from '@xyne/shared';
import { convertCustomEmojiUrls } from '../../../utils/customEmojiUtils';
import { convertTrailingEmoticonsInHtml } from '../../../utils/emojiLookup';
/**
 * Escapes special HTML characters to prevent XSS attacks.
 * Must be applied to all user-provided data before inserting into HTML.
 */
const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const sanitizeHtmlContent = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const scripts = doc.querySelectorAll('script');
  scripts.forEach(script => script.remove());

  const allElements = doc.querySelectorAll('*');
  allElements.forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
};

/**
 * Converts plain text @mentions to proper mention spans by matching against known users.
 * Only matches @Name patterns that are NOT already inside a data-mention span.
 * Uses a single regex pass for O(M) complexity instead of O(N*M).
 */
const convertPlainTextMentionsToSpans = (htmlContent: string, users: MentionResult[]): string => {
  if (!users || users.length === 0) return htmlContent;

  // Create a map of users for quick lookup, keyed by the "clean name" (lowercase for case-insensitive matching)
  const userMap = new Map<string, MentionResult>();
  for (const user of users) {
    const cleanName = user.name.replace(/ \(you\)$/, '');
    userMap.set(cleanName.toLowerCase(), user);
  }

  // Get all unique clean names, sort by length descending to match "John Doe" before "John"
  const allCleanNames = Array.from(userMap.keys());
  allCleanNames.sort((a, b) => b.length - a.length);

  if (allCleanNames.length === 0) {
    return htmlContent;
  }

  // Escape names for regex and join with '|' to create one pattern
  const patternParts = allCleanNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${patternParts.join('|')})(?=[\\s,.!?;:)\\]\\}<]|$)`, 'gi');

  // Perform a single replace operation
  return htmlContent.replace(pattern, (match, capturedName: string, offset: number) => {
    // Check if the match is inside an existing mention span using the correct offset
    const beforeMatch = htmlContent.substring(0, offset);
    const lastOpenSpan = beforeMatch.lastIndexOf('<span');
    const lastCloseSpan = beforeMatch.lastIndexOf('</span>');

    if (lastOpenSpan > lastCloseSpan) {
      const spanTag = beforeMatch.substring(lastOpenSpan);
      if (spanTag.includes('data-mention')) {
        return match; // Don't replace, it's already a mention
      }
    }

    const user = userMap.get(capturedName.toLowerCase());
    if (!user) return match; // Safe fallback

    // Create the new mention span (use original name casing from user object)
    // Apply HTML escaping to prevent XSS attacks
    const originalName = user.name.replace(/ \(you\)$/, '');
    const escapedName = escapeHtml(originalName);
    const escapedId = escapeHtml(user.id);
    return `<span data-mention="" data-mention-type="user" data-user-id="${escapedId}" data-username="${escapedName}" class="chat-input-mention">@${escapedName}</span>`;
  });
};

/**
 * Converts blob URLs to stream URLs for custom emojis.
 * Matches img tags with data-emoji-id attribute and blob: src,
 * then replaces the src with the permanent stream endpoint.
 */

export const processMessageForSending = (htmlContent: string, users?: MentionResult[]): string => {
  const sanitized = sanitizeHtmlContent(htmlContent);

  let processed = sanitized;
  processed = processed.replace(/\u200B(<span[^>]*data-mention[^>]*>.*?<\/span>)\u200B/g, '$1');
  processed = processed.replace(/\u200B(@[^\u200B<]+)\u200B/g, '$1');

  // Convert plain text mentions to proper mention spans if users are provided
  if (users && users.length > 0) {
    processed = convertPlainTextMentionsToSpans(processed, users);
  }

  // Convert blob URLs to stream URLs for custom emojis
  processed = convertCustomEmojiUrls(processed);

  // Convert trailing text emoticons (e.g. ":)" at end of message) to emoji
  processed = convertTrailingEmoticonsInHtml(processed);

  return processed;
};

export const containsSpecialBroadcastMention = (content: string): boolean => {
  if (!content) return false;

  // Mention node form from editor
  const specialMentionSpanRegex =
    /<span[^>]*class="[^"]*chat-input-special-mention[^"]*"[^>]*data-mention-type="(channel|here)"[^>]*>/i;
  if (specialMentionSpanRegex.test(content)) {
    return true;
  }

  // Plain text form (including code blocks): show warning but let backend treat as plain text when disabled.
  const textContent = new DOMParser().parseFromString(content, 'text/html').body.textContent ?? '';
  return /@(?:channel|here)\b/i.test(textContent);
};
