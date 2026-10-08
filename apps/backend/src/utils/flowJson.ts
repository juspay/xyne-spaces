/**
 * Shared FlowJSON text extraction helpers.
 *
 * FlowJSON is stored as `<div data-flow-json="...escaped JSON...">Flow JSON</div>`
 * — the real text lives in the escaped attribute. Kept in `utils` (not in the
 * zero messages handler) so the automation trigger can use it without an import
 * cycle (messages-handler imports the trigger).
 */

/** Collect text `content` props from a FlowJSON tree. '' for non-flow content. */
export function extractTextFromFlowJson(content: string): string {
  const attrMatch = content.match(/data-flow-json="([^"]+)"/);
  if (!attrMatch) return '';
  try {
    const json = attrMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const flow = JSON.parse(json) as { components?: unknown[] };

    const texts: string[] = [];

    function walk(components: unknown[]): void {
      for (const comp of components) {
        if (!comp || typeof comp !== 'object') continue;
        const c = comp as Record<string, unknown>;
        if (c['props'] && typeof c['props'] === 'object') {
          const p = c['props'] as Record<string, unknown>;
          if (typeof p['content'] === 'string' && p['content'].trim()) {
            texts.push(p['content'].trim());
          }
        }
        if (Array.isArray(c['children'])) {
          walk(c['children'] as unknown[]);
        }
      }
    }

    if (Array.isArray(flow.components)) {
      walk(flow.components);
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** Strip Flow mrkdwn tokens without exposing internal entity identifiers. */
export function cleanNotificationText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<userid:[^>]+>/g, '')
    .replace(/<channelid:[^>]+>/g, '#channel')
    .replace(/<broadcast:channel>/gi, '@channel ')
    .replace(/<broadcast:here>/gi, '@here ')
    .replace(/<broadcast:([^>]+)>/gi, '@$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

/** Like extractTextFromFlowJson but strips mrkdwn tokens for display. */
export function extractCleanTextFromFlowJson(content: string): string {
  const raw = extractTextFromFlowJson(content);
  return cleanNotificationText(raw);
}

/** Extracted plaintext for a FlowJSON message; null for non-flow content. */
export function getFlowJsonContentForNotification(content: string): string | null {
  if (!content.includes('data-flow-json')) return null;
  return extractCleanTextFromFlowJson(content) || null;
}

/** Returns raw FlowJSON text with tokens intact (for mention scanning). */
export function getFlowJsonRawTextForMentions(content: string): string | null {
  if (!content.includes('data-flow-json')) return null;
  return extractTextFromFlowJson(content) || null;
}

/**
 * Message content rendered as readable plaintext: a FlowJSON payload is decoded
 * to its underlying text, and a plain message is returned unchanged. Null/empty
 * in → null out.
 */
export function toReadableMessageContent(
  content: string | null | undefined,
): string | null {
  if (!content) return null;
  return getFlowJsonContentForNotification(content) ?? content;
}
