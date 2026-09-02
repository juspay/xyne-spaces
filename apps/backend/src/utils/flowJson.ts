/**
 * Shared FlowJSON text extraction helpers.
 *
 * FlowJSON messages are stored as
 * `<div data-flow-json="...escaped JSON...">Flow JSON</div>`. The visible text
 * node ("Flow JSON") is meaningless — the real content lives inside the escaped
 * JSON `data-flow-json` attribute. These helpers walk the component tree and
 * return readable plaintext.
 *
 * This lives in `utils` (not inside a zero side-effect handler) so it can be
 * shared by notification building, Vespa indexing, mention scanning AND the
 * automation trigger layer without creating an import cycle
 * (messages-handler imports the trigger, so the trigger must not import back
 * into messages-handler).
 */

/**
 * Extract plaintext content strings from a FlowJSON payload for notification
 * preview and mention scanning.
 *
 * Walks the component tree and collects every text `content` prop, then joins
 * them. Returns '' for non-flow / unparseable content.
 */
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

/**
 * Like extractTextFromFlowJson but strips mrkdwn tokens for display in
 * notification previews (user mentions removed, broadcast → @channel, etc.).
 */
export function extractCleanTextFromFlowJson(content: string): string {
  const raw = extractTextFromFlowJson(content);
  return cleanNotificationText(raw);
}

/**
 * For flow JSON messages, returns the extracted plaintext from the FlowJSON
 * component tree (suitable for mention scanning and notification preview).
 * Returns null for non-flow-json content.
 */
export function getFlowJsonContentForNotification(content: string): string | null {
  if (!content.includes('data-flow-json')) return null;
  return extractCleanTextFromFlowJson(content) || null;
}

/** Returns raw FlowJSON text with tokens intact (for mention scanning). */
export function getFlowJsonRawTextForMentions(content: string): string | null {
  if (!content.includes('data-flow-json')) return null;
  return extractTextFromFlowJson(content) || null;
}
